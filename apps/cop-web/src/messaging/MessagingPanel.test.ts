import { describe, expect, it } from "vitest";
import { assertMatrixRoomBindingConfirmed, linkedConversationForCommunityGroup, matrixUserIdsFromResolution, visibleMatrixRooms } from "./MessagingPanel";
import type { CommunityGroup, MessagingConversationSummary } from "../cop-data";

describe("MessagingPanel Matrix safety gates", () => {
  it("fails closed when identity resolution is degraded", () => {
    expect(() => matrixUserIdsFromResolution({
      contractVersion: "cop-messaging-identities-v1",
      enabled: true,
      identities: [],
      providerId: "csm.messaging",
      status: "degraded",
      warnings: ["identity provider unavailable"]
    }, ["user-2"])).toThrow("identity provider unavailable");
  });

  it("fails closed when identity resolution misses a requested member", () => {
    expect(() => matrixUserIdsFromResolution({
      contractVersion: "cop-messaging-identities-v1",
      enabled: true,
      identities: [{ matrixUserId: "@user2:msg.zeleznalady.cz", userId: "user-2" }],
      providerId: "csm.messaging",
      status: "online",
      warnings: []
    }, ["user-2", "user-3"])).toThrow("user-3");
  });

  it("confirms Matrix room only after provider binding returns the same room id", () => {
    expect(() => assertMatrixRoomBindingConfirmed({
      contractVersion: "cop-messaging-room-binding-v1",
      conversation: {
        conversationId: "conv_1",
        matrix: { roomId: "!room:msg.zeleznalady.cz" },
        title: "Flood Ops",
        type: "group"
      },
      enabled: true,
      providerId: "csm.messaging",
      status: "online",
      warnings: []
    }, "!room:msg.zeleznalady.cz")).not.toThrow();

    expect(() => assertMatrixRoomBindingConfirmed({
      contractVersion: "cop-messaging-room-binding-v1",
      conversation: {
        conversationId: "conv_1",
        matrix: { roomId: "!other:msg.zeleznalady.cz" },
        title: "Flood Ops",
        type: "group"
      },
      enabled: true,
      providerId: "csm.messaging",
      status: "degraded",
      warnings: ["binding rejected"]
    }, "!room:msg.zeleznalady.cz")).toThrow("binding rejected");
  });

  it("does not duplicate Matrix rooms already represented by conversation metadata", () => {
    expect(visibleMatrixRooms([
      { encrypted: true, name: "Kyjev", roomId: "!kyjev:docker.home.cz", unreadCount: 0 },
      { encrypted: true, name: "Solo", roomId: "!solo:docker.home.cz", unreadCount: 0 }
    ], [
      {
        conversationId: "conv_kyjev",
        matrix: { roomId: "!kyjev:docker.home.cz" },
        title: "Kyjev",
        type: "group"
      }
    ])).toEqual([
      { encrypted: true, name: "Solo", roomId: "!solo:docker.home.cz", unreadCount: 0 }
    ]);
  });

  it("links group conversations only by stable community metadata, not duplicate names", () => {
    const conversations: MessagingConversationSummary[] = [
      {
        conversationId: "conv_legacy_same_name",
        title: "Kyjev",
        type: "group"
      },
      {
        conversationId: "conv_group_2",
        metadata: {
          externalId: "group_2",
          source: "cop.community"
        },
        title: "Kyjev",
        type: "group"
      }
    ];
    const groupOne = minimalGroup("group_1", "Kyjev");
    const groupTwo = minimalGroup("group_2", "Kyjev");

    expect(linkedConversationForCommunityGroup(conversations, groupOne)).toBeUndefined();
    expect(linkedConversationForCommunityGroup(conversations, groupTwo)?.conversationId).toBe("conv_group_2");
  });
});

function minimalGroup(groupId: string, name: string): CommunityGroup {
  return {
    createdAt: "2026-05-30T00:00:00.000Z",
    createdBy: {
      displayName: "Operator",
      subjectId: "operator-1",
      username: "operator"
    },
    groupId,
    members: [],
    name,
    updatedAt: "2026-05-30T00:00:00.000Z",
    visibility: "private"
  };
}
