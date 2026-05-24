import { describe, expect, it } from "vitest";
import { assertMatrixRoomBindingConfirmed, matrixUserIdsFromResolution } from "./MessagingPanel";

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
});
