import type { DeviceSession } from "./types";

const SESSION_KEY = "the-button:device-session";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadSession(storage: StorageLike = window.localStorage): DeviceSession | null {
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DeviceSession>;
    if (!parsed.deviceId || !parsed.deviceSecret || !parsed.displayName) {
      return null;
    }
    return {
      deviceId: parsed.deviceId,
      deviceSecret: parsed.deviceSecret,
      displayName: parsed.displayName
    };
  } catch {
    return null;
  }
}

export function saveSession(session: DeviceSession, storage: StorageLike = window.localStorage): void {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(storage: StorageLike = window.localStorage): void {
  storage.removeItem(SESSION_KEY);
}

