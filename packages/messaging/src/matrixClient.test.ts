import { afterEach, describe, expect, it, vi } from "vitest";
import { createMatrixMessagingSession, formatMatrixClientError, normalizeMatrixMessageBody } from "./matrixClient.js";
import type { MessagingBootstrapResponse } from "./types.js";

type MockMatrixClient = {
  getCrypto?: () => MockMatrixCrypto;
  getJoinedRooms?: () => Promise<{ joined_rooms: string[] }>;
  getProfileInfo?: (userId: string) => Promise<Record<string, unknown>>;
  getRooms: () => unknown[];
  getUserId: () => string;
  initRustCrypto: () => Promise<void>;
  isRoomEncrypted: () => boolean;
  leave?: MatrixLeaveRoom;
  mxcUrlToHttp?: MatrixMxcUrlToHttp;
  off?: MatrixEventSubscription;
  on?: MatrixEventSubscription;
  redactEvent?: MatrixRedactEvent;
  sendEvent?: MatrixSendEvent;
  sendMessage?: MatrixSendMessage;
  sendStateEvent?: MatrixSendStateEvent;
  setAvatarUrl?: (mxcUrl: string) => Promise<unknown>;
  setDisplayName?: (displayName: string) => Promise<unknown>;
  scrollback?: MatrixScrollback;
  startClient: () => Promise<void>;
  uploadContent?: (file: Blob | File, opts?: Record<string, unknown>) => Promise<{ content_uri?: string; contentUri?: string }>;
};

type MockMatrixCrypto = {
  bootstrapCrossSigning?: (options: {
    authUploadDeviceSigningKeys?: (makeRequest: (authData: Record<string, unknown> | null) => Promise<unknown>) => Promise<unknown>;
    setupNewCrossSigning?: boolean;
  }) => Promise<void>;
  bootstrapSecretStorage?: (options: {
    createSecretStorageKey?: () => Promise<unknown>;
    setupNewKeyBackup?: boolean;
    setupNewSecretStorage?: boolean;
  }) => Promise<void>;
  checkKeyBackupAndEnable?: () => Promise<unknown>;
  createRecoveryKeyFromPassphrase?: () => Promise<unknown>;
  getActiveSessionBackupVersion?: () => Promise<string | null>;
  getKeyBackupInfo?: () => Promise<unknown | null>;
  isCrossSigningReady?: () => Promise<boolean>;
  isSecretStorageReady?: () => Promise<boolean>;
  loadSessionBackupPrivateKeyFromSecretStorage?: () => Promise<void>;
  resetEncryption?: (authUploadDeviceSigningKeys: (makeRequest: (authData: Record<string, unknown> | null) => Promise<unknown>) => Promise<unknown>) => Promise<void>;
  restoreKeyBackup?: () => Promise<unknown>;
};

type MatrixSendStateEvent = (roomId: string, eventType: string, content: Record<string, unknown>, stateKey?: string) => Promise<unknown>;
type MatrixSendEvent = (roomId: string, eventType: string, content: Record<string, unknown>, txnId?: string) => Promise<unknown>;
type MatrixSendMessage = (roomId: string, content: Record<string, unknown>) => Promise<unknown>;
type MatrixRedactEvent = (roomId: string, eventId: string, txnId?: string, opts?: Record<string, unknown>) => Promise<unknown>;
type MatrixLeaveRoom = (roomId: string) => Promise<unknown>;
type MatrixScrollback = (room: unknown, limit?: number) => Promise<unknown>;
type MatrixEventSubscription = (event: string, listener: (...args: unknown[]) => void) => void;
type MatrixMxcUrlToHttp = (mxcUrl: string, width?: number, height?: number, resizeMethod?: string, allowDirectLinks?: boolean, allowRedirects?: boolean, useAuthentication?: boolean) => string | null;

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
  vi.unstubAllGlobals();
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

  it("syncs authenticated COP display name to the Matrix user profile", async () => {
    const setDisplayName = vi.fn<NonNullable<MockMatrixClient["setDisplayName"]>>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      getProfileInfo: vi.fn().mockResolvedValue({}),
      rooms: [createRoom({ roomId: "!chat:cop.local" })],
      setDisplayName
    }));

    await createMatrixMessagingSession(createBootstrap(), {
      profile: { displayName: "Jiří Volek" }
    });

    await vi.waitFor(() => expect(setDisplayName).toHaveBeenCalledWith("Jiří Volek"));
  });

  it("uploads authenticated COP avatar and syncs it to the Matrix user profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["avatar"], { type: "image/png" }), { status: 200 })));
    const setAvatarUrl = vi.fn<NonNullable<MockMatrixClient["setAvatarUrl"]>>().mockResolvedValue(undefined);
    const uploadContent = vi.fn<NonNullable<MockMatrixClient["uploadContent"]>>().mockResolvedValue({ content_uri: "mxc://cop.local/avatar" });
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      getProfileInfo: vi.fn().mockResolvedValue({}),
      rooms: [createRoom({ roomId: "!chat:cop.local" })],
      setAvatarUrl,
      uploadContent
    }));

    await createMatrixMessagingSession(createBootstrap(), {
      profile: { avatarUrl: "data:image/png;base64,YXZhdGFy" }
    });

    await vi.waitFor(() => expect(uploadContent).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({
      includeFilename: false,
      name: "avatar",
      type: "image/png"
    })));
    expect(setAvatarUrl).toHaveBeenCalledWith("mxc://cop.local/avatar");
  });

  it("refreshes direct chat avatars from Matrix profile info when room member state has no avatar", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const onRoomsChanged = vi.fn();
    const getProfileInfo = vi.fn<NonNullable<MockMatrixClient["getProfileInfo"]>>(async (userId) => userId === "@peer:cop.local"
      ? { avatar_url: "mxc://cop.local/peer-avatar", displayname: "Peer User" }
      : {});
    const mxcUrlToHttp = vi.fn<MatrixMxcUrlToHttp>((mxcUrl) => `https://msg.zeleznalady.cz/media/${encodeURIComponent(mxcUrl)}`);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      getProfileInfo,
      mxcUrlToHttp,
      rooms: [createRoom({
        members: [
          { displayName: "COP Operator", userId: "@operator:cop.local" },
          { displayName: "Peer User", userId: "@peer:cop.local" }
        ],
        roomId: "!direct:cop.local"
      })]
    }));

    const session = await createMatrixMessagingSession(createBootstrap(), { onRoomsChanged });

    expect(session.getRooms()[0]?.avatarUrl).toBeUndefined();

    await vi.runOnlyPendingTimersAsync();

    const latestRooms = onRoomsChanged.mock.calls.at(-1)?.[0];
    expect(getProfileInfo).toHaveBeenCalledWith("@peer:cop.local");
    expect(latestRooms?.[0]?.avatarUrl).toBe("https://msg.zeleznalady.cz/media/mxc%3A%2F%2Fcop.local%2Fpeer-avatar");
    expect(latestRooms?.[0]?.directPeer?.avatarUrl).toBe("https://msg.zeleznalady.cz/media/mxc%3A%2F%2Fcop.local%2Fpeer-avatar");
  });

  it("fills missing peer avatar from the Matrix HTTP profile when SDK profile is partial", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/_matrix/client/v3/profile/")) {
        return new Response(JSON.stringify({ avatar_url: "mxc://cop.local/http-peer-avatar" }), {
          headers: { "content-type": "application/json" },
          status: 200
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onRoomsChanged = vi.fn();
    const getProfileInfo = vi.fn<NonNullable<MockMatrixClient["getProfileInfo"]>>(async (userId) => userId === "@peer:cop.local"
      ? { displayname: "Peer User" }
      : {});
    const mxcUrlToHttp = vi.fn<MatrixMxcUrlToHttp>((mxcUrl) => `https://msg.zeleznalady.cz/media/${encodeURIComponent(mxcUrl)}`);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      getProfileInfo,
      mxcUrlToHttp,
      rooms: [createRoom({
        members: [
          { displayName: "COP Operator", userId: "@operator:cop.local" },
          { displayName: "Peer User", userId: "@peer:cop.local" }
        ],
        roomId: "!direct:cop.local"
      })]
    }));

    await createMatrixMessagingSession(createBootstrap(), { onRoomsChanged });
    await vi.runOnlyPendingTimersAsync();

    const latestRooms = onRoomsChanged.mock.calls.at(-1)?.[0];
    expect(getProfileInfo).toHaveBeenCalledWith("@peer:cop.local");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://msg.zeleznalady.cz/_matrix/client/v3/profile/%40peer%3Acop.local",
      expect.objectContaining({
        cache: "no-store",
        headers: { Authorization: "Bearer test-token" }
      })
    );
    expect(latestRooms?.[0]?.avatarUrl).toBe("https://msg.zeleznalady.cz/media/mxc%3A%2F%2Fcop.local%2Fhttp-peer-avatar");
    expect(latestRooms?.[0]?.directPeer?.avatarUrl).toBe("https://msg.zeleznalady.cz/media/mxc%3A%2F%2Fcop.local%2Fhttp-peer-avatar");
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

  it("keeps an empty initial scrollback retryable while Matrix sync warms the timeline", async () => {
    const timeline: unknown[] = [];
    const scrollback = vi.fn<MatrixScrollback>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      rooms: [createRoom({ roomId: "!chat:cop.local", timeline })],
      scrollback
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    const first = await session.loadMoreTimeline("!chat:cop.local", 50);
    timeline.push(createMessageEvent("synced after first attempt", Date.parse("2026-06-24T11:00:00.000Z")));
    const second = await session.loadMoreTimeline("!chat:cop.local", 50);

    expect(first).toEqual({ exhausted: false, messages: [] });
    expect(scrollback).toHaveBeenCalledTimes(2);
    expect(second.messages.map((message) => message.body)).toEqual(["synced after first attempt"]);
  });

  it("hides local cached rooms that are no longer joined on the homeserver", async () => {
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!active:cop.local"] }),
      rooms: [
        createRoom({ roomId: "!active:cop.local" }),
        createRoom({ roomId: "!purged-local-cache:cop.local" })
      ]
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getRooms().map((room) => room.roomId)).toEqual(["!active:cop.local"]);
  });

  it("coalesces a burst of decrypted events into a single timeline callback", async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const on = vi.fn<MatrixEventSubscription>((event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    });
    const off = vi.fn<MatrixEventSubscription>();
    const onTimelineChanged = vi.fn();
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      off,
      on,
      rooms: [createRoom({ roomId: "!chat:cop.local" })]
    }));

    const session = await createMatrixMessagingSession(createBootstrap(), { onTimelineChanged });
    onTimelineChanged.mockClear();

    // Fire several decrypt events synchronously, as the SDK does during sync.
    for (let index = 0; index < 5; index += 1) {
      for (const listener of listeners.get("Event.decrypted") ?? []) {
        listener();
      }
    }

    // The callback is deferred to a microtask and coalesced: nothing fired yet.
    expect(onTimelineChanged).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(on).toHaveBeenCalledWith("Event.decrypted", expect.any(Function));
    expect(onTimelineChanged).toHaveBeenCalledTimes(1);

    session.stop();
    expect(off).toHaveBeenCalledWith("Event.decrypted", expect.any(Function));
  });

  it("does not flush timeline callbacks scheduled after the session stops", async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const on = vi.fn<MatrixEventSubscription>((event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    });
    const onTimelineChanged = vi.fn();
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      on,
      rooms: [createRoom({ roomId: "!chat:cop.local" })]
    }));

    const session = await createMatrixMessagingSession(createBootstrap(), { onTimelineChanged });
    onTimelineChanged.mockClear();

    for (const listener of listeners.get("Event.decrypted") ?? []) {
      listener();
    }
    session.stop();
    await Promise.resolve();

    expect(onTimelineChanged).not.toHaveBeenCalled();
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

  it("sends and reads COP AI metadata on Matrix text messages", async () => {
    const sendMessage = vi.fn<MatrixSendMessage>().mockResolvedValue(undefined);
    const content = {
      "cz.cop": {
        ai: {
          auditId: "audit-1",
          mapActions: [{
            action: "focus-map",
            distanceText: "1.8 km",
            entityId: "place:nominatim:183697209",
            entityType: "place",
            label: "Zobrazit na mapě: Policie ČR - Vrbno pod Pradědem (1.8 km)",
            layerId: "reference.infrastructure.emergency",
            lat: 50.12076,
            lon: 17.38413,
            sourceName: "SIM search-data",
            sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
            title: "Policie ČR - Vrbno pod Pradědem",
            zoom: 16
          }],
          policyReason: "allowed",
          provider: "mock",
          question: "Co je teď důležité?",
          requestId: "request-1",
          status: "COMPLETED",
          type: "chat-agent"
        },
        kind: "ai-agent-response",
        source: "cop-chat"
      },
      body: "AI odpověď",
      msgtype: "m.text"
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      rooms: [createRoom({
        roomId: "!chat:cop.local",
        timeline: [createMessageEvent(content.body, Date.parse("2026-06-24T11:00:00.000Z"), "$ai", "@operator:cop.local", content)]
      })],
      sendMessage
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.sendMessage("!chat:cop.local", "AI odpověď", {
      cop: {
        ai: {
          auditId: "audit-1",
          mapActions: [{
            action: "focus-map",
            distanceText: "1.8 km",
            entityId: "place:nominatim:183697209",
            entityType: "place",
            label: "Zobrazit na mapě: Policie ČR - Vrbno pod Pradědem (1.8 km)",
            layerId: "reference.infrastructure.emergency",
            lat: 50.12076,
            lon: 17.38413,
            sourceName: "SIM search-data",
            sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
            title: "Policie ČR - Vrbno pod Pradědem",
            zoom: 16
          }],
          policyReason: "allowed",
          provider: "mock",
          question: "Co je teď důležité?",
          requestId: "request-1",
          status: "COMPLETED",
          type: "chat-agent"
        },
        kind: "ai-agent-response",
        source: "cop-chat"
      }
    });

    expect(sendMessage).toHaveBeenCalledWith("!chat:cop.local", content);
    expect(session.getTimeline("!chat:cop.local")[0]?.cop).toEqual(content["cz.cop"]);
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
          createReactionEvent("$hello", "👀", "@operator:cop.local", "$reaction-own-old"),
          createReactionEvent("$hello", "👍", "@operator:cop.local", "$reaction-own")
        ]
      })],
      sendEvent
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.setReaction("!chat:cop.local", "$hello", "👍");

    expect(redactEvent).toHaveBeenNthCalledWith(1, "!chat:cop.local", "$reaction-own-old", undefined, {
      reason: "Reakce odstraněna uživatelem"
    });
    expect(redactEvent).toHaveBeenNthCalledWith(2, "!chat:cop.local", "$reaction-own", undefined, {
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

  it("leaves a Matrix room when leaving a group", async () => {
    const leave = vi.fn<MatrixLeaveRoom>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      leave,
      rooms: [createRoom({ roomId: "!group:cop.local" })]
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.leaveRoom("!group:cop.local");

    expect(leave).toHaveBeenCalledWith("!group:cop.local");
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
        isCrossSigningReady: vi.fn().mockResolvedValue(false),
        isSecretStorageReady: vi.fn().mockResolvedValue(false)
      },
      rooms: []
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.getEncryptionRecoveryStatus()).resolves.toMatchObject({
      keyBackupEnabled: false,
      keyBackupExists: false,
      matrixRustCompatible: false,
      needsSetup: true,
      ready: false
    });
  });

  it("treats active key backup as web-ready even when iOS metadata are incomplete", async () => {
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({
      crypto: {
        getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
        getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
        isCrossSigningReady: vi.fn().mockResolvedValue(false),
        isSecretStorageReady: vi.fn().mockResolvedValue(true)
      },
      rooms: []
    }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.getEncryptionRecoveryStatus()).resolves.toMatchObject({
      canPrepareForMobile: false,
      crossSigningReady: false,
      keyBackupEnabled: true,
      keyBackupExists: true,
      matrixRustCompatible: false,
      needsSetup: false,
      ready: true,
      secretStorageReady: true
    });
  });

  it("creates a user-held Matrix recovery key without server-managed recovery material", async () => {
    const bootstrapCrossSigning = vi.fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>().mockResolvedValue(undefined);
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning,
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK aBCd user held recovery key",
        privateKey: new Uint8Array([1, 2, 3])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true)
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());
    const recoveryKey = await session.createEncryptionRecovery();

    expect(recoveryKey).toBe("EsTK aBCd user held recovery key");
    expect(bootstrapCrossSigning).toHaveBeenCalled();
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(expect.objectContaining({
      setupNewKeyBackup: true,
      setupNewSecretStorage: true
    }));
  });

  it("prepares a complete Matrix Rust compatible recovery set for iPhone and iPad", async () => {
    const bootstrapCrossSigning = vi.fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>().mockResolvedValue(undefined);
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(async (authUploadDeviceSigningKeys) => {
      await authUploadDeviceSigningKeys((authData) => Promise.resolve(authData));
    });
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning,
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK mobile compatible recovery key",
        privateKey: new Uint8Array([7, 8, 9])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("2"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "2" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      resetEncryption
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());
    const recoveryKey = await session.prepareEncryptionRecoveryForMobile();

    expect(recoveryKey).toBe("EsTK mobile compatible recovery key");
    expect(resetEncryption).toHaveBeenCalled();
    expect(bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(expect.objectContaining({
      setupNewKeyBackup: false,
      setupNewSecretStorage: true
    }));
    await expect(session.getEncryptionRecoveryStatus()).resolves.toMatchObject({
      matrixRustCompatible: true,
      ready: true
    });
  });

  it("accepts a completed recovery when Matrix reports a duplicate one-time key upload", async () => {
    const duplicateUploadError = new Error(
      "MatrixError: [400] One time key signed_curve25519:AAAAAAAAAGO already exists. Old key: {\"key\":\"old-secret\",\"signatures\":{\"@user:server\":{\"ed25519:DEVICE\":\"old-signature\"}}}; new key: {\"key\":\"new-secret\"} (https://msg.zeleznalady.cz/_matrix/client/v3/keys/upload)"
    );
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
      throw duplicateUploadError;
    });
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning: vi.fn(),
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK duplicate upload recovery key",
        privateKey: new Uint8Array([7, 8, 9])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("2"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "2" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      resetEncryption: vi.fn().mockResolvedValue(undefined)
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.prepareEncryptionRecoveryForMobile()).resolves.toBe("EsTK duplicate upload recovery key");
    expect(crypto.checkKeyBackupAndEnable).toHaveBeenCalled();
  });

  it("sanitizes duplicate one-time key upload failures when recovery cannot be confirmed", async () => {
    const duplicateUploadError = new Error(
      "MatrixError: [400] One time key signed_curve25519:AAAAAAAAAGO already exists. Old key: {\"key\":\"old-secret\",\"signatures\":{\"@user:server\":{\"ed25519:DEVICE\":\"old-signature\"}}}; new key: {\"key\":\"new-secret\"} (https://msg.zeleznalady.cz/_matrix/client/v3/keys/upload)"
    );
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
      throw duplicateUploadError;
    });
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning: vi.fn(),
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK duplicate upload recovery key",
        privateKey: new Uint8Array([7, 8, 9])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue(null),
      getKeyBackupInfo: vi.fn().mockResolvedValue(null),
      isCrossSigningReady: vi.fn().mockResolvedValue(false),
      isSecretStorageReady: vi.fn().mockResolvedValue(false),
      resetEncryption: vi.fn().mockResolvedValue(undefined)
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());
    let caught: unknown;
    try {
      await session.prepareEncryptionRecoveryForMobile();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("původní webové zařízení");
    expect((caught as Error).message).not.toMatch(/signed_curve25519|old-secret|new-secret|old-signature|\/keys\/upload/iu);
  });

  it("keeps the generated secret-storage key available during iOS recovery preparation", async () => {
    let createClientOptions: Record<string, unknown> | undefined;
    const bootstrapCrossSigning = vi.fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>().mockResolvedValue(undefined);
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
      const callbacks = createClientOptions?.cryptoCallbacks as {
        getSecretStorageKey?: (
          options: { keys: Record<string, unknown> },
          name: string
        ) => Promise<[string, Uint8Array] | null>;
      } | undefined;
      const returnedKey = await callbacks?.getSecretStorageKey?.({
        keys: {
          "generated-key": { algorithm: "m.secret_storage.v1.aes-hmac-sha2" }
        }
      }, "m.cross_signing.master");
      expect(returnedKey?.[0]).toBe("generated-key");
      expect(Array.from(returnedKey?.[1] ?? [])).toEqual([7, 8, 9]);
    });
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning,
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK mobile compatible recovery key",
        privateKey: new Uint8Array([7, 8, 9])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("2"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "2" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true)
    };
    matrixSdkMock.createClient.mockImplementation((options: Record<string, unknown>) => {
      createClientOptions = options;
      return createMockMatrixClient({ crypto, rooms: [] });
    });

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.prepareEncryptionRecoveryForMobile()).resolves.toBe("EsTK mobile compatible recovery key");
    expect(bootstrapSecretStorage).toHaveBeenCalled();
  });

  it("does not read legacy cross-signing secrets after creating a mobile recovery set", async () => {
    const bootstrapCrossSigning = vi.fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>(async (options) => {
      throw new Error(`Legacy cross-signing read was attempted: ${String(options.setupNewCrossSigning)}`);
    });
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>().mockResolvedValue(undefined);
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning,
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK mobile compatible recovery key",
        privateKey: new Uint8Array([7, 8, 9])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("2"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "2" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      resetEncryption
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.prepareEncryptionRecoveryForMobile()).resolves.toBe("EsTK mobile compatible recovery key");
    expect(resetEncryption).toHaveBeenCalled();
    expect(bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it("resets legacy Matrix E2EE metadata before preparing iOS recovery", async () => {
    const bootstrapCrossSigning = vi.fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>().mockRejectedValue(
      new Error("getSecretStorageKey callback returned falsey")
    );
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>().mockResolvedValue(undefined);
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning,
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK clean mobile recovery key",
        privateKey: new Uint8Array([1, 2, 3])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("3"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "3" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      resetEncryption
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.prepareEncryptionRecoveryForMobile()).resolves.toBe("EsTK clean mobile recovery key");
    expect(resetEncryption).toHaveBeenCalled();
    expect(bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(expect.objectContaining({
      setupNewKeyBackup: false,
      setupNewSecretStorage: true
    }));
  });

  it("completes Matrix UIA with dummy auth when the homeserver offers it", async () => {
    const authAttempts: Array<Record<string, unknown> | null> = [];
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(async (authUploadDeviceSigningKeys) => {
      await authUploadDeviceSigningKeys(async (authData) => {
        authAttempts.push(authData);
        if (!authData) {
          throw Object.assign(new Error("UIA required"), {
            data: {
              flows: [{ stages: ["m.login.dummy"] }],
              session: "UIA_SESSION"
            }
          });
        }
        return undefined;
      });
    });
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning: vi.fn(),
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK dummy uia recovery key",
        privateKey: new Uint8Array([4, 5, 6])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      resetEncryption
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.prepareEncryptionRecoveryForMobile()).resolves.toBe("EsTK dummy uia recovery key");
    expect(authAttempts).toEqual([
      null,
      { session: "UIA_SESSION", type: "m.login.dummy" }
    ]);
  });

  it("surfaces Matrix UIA requirements instead of masking them as COP login failures", async () => {
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(async (authUploadDeviceSigningKeys) => {
      await authUploadDeviceSigningKeys(async () => {
        throw Object.assign(new Error("UIA required"), {
          data: {
            flows: [{ stages: ["m.login.password"] }],
            session: "PASSWORD_UIA"
          }
        });
      });
    });
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning: vi.fn(),
      bootstrapSecretStorage: vi.fn(),
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK unused",
        privateKey: new Uint8Array([4, 5, 6])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(false),
      isSecretStorageReady: vi.fn().mockResolvedValue(false),
      resetEncryption
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.prepareEncryptionRecoveryForMobile()).rejects.toThrow(/Matrix interactive auth.*m\.login\.password/u);
  });

  it("resets Matrix encryption metadata before rotating the recovery key", async () => {
    const bootstrapCrossSigning = vi.fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>().mockResolvedValue(undefined);
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(async (authUploadDeviceSigningKeys) => {
      await authUploadDeviceSigningKeys((authData) => Promise.resolve(authData));
    });
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning,
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK replacement recovery key",
        privateKey: new Uint8Array([4, 5, 6])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      resetEncryption
    };
    matrixSdkMock.createClient.mockReturnValue(createMockMatrixClient({ crypto, rooms: [] }));

    const session = await createMatrixMessagingSession(createBootstrap());
    const recoveryKey = await session.createEncryptionRecovery(true);

    expect(recoveryKey).toBe("EsTK replacement recovery key");
    expect(resetEncryption).toHaveBeenCalled();
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(expect.objectContaining({
      setupNewKeyBackup: false,
      setupNewSecretStorage: true
    }));
  });

  it("restores an existing key backup after the user enters a recovery key", async () => {
    const crypto: MockMatrixCrypto = {
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
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
  getJoinedRooms,
  getProfileInfo,
  leave,
  mxcUrlToHttp,
  redactEvent = vi.fn<MatrixRedactEvent>().mockResolvedValue(undefined),
  off,
  on,
  rooms,
  sendEvent = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined),
  sendMessage = vi.fn<MatrixSendMessage>().mockResolvedValue(undefined),
  sendStateEvent = vi.fn<MatrixSendStateEvent>().mockResolvedValue(undefined),
  setAvatarUrl,
  setDisplayName,
  scrollback,
  uploadContent
}: {
  crypto?: MockMatrixCrypto;
  getJoinedRooms?: MockMatrixClient["getJoinedRooms"];
  getProfileInfo?: MockMatrixClient["getProfileInfo"];
  leave?: MockMatrixClient["leave"];
  mxcUrlToHttp?: MockMatrixClient["mxcUrlToHttp"];
  off?: MockMatrixClient["off"];
  on?: MockMatrixClient["on"];
  redactEvent?: MockMatrixClient["redactEvent"];
  rooms: unknown[];
  sendEvent?: MockMatrixClient["sendEvent"];
  sendMessage?: MockMatrixClient["sendMessage"];
  sendStateEvent?: MockMatrixClient["sendStateEvent"];
  setAvatarUrl?: MockMatrixClient["setAvatarUrl"];
  setDisplayName?: MockMatrixClient["setDisplayName"];
  scrollback?: MockMatrixClient["scrollback"];
  uploadContent?: MockMatrixClient["uploadContent"];
}): MockMatrixClient {
  return {
    ...(crypto ? { getCrypto: () => crypto } : {}),
    ...(getJoinedRooms ? { getJoinedRooms } : {}),
    ...(getProfileInfo ? { getProfileInfo } : {}),
    getRooms: () => rooms,
    getUserId: () => "@operator:cop.local",
    initRustCrypto: () => Promise.resolve(),
    isRoomEncrypted: () => true,
    ...(leave ? { leave } : {}),
    ...(mxcUrlToHttp ? { mxcUrlToHttp } : {}),
    ...(off ? { off } : {}),
    ...(on ? { on } : {}),
    redactEvent,
    sendEvent,
    sendMessage,
    sendStateEvent,
    ...(setAvatarUrl ? { setAvatarUrl } : {}),
    ...(setDisplayName ? { setDisplayName } : {}),
    ...(scrollback ? { scrollback } : {}),
    ...(uploadContent ? { uploadContent } : {}),
    startClient: () => Promise.resolve()
  };
}

function createRoom({
  members,
  retentionSeconds,
  roomId,
  timeline = []
}: {
  members?: Array<{ avatarUrl?: string; displayName?: string; userId: string }>;
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
    ...(members ? { getJoinedMembers: () => members } : {}),
    getMyMembership: () => "join",
    getUnreadNotificationCount: () => 0,
    name: "Test Chat",
    roomId,
    timeline
  };
}

function createMessageEvent(
  body: string,
  timestamp: number,
  eventId = `$${body}`,
  sender = "@operator:cop.local",
  content: Record<string, unknown> = { body, msgtype: "m.text" }
) {
  return {
    getContent: () => content,
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
