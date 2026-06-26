// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  centerLocationInCop,
  embeddedChatSelectionFromMessage,
  readRouteSelection,
  writeChatRoute
} from "./ChatApp";
import type { MatrixLocationShare } from "@cop/messaging/types";

// Bridge / wire-protocol contract tests. These pin the exact cross-app contract
// (message `type` strings, payload shapes, URL route encoding) that cop-web relies
// on. They must keep passing byte-for-byte through the Phase 3 package extraction.

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("embeddedChatSelectionFromMessage (web → chat: cop-chat:select)", () => {
  it("accepts only the cop-chat:select envelope and trims the selection", () => {
    expect(embeddedChatSelectionFromMessage({ selection: "  room-1  ", type: "cop-chat:select" })).toBe("room-1");
  });

  it("rejects foreign or malformed payloads", () => {
    expect(embeddedChatSelectionFromMessage({ selection: "x", type: "other" })).toBeNull();
    expect(embeddedChatSelectionFromMessage({ type: "cop-chat:select" })).toBeNull();
    expect(embeddedChatSelectionFromMessage({ selection: "   ", type: "cop-chat:select" })).toBeNull();
    expect(embeddedChatSelectionFromMessage(null)).toBeNull();
    expect(embeddedChatSelectionFromMessage(["cop-chat:select"])).toBeNull();
  });
});

describe("centerLocationInCop (chat → web: cop-chat:center-location)", () => {
  const location: MatrixLocationShare = { lat: 50.0755, lon: 14.4378, source: "map" };

  it("posts a cop-chat:center-location message to the parent frame when embedded", () => {
    const postMessage = vi.fn();
    const originalParent = window.parent;
    Object.defineProperty(window, "parent", { configurable: true, value: { postMessage } });
    try {
      centerLocationInCop(location);
    } finally {
      Object.defineProperty(window, "parent", { configurable: true, value: originalParent });
    }
    expect(postMessage).toHaveBeenCalledWith(
      { lat: 50.0755, lon: 14.4378, type: "cop-chat:center-location" },
      window.location.origin
    );
  });

  it("opens a standalone map when not embedded (parent === self)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    centerLocationInCop(location);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toContain("50.0755");
    expect(open.mock.calls[0]?.[0]).toContain("14.4378");
  });
});

describe("readRouteSelection / writeChatRoute (URL route contract)", () => {
  it("reads a selection from the /chat/<id> path", () => {
    window.history.replaceState({}, "", "/chat/room-42");
    expect(readRouteSelection()).toBe("room-42");
  });

  it("prefers explicit query parameters over the path", () => {
    window.history.replaceState({}, "", "/chat/ignored?conversationId=conv-7");
    expect(readRouteSelection()).toBe("conv-7");
  });

  it("returns null at the bare /chat root", () => {
    window.history.replaceState({}, "", "/chat");
    expect(readRouteSelection()).toBeNull();
  });

  it("round-trips an encoded selection through writeChatRoute", () => {
    window.history.replaceState({}, "", "/chat?selection=stale&roomId=stale");
    writeChatRoute("!room:example.cz");
    expect(window.location.pathname).toBe(`/chat/${encodeURIComponent("!room:example.cz")}`);
    // legacy selection query params are stripped on write
    expect(window.location.search).toBe("");
    expect(readRouteSelection()).toBe("!room:example.cz");
  });

  it("clears the route back to /chat when given null", () => {
    window.history.replaceState({}, "", "/chat/room-1");
    writeChatRoute(null);
    expect(window.location.pathname).toBe("/chat");
    expect(readRouteSelection()).toBeNull();
  });
});
