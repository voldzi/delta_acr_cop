import { afterEach, describe, expect, it, vi } from "vitest";
import { createMatrixMessagingSession, formatMatrixClientError, normalizeMatrixMessageBody } from "./matrixClient";
import type { MessagingBootstrapResponse } from "../cop-data";

type MockMatrixClient = {
  getCrypto?: () => MockMatrixCrypto;
  getRooms: () => unknown[];
  getUserId: () => string;
  initRustCrypto: () => Promise<void>;
  isRoomEncrypted: () => boolean;
  redactEvent?: MatrixRedactEvent;
  sendEvent?: MatrixSendEvent;
  sendMessage?: MatrixSendMessage;
  sendStateEvent?: MatrixSendStateEvent;
  startClient: () => Promise<void>;
};

type MockMatrixCrypto = {
  bootstrapSecretStorage?: (options: {
    createSecretStorageKey?: () => Promise<unknown>;
    setupNewKeyBackup?: boolean;
    setupNewSecretStorage?: boolean;
  }) => Promise<void>;
  checkKeyBackupAndEnable?: () => Promise<unknown>;
  createRecoveryKeyFromPassphrase?: () => Promise<unknown>;
  getActiveSessionBackupVersion?: () => Promise<string | null>;
  getKeyBackupInfo?: () => Promise<unknown | null>;
  isSecretStorageReady?: () => Promise<boolean>;
  loadSessionBackupPrivateKeyFromSecretStorage?: () => Promise<void>;
  restoreKeyBackup?: () => Promise<unknown>;
};

type MatrixSendStateEvent = (roomId: string, eventType: string, content: Record<string, unknown>, stateKey?: string) => Promise<unknown>;
type MatrixSendEvent = (roomId: string, eventType: string, content: Record<string, unknown>, txnId?: string) => Promise<unknown>;
type MatrixSendMessage = (roomId: string, content: Record<string, unknown>) => Promise<unknown>;
type MatrixRedactEvent = (roomId: string, eventId: string, txnId?: string, opts?: Record<string, unknown>) => Promise<unknown>;

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

  it("sends Matrix reactions as annotation relation events", async () => {
    const sendEvent = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      rooms: [createRoom({ roomId: "!chat:cop.local" })],
      sendEvent
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.sendReaction("!chat:cop.local", "$message", "👍");

    expect(sendEvent).toHaveBeenCalledWith("!chat:cop.local", "m.reaction", {
      "m.relates_to": {
        event_id: "$message",
        key: "👍",
        rel_type: "m.annotation"
      }
    });
  });

  it("removes the current Matrix reaction when setting the same reaction again", async () => {
    const redactEvent = vi.fn<MatrixRedactEvent>().mockResolvedValue(undefined);
    const sendEvent = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      redactEvent,
      rooms: [createRoom({
        roomId: "!chat:cop.local",
        timeline: [
          createMessageEvent("hello", Date.parse("2026-06-24T11:00:00.000Z"), "$hello", "@other:cop.local"),
          createReactionEvent("$hello", "👍", "@operator:cop.local", "$reaction-own")
        ]
      })],
      sendEvent
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.setReaction("!chat:cop.local", "$hello", "👍");

    expect(redactEvent).toHaveBeenCalledWith("!chat:cop.local", "$reaction-own", undefined, {
      reason: "Reakce odstraněna uživatelem"
    });
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("changes the current Matrix reaction by redacting the old one before sending the new one", async () => {
    const redactEvent = vi.fn<MatrixRedactEvent>().mockResolvedValue(undefined);
    const sendEvent = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      redactEvent,
      rooms: [createRoom({
        roomId: "!chat:cop.local",
        timeline: [
          createMessageEvent("hello", Date.parse("2026-06-24T11:00:00.000Z"), "$hello", "@other:cop.local"),
          createReactionEvent("$hello", "👀", "@operator:cop.local", "$reaction-own")
        ]
      })],
      sendEvent
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.setReaction("!chat:cop.local", "$hello", "👍");

    expect(redactEvent).toHaveBeenCalledWith("!chat:cop.local", "$reaction-own", undefined, {
      reason: "Reakce změněna uživatelem"
    });
    expect(sendEvent).toHaveBeenCalledWith("!chat:cop.local", "m.reaction", {
      "m.relates_to": {
        event_id: "$hello",
        key: "👍",
        rel_type: "m.annotation"
      }
    });
  });

  it("redacts messages through Matrix when deleting a message", async () => {
    const redactEvent = vi.fn<MatrixRedactEvent>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      redactEvent,
      rooms: [createRoom({ roomId: "!chat:cop.local" })]
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.deleteMessage("!chat:cop.local", "$message");

    expect(redactEvent).toHaveBeenCalledWith("!chat:cop.local", "$message", undefined, {
      reason: "Odstraněno uživatelem"
    });
  });

  it("reads grouped Matrix reactions from timeline relation events", async () => {
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      rooms: [createRoom({
        roomId: "!chat:cop.local",
        timeline: [
          createMessageEvent("hello", Date.parse("2026-06-24T11:00:00.000Z"), "$hello", "@other:cop.local"),
          createReactionEvent("$hello", "👍", "@operator:cop.local", "$reaction-own"),
          createReactionEvent("$hello", "👍", "@other:cop.local", "$reaction-other")
        ]
      })]
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getTimeline("!chat:cop.local")[0]?.reactions).toEqual([{
      count: 2,
      key: "👍",
      own: true,
      ownEventId: "$reaction-own",
      senders: ["@operator:cop.local", "@other:cop.local"]
    }]);
  });

  it("reports that user-controlled E2EE recovery needs setup when no key backup exists", async () => {
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      crypto: {
        getActiveSessionBackupVersion: vi.fn().mockResolvedValue(null),
        getKeyBackupInfo: vi.fn().mockResolvedValue(null),
        isSecretStorageReady: vi.fn().mockResolvedValue(false)
      },
      rooms: []
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.getEncryptionRecoveryStatus()).resolves.toMatchObject({
      keyBackupEnabled: false,
      keyBackupExists: false,
      needsSetup: true,
      ready: false
    });
  });

  it("creates a user-held Matrix recovery key without server-managed recovery material", async () => {
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const crypto: MockMatrixCrypto = {
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK aBCd user held recovery key",
        privateKey: new Uint8Array([1, 2, 3])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue(null),
      getKeyBackupInfo: vi.fn().mockResolvedValue(null),
      isSecretStorageReady: vi.fn().mockResolvedValue(false)
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());
    const recoveryKey = await session.createEncryptionRecovery();

    expect(recoveryKey).toBe("EsTK aBCd user held recovery key");
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(expect.objectContaining({
      setupNewKeyBackup: true
    }));
  });

  it("restores an existing key backup after the user enters a recovery key", async () => {
    const crypto: MockMatrixCrypto = {
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      loadSessionBackupPrivateKeyFromSecretStorage: vi.fn().mockResolvedValue(undefined),
      restoreKeyBackup: vi.fn().mockResolvedValue(undefined)
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.restoreEncryptionRecovery("EsTK aBCd user held recovery key")).resolves.toBeUndefined();
    expect(crypto.loadSessionBackupPrivateKeyFromSecretStorage).toHaveBeenCalled();
    expect(crypto.checkKeyBackupAndEnable).toHaveBeenCalled();
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
  crypto,
  redactEvent = vi.fn<MatrixRedactEvent>().mockResolvedValue(undefined),
  rooms,
  sendEvent = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined),
  sendMessage = vi.fn<MatrixSendMessage>().mockResolvedValue(undefined),
  sendStateEvent = vi.fn<MatrixSendStateEvent>().mockResolvedValue(undefined)
}: {
  crypto?: MockMatrixCrypto;
  redactEvent?: MockMatrixClient["redactEvent"];
  rooms: unknown[];
  sendEvent?: MockMatrixClient["sendEvent"];
  sendMessage?: MockMatrixClient["sendMessage"];
  sendStateEvent?: MockMatrixClient["sendStateEvent"];
}): MockMatrixClient {
  return {
    ...(crypto ? { getCrypto: () => crypto } : {}),
    getRooms: () => rooms,
    getUserId: () => "@operator:cop.local",
    initRustCrypto: () => Promise.resolve(),
    isRoomEncrypted: () => true,
    redactEvent,
    sendEvent,
    sendMessage,
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

function createMessageEvent(body: string, timestamp: number, eventId = `$${body}`, sender = "@operator:cop.local") {
  return {
    getContent: () => ({ body, msgtype: "m.text" }),
    getId: () => eventId,
    getSender: () => sender,
    getTs: () => timestamp,
    getType: () => "m.room.message"
  };
}

function createReactionEvent(targetEventId: string, key: string, sender: string, eventId: string) {
  const relation = {
    event_id: targetEventId,
    key,
    rel_type: "m.annotation"
  };
  return {
    getContent: () => ({ "m.relates_to": relation }),
    getId: () => eventId,
    getRelation: () => relation,
    getSender: () => sender,
    getTs: () => Date.parse("2026-06-24T11:01:00.000Z"),
    getType: () => "m.reaction"
  };
}
