import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiMatrixBotInvitePlan,
  applyChatPreferences,
  buildChatItems,
  chatPreferenceSnapshot,
  dedupeChatItems,
  isAiAgentChatItem,
  userFacingError
} from "./ChatApp";
import {
  buildTimelineRows,
  filterTimelineByRetention,
  isChatMuted,
  messageMatchesQuery,
  normalizeChatPreferences,
  type ChatPreferences
} from "./chat-model";
import type { ChatListItem } from "./ChatApp";
import type { MatrixRoomSummary, MatrixTimelineMessage } from "@cop/messaging/types";
import type { MessagingConversationSummary } from "@cop/core/cop-data";

// These are characterization tests: they pin the *current* observable behavior of
// the pure functions before the Phase 1/2 refactor so any accidental change of
// output is caught. They are intentionally minimal and structural.

function message(overrides: Partial<MatrixTimelineMessage> = {}): MatrixTimelineMessage {
  return {
    body: "Ahoj",
    eventId: "$evt-1",
    kind: "text",
    own: false,
    sender: "@alice:msg.example.cz",
    timestamp: "2026-06-26T08:00:00.000Z",
    ...overrides
  };
}

function emptyPreferences(): ChatPreferences {
  return {
    hiddenByKey: {},
    manualUnreadKeys: [],
    mutedUntilByKey: {},
    pinnedKeys: [],
    readOverrideByKey: {}
  };
}

function chatItem(overrides: Partial<ChatListItem> = {}): ChatListItem {
  return {
    active: false,
    id: "room:!a",
    memberCount: 2,
    muted: false,
    pinned: false,
    preferenceKey: "room:!a",
    preview: "Ahoj",
    searchable: "Alice",
    sortAt: 1_000,
    title: "Alice",
    type: "direct",
    unreadCount: 0,
    ...overrides
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildTimelineRows", () => {
  it("inserts a date pill before the first message of each day and groups same-sender runs", () => {
    const rows = buildTimelineRows([
      message({ eventId: "$a", sender: "@alice:x", timestamp: "2026-06-25T10:00:00.000Z" }),
      message({ eventId: "$b", sender: "@alice:x", timestamp: "2026-06-25T10:01:00.000Z" }),
      message({ eventId: "$c", sender: "@bob:x", timestamp: "2026-06-26T09:00:00.000Z" })
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["date", "message", "message", "date", "message"]);
    const messageRows = rows.filter((row): row is Extract<typeof row, { kind: "message" }> => row.kind === "message");
    expect(messageRows[0]?.grouped).toBe(false);
    expect(messageRows[1]?.grouped).toBe(true); // same sender, same day
    expect(messageRows[2]?.grouped).toBe(false); // new day resets grouping
  });

  it("returns an empty array for no messages", () => {
    expect(buildTimelineRows([])).toEqual([]);
  });
});

describe("filterTimelineByRetention", () => {
  it("keeps all messages when retention is disabled (null)", () => {
    const messages = [message({ timestamp: "2000-01-01T00:00:00.000Z" })];
    expect(filterTimelineByRetention(messages, null)).toEqual(messages);
  });

  it("drops messages older than the retention window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T12:00:00.000Z"));
    const fresh = message({ eventId: "$fresh", timestamp: "2026-06-26T11:00:00.000Z" });
    const stale = message({ eventId: "$stale", timestamp: "2026-06-24T11:00:00.000Z" });
    const kept = filterTimelineByRetention([stale, fresh], 86_400);
    expect(kept).toEqual([fresh]);
  });

  it("keeps messages with an unparseable timestamp", () => {
    const broken = message({ eventId: "$broken", timestamp: "not-a-date" });
    expect(filterTimelineByRetention([broken], 86_400)).toEqual([broken]);
  });
});

describe("isChatMuted", () => {
  it("treats the forever sentinel and future ISO timestamps as muted", () => {
    expect(isChatMuted(undefined)).toBe(false);
    expect(isChatMuted("forever")).toBe(true);
    expect(isChatMuted("2999-01-01T00:00:00.000Z")).toBe(true);
    expect(isChatMuted("2000-01-01T00:00:00.000Z")).toBe(false);
  });
});

describe("messageMatchesQuery", () => {
  it("matches case-insensitively on the message body and ignores empty queries", () => {
    const subject = message({ body: "Povodňová výstraha" });
    expect(messageMatchesQuery(subject, "povodň")).toBe(true);
    expect(messageMatchesQuery(subject, "  ")).toBe(false);
    expect(messageMatchesQuery(subject, "nepřítomné")).toBe(false);
  });
});

describe("userFacingError", () => {
  it("does not mask Matrix UIA failures as a missing COP login", () => {
    expect(
      userFacingError(
        "Obnovovací klíč se nepodařilo připravit pro iPhone/iPad: Matrix interactive auth je vyžadovaný pro E2EE reset (m.login.password): MatrixError: [401] Unauthorized"
      )
    ).toContain("Matrix vyžaduje dodatečné ověření");
  });

  it("keeps real COP auth failures as login failures", () => {
    expect(userFacingError("HTTP 401 unauthorized")).toBe("Pro tuto akci je potřeba platné přihlášení.");
  });

  it("does not expose Matrix key material from duplicate one-time key upload errors", () => {
    const message = userFacingError(
      'Obnovovací klíč se nepodařilo vytvořit: MatrixError: [400] One time key signed_curve25519:AAAAAAAAAGO already exists. Old key: {"key":"old-secret","signatures":{"@user:server":{"ed25519:DEVICE":"old-signature"}}}; new key: {"key":"new-secret"} (https://msg.zeleznalady.cz/_matrix/client/v3/keys/upload)'
    );

    expect(message).toContain("původní webové zařízení");
    expect(message).not.toMatch(/signed_curve25519|old-secret|new-secret|old-signature|\/keys\/upload/iu);
  });
});

describe("normalizeChatPreferences", () => {
  it("fills missing collections and caps list sizes", () => {
    const normalized = normalizeChatPreferences({ pinnedKeys: ["a", "a", "", "b"] });
    expect(normalized.pinnedKeys).toEqual(["a", "b"]);
    expect(normalized.manualUnreadKeys).toEqual([]);
    expect(normalized.hiddenByKey).toEqual({});
  });

  it("drops expired mute entries but keeps the forever sentinel", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T12:00:00.000Z"));
    const normalized = normalizeChatPreferences({
      mutedUntilByKey: {
        expired: "2026-06-25T00:00:00.000Z",
        forever: "forever",
        future: "2999-01-01T00:00:00.000Z"
      }
    });
    expect(Object.keys(normalized.mutedUntilByKey).sort()).toEqual(["forever", "future"]);
  });
});

describe("applyChatPreferences", () => {
  it("marks muted/pinned and sorts pinned items first in pin order", () => {
    const items = [
      chatItem({ id: "a", preferenceKey: "a", title: "A", sortAt: 1 }),
      chatItem({ id: "b", preferenceKey: "b", title: "B", sortAt: 5 }),
      chatItem({ id: "c", preferenceKey: "c", title: "C", sortAt: 3 })
    ];
    const preferences: ChatPreferences = {
      ...emptyPreferences(),
      mutedUntilByKey: { a: "forever" },
      pinnedKeys: ["c", "a"]
    };
    const result = applyChatPreferences(items, preferences);
    expect(result.map((item) => item.id)).toEqual(["c", "a", "b"]); // pinned (pin order) then by sortAt desc
    expect(result.find((item) => item.id === "a")?.muted).toBe(true);
    expect(result.find((item) => item.id === "c")?.pinned).toBe(true);
    expect(result.find((item) => item.id === "b")?.pinned).toBe(false);
  });

  it("applies a manual-unread flag as at least one unread", () => {
    const items = [chatItem({ preferenceKey: "a", unreadCount: 0 })];
    const result = applyChatPreferences(items, { ...emptyPreferences(), manualUnreadKeys: ["a"] });
    expect(result[0]?.manuallyUnread).toBe(true);
    expect(result[0]?.unreadCount).toBe(1);
  });

  it("hides an item whose snapshot still matches the hidden snapshot", () => {
    const latest = message({ eventId: "$latest" });
    const item = chatItem({ preferenceKey: "a", latest, unreadCount: 0 });
    const snapshot = chatPreferenceSnapshot(item);
    const hidden = applyChatPreferences([item], { ...emptyPreferences(), hiddenByKey: { a: snapshot } });
    expect(hidden).toHaveLength(0);

    // A newer message changes the snapshot and the chat reappears.
    const revived = chatItem({ preferenceKey: "a", latest: message({ eventId: "$newer" }), unreadCount: 0 });
    const shown = applyChatPreferences([revived], { ...emptyPreferences(), hiddenByKey: { a: snapshot } });
    expect(shown).toHaveLength(1);
  });
});

describe("dedupeChatItems", () => {
  it("collapses duplicate direct chats and prefers the room-backed item", () => {
    const withRoom = chatItem({
      id: "room:!a",
      roomId: "!a",
      title: "Alice",
      latest: message({ eventId: "$x" }),
      unreadCount: 2
    });
    const metadataOnly = chatItem({ id: "conversation:c1", roomId: undefined, title: "Alice", unreadCount: 0 });
    const deduped = dedupeChatItems([metadataOnly, withRoom]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.roomId).toBe("!a");
    expect(deduped[0]?.unreadCount).toBe(2); // max of the two
  });

  it("keeps AI conversation metadata when a Matrix room-backed item wins", () => {
    const conversation = {
      conversationId: "c-ai",
      members: [{ displayName: "COP AI Assistant", role: "bot", userId: "cop.ai.agent" }],
      metadata: {
        externalId: "cop.ai.agent",
        source: "cop.ai.direct"
      },
      title: "COP AI Assistant",
      type: "direct"
    } as unknown as MessagingConversationSummary;
    const metadataOnly = chatItem({
      conversation,
      id: "conversation:c-ai",
      preferenceKey: "conversation:c-ai",
      roomId: undefined,
      title: "COP AI Assistant"
    });
    const withRoom = chatItem({
      id: "room:!ai",
      latest: message({ eventId: "$ai", body: "Dotaz", timestamp: "2026-06-26T09:00:00.000Z" }),
      preferenceKey: "room:!ai",
      room: {
        directPeer: {
          displayName: "COP AI Assistant",
          userId: "@cop.ai.agent:docker.home.cz"
        },
        encrypted: true,
        name: "COP AI Assistant",
        roomId: "!ai",
        unreadCount: 0
      } as MatrixRoomSummary,
      roomId: "!ai",
      sortAt: 2_000,
      title: "COP AI Assistant"
    });

    const deduped = dedupeChatItems([metadataOnly, withRoom]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.roomId).toBe("!ai");
    expect(deduped[0]?.conversation?.conversationId).toBe("c-ai");
    expect(isAiAgentChatItem(deduped[0] as ChatListItem)).toBe(true);
  });

  it("recognizes a room-only AI direct chat from the Matrix peer identity", () => {
    const item = chatItem({
      conversation: undefined,
      room: {
        directPeer: {
          displayName: "COP AI Assistant",
          userId: "@cop.ai.agent:docker.home.cz"
        },
        encrypted: true,
        name: "COP AI Assistant",
        roomId: "!ai",
        unreadCount: 0
      } as MatrixRoomSummary,
      roomId: "!ai",
      title: "COP AI Assistant"
    });

    expect(isAiAgentChatItem(item)).toBe(true);
  });

  it("recognizes a metadata-light AI direct chat by the canonical assistant title", () => {
    expect(
      isAiAgentChatItem(
        chatItem({
          conversation: undefined,
          room: undefined,
          title: "COP AI Assistant",
          type: "direct"
        })
      )
    ).toBe(true);
  });
});

describe("aiMatrixBotInvitePlan", () => {
  it("invites the bot when backend has a Matrix identity but join is still pending", () => {
    expect(
      aiMatrixBotInvitePlan({
        enabled: true,
        label: "COP AI Assistant",
        matrixBot: {
          matrixUserId: "@cop.ai.agent:docker.home.cz",
          roomId: "!room:docker.home.cz",
          status: "bot_join_failed"
        },
        mode: "cop-context"
      })
    ).toEqual({
      matrixUserId: "@cop.ai.agent:docker.home.cz",
      roomId: "!room:docker.home.cz"
    });
  });

  it("uses the selected Matrix room as a fallback when metadata has not caught up", () => {
    expect(
      aiMatrixBotInvitePlan(
        {
          enabled: true,
          label: "COP AI Assistant",
          matrixBot: {
            matrixUserId: "@cop.ai.agent:docker.home.cz",
            status: "bot_join_failed"
          },
          mode: "cop-context"
        },
        "!selected:docker.home.cz"
      )
    ).toEqual({
      matrixUserId: "@cop.ai.agent:docker.home.cz",
      roomId: "!selected:docker.home.cz"
    });
  });

  it("does not invite when the bot is already joined or cannot authenticate", () => {
    expect(
      aiMatrixBotInvitePlan({
        enabled: true,
        label: "COP AI Assistant",
        matrixBot: {
          matrixUserId: "@cop.ai.agent:docker.home.cz",
          roomId: "!room:docker.home.cz",
          status: "joined"
        },
        mode: "cop-context"
      })
    ).toBeNull();
    expect(
      aiMatrixBotInvitePlan({
        enabled: true,
        label: "COP AI Assistant",
        matrixBot: {
          matrixUserId: "@cop.ai.agent:docker.home.cz",
          roomId: "!room:docker.home.cz",
          status: "bot_token_unavailable"
        },
        mode: "cop-context"
      })
    ).toBeNull();
  });
});

describe("buildChatItems", () => {
  it("marks the dedicated AI direct chat with the AI avatar variant", () => {
    const conversation = {
      conversationId: "c-ai",
      members: [{ displayName: "COP AI Assistant", role: "bot", userId: "cop.ai.agent" }],
      metadata: {
        externalId: "cop.ai.agent",
        source: "cop.ai.direct"
      },
      title: "COP AI Assistant",
      type: "direct",
      updatedAt: "2026-06-26T08:00:00.000Z"
    } as unknown as MessagingConversationSummary;

    const items = buildChatItems({
      authSubjectId: "@me:example.cz",
      conversations: [conversation],
      filter: "all",
      groups: [],
      ownIdentityIds: new Set<string>(),
      query: "",
      rooms: [],
      selectedConversationId: "c-ai",
      selectedGroupId: null,
      selectedRoomId: null
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.avatarVariant).toBe("ai");
    expect(isAiAgentChatItem(items[0] as ChatListItem)).toBe(true);
  });

  it("derives latest/preview/unread/sortAt for a room-backed direct conversation from the room summary", () => {
    const conversation = {
      conversationId: "c1",
      matrix: { roomId: "!room:example.cz" },
      memberCount: 2,
      members: [{ userId: "@alice:example.cz", displayName: "Alice" }],
      title: "Alice",
      type: "direct",
      updatedAt: "2026-06-26T07:00:00.000Z"
    } as unknown as MessagingConversationSummary;
    const latest = message({ eventId: "$latest", body: "Poslední zpráva", timestamp: "2026-06-26T08:30:00.000Z" });
    const room = { roomId: "!room:example.cz", unreadCount: 3, latestMessage: latest } as unknown as MatrixRoomSummary;

    const items = buildChatItems({
      authSubjectId: "@me:example.cz",
      conversations: [conversation],
      filter: "all",
      groups: [],
      ownIdentityIds: new Set<string>(),
      query: "",
      rooms: [room],
      selectedConversationId: null,
      selectedGroupId: null,
      selectedRoomId: "!room:example.cz"
    });

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item?.id).toBe("room:!room:example.cz");
    expect(item?.roomId).toBe("!room:example.cz");
    expect(item?.type).toBe("direct");
    expect(item?.active).toBe(true); // selectedRoomId matches
    expect(item?.unreadCount).toBe(3); // from room
    expect(item?.latest?.eventId).toBe("$latest");
    expect(item?.preview).toContain("Poslední zpráva");
    expect(item?.preferenceKey).toBeTruthy();
  });
});
