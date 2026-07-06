import * as React from "react";
import { decodeChatSelect } from "@cop/messaging/bridge";

export interface ChatRoutingState {
  conversationId: string | null;
  groupId: string | null;
  roomId: string | null;
  routeApplied: boolean;
  routeOpenAttemptKey: string | null;
}

export type ChatRoutingSelectionValue = string | null | ((current: string | null) => string | null);

export type ChatRoutingAction =
  | { type: "clear"; routeApplied?: boolean }
  | { type: "conversation"; value: ChatRoutingSelectionValue }
  | { type: "group"; value: ChatRoutingSelectionValue }
  | { type: "route-applied"; applied: boolean }
  | { type: "route-open-attempt"; key: string | null }
  | { type: "room"; value: ChatRoutingSelectionValue }
  | { type: "select"; conversationId?: string | null; groupId?: string | null; roomId?: string | null };

export function chatRoutingReducer(state: ChatRoutingState, action: ChatRoutingAction): ChatRoutingState {
  switch (action.type) {
    case "clear":
      return {
        conversationId: null,
        groupId: null,
        roomId: null,
        routeApplied: action.routeApplied ?? state.routeApplied,
        routeOpenAttemptKey: state.routeOpenAttemptKey
      };
    case "conversation":
      return { ...state, conversationId: resolveRoutingValue(action.value, state.conversationId) };
    case "group":
      return { ...state, groupId: resolveRoutingValue(action.value, state.groupId) };
    case "route-applied":
      return { ...state, routeApplied: action.applied };
    case "route-open-attempt":
      return { ...state, routeOpenAttemptKey: action.key };
    case "room":
      return { ...state, roomId: resolveRoutingValue(action.value, state.roomId) };
    case "select":
      return {
        ...state,
        conversationId: action.conversationId ?? null,
        groupId: action.groupId ?? null,
        roomId: action.roomId ?? null
      };
    default:
      return state;
  }
}

export function useChatRouting(): {
  clearChatSelection: (routeApplied?: boolean) => void;
  hasRouteOpenAttempt: (key: string) => boolean;
  markRouteApplied: (applied: boolean) => void;
  resetRouteOpenAttempt: () => void;
  routeApplied: boolean;
  routeOpenAttemptKey: string | null;
  selectedConversationId: string | null;
  selectedGroupId: string | null;
  selectedRoomId: string | null;
  setRouteOpenAttempt: (key: string) => void;
  setSelectedConversationId: (value: ChatRoutingSelectionValue) => void;
  setSelectedGroupId: (value: ChatRoutingSelectionValue) => void;
  setSelectedRoomId: (value: ChatRoutingSelectionValue) => void;
  selectChatRoute: (selection: {
    conversationId?: string | null;
    groupId?: string | null;
    roomId?: string | null;
  }) => void;
} {
  const [state, dispatch] = React.useReducer(chatRoutingReducer, {
    conversationId: null,
    groupId: null,
    roomId: null,
    routeApplied: false,
    routeOpenAttemptKey: null
  });

  return {
    clearChatSelection: React.useCallback((routeApplied) => dispatch({ type: "clear", routeApplied }), []),
    hasRouteOpenAttempt: React.useCallback((key) => state.routeOpenAttemptKey === key, [state.routeOpenAttemptKey]),
    markRouteApplied: React.useCallback((applied) => dispatch({ type: "route-applied", applied }), []),
    resetRouteOpenAttempt: React.useCallback(() => dispatch({ type: "route-open-attempt", key: null }), []),
    routeApplied: state.routeApplied,
    routeOpenAttemptKey: state.routeOpenAttemptKey,
    selectedConversationId: state.conversationId,
    selectedGroupId: state.groupId,
    selectedRoomId: state.roomId,
    setRouteOpenAttempt: React.useCallback((key) => dispatch({ type: "route-open-attempt", key }), []),
    setSelectedConversationId: React.useCallback((value) => dispatch({ type: "conversation", value }), []),
    setSelectedGroupId: React.useCallback((value) => dispatch({ type: "group", value }), []),
    setSelectedRoomId: React.useCallback((value) => dispatch({ type: "room", value }), []),
    selectChatRoute: React.useCallback((selection) => dispatch({ type: "select", ...selection }), [])
  };
}

export function embeddedChatSelectionFromMessage(data: unknown): string | null {
  return decodeChatSelect(data);
}

export function readRouteSelection(): string | null {
  const params = new URLSearchParams(window.location.search);
  const querySelection =
    params.get("selection") ?? params.get("groupId") ?? params.get("conversationId") ?? params.get("roomId");
  if (querySelection?.trim()) {
    return querySelection.trim();
  }
  const path = window.location.pathname.replace(/\/+$/u, "");
  const prefix = "/chat";
  if (path === prefix || !path.startsWith(`${prefix}/`)) {
    return null;
  }
  const raw = path.slice(prefix.length + 1).split("/")[0];
  if (!raw) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function writeChatRoute(selection: string | null): void {
  const nextPath = selection ? `/chat/${encodeURIComponent(selection)}` : "/chat";
  const params = new URLSearchParams(window.location.search);
  params.delete("selection");
  params.delete("groupId");
  params.delete("conversationId");
  params.delete("roomId");
  const query = params.toString();
  const nextUrl = `${nextPath}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.pushState({}, "", nextUrl);
}

function resolveRoutingValue(value: ChatRoutingSelectionValue, current: string | null): string | null {
  return typeof value === "function" ? value(current) : value;
}
