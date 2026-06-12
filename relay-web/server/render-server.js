import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";
import { WebSocketServer, WebSocket } from "ws";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const STATIC_ROOT = process.env.THEBUTTON_STATIC_ROOT
  ? path.resolve(process.cwd(), process.env.THEBUTTON_STATIC_ROOT)
  : path.resolve(path.dirname(CURRENT_FILE), "../web/dist");

const SERVER_BUILD = "the-button-v1";
const STATE_KEY = "thebutton:v1:state";
const MAX_EVENTS = 300;
const MAX_MESSAGES = 600;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 1200;
const MAX_NUKE_MESSAGE_CHARS = 240;
const RECEIVER_ACK_TIMEOUT_MS = 2500;

export function createTheButtonServer(options = {}) {
  const store = options.store || createStoreFromEnv();
  const config = resolveConfig(options);
  const rateLimiter = new RateLimiter();
  const siteSockets = new Map();
  const socketDevices = new Map();
  const receiverSockets = new Set();
  const pendingEventAcks = new Map();
  const siteWSS = new WebSocketServer({ noServer: true });
  const receiverWSS = new WebSocketServer({ noServer: true });

  const context = {
    store,
    config,
    rateLimiter,
    siteSockets,
    socketDevices,
    receiverSockets,
    pendingEventAcks
  };

  const server = createServer(async (request, response) => {
    try {
      await handleHTTP(request, response, context);
    } catch (error) {
      sendJSON(response, { error: error?.message || "internal server error" }, error?.status || 500);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", publicBaseURL(request));
    if (url.pathname === "/ws/site") {
      siteWSS.handleUpgrade(request, socket, head, websocket => {
        attachSiteSocket(websocket, url, request, context).catch(error => {
          safeSend(websocket, { type: "error", message: error?.message || "site websocket rejected" });
          closeSocket(websocket);
        });
      });
      return;
    }
    if (url.pathname === "/ws/receiver") {
      receiverWSS.handleUpgrade(request, socket, head, websocket => {
        attachReceiverSocket(websocket, url, context).catch(error => {
          safeSend(websocket, { type: "error", message: error?.message || "receiver websocket rejected" });
          closeSocket(websocket);
        });
      });
      return;
    }
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  });

  return { server, store };
}

async function handleHTTP(request, response, context) {
  const url = new URL(request.url || "/", publicBaseURL(request));
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  if (url.pathname === "/health") {
    sendJSON(response, {
      ok: true,
      service: "the-button",
      serverBuild: SERVER_BUILD,
      storage: context.store.kind,
      receiverOnline: context.receiverSockets.size > 0
    });
    return;
  }

  if (url.pathname === "/api/devices" && request.method === "POST") {
    await handleDeviceJoin(request, response, context);
    return;
  }

  if (url.pathname === "/api/events" && request.method === "POST") {
    await handleEvent(request, response, context);
    return;
  }

  if (url.pathname === "/api/messages" && request.method === "POST") {
    await handleMessage(request, response, context);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJSON(response, { error: "unknown endpoint" }, 404);
    return;
  }

  await serveStatic(response, url.pathname);
}

async function handleDeviceJoin(request, response, context) {
  const ip = clientIP(request);
  enforceRateLimit(context.rateLimiter, `join:${ip}`, 20, 60 * 60 * 1000, "too many join attempts");
  const body = await readJSONBody(request);
  requireJoinPassword(body?.password, context.config);

  const displayName = sanitizeDisplayName(body?.displayName);
  if (!displayName) {
    sendJSON(response, { error: "Choose a name between 1 and 32 characters." }, 400);
    return;
  }

  const state = await context.store.getState();
  const now = new Date().toISOString();
  const requestedID = cleanDeviceID(body?.deviceId);
  const requestedSecret = String(body?.deviceSecret || "");
  let device = requestedID ? state.devices[requestedID] : null;

  if (device?.status === "banned") {
    sendJSON(response, { error: "This device is permanently deleted.", code: "banned" }, 403);
    return;
  }

  if (device && !secretMatches(requestedSecret, device.secretHash)) {
    sendJSON(response, { error: "Saved device identity was rejected. Clear this browser and request access again.", code: "bad_secret" }, 403);
    return;
  }

  let deviceSecret = requestedSecret;
  if (!device) {
    deviceSecret = randomID(32);
    const deviceId = `btn_${randomID(12)}`;
    device = {
      deviceId,
      displayName,
      secretHash: secretHash(deviceSecret),
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      lastIpHash: hashIP(ip, context.config),
      counts: { presses: 0, messages: 0, nukes: 0 }
    };
    state.devices[deviceId] = device;
  } else {
    device.displayName = displayName;
    device.status = "active";
    device.updatedAt = now;
    device.lastSeenAt = now;
    device.lastIpHash = hashIP(ip, context.config);
  }

  pushEvent(state, {
    type: "joined",
    deviceId: device.deviceId,
    displayName: device.displayName,
    text: `${device.displayName} connected.`
  });
  await context.store.setState(state);

  broadcastReceivers(context, receiverSnapshot(state, context));
  sendJSON(response, {
    ok: true,
    device: publicDevice(device, context),
    deviceSecret,
    messages: messagesForDevice(state, device.deviceId),
    receiverOnline: context.receiverSockets.size > 0
  });
}

async function handleEvent(request, response, context) {
  const ip = clientIP(request);
  const body = await readJSONBody(request);
  const auth = await authenticateDevice(body, context);
  if (!auth.ok) {
    sendJSON(response, { error: auth.error, code: auth.code }, auth.status);
    return;
  }

  const eventType = String(body?.eventType || "");
  if (!["press", "nuke"].includes(eventType)) {
    sendJSON(response, { error: "unknown event type" }, 400);
    return;
  }

  const device = auth.device;
  enforceRateLimit(context.rateLimiter, `event:${device.deviceId}`, eventType === "nuke" ? 3 : 30, eventType === "nuke" ? 60 * 60 * 1000 : 60 * 1000, "slow down");
  enforceRateLimit(context.rateLimiter, `ip-event:${ip}`, 120, 60 * 1000, "too many requests");
  if (eventType === "nuke" && String(body?.confirm || "") !== "yes") {
    sendJSON(response, { error: "Type yes to confirm The Nuke." }, 400);
    return;
  }
  const nukeMessage = eventType === "nuke" ? sanitizeNukeMessage(body?.message) : "";
  if (eventType === "nuke" && nukeMessage == null) {
    sendJSON(response, { error: "Nuke message is too long." }, 400);
    return;
  }

  const state = await context.store.getState();
  const fresh = state.devices[device.deviceId];
  if (!fresh || fresh.status !== "active") {
    sendJSON(response, { error: "This device must request access again.", code: fresh?.status || "deleted" }, 409);
    return;
  }

  const now = new Date().toISOString();
  fresh.lastSeenAt = now;
  fresh.lastIpHash = hashIP(ip, context.config);
  fresh.counts = normalizeCounts(fresh.counts);
  if (eventType === "press") {
    fresh.counts.presses += 1;
  } else {
    fresh.counts.nukes += 1;
  }

  const event = pushEvent(state, {
    type: eventType,
    deviceId: fresh.deviceId,
    displayName: fresh.displayName,
    text: eventType === "press"
      ? `${fresh.displayName} pressed the big red button.`
      : nukeText(fresh.displayName, nukeMessage),
    ...(eventType === "nuke" && nukeMessage ? { nukeMessage } : {})
  });
  const deliveredToReceiver = waitForReceiverEventAck(context, event.id);
  await context.store.setState(state);

  broadcastReceivers(context, { type: "event", event, snapshot: receiverSnapshot(state, context) });
  sendJSON(response, { ok: true, event, deliveredToReceiver: await deliveredToReceiver });
}

async function handleMessage(request, response, context) {
  const ip = clientIP(request);
  const body = await readJSONBody(request);
  const auth = await authenticateDevice(body, context);
  if (!auth.ok) {
    sendJSON(response, { error: auth.error, code: auth.code }, auth.status);
    return;
  }

  const text = sanitizeMessage(body?.text);
  if (!text) {
    sendJSON(response, { error: "Message is empty or too long." }, 400);
    return;
  }

  enforceRateLimit(context.rateLimiter, `message:${auth.device.deviceId}`, 30, 60 * 1000, "too many messages");
  enforceRateLimit(context.rateLimiter, `ip-message:${ip}`, 90, 60 * 1000, "too many messages");

  const state = await context.store.getState();
  const device = state.devices[auth.device.deviceId];
  if (!device || device.status !== "active") {
    sendJSON(response, { error: "This device must request access again.", code: device?.status || "deleted" }, 409);
    return;
  }

  const now = new Date().toISOString();
  device.lastSeenAt = now;
  device.counts = normalizeCounts(device.counts);
  device.counts.messages += 1;
  const message = pushMessage(state, {
    deviceId: device.deviceId,
    displayName: device.displayName,
    from: "user",
    text
  });
  const event = pushEvent(state, {
    type: "message",
    deviceId: device.deviceId,
    displayName: device.displayName,
    text: `${device.displayName} sent a message.`
  });
  await context.store.setState(state);

  sendToDevice(context, device.deviceId, { type: "message", message });
  broadcastReceivers(context, { type: "message", message, event, snapshot: receiverSnapshot(state, context) });
  sendJSON(response, { ok: true, message });
}

async function attachSiteSocket(socket, url, request, context) {
  const deviceId = cleanDeviceID(url.searchParams.get("deviceId"));
  const deviceSecret = url.searchParams.get("deviceSecret") || "";
  const state = await context.store.getState();
  const device = deviceId ? state.devices[deviceId] : null;
  if (!device || !secretMatches(deviceSecret, device.secretHash)) {
    safeSend(socket, { type: "error", message: "device rejected" });
    closeSocket(socket);
    return;
  }
  if (device.status !== "active") {
    safeSend(socket, { type: device.status === "banned" ? "banned" : "deleted", deviceId });
    closeSocket(socket);
    return;
  }

  device.lastSeenAt = new Date().toISOString();
  device.lastIpHash = hashIP(clientIP(request), context.config);
  await context.store.setState(state);

  if (!context.siteSockets.has(deviceId)) {
    context.siteSockets.set(deviceId, new Set());
  }
  context.siteSockets.get(deviceId).add(socket);
  context.socketDevices.set(socket, deviceId);

  safeSend(socket, siteSnapshot(state, deviceId, context));
  broadcastReceivers(context, receiverSnapshot(state, context));

  socket.on("message", data => {
    handleSiteSocketMessage(socket, data).catch(error => {
      safeSend(socket, { type: "error", message: error?.message || "site socket error" });
    });
  });
  socket.on("close", () => handleSiteSocketClosed(socket, context).catch(() => {}));
  socket.on("error", () => handleSiteSocketClosed(socket, context).catch(() => {}));
}

async function handleSiteSocketMessage(socket, data) {
  const message = JSON.parse(String(data));
  if (message.type === "ping") {
    safeSend(socket, { type: "pong", at: new Date().toISOString() });
  }
}

async function handleSiteSocketClosed(socket, context) {
  const deviceId = context.socketDevices.get(socket);
  context.socketDevices.delete(socket);
  if (!deviceId) {
    return;
  }
  const sockets = context.siteSockets.get(deviceId);
  sockets?.delete(socket);
  if (sockets && sockets.size === 0) {
    context.siteSockets.delete(deviceId);
  }
  const state = await context.store.getState();
  broadcastReceivers(context, receiverSnapshot(state, context));
}

async function attachReceiverSocket(socket, url, context) {
  const token = url.searchParams.get("token") || "";
  if (!receiverTokenMatches(token, context.config.receiverToken)) {
    safeSend(socket, { type: "error", message: "receiver token rejected" });
    closeSocket(socket);
    return;
  }
  context.receiverSockets.add(socket);
  const state = await context.store.getState();
  safeSend(socket, receiverSnapshot(state, context));
  sendSiteSnapshots(context, state);

  socket.on("message", data => {
    handleReceiverSocketMessage(socket, data, context).catch(error => {
      safeSend(socket, { type: "error", message: error?.message || "receiver socket error" });
    });
  });
  socket.on("close", () => {
    context.receiverSockets.delete(socket);
    sendCurrentSiteSnapshots(context).catch(() => {});
  });
  socket.on("error", () => {
    context.receiverSockets.delete(socket);
    sendCurrentSiteSnapshots(context).catch(() => {});
  });
}

async function handleReceiverSocketMessage(socket, data, context) {
  const message = JSON.parse(String(data));
  if (message.type === "ping") {
    safeSend(socket, { type: "pong", at: new Date().toISOString() });
    return;
  }

  if (message.type === "eventReceived") {
    acknowledgeReceiverEvent(context, message.eventId);
    return;
  }

  if (message.type === "reply") {
    const deviceId = cleanDeviceID(message.deviceId);
    const text = sanitizeMessage(message.text);
    if (!deviceId || !text) {
      throw new Error("invalid reply");
    }
    const state = await context.store.getState();
    const device = state.devices[deviceId];
    if (!device || device.status === "banned") {
      throw new Error("device is not available");
    }
    const reply = pushMessage(state, {
      deviceId,
      displayName: device.displayName,
      from: "leo",
      text
    });
    const event = pushEvent(state, {
      type: "reply",
      deviceId,
      displayName: device.displayName,
      text: `Leo replied to ${device.displayName}.`
    });
    await context.store.setState(state);
    sendToDevice(context, deviceId, { type: "message", message: reply });
    broadcastReceivers(context, { type: "message", message: reply, event, snapshot: receiverSnapshot(state, context) });
    return;
  }

  if (message.type === "deleteDevice" || message.type === "banDevice") {
    const deviceId = cleanDeviceID(message.deviceId);
    if (!deviceId) {
      throw new Error("missing device id");
    }
    const state = await context.store.getState();
    const device = state.devices[deviceId];
    if (!device) {
      throw new Error("unknown device");
    }
    const now = new Date().toISOString();
    if (message.type === "banDevice") {
      device.status = "banned";
      device.bannedAt = now;
      pushEvent(state, {
        type: "banned",
        deviceId,
        displayName: device.displayName,
        text: `${device.displayName} was permanently deleted.`
      });
      sendToDevice(context, deviceId, { type: "banned", deviceId });
      closeDeviceSockets(context, deviceId);
    } else {
      device.status = "deleted";
      device.deletedAt = now;
      pushEvent(state, {
        type: "deleted",
        deviceId,
        displayName: device.displayName,
        text: `${device.displayName} was deleted.`
      });
      sendToDevice(context, deviceId, { type: "deleted", deviceId });
      closeDeviceSockets(context, deviceId);
    }
    device.updatedAt = now;
    await context.store.setState(state);
    broadcastReceivers(context, receiverSnapshot(state, context));
    return;
  }

  throw new Error("unknown receiver message type");
}

async function authenticateDevice(body, context) {
  const state = await context.store.getState();
  const deviceId = cleanDeviceID(body?.deviceId);
  const deviceSecret = String(body?.deviceSecret || "");
  const device = deviceId ? state.devices[deviceId] : null;
  if (!device || !secretMatches(deviceSecret, device.secretHash)) {
    return { ok: false, status: 403, error: "device rejected", code: "bad_device" };
  }
  if (device.status === "banned") {
    return { ok: false, status: 403, error: "This device is permanently deleted.", code: "banned" };
  }
  if (device.status !== "active") {
    return { ok: false, status: 409, error: "This device must request access again.", code: "deleted" };
  }
  return { ok: true, device };
}

function receiverSnapshot(state, context) {
  return {
    type: "snapshot",
    generatedAt: new Date().toISOString(),
    receiverOnline: context.receiverSockets.size > 0,
    users: Object.values(state.devices)
      .map(device => publicDevice(device, context))
      .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName))),
    events: state.events.slice(-MAX_EVENTS),
    messages: state.messages.slice(-MAX_MESSAGES),
    totals: {
      users: Object.keys(state.devices).length,
      online: [...context.siteSockets.keys()].length,
      events: state.events.length,
      messages: state.messages.length
    }
  };
}

function siteSnapshot(state, deviceId, context) {
  return {
    type: "snapshot",
    device: publicDevice(state.devices[deviceId], context),
    receiverOnline: context.receiverSockets.size > 0,
    messages: messagesForDevice(state, deviceId)
  };
}

function messagesForDevice(state, deviceId) {
  return state.messages.filter(message => message.deviceId === deviceId).slice(-200);
}

function publicDevice(device, context) {
  return {
    deviceId: device.deviceId,
    displayName: device.displayName,
    status: device.status,
    online: Boolean(context.siteSockets.get(device.deviceId)?.size),
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    lastSeenAt: device.lastSeenAt,
    counts: normalizeCounts(device.counts)
  };
}

function pushEvent(state, patch) {
  const event = {
    id: `evt_${randomID(12)}`,
    createdAt: new Date().toISOString(),
    ...patch
  };
  state.events.push(event);
  while (state.events.length > MAX_EVENTS) {
    state.events.shift();
  }
  return event;
}

function pushMessage(state, patch) {
  const message = {
    id: `msg_${randomID(12)}`,
    createdAt: new Date().toISOString(),
    ...patch
  };
  state.messages.push(message);
  while (state.messages.length > MAX_MESSAGES) {
    state.messages.shift();
  }
  return message;
}

function sendToDevice(context, deviceId, payload) {
  for (const socket of context.siteSockets.get(deviceId) || []) {
    safeSend(socket, payload);
  }
}

async function sendCurrentSiteSnapshots(context) {
  const state = await context.store.getState();
  sendSiteSnapshots(context, state);
}

function sendSiteSnapshots(context, state) {
  for (const deviceId of context.siteSockets.keys()) {
    if (state.devices[deviceId]) {
      sendToDevice(context, deviceId, siteSnapshot(state, deviceId, context));
    }
  }
}

function closeDeviceSockets(context, deviceId) {
  for (const socket of context.siteSockets.get(deviceId) || []) {
    closeSocket(socket);
  }
  context.siteSockets.delete(deviceId);
}

function broadcastReceivers(context, payload) {
  for (const socket of context.receiverSockets) {
    safeSend(socket, payload);
  }
}

async function serveStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(STATIC_ROOT, `.${safePath}`);
  if (!resolved.startsWith(STATIC_ROOT) || !existsSync(resolved)) {
    const indexPath = path.join(STATIC_ROOT, "index.html");
    if (existsSync(indexPath)) {
      await sendFile(response, indexPath);
      return;
    }
    sendJSON(response, { error: "web build not found. Run npm run build:web." }, 404);
    return;
  }
  await sendFile(response, resolved);
}

async function sendFile(response, filePath) {
  const data = await readFile(filePath);
  response.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
  response.end(data);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function readJSONBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJSON(response, value, status = 200) {
  response.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

function resolveConfig(options) {
  return {
    joinPassword: options.joinPassword ?? process.env.THEBUTTON_JOIN_PASSWORD ?? "",
    receiverToken: options.receiverToken ?? process.env.THEBUTTON_RECEIVER_TOKEN ?? "",
    ipHashSalt: options.ipHashSalt ?? process.env.THEBUTTON_IP_HASH_SALT ?? process.env.THEBUTTON_RECEIVER_TOKEN ?? "the-button-dev"
  };
}

function requireJoinPassword(value, config) {
  if (!config.joinPassword) {
    const error = new Error("THEBUTTON_JOIN_PASSWORD is not configured.");
    error.status = 503;
    throw error;
  }
  if (!constantTimeStringEqual(String(value || ""), config.joinPassword)) {
    const error = new Error("Wrong password.");
    error.status = 403;
    throw error;
  }
}

function receiverTokenMatches(value, expected) {
  return Boolean(expected) && constantTimeStringEqual(String(value || ""), expected);
}

function secretMatches(value, expectedHash) {
  return Boolean(value && expectedHash) && constantTimeStringEqual(secretHash(value), expectedHash);
}

function constantTimeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function secretHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function hashIP(ip, config) {
  return createHash("sha256").update(`${config.ipHashSalt}:${ip}`).digest("hex").slice(0, 24);
}

function randomID(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function cleanDeviceID(value) {
  const text = String(value || "").trim();
  return /^btn_[A-Za-z0-9_-]{12,64}$/.test(text) ? text : "";
}

function cleanEventID(value) {
  const text = String(value || "").trim();
  return /^evt_[A-Za-z0-9_-]{12,64}$/.test(text) ? text : "";
}

function sanitizeDisplayName(value) {
  const text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 && text.length <= 32 ? text : "";
}

function sanitizeMessage(value) {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  return text.length > 0 && text.length <= MAX_MESSAGE_CHARS ? text : "";
}

function sanitizeNukeMessage(value) {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  return text.length <= MAX_NUKE_MESSAGE_CHARS ? text : null;
}

function nukeText(displayName, message) {
  return message ? `${displayName} has nuked you: ${message}` : `${displayName} has nuked you.`;
}

function waitForReceiverEventAck(context, eventId) {
  if (context.receiverSockets.size === 0) {
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = delivered => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      context.pendingEventAcks.delete(eventId);
      resolve(delivered);
    };
    const timeout = setTimeout(() => finish(false), RECEIVER_ACK_TIMEOUT_MS);
    context.pendingEventAcks.set(eventId, finish);
  });
}

function acknowledgeReceiverEvent(context, eventId) {
  const clean = cleanEventID(eventId);
  if (!clean) {
    return;
  }
  context.pendingEventAcks.get(clean)?.(true);
}

function normalizeCounts(value) {
  return {
    presses: Number(value?.presses || 0),
    messages: Number(value?.messages || 0),
    nukes: Number(value?.nukes || 0)
  };
}

function clientIP(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "unknown";
}

function publicBaseURL(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || "127.0.0.1";
  return `${proto}://${host}`;
}

function safeSend(socket, value) {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(value));
  return true;
}

function closeSocket(socket) {
  try {
    socket.close();
  } catch {
    socket.terminate();
  }
}

function enforceRateLimit(rateLimiter, key, max, windowMs, message) {
  const result = rateLimiter.take(key, max, windowMs);
  if (!result.ok) {
    const error = new Error(message);
    error.status = 429;
    throw error;
  }
}

class RateLimiter {
  constructor() {
    this.windows = new Map();
  }

  take(key, max, windowMs) {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    current.count += 1;
    return { ok: current.count <= max, resetAt: current.resetAt };
  }
}

export function normalizeState(value = {}) {
  return {
    devices: value.devices && typeof value.devices === "object" ? value.devices : {},
    events: Array.isArray(value.events) ? value.events : [],
    messages: Array.isArray(value.messages) ? value.messages : []
  };
}

export class MemoryStore {
  constructor(initialState = {}) {
    this.kind = "memory";
    this.state = normalizeState(initialState);
  }

  async getState() {
    return normalizeState(JSON.parse(JSON.stringify(this.state)));
  }

  async setState(next) {
    this.state = normalizeState(JSON.parse(JSON.stringify(next)));
  }
}

class UpstashStore {
  constructor(redis) {
    this.kind = "upstash";
    this.redis = redis;
  }

  async getState() {
    const raw = await this.redis.get(STATE_KEY);
    if (typeof raw === "string") {
      return normalizeState(JSON.parse(raw));
    }
    return normalizeState(raw || {});
  }

  async setState(next) {
    await this.redis.set(STATE_KEY, JSON.stringify(normalizeState(next)));
  }
}

function createStoreFromEnv() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashStore(Redis.fromEnv());
  }
  console.warn("UPSTASH_REDIS_REST_URL/TOKEN are not set. Using in-memory storage.");
  return new MemoryStore();
}

if (process.argv[1] === CURRENT_FILE) {
  const { server } = createTheButtonServer();
  const port = Number(process.env.PORT || 8787);
  server.listen(port, () => {
    console.log(`The Button listening on http://127.0.0.1:${port}`);
  });
}
