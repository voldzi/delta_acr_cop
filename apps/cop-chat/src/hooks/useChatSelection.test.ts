import { describe, expect, it } from "vitest";

import { chatSelectionReducer, type ChatSelectionState } from "./useChatSelection";

describe("chatSelectionReducer", () => {
  it("updates individual selection ids and clears them together", () => {
    let state: ChatSelectionState = { conversationId: null, groupId: null, roomId: null };

    state = chatSelectionReducer(state, { type: "conversation", value: "conv-1" });
    state = chatSelectionReducer(state, { type: "group", value: "group-1" });
    state = chatSelectionReducer(state, { type: "room", value: (current) => current ?? "!room:cop.local" });

    expect(state).toEqual({ conversationId: "conv-1", groupId: "group-1", roomId: "!room:cop.local" });
    expect(chatSelectionReducer(state, { type: "clear" })).toEqual({ conversationId: null, groupId: null, roomId: null });
  });
});
