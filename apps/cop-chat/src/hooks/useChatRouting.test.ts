// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  chatRoutingReducer,
  embeddedChatSelectionFromMessage,
  readRouteSelection,
  writeChatRoute,
  type ChatRoutingState
} from "./useChatRouting";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("chatRoutingReducer", () => {
  it("updates route selection and keeps route bookkeeping explicit", () => {
    let state: ChatRoutingState = {
      conversationId: null,
      groupId: null,
      roomId: null,
      routeApplied: false,
      routeOpenAttemptKey: null
    };

    state = chatRoutingReducer(state, { type: "conversation", value: "conv-1" });
    state = chatRoutingReducer(state, { type: "group", value: "group-1" });
    state = chatRoutingReducer(state, { type: "room", value: (current) => current ?? "!room:cop.local" });
    state = chatRoutingReducer(state, { type: "route-applied", applied: true });
    state = chatRoutingReducer(state, { type: "route-open-attempt", key: "conv-1:chat-ready" });

    expect(state).toEqual({
      conversationId: "conv-1",
      groupId: "group-1",
      roomId: "!room:cop.local",
      routeApplied: true,
      routeOpenAttemptKey: "conv-1:chat-ready"
    });
    expect(chatRoutingReducer(state, { type: "clear" })).toEqual({
      conversationId: null,
      groupId: null,
      roomId: null,
      routeApplied: true,
      routeOpenAttemptKey: "conv-1:chat-ready"
    });
  });

  it("selects all ids atomically for route application", () => {
    const state = chatRoutingReducer({
      conversationId: "old",
      groupId: "old-group",
      roomId: "old-room",
      routeApplied: false,
      routeOpenAttemptKey: null
    }, {
      conversationId: "conv-2",
      groupId: null,
      roomId: "!room-2",
      type: "select"
    });

    expect(state).toMatchObject({ conversationId: "conv-2", groupId: null, roomId: "!room-2" });
  });
});

describe("embeddedChatSelectionFromMessage", () => {
  it("accepts only bridge select messages", () => {
    expect(embeddedChatSelectionFromMessage({ selection: "  room-1  ", type: "cop-chat:select" })).toBe("room-1");
    expect(embeddedChatSelectionFromMessage({ selection: "x", type: "other" })).toBeNull();
    expect(embeddedChatSelectionFromMessage({ type: "cop-chat:select" })).toBeNull();
    expect(embeddedChatSelectionFromMessage(null)).toBeNull();
  });
});

describe("readRouteSelection / writeChatRoute", () => {
  it("reads query route selection before path selection", () => {
    window.history.replaceState({}, "", "/chat/path-room?selection=query-room");
    expect(readRouteSelection()).toBe("query-room");
  });

  it("round-trips an encoded selection through writeChatRoute", () => {
    window.history.replaceState({}, "", "/chat?embedded=1");
    writeChatRoute("!room:example.cz");

    expect(window.location.pathname).toBe("/chat/!room%3Aexample.cz");
    expect(window.location.search).toBe("?embedded=1");
    expect(readRouteSelection()).toBe("!room:example.cz");
  });

  it("clears selection route while preserving unrelated query params", () => {
    window.history.replaceState({}, "", "/chat/abc?roomId=ignored&embedded=1");
    writeChatRoute(null);

    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toBe("?embedded=1");
    expect(readRouteSelection()).toBeNull();
  });
});
