import * as React from "react";

export interface ChatSelectionState {
  conversationId: string | null;
  groupId: string | null;
  roomId: string | null;
}

export type ChatSelectionValue = string | null | ((current: string | null) => string | null);

export type ChatSelectionAction =
  | { type: "clear" }
  | { type: "conversation"; value: ChatSelectionValue }
  | { type: "group"; value: ChatSelectionValue }
  | { type: "room"; value: ChatSelectionValue };

export function chatSelectionReducer(state: ChatSelectionState, action: ChatSelectionAction): ChatSelectionState {
  switch (action.type) {
    case "clear":
      return { conversationId: null, groupId: null, roomId: null };
    case "conversation":
      return { ...state, conversationId: resolveSelectionValue(action.value, state.conversationId) };
    case "group":
      return { ...state, groupId: resolveSelectionValue(action.value, state.groupId) };
    case "room":
      return { ...state, roomId: resolveSelectionValue(action.value, state.roomId) };
    default:
      return state;
  }
}

export function useChatSelection(): {
  clearChatSelection: () => void;
  selectedConversationId: string | null;
  selectedGroupId: string | null;
  selectedRoomId: string | null;
  setSelectedConversationId: (value: ChatSelectionValue) => void;
  setSelectedGroupId: (value: ChatSelectionValue) => void;
  setSelectedRoomId: (value: ChatSelectionValue) => void;
} {
  const [chatSelection, dispatchChatSelection] = React.useReducer(chatSelectionReducer, {
    conversationId: null,
    groupId: null,
    roomId: null
  });
  return {
    clearChatSelection: React.useCallback(() => dispatchChatSelection({ type: "clear" }), []),
    selectedConversationId: chatSelection.conversationId,
    selectedGroupId: chatSelection.groupId,
    selectedRoomId: chatSelection.roomId,
    setSelectedConversationId: React.useCallback(
      (value: ChatSelectionValue) => dispatchChatSelection({ type: "conversation", value }),
      []
    ),
    setSelectedGroupId: React.useCallback(
      (value: ChatSelectionValue) => dispatchChatSelection({ type: "group", value }),
      []
    ),
    setSelectedRoomId: React.useCallback(
      (value: ChatSelectionValue) => dispatchChatSelection({ type: "room", value }),
      []
    )
  };
}

function resolveSelectionValue(value: ChatSelectionValue, current: string | null): string | null {
  return typeof value === "function" ? value(current) : value;
}
