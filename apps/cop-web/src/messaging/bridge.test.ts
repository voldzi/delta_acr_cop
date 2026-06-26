import { describe, expect, it } from "vitest";

import {
  chatBridgeChannelName,
  chatBridgeMessageTypes,
  chatUnreadStorageKey,
  decodeChatCenterLocation,
  decodeChatSelect,
  decodeChatUnread,
  encodeChatCenterLocation,
  encodeChatSelect,
  encodeChatUnread
} from "./bridge";

// Single source of truth for the cop-chat <-> cop-web wire contract. These tests
// pin the exact constants and payload shapes so both apps stay compatible.

describe("contract constants", () => {
  it("keeps the agreed message types, channel and storage key", () => {
    expect(chatBridgeMessageTypes).toEqual({
      centerLocation: "cop-chat:center-location",
      select: "cop-chat:select",
      unread: "cop-chat:unread"
    });
    expect(chatBridgeChannelName).toBe("cop-chat");
    expect(chatUnreadStorageKey).toBe("cop.chat.unread.v1");
  });
});

describe("unread (chat -> web)", () => {
  it("encodes a clamped integer count under the unread type", () => {
    const payload = encodeChatUnread(3.9);
    expect(payload.type).toBe("cop-chat:unread");
    expect(payload.count).toBe(3);
    expect(typeof payload.at).toBe("number");
    expect(encodeChatUnread(-5).count).toBe(0);
  });

  it("decodes valid payloads and rejects foreign ones", () => {
    expect(decodeChatUnread({ count: 4, type: "cop-chat:unread" })).toBe(4);
    expect(decodeChatUnread({ count: -2, type: "cop-chat:unread" })).toBe(0);
    expect(decodeChatUnread({ count: "4", type: "cop-chat:unread" })).toBeNull();
    expect(decodeChatUnread({ count: 4, type: "other" })).toBeNull();
    expect(decodeChatUnread(null)).toBeNull();
  });
});

describe("center-location (chat -> web)", () => {
  it("round-trips finite coordinates", () => {
    const payload = encodeChatCenterLocation(50.0755, 14.4378);
    expect(payload).toEqual({ lat: 50.0755, lon: 14.4378, type: "cop-chat:center-location" });
    expect(decodeChatCenterLocation(payload)).toEqual({ lat: 50.0755, lon: 14.4378 });
  });

  it("rejects non-finite or foreign payloads", () => {
    expect(decodeChatCenterLocation({ lat: Number.NaN, lon: 1, type: "cop-chat:center-location" })).toBeNull();
    expect(decodeChatCenterLocation({ lat: 1, lon: 2, type: "other" })).toBeNull();
    expect(decodeChatCenterLocation(["cop-chat:center-location"])).toBeNull();
  });
});

describe("select (web -> chat)", () => {
  it("encodes and trims a selection, rejecting empty or foreign payloads", () => {
    expect(encodeChatSelect("room-1")).toEqual({ selection: "room-1", type: "cop-chat:select" });
    expect(decodeChatSelect({ selection: "  room-1  ", type: "cop-chat:select" })).toBe("room-1");
    expect(decodeChatSelect({ selection: "   ", type: "cop-chat:select" })).toBeNull();
    expect(decodeChatSelect({ selection: "x", type: "other" })).toBeNull();
    expect(decodeChatSelect(null)).toBeNull();
  });
});
