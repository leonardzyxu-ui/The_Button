export type DeviceStatus = "active" | "deleted" | "banned";

export interface ButtonDevice {
  deviceId: string;
  displayName: string;
  status: DeviceStatus;
  online: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  counts: {
    presses: number;
    messages: number;
    nukes: number;
  };
}

export interface ConversationMessage {
  id: string;
  createdAt: string;
  deviceId: string;
  displayName: string;
  from: "user" | "leo";
  text: string;
}

export interface DeviceSession {
  deviceId: string;
  deviceSecret: string;
  displayName: string;
}

export interface JoinResponse {
  ok: true;
  device: ButtonDevice;
  deviceSecret: string;
  messages: ConversationMessage[];
  receiverOnline: boolean;
}

export interface SiteSnapshotMessage {
  type: "snapshot";
  device: ButtonDevice;
  messages: ConversationMessage[];
  receiverOnline: boolean;
}

export interface SiteMessageMessage {
  type: "message";
  message: ConversationMessage;
}

export type SiteSocketMessage =
  | SiteSnapshotMessage
  | SiteMessageMessage
  | { type: "deleted"; deviceId: string }
  | { type: "banned"; deviceId: string }
  | { type: "error"; message: string }
  | { type: "pong"; at: string };

