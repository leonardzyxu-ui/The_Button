import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createTheButtonServer, MemoryStore } from "./render-server.js";

const openServers = [];
const openSockets = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    try {
      socket.close();
    } catch {
      socket.terminate();
    }
  }
  await Promise.all(openServers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

describe("The Button relay", () => {
  it("password-gates device join and issues browser identity", async () => {
    const { baseURL } = await startTestServer();

    const rejected = await post(baseURL, "/api/devices", { password: "wrong", displayName: "Alex" });
    expect(rejected.status).toBe(403);

    const accepted = await post(baseURL, "/api/devices", { password: "join-pass", displayName: "Alex" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.device.deviceId).toMatch(/^btn_/);
    expect(accepted.body.deviceSecret).toBeTruthy();
    expect(accepted.body.device.displayName).toBe("Alex");
  });

  it("keeps the conversation live between website and Receiver", async () => {
    const { baseURL, wsBaseURL } = await startTestServer();
    const joined = await join(baseURL, "Alex");
    const site = await connectWS(`${wsBaseURL}/ws/site?deviceId=${joined.device.deviceId}&deviceSecret=${joined.deviceSecret}`);
    const receiver = await connectWS(`${wsBaseURL}/ws/receiver?token=receiver-token`);
    await nextOfType(site, "snapshot");
    await nextOfType(receiver, "snapshot");

    const sent = await post(baseURL, "/api/messages", {
      deviceId: joined.device.deviceId,
      deviceSecret: joined.deviceSecret,
      text: "Just checking in."
    });
    expect(sent.status).toBe(200);
    const receiverMessage = await nextOfType(receiver, "message");
    expect(receiverMessage.message.text).toBe("Just checking in.");

    receiver.send(JSON.stringify({
      type: "reply",
      deviceId: joined.device.deviceId,
      text: "I see it."
    }));
    const siteReply = await nextMessageFrom(site, "leo");
    expect(siteReply.message.from).toBe("leo");
    expect(siteReply.message.text).toBe("I see it.");

    site.close();
    receiver.close();
  });

  it("requires exact yes confirmation before sending The Nuke", async () => {
    const { baseURL, wsBaseURL } = await startTestServer();
    const joined = await join(baseURL, "Alex");
    const receiver = await connectWS(`${wsBaseURL}/ws/receiver?token=receiver-token`);
    await nextOfType(receiver, "snapshot");

    const rejected = await post(baseURL, "/api/events", {
      deviceId: joined.device.deviceId,
      deviceSecret: joined.deviceSecret,
      eventType: "nuke",
      confirm: "YES"
    });
    expect(rejected.status).toBe(400);

    const acceptedPromise = post(baseURL, "/api/events", {
      deviceId: joined.device.deviceId,
      deviceSecret: joined.deviceSecret,
      eventType: "nuke",
      confirm: "yes",
      message: "Please look at the laptop."
    });
    const event = await nextOfType(receiver, "event");
    receiver.send(JSON.stringify({ type: "eventReceived", eventId: event.event.id }));
    const accepted = await acceptedPromise;
    expect(accepted.status).toBe(200);
    expect(accepted.body.deliveredToReceiver).toBe(true);
    expect(event.event.text).toBe("Alex has nuked you: Please look at the laptop.");
    expect(event.event.nukeMessage).toBe("Please look at the laptop.");
    receiver.close();
  });

  it("soft delete forces the browser to request access again", async () => {
    const { baseURL, wsBaseURL } = await startTestServer();
    const joined = await join(baseURL, "Alex");
    const site = await connectWS(`${wsBaseURL}/ws/site?deviceId=${joined.device.deviceId}&deviceSecret=${joined.deviceSecret}`);
    const receiver = await connectWS(`${wsBaseURL}/ws/receiver?token=receiver-token`);
    await nextOfType(site, "snapshot");
    await nextOfType(receiver, "snapshot");

    receiver.send(JSON.stringify({ type: "deleteDevice", deviceId: joined.device.deviceId }));
    expect((await nextOfType(site, "deleted")).deviceId).toBe(joined.device.deviceId);

    const afterDelete = await post(baseURL, "/api/events", {
      deviceId: joined.device.deviceId,
      deviceSecret: joined.deviceSecret,
      eventType: "press"
    });
    expect(afterDelete.status).toBe(409);
    expect(afterDelete.body.code).toBe("deleted");

    site.close();
    receiver.close();
  });

  it("permanent delete blocks the saved device identity", async () => {
    const { baseURL, wsBaseURL } = await startTestServer();
    const joined = await join(baseURL, "Alex");
    const receiver = await connectWS(`${wsBaseURL}/ws/receiver?token=receiver-token`);
    await nextOfType(receiver, "snapshot");

    receiver.send(JSON.stringify({ type: "banDevice", deviceId: joined.device.deviceId }));
    await nextOfType(receiver, "snapshot");

    const banned = await post(baseURL, "/api/devices", {
      password: "join-pass",
      displayName: "Alex",
      deviceId: joined.device.deviceId,
      deviceSecret: joined.deviceSecret
    });
    expect(banned.status).toBe(403);
    expect(banned.body.code).toBe("banned");
    receiver.close();
  });

  it("rate-limits button abuse", async () => {
    const { baseURL } = await startTestServer();
    const joined = await join(baseURL, "Alex");
    let lastStatus = 200;
    for (let index = 0; index < 31; index += 1) {
      const result = await post(baseURL, "/api/events", {
        deviceId: joined.device.deviceId,
        deviceSecret: joined.deviceSecret,
        eventType: "press"
      });
      lastStatus = result.status;
    }
    expect(lastStatus).toBe(429);
  });
});

async function startTestServer() {
  const { server } = createTheButtonServer({
    store: new MemoryStore(),
    joinPassword: "join-pass",
    receiverToken: "receiver-token",
    ipHashSalt: "test-salt"
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  openServers.push(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;
  return { baseURL, wsBaseURL: baseURL.replace("http:", "ws:") };
}

async function join(baseURL, displayName) {
  const result = await post(baseURL, "/api/devices", { password: "join-pass", displayName });
  expect(result.status).toBe(200);
  return result.body;
}

async function post(baseURL, path, body) {
  const response = await fetch(`${baseURL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}

function connectWS(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.__messages = [];
    socket.on("message", data => {
      socket.__messages.push(JSON.parse(String(data)));
    });
    socket.once("open", () => {
      openSockets.push(socket);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

function nextOfType(socket, type) {
  return new Promise((resolve, reject) => {
    const existingIndex = socket.__messages.findIndex(payload => payload.type === type);
    if (existingIndex >= 0) {
      const [payload] = socket.__messages.splice(existingIndex, 1);
      resolve(payload);
      return;
    }
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 3000);
    const onMessage = data => {
      const payload = JSON.parse(String(data));
      if (payload.type !== type) {
        return;
      }
      clearTimeout(timeout);
      socket.off("message", onMessage);
      const bufferedIndex = socket.__messages.findIndex(item => item.type === type && item.id === payload.id);
      if (bufferedIndex >= 0) {
        socket.__messages.splice(bufferedIndex, 1);
      } else {
        const sameTypeIndex = socket.__messages.findIndex(item => item.type === type);
        if (sameTypeIndex >= 0) {
          socket.__messages.splice(sameTypeIndex, 1);
        }
      }
      resolve(payload);
    };
    socket.on("message", onMessage);
  });
}

async function nextMessageFrom(socket, from) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const payload = await nextOfType(socket, "message");
    if (payload.message?.from === from) {
      return payload;
    }
  }
  throw new Error(`Timed out waiting for message from ${from}`);
}
