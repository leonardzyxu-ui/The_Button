import type { ButtonEventResponse, ConversationMessage, DeviceSession, JoinResponse } from "./types";

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(value?.error || `Request failed (${response.status})`);
  }
  return value as T;
}

export function joinDevice(input: {
  password: string;
  displayName: string;
  existing?: DeviceSession | null;
}): Promise<JoinResponse> {
  return postJSON<JoinResponse>("/api/devices", {
    password: input.password,
    displayName: input.displayName,
    deviceId: input.existing?.deviceId,
    deviceSecret: input.existing?.deviceSecret
  });
}

export function pressButton(session: DeviceSession): Promise<ButtonEventResponse> {
  return postJSON("/api/events", {
    deviceId: session.deviceId,
    deviceSecret: session.deviceSecret,
    eventType: "press"
  });
}

export function sendNuke(session: DeviceSession, message: string): Promise<ButtonEventResponse> {
  return postJSON("/api/events", {
    deviceId: session.deviceId,
    deviceSecret: session.deviceSecret,
    eventType: "nuke",
    confirm: "yes",
    message
  });
}

export function sendMessage(session: DeviceSession, text: string): Promise<{ ok: true; message: ConversationMessage }> {
  return postJSON("/api/messages", {
    deviceId: session.deviceId,
    deviceSecret: session.deviceSecret,
    text
  });
}

export function siteWebSocketURL(session: DeviceSession): string {
  const url = new URL("/ws/site", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("deviceId", session.deviceId);
  url.searchParams.set("deviceSecret", session.deviceSecret);
  return url.toString();
}
