import { describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession, type StorageLike } from "./session";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("device session storage", () => {
  it("survives refresh through localStorage", () => {
    const storage = new MemoryStorage();
    saveSession({ deviceId: "btn_abc", deviceSecret: "secret", displayName: "Alex" }, storage);
    expect(loadSession(storage)).toEqual({ deviceId: "btn_abc", deviceSecret: "secret", displayName: "Alex" });
  });

  it("can clear deleted devices", () => {
    const storage = new MemoryStorage();
    saveSession({ deviceId: "btn_abc", deviceSecret: "secret", displayName: "Alex" }, storage);
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
  });
});

