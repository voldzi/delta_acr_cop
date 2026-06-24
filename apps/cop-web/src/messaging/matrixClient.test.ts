import { afterEach, describe, expect, it, vi } from "vitest";
import { createMatrixMessagingSession, formatMatrixClientError, normalizeMatrixMessageBody } from "./matrixClient";
import type { MessagingBootstrapResponse } from "../cop-data";

type MockMatrixClient = {
  getRooms: () => unknown[];
  getUserId: () => string;
  initRustCrypto: () => Promise<void>;
  isRoomEncrypted: () => boolean;
  sendStateEvent?: MatrixSendStateEvent;
  startClient: () => Promise<void>;
};

type MatrixSendStateEvent = (roomId: string, eventType: string, content: Record<string, unknown>, stateKey?: string) => Promise<unknown>;

const matrixSdkMock = vi.hoisted(() => ({
  createClient: vi.fn()
}));

vi.mock("matrix-js-sdk/lib/browser-index.js", () => ({
  createClient: matrixSdkMock.createClient,
  Room: {
    prototype: {}
  }
}));

afterEach(() => {
  matrixSdkMock.createClient.mockReset();
  vi.useRealTimers();
});

describe("Matrix client diagnostics", () => {
  it("turns browser network failures into user-facing messaging errors", () => {
    const error = formatMatrixClientError(
      new TypeError("fetch failed: Load failed"),
      "https://msg.zeleznalady.cz",
      "založit chatovou místnost"
    );

    expect(error.message).toContain("Služba zpráv teď není z tohoto zařízení dostupná");
    expect(error.message).not.toContain("/_matrix/client/versions");
  });

  it("keeps Matrix protocol errors unchanged", () => {
    const source = new Error("M_FORBIDDEN");

    expect(formatMatrixClientError(source, "https://msg.zeleznalady.cz", "odeslat zprávu")).toBe(source);
  });

  it("hides raw Matrix decryption diagnostics from the user timeline", () => {
    expect(normalizeMatrixMessageBody(
      "** Unable to decrypt: DecryptionError: This message was sent before this device logged in, and there is no key backup on the server. **"
    )).toBe("Zprávu zatím nelze zobrazit. V tomto prohlížeči chybí šifrovací klíč pro starší zprávy.");
  });

  it("stores disappearing-message settings as Matrix room retention state", async () => {
    const sendStateEvent = vi.fn<MatrixSendStateEvent>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      rooms: [createRoom({ roomId: "!chat:cop.local" })],
      sendStateEvent
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.setMessageRetentionPolicy("!chat:cop.local", 604_800);
    await session.setMessageRetentionPolicy("!chat:cop.local", null);

    expect(sendStateEvent).toHaveBeenNthCalledWith(
      1,
      "!chat:cop.local",
      "m.room.retention",
      { max_lifetime: 604_800_000 },
      ""
    );
    expect(sendStateEvent).toHaveBeenNthCalledWith(
      2,
      "!chat:cop.local",
      "m.room.retention",
      {},
      ""
    );
  });

  it("turns Matrix retention permission failures into a user-facing error", async () => {
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      rooms: [createRoom({ roomId: "!chat:cop.local" })],
      sendStateEvent: vi.fn<MatrixSendStateEvent>().mockRejectedValue(new Error("M_FORBIDDEN: power level too low"))
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.setMessageRetentionPolicy("!chat:cop.local", 86_400))
      .rejects
      .toThrow("Automatické mazání zpráv může v této místnosti změnit jen správce chatu.");
  });

  it("reads retention state and hides messages older than the configured interval", async () => {
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      rooms: [createRoom({
        retentionSeconds: 86_400,
        roomId: "!chat:cop.local",
        timeline: [
          createMessageEvent("old", Date.parse("2026-06-22T12:00:00.000Z")),
          createMessageEvent("recent", Date.parse("2026-06-24T11:00:00.000Z"))
        ]
      })]
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getRooms()[0]?.messageRetentionSeconds).toBe(86_400);
    expect(session.getTimeline("!chat:cop.local").map((message) => message.body)).toEqual(["recent"]);
  });
});

function createBootstrap(): MessagingBootstrapResponse {
  return {
    accessToken: "test-token",
    chatAvailable: true,
    contractVersion: "cop-messaging-bootstrap-v1",
    deviceId: "TESTDEVICE",
    e2eeRequired: true,
    enabled: true,
    homeserverBaseUrl: "https://msg.zeleznalady.cz",
    providerId: "csm.messaging",
    status: "online",
    tokenAvailable: true,
    userId: "@operator:cop.local",
    warnings: []
  };
}

function createMockMatrixClient({
  rooms,
  sendStateEvent = vi.fn<MatrixSendStateEvent>().mockResolvedValue(undefined)
}: {
  rooms: unknown[];
  sendStateEvent?: MockMatrixClient["sendStateEvent"];
}): MockMatrixClient {
  return {
    getRooms: () => rooms,
    getUserId: () => "@operator:cop.local",
    initRustCrypto: () => Promise.resolve(),
    isRoomEncrypted: () => true,
    sendStateEvent,
    startClient: () => Promise.resolve()
  };
}

function createRoom({
  retentionSeconds,
  roomId,
  timeline = []
}: {
  retentionSeconds?: number;
  roomId: string;
  timeline?: unknown[];
}) {
  return {
    currentState: {
      getStateEvents: (eventType: string) => eventType === "m.room.retention" && retentionSeconds
        ? {
          getContent: () => ({ max_lifetime: retentionSeconds * 1000 }),
          getType: () => "m.room.retention"
        }
        : null
    },
    getMyMembership: () => "join",
    getUnreadNotificationCount: () => 0,
    name: "Test Chat",
    roomId,
    timeline
  };
}

function createMessageEvent(body: string, timestamp: number) {
  return {
    getContent: () => ({ body, msgtype: "m.text" }),
    getId: () => `$${body}`,
    getSender: () => "@operator:cop.local",
    getTs: () => timestamp,
    getType: () => "m.room.message"
  };
}
