// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyChatSummaryPayload,
  applyChatUnreadPayload,
  applyChatVoiceCallPayload,
  publishChatSummarySnapshot,
  publishChatUnreadCount,
  publishChatVoiceCallSnapshot,
  readStoredChatSummarySnapshot,
  readStoredChatUnreadCount,
  readStoredChatVoiceCallSnapshot
} from "./runtime.js";

// Unread-badge bridge contract (chat → web: cop-chat:unread). cop-web's shell badge
// in the Komunikace menu depends on this exact payload shape and storage key.
//
// Note: this jsdom/Node combination does not expose window.localStorage, so we
// install a minimal in-memory stub. The runtime guards localStorage access in
// try/catch for exactly this reason (private browsing, blocked storage, etc.).

const unreadStorageKey = "cop.chat.unread.v1";
const voiceCallStorageKey = "cop.chat.voiceCall.v1";

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

describe("publishChatSummarySnapshot", () => {
  it("persists a cop-chat:summary payload and keeps unread count readable", () => {
    publishChatSummarySnapshot({
      syncState: "ready",
      totalUnread: 3,
      unreadRooms: [{ selection: "!ops", title: "Ops", unreadCount: 3 }]
    });
    const raw = window.localStorage.getItem(unreadStorageKey);
    expect(raw).toBeTruthy();
    const payload = JSON.parse(raw as string) as { totalUnread: number; type: string };
    expect(payload.type).toBe("cop-chat:summary");
    expect(payload.totalUnread).toBe(3);
    expect(readStoredChatUnreadCount()).toBe(3);
    expect(readStoredChatSummarySnapshot()?.unreadRooms).toEqual([{ selection: "!ops", title: "Ops", unreadCount: 3 }]);
  });
});

describe("publishChatVoiceCallSnapshot", () => {
  it("persists a cop-chat:voice-call payload under the call storage key", () => {
    publishChatVoiceCallSnapshot({
      callId: "call-1",
      direction: "incoming",
      phase: "ringing",
      roomId: "!ops",
      title: "Ops"
    });
    const raw = window.localStorage.getItem(voiceCallStorageKey);
    expect(raw).toBeTruthy();
    const payload = JSON.parse(raw as string) as { callId: string; phase: string; type: string };
    expect(payload.type).toBe("cop-chat:voice-call");
    expect(payload.callId).toBe("call-1");
    expect(payload.phase).toBe("ringing");
    expect(readStoredChatVoiceCallSnapshot()).toMatchObject({
      callId: "call-1",
      direction: "incoming",
      phase: "ringing",
      roomId: "!ops",
      title: "Ops"
    });
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

describe("applyChatSummaryPayload", () => {
  it("accepts a valid summary payload", () => {
    const onSummary = vi.fn();
    expect(
      applyChatSummaryPayload(
        {
          syncState: "ready",
          totalUnread: 2,
          type: "cop-chat:summary",
          unreadRooms: [{ selection: "!ops", title: "Ops", unreadCount: 2 }]
        },
        onSummary
      )
    ).toBe(true);
    expect(onSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        syncState: "ready",
        totalUnread: 2,
        unreadRooms: [{ selection: "!ops", title: "Ops", unreadCount: 2 }]
      })
    );
  });

  it("rejects malformed summaries", () => {
    const onSummary = vi.fn();
    expect(applyChatSummaryPayload({ totalUnread: 2, type: "other" }, onSummary)).toBe(false);
    expect(onSummary).not.toHaveBeenCalled();
  });
});

describe("applyChatVoiceCallPayload", () => {
  it("accepts a valid voice-call payload", () => {
    const onVoiceCall = vi.fn();
    expect(
      applyChatVoiceCallPayload(
        {
          callId: "call-1",
          direction: "incoming",
          phase: "ringing",
          roomId: "!ops",
          type: "cop-chat:voice-call"
        },
        onVoiceCall
      )
    ).toBe(true);
    expect(onVoiceCall).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: "call-1",
        direction: "incoming",
        phase: "ringing",
        roomId: "!ops"
      })
    );
  });

  it("rejects malformed voice-call payloads", () => {
    const onVoiceCall = vi.fn();
    expect(applyChatVoiceCallPayload({ callId: "call-1", type: "other" }, onVoiceCall)).toBe(false);
    expect(onVoiceCall).not.toHaveBeenCalled();
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
