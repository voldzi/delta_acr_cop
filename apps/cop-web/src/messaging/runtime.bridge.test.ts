// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyChatUnreadPayload,
  publishChatUnreadCount,
  readStoredChatUnreadCount
} from "./runtime";

// Unread-badge bridge contract (chat → web: cop-chat:unread). cop-web's shell badge
// in the Komunikace menu depends on this exact payload shape and storage key.
//
// Note: this jsdom/Node combination does not expose window.localStorage, so we
// install a minimal in-memory stub. The runtime guards localStorage access in
// try/catch for exactly this reason (private browsing, blocked storage, etc.).

const unreadStorageKey = "cop.chat.unread.v1";

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => {
      store.set(key, String(value));
    }
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: stub });
}

beforeEach(() => {
  installLocalStorageStub();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage?.clear();
});

describe("publishChatUnreadCount", () => {
  it("persists a cop-chat:unread payload under the contract storage key", () => {
    publishChatUnreadCount(5);
    const raw = window.localStorage.getItem(unreadStorageKey);
    expect(raw).toBeTruthy();
    const payload = JSON.parse(raw as string) as { count: number; type: string };
    expect(payload.type).toBe("cop-chat:unread");
    expect(payload.count).toBe(5);
  });

  it("clamps negative and fractional counts to a non-negative integer", () => {
    publishChatUnreadCount(-3);
    expect(readStoredChatUnreadCount()).toBe(0);
    publishChatUnreadCount(2.9);
    expect(readStoredChatUnreadCount()).toBe(2);
  });
});

describe("applyChatUnreadPayload", () => {
  it("accepts a valid payload and reports the clamped count", () => {
    const onCount = vi.fn();
    expect(applyChatUnreadPayload({ count: 4, type: "cop-chat:unread" }, onCount)).toBe(true);
    expect(onCount).toHaveBeenCalledWith(4);
  });

  it("rejects payloads with the wrong type or a non-numeric count", () => {
    const onCount = vi.fn();
    expect(applyChatUnreadPayload({ count: 4, type: "other" }, onCount)).toBe(false);
    expect(applyChatUnreadPayload({ count: "4", type: "cop-chat:unread" }, onCount)).toBe(false);
    expect(applyChatUnreadPayload(null, onCount)).toBe(false);
    expect(onCount).not.toHaveBeenCalled();
  });
});

describe("readStoredChatUnreadCount", () => {
  it("returns null when nothing is stored", () => {
    expect(readStoredChatUnreadCount()).toBeNull();
  });

  it("round-trips a published count", () => {
    publishChatUnreadCount(7);
    expect(readStoredChatUnreadCount()).toBe(7);
  });
});
