import { afterEach, describe, expect, it, vi } from "vitest";
import { createMatrixMessagingSession, formatMatrixClientError, normalizeMatrixMessageBody } from "./matrixClient.js";
import type { MatrixVoiceCallWakeRequest, MessagingBootstrapResponse } from "./types.js";

type MockMatrixClient = {
  createGroupCall?: (roomId: string, type: string, isPtt: boolean, intent: string) => Promise<MockMatrixGroupCall>;
  getCrypto?: () => MockMatrixCrypto;
  getJoinedRooms?: () => Promise<{ joined_rooms: string[] }>;
  getGroupCallForRoom?: (roomId: string) => MockMatrixGroupCall | null;
  getProfileInfo?: (userId: string) => Promise<Record<string, unknown>>;
  getRooms: () => unknown[];
  getTurnServers?: () => RTCIceServer[];
  getUser?: (userId: string) => { displayName?: string; userId?: string } | undefined;
  getUserId: () => string;
  initRustCrypto: (args?: { cryptoDatabasePrefix?: string }) => Promise<void>;
  isRoomEncrypted: () => boolean;
  leave?: MatrixLeaveRoom;
  mxcUrlToHttp?: MatrixMxcUrlToHttp;
  off?: MatrixEventSubscription;
  on?: MatrixEventSubscription;
  redactEvent?: MatrixRedactEvent;
  sendReadReceipt?: MatrixSendReadReceipt;
  sendEvent?: MatrixSendEvent;
  sendMessage?: MatrixSendMessage;
  sendStateEvent?: MatrixSendStateEvent;
  setAccessToken?: (accessToken: string) => void;
  setRoomReadMarkers?: MatrixSetRoomReadMarkers;
  setAvatarUrl?: (mxcUrl: string) => Promise<unknown>;
  setDisplayName?: (displayName: string) => Promise<unknown>;
  setPusher?: (pusher: Record<string, unknown>) => Promise<unknown>;
  scrollback?: MatrixScrollback;
  startClient: () => Promise<void>;
  uploadContent?: (
    file: Blob | File,
    opts?: Record<string, unknown>
  ) => Promise<{ content_uri?: string; contentUri?: string }>;
  waitUntilRoomReadyForGroupCalls?: (roomId: string) => Promise<void>;
};

type MockMatrixGroupCall = {
  groupCallId: string;
  participants: Map<{ displayName?: string; userId: string }, Map<string, unknown>>;
  room: ReturnType<typeof createRoom>;
  state: string;
  userMediaFeeds: Array<{ stream?: MediaStream; userId?: string }>;
  enter: () => Promise<void>;
  leave: () => void;
  off: MatrixEventSubscription;
  on: MatrixEventSubscription;
  setMicrophoneMuted: (muted: boolean) => Promise<boolean>;
  terminate: (emitStateEvent?: boolean) => Promise<void>;
};

type MockMatrixCall = {
  callId: string;
  direction: "inbound" | "outbound";
  roomId: string;
  state: string;
  answer: (audio?: boolean, video?: boolean) => Promise<void>;
  emitEvent: (event: string, ...args: unknown[]) => void;
  hangup: (reason: string, suppressEvent: boolean) => void;
  isMicrophoneMuted: () => boolean;
  off: MatrixEventSubscription;
  on: MatrixEventSubscription;
  placeVoiceCall: () => Promise<void>;
  reject: () => void;
  setMicrophoneMuted: (muted: boolean) => Promise<boolean>;
};

type MockMatrixCrypto = {
  bootstrapCrossSigning?: (options: {
    authUploadDeviceSigningKeys?: (
      makeRequest: (authData: Record<string, unknown> | null) => Promise<unknown>
    ) => Promise<unknown>;
    setupNewCrossSigning?: boolean;
  }) => Promise<void>;
  bootstrapSecretStorage?: (options: {
    createSecretStorageKey?: () => Promise<unknown>;
    setupNewKeyBackup?: boolean;
    setupNewSecretStorage?: boolean;
  }) => Promise<void>;
  checkKeyBackupAndEnable?: () => Promise<unknown>;
  createRecoveryKeyFromPassphrase?: () => Promise<unknown>;
  forceDiscardSession?: (roomId: string) => Promise<void>;
  getActiveSessionBackupVersion?: () => Promise<string | null>;
  getKeyBackupInfo?: () => Promise<unknown | null>;
  isCrossSigningReady?: () => Promise<boolean>;
  isSecretStorageReady?: () => Promise<boolean>;
  loadSessionBackupPrivateKeyFromSecretStorage?: () => Promise<void>;
  resetEncryption?: (
    authUploadDeviceSigningKeys: (
      makeRequest: (authData: Record<string, unknown> | null) => Promise<unknown>
    ) => Promise<unknown>
  ) => Promise<void>;
  restoreKeyBackup?: (options?: Record<string, unknown>) => Promise<unknown>;
};

type MatrixSendStateEvent = (
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
  stateKey?: string
) => Promise<unknown>;
type MatrixSendEvent = (
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
  txnId?: string
) => Promise<unknown>;
type MatrixSendMessage = (roomId: string, content: Record<string, unknown>) => Promise<unknown>;
type MatrixRedactEvent = (
  roomId: string,
  eventId: string,
  txnId?: string,
  opts?: Record<string, unknown>
) => Promise<unknown>;
type MatrixLeaveRoom = (roomId: string) => Promise<unknown>;
type MatrixScrollback = (room: unknown, limit?: number) => Promise<unknown>;
type MatrixEventSubscription = (event: string, listener: (...args: unknown[]) => void) => void;
type MatrixSendReadReceipt = (event: unknown, receiptType?: string) => Promise<unknown>;
type MatrixSetRoomReadMarkers = (
  roomId: string,
  readMarkerEventId: string,
  readReceiptEvent?: unknown
) => Promise<unknown>;
type MatrixMxcUrlToHttp = (
  mxcUrl: string,
  width?: number,
  height?: number,
  resizeMethod?: string,
  allowDirectLinks?: boolean,
  allowRedirects?: boolean,
  useAuthentication?: boolean
) => string | null;

const matrixSdkMock = vi.hoisted(() => ({
  createClient: vi.fn(),
  createNewMatrixCall: vi.fn(),
  IndexedDBStore: vi.fn()
}));

vi.mock("matrix-js-sdk/lib/browser-index.js", () => ({
  createClient: matrixSdkMock.createClient,
  createNewMatrixCall: matrixSdkMock.createNewMatrixCall,
  IndexedDBStore: matrixSdkMock.IndexedDBStore,
  Room: {
    prototype: {}
  }
}));

afterEach(() => {
  matrixSdkMock.createClient.mockReset();
  matrixSdkMock.createNewMatrixCall.mockReset();
  matrixSdkMock.IndexedDBStore.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Matrix client diagnostics", () => {
  it("restores and saves the persistent Matrix sync store when IndexedDB is available", async () => {
    const store = {
      destroy: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      startup: vi.fn().mockResolvedValue(undefined)
    };
    matrixSdkMock.IndexedDBStore.mockImplementation(function IndexedDbStoreMock() {
      return store;
    });
    vi.stubGlobal("window", {
      indexedDB: {},
      localStorage: {}
    });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({ getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }), rooms: [] })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(matrixSdkMock.IndexedDBStore).toHaveBeenCalledWith(
      expect.objectContaining({ dbName: expect.stringContaining("cop-web-matrix-") })
    );
    expect(matrixSdkMock.createClient).toHaveBeenCalledWith(expect.objectContaining({ store }));
    expect(store.startup).toHaveBeenCalledTimes(1);

    session.stop();
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(store.destroy).toHaveBeenCalledTimes(1));
  });

  it("renews compatible Matrix bootstrap credentials without replacing crypto state", async () => {
    const setAccessToken = vi.fn();
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }),
        rooms: [],
        setAccessToken
      })
    );
    const session = await createMatrixMessagingSession(createBootstrap());
    const renewedBootstrap = {
      ...createBootstrap(),
      accessToken: "renewed-matrix-token",
      expiresAt: "2026-07-10T12:30:00.000Z"
    };

    expect(session.refreshBootstrap(renewedBootstrap)).toBe(true);
    expect(setAccessToken).toHaveBeenCalledWith("renewed-matrix-token");
    expect(session.bootstrap).toEqual(renewedBootstrap);

    expect(session.refreshBootstrap({ ...renewedBootstrap, deviceId: "OTHERDEVICE" })).toBe(false);
    expect(setAccessToken).toHaveBeenCalledTimes(1);
  });

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
    expect(
      normalizeMatrixMessageBody(
        "** Unable to decrypt: DecryptionError: This message was sent before this device logged in, and there is no key backup on the server. **"
      )
    ).toBe("Zprávu zatím nelze zobrazit. V tomto prohlížeči chybí šifrovací klíč pro starší zprávy.");
  });

  it("syncs authenticated COP display name to the Matrix user profile", async () => {
    const setDisplayName = vi.fn<NonNullable<MockMatrixClient["setDisplayName"]>>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getProfileInfo: vi.fn().mockResolvedValue({}),
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        setDisplayName
      })
    );

    await createMatrixMessagingSession(createBootstrap(), {
      profile: { displayName: "Jiří Volek" }
    });

    await vi.waitFor(() => expect(setDisplayName).toHaveBeenCalledWith("Jiří Volek"));
  });

  it("uploads authenticated COP avatar and syncs it to the Matrix user profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["avatar"], { type: "image/png" }), { status: 200 }))
    );
    const setAvatarUrl = vi.fn<NonNullable<MockMatrixClient["setAvatarUrl"]>>().mockResolvedValue(undefined);
    const uploadContent = vi
      .fn<NonNullable<MockMatrixClient["uploadContent"]>>()
      .mockResolvedValue({ content_uri: "mxc://cop.local/avatar" });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getProfileInfo: vi.fn().mockResolvedValue({}),
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        setAvatarUrl,
        uploadContent
      })
    );

    await createMatrixMessagingSession(createBootstrap(), {
      profile: { avatarUrl: "data:image/png;base64,YXZhdGFy" }
    });

    await vi.waitFor(() =>
      expect(uploadContent).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.objectContaining({
          includeFilename: false,
          name: "avatar",
          type: "image/png"
        })
      )
    );
    expect(setAvatarUrl).toHaveBeenCalledWith("mxc://cop.local/avatar");
  });

  it("registers a Matrix web pusher for COP browser notifications", async () => {
    const setPusher = vi.fn<NonNullable<MockMatrixClient["setPusher"]>>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        setPusher
      })
    );

    await createMatrixMessagingSession(createBootstrap(), {
      webPush: { deviceId: "web_device-1", lang: "cs-CZ" }
    });

    await vi.waitFor(() =>
      expect(setPusher).toHaveBeenCalledWith(
        expect.objectContaining({
          app_display_name: "COP Chat",
          app_id: "cz.zeleznalady.cop.web",
          data: { url: "https://msg.zeleznalady.cz/_matrix/push/v1/notify" },
          device_display_name: "COP web",
          kind: "http",
          lang: "cs-CZ",
          pushkey: "web_device-1"
        })
      )
    );
  });

  it("removes a stored Matrix web pusher when COP browser notifications are not registered", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    });
    const registerPusher = vi.fn<NonNullable<MockMatrixClient["setPusher"]>>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValueOnce(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        setPusher: registerPusher
      })
    );

    await createMatrixMessagingSession(createBootstrap(), {
      webPush: { deviceId: "web_device-1", lang: "cs-CZ", registered: true }
    });
    await vi.waitFor(() =>
      expect(registerPusher).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "http",
          pushkey: "web_device-1"
        })
      )
    );

    const removePusher = vi.fn<NonNullable<MockMatrixClient["setPusher"]>>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValueOnce(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        setPusher: removePusher
      })
    );

    await createMatrixMessagingSession(createBootstrap(), {
      webPush: { lang: "cs-CZ", registered: false }
    });

    await vi.waitFor(() =>
      expect(removePusher).toHaveBeenCalledWith({
        app_id: "cz.zeleznalady.cop.web",
        kind: null,
        pushkey: "web_device-1"
      })
    );
    expect(storage.get("cop.matrix.webPushPusher.v1")).toBeUndefined();
  });

  it("starts an outgoing Matrix voice call and publishes call state", async () => {
    stubVoiceCallBrowserSupport();
    const call = createMockVoiceCall({ direction: "outbound", roomId: "!chat:cop.local" });
    const onVoiceCallWake = vi.fn().mockResolvedValue(undefined);
    const onVoiceCallChanged = vi.fn();
    matrixSdkMock.createNewMatrixCall.mockReturnValue(call);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onVoiceCallChanged, onVoiceCallWake });
    await session.startVoiceCall("!chat:cop.local");

    expect(matrixSdkMock.createNewMatrixCall).toHaveBeenCalledWith(expect.any(Object), "!chat:cop.local");
    expect(call.placeVoiceCall).toHaveBeenCalled();
    expect(session.getVoiceCall()).toMatchObject({
      callId: "call-1",
      direction: "outgoing",
      phase: "connecting",
      roomId: "!chat:cop.local"
    });
    expect(onVoiceCallChanged).toHaveBeenCalledWith(
      expect.objectContaining({ callId: "call-1", direction: "outgoing" })
    );
    await vi.waitFor(() =>
      expect(onVoiceCallWake).toHaveBeenCalledWith({
        action: "invite",
        callId: "call-1",
        roomId: "!chat:cop.local"
      })
    );
  });

  it("starts an encrypted Matrix group voice call and rings room members", async () => {
    stubVoiceCallBrowserSupport();
    const room = createRoom({
      members: [
        { displayName: "Operátor", userId: "@operator:cop.local" },
        { displayName: "Alice", userId: "@alice:cop.local" },
        { displayName: "Bob", userId: "@bob:cop.local" }
      ],
      roomId: "!group:cop.local"
    });
    const groupCall = createMockGroupVoiceCall(room);
    const createGroupCall = vi.fn().mockResolvedValue(groupCall);
    const waitUntilRoomReadyForGroupCalls = vi.fn().mockResolvedValue(undefined);
    const onVoiceCallWake = vi.fn().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        createGroupCall,
        getGroupCallForRoom: vi.fn(() => null),
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!group:cop.local"] }),
        rooms: [room],
        waitUntilRoomReadyForGroupCalls
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onVoiceCallWake });
    await session.startVoiceCall("!group:cop.local", { group: true });

    expect(waitUntilRoomReadyForGroupCalls).toHaveBeenCalledWith("!group:cop.local");
    expect(createGroupCall).toHaveBeenCalledWith("!group:cop.local", "m.voice", false, "m.ring");
    expect(groupCall.enter).toHaveBeenCalledTimes(1);
    expect(session.getVoiceCall()).toMatchObject({
      callId: "group-call-1",
      kind: "group",
      phase: "connected",
      roomId: "!group:cop.local"
    });
    expect(session.getVoiceCall()?.eligibleParticipants?.map((participant) => participant.userId)).toEqual([
      "@alice:cop.local",
      "@bob:cop.local"
    ]);
    expect(onVoiceCallWake).toHaveBeenCalledWith({
      action: "invite",
      callId: "group-call-1",
      roomId: "!group:cop.local"
    });
  });

  it("rings only selected eligible members when extending a group call", async () => {
    stubVoiceCallBrowserSupport();
    const operator = { displayName: "Operátor", userId: "@operator:cop.local" };
    const alice = { displayName: "Alice", userId: "@alice:cop.local" };
    const bob = { displayName: "Bob", userId: "@bob:cop.local" };
    const room = createRoom({ members: [operator, alice, bob], roomId: "!group:cop.local" });
    const groupCall = createMockGroupVoiceCall(
      room,
      new Map([
        [operator, new Map([["DEVICE", {}]])],
        [alice, new Map([["DEVICE", {}]])]
      ])
    );
    const onVoiceCallWake = vi.fn().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        createGroupCall: vi.fn().mockResolvedValue(groupCall),
        getGroupCallForRoom: vi.fn(() => groupCall),
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!group:cop.local"] }),
        rooms: [room],
        waitUntilRoomReadyForGroupCalls: vi.fn().mockResolvedValue(undefined)
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onVoiceCallWake });
    await session.startVoiceCall("!group:cop.local", { group: true });
    await session.inviteVoiceCallParticipants("group-call-1", ["@alice:cop.local", "@bob:cop.local"]);

    expect(onVoiceCallWake).toHaveBeenLastCalledWith({
      action: "invite",
      callId: "group-call-1",
      participantUserIds: ["@bob:cop.local"],
      roomId: "!group:cop.local"
    });
    expect(onVoiceCallWake).toHaveBeenCalledTimes(2);
  });

  it("appends configured ICE server URLs without duplicating homeserver URLs", async () => {
    const existingServers: RTCIceServer[] = [
      {
        credential: "turn-password",
        urls: ["turn:relay.cop.local:3478?transport=udp", "stun:existing.cop.local:3478"],
        username: "turn-user"
      }
    ];
    const client = createMockMatrixClient({
      getTurnServers: vi.fn(() => existingServers),
      rooms: []
    });
    matrixSdkMock.createClient.mockReturnValue(client);

    await createMatrixMessagingSession(createBootstrap(), {
      voip: {
        additionalIceServerUrls: [
          " stun:existing.cop.local:3478 ",
          "stun:backup.cop.local:3478",
          "STUN:BACKUP.COP.LOCAL:3478",
          "turns:relay-backup.cop.local:443?transport=tcp",
          "https://not-an-ice-server.example"
        ]
      }
    });

    expect(client.getTurnServers?.()).toEqual([
      existingServers[0],
      {
        urls: ["stun:backup.cop.local:3478", "turns:relay-backup.cop.local:443?transport=tcp"]
      }
    ]);
  });

  it("delivers an ended wake only after the matching invite wake completes", async () => {
    stubVoiceCallBrowserSupport();
    const call = createMockVoiceCall({ direction: "outbound", roomId: "!chat:cop.local" });
    let resolveInvite: (() => void) | undefined;
    const pendingInvite = new Promise<void>((resolve) => {
      resolveInvite = resolve;
    });
    const wakeActions: MatrixVoiceCallWakeRequest["action"][] = [];
    const onVoiceCallWake = vi.fn(async ({ action }: MatrixVoiceCallWakeRequest) => {
      wakeActions.push(action);
      if (action === "invite") {
        await pendingInvite;
      }
    });
    matrixSdkMock.createNewMatrixCall.mockReturnValue(call);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onVoiceCallWake });
    await session.startVoiceCall("!chat:cop.local");
    await vi.waitFor(() => expect(wakeActions).toEqual(["invite"]));

    await session.hangupVoiceCall("call-1");
    expect(wakeActions).toEqual(["invite"]);

    resolveInvite?.();
    await vi.waitFor(() => expect(wakeActions).toEqual(["invite", "ended"]));
  });

  it("keeps Matrix voice call signalling on the SDK encryption path", async () => {
    stubVoiceCallBrowserSupport();
    const rawSend = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "$call-invite" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    matrixSdkMock.createNewMatrixCall.mockImplementation((client: { sendEvent: MatrixSendEvent }, roomId: string) => {
      const call = createMockVoiceCall({ direction: "outbound", roomId });
      call.placeVoiceCall = vi.fn(async () => {
        await client.sendEvent(roomId, "m.call.invite", {
          call_id: "call-1",
          lifetime: 60_000,
          version: "1"
        });
        call.state = "invite_sent";
      });
      return call;
    });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        sendEvent: rawSend
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    await session.startVoiceCall("!chat:cop.local");

    expect(rawSend).toHaveBeenCalledWith("!chat:cop.local", "m.call.invite", {
      call_id: "call-1",
      lifetime: 60_000,
      version: "1"
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/rooms/") && String(url).includes("m.call.invite"))
    ).toBe(false);
  });

  it("keeps call signalling encrypted when the peer acknowledges the E2EE preflight", async () => {
    stubVoiceCallBrowserSupport();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const on = vi.fn<MatrixEventSubscription>((event, listener) => listeners.set(event, listener));
    const forceDiscardSession = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "$unexpected" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const rawSend = vi.fn<MatrixSendEvent>(async (roomId, eventType, content) => {
      if (eventType === "cz.zeleznalady.cop.call.preflight") {
        listeners.get("Event.decrypted")?.(
          createCallControlEvent(
            "cz.zeleznalady.cop.call.preflight_ack",
            { probe_id: content.probe_id },
            "$preflight-ack",
            "@peer:cop.local",
            roomId,
            "m.room.encrypted"
          )
        );
      }
    });
    matrixSdkMock.createNewMatrixCall.mockImplementation((client: { sendEvent: MatrixSendEvent }, roomId: string) => {
      const call = createMockVoiceCall({ direction: "outbound", roomId });
      call.placeVoiceCall = vi.fn(async () => {
        await client.sendEvent(roomId, "m.call.invite", {
          call_id: "call-1",
          lifetime: 60_000,
          version: "1"
        });
        call.state = "invite_sent";
      });
      return call;
    });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        crypto: { forceDiscardSession },
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        on,
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        sendEvent: rawSend
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    await session.startVoiceCall("!chat:cop.local");

    expect(forceDiscardSession).toHaveBeenCalledWith("!chat:cop.local");
    expect(rawSend).toHaveBeenCalledWith(
      "!chat:cop.local",
      "cz.zeleznalady.cop.call.preflight",
      expect.objectContaining({ probe_id: expect.any(String), sender_device_id: "TESTDEVICE" })
    );
    expect(rawSend).toHaveBeenCalledWith("!chat:cop.local", "m.call.invite", {
      call_id: "call-1",
      lifetime: 60_000,
      version: "1"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to authenticated TLS call signalling when the peer cannot acknowledge E2EE", async () => {
    vi.useFakeTimers();
    stubVoiceCallBrowserSupport();
    const forceDiscardSession = vi.fn().mockResolvedValue(undefined);
    const rawSend = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "$call-invite" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    matrixSdkMock.createNewMatrixCall.mockImplementation((client: { sendEvent: MatrixSendEvent }, roomId: string) => {
      const call = createMockVoiceCall({ direction: "outbound", roomId });
      call.placeVoiceCall = vi.fn(async () => {
        await client.sendEvent(roomId, "m.call.invite", {
          call_id: "call-1",
          lifetime: 60_000,
          version: "1"
        });
        call.state = "invite_sent";
      });
      return call;
    });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        crypto: { forceDiscardSession },
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        sendEvent: rawSend
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    const startCall = session.startVoiceCall("!chat:cop.local");
    await vi.advanceTimersByTimeAsync(1_200);
    await startCall;

    expect(rawSend).toHaveBeenCalledWith(
      "!chat:cop.local",
      "cz.zeleznalady.cop.call.preflight",
      expect.objectContaining({ probe_id: expect.any(String) })
    );
    expect(rawSend).not.toHaveBeenCalledWith("!chat:cop.local", "m.call.invite", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/rooms/!chat%3Acop.local/send/m.call.invite/"),
      expect.objectContaining({
        body: JSON.stringify({ call_id: "call-1", lifetime: 60_000, version: "1" }),
        method: "PUT"
      })
    );
  });

  it("falls back when discarding the outbound encryption session never settles", async () => {
    vi.useFakeTimers();
    stubVoiceCallBrowserSupport();
    const neverSettles = new Promise<void>(() => undefined);
    const forceDiscardSession = vi.fn(() => neverSettles);
    const rawSend = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "$call-invite" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    matrixSdkMock.createNewMatrixCall.mockImplementation((client: { sendEvent: MatrixSendEvent }, roomId: string) => {
      const call = createMockVoiceCall({ direction: "outbound", roomId });
      call.placeVoiceCall = vi.fn(async () => {
        await client.sendEvent(roomId, "m.call.invite", {
          call_id: "call-1",
          lifetime: 60_000,
          version: "1"
        });
        call.state = "invite_sent";
      });
      return call;
    });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        crypto: { forceDiscardSession },
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        sendEvent: rawSend
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    const startCall = session.startVoiceCall("!chat:cop.local");
    await vi.advanceTimersByTimeAsync(1_200);
    await startCall;

    expect(forceDiscardSession).toHaveBeenCalledWith("!chat:cop.local");
    expect(rawSend).not.toHaveBeenCalledWith(
      "!chat:cop.local",
      "cz.zeleznalady.cop.call.preflight",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/rooms/!chat%3Acop.local/send/m.call.invite/"),
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("falls back when sending the encrypted preflight never settles", async () => {
    vi.useFakeTimers();
    stubVoiceCallBrowserSupport();
    const forceDiscardSession = vi.fn().mockResolvedValue(undefined);
    const rawSend = vi.fn<MatrixSendEvent>((_roomId, eventType) =>
      eventType === "cz.zeleznalady.cop.call.preflight"
        ? new Promise<unknown>(() => undefined)
        : Promise.resolve(undefined)
    );
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "$call-invite" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    matrixSdkMock.createNewMatrixCall.mockImplementation((client: { sendEvent: MatrixSendEvent }, roomId: string) => {
      const call = createMockVoiceCall({ direction: "outbound", roomId });
      call.placeVoiceCall = vi.fn(async () => {
        await client.sendEvent(roomId, "m.call.invite", {
          call_id: "call-1",
          lifetime: 60_000,
          version: "1"
        });
        call.state = "invite_sent";
      });
      return call;
    });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        crypto: { forceDiscardSession },
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        sendEvent: rawSend
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    const startCall = session.startVoiceCall("!chat:cop.local");
    await vi.advanceTimersByTimeAsync(1_200);
    await startCall;

    expect(rawSend).toHaveBeenCalledWith(
      "!chat:cop.local",
      "cz.zeleznalady.cop.call.preflight",
      expect.objectContaining({ probe_id: expect.any(String) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/rooms/!chat%3Acop.local/send/m.call.invite/"),
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("answers an incoming TLS-fallback call through the same signalling path", async () => {
    stubVoiceCallBrowserSupport();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const on = vi.fn<MatrixEventSubscription>((event, listener) => listeners.set(event, listener));
    const rawSend = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "$call-answer" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createMockMatrixClient({
      getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
      on,
      rooms: [createRoom({ roomId: "!chat:cop.local" })],
      sendEvent: rawSend
    });
    const call = createMockVoiceCall({ direction: "inbound", roomId: "!chat:cop.local", state: "ringing" });
    call.answer = vi.fn(async () => {
      call.state = "connecting";
      call.emitEvent("state", "connecting", "ringing", call);
      queueMicrotask(() => {
        void client.sendEvent?.("!chat:cop.local", "m.call.answer", { call_id: "call-1", version: "1" }).then(() => {
          call.state = "connected";
          call.emitEvent("state", "connected", "connecting", call);
        });
      });
    });
    matrixSdkMock.createClient.mockReturnValue(client);

    const session = await createMatrixMessagingSession(createBootstrap());
    listeners.get("received_voip_event")?.(
      createCallEvent("m.call.invite", Date.now(), "$plain-call-invite", "@peer:cop.local")
    );
    listeners.get("Call.incoming")?.(call);
    await session.answerVoiceCall("call-1");

    expect(rawSend).not.toHaveBeenCalledWith("!chat:cop.local", "m.call.answer", expect.any(Object));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/rooms/!chat%3Acop.local/send/m.call.answer/"),
        expect.objectContaining({ body: JSON.stringify({ call_id: "call-1", version: "1" }), method: "PUT" })
      )
    );
  });

  it("falls back before a delayed incoming answer when that device preflight hangs", async () => {
    vi.useFakeTimers();
    stubVoiceCallBrowserSupport();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const on = vi.fn<MatrixEventSubscription>((event, listener) => listeners.set(event, listener));
    const forceDiscardSession = vi.fn().mockResolvedValue(undefined);
    const rawSend = vi.fn<MatrixSendEvent>((_roomId, eventType) =>
      eventType === "cz.zeleznalady.cop.call.preflight"
        ? new Promise<unknown>(() => undefined)
        : Promise.resolve(undefined)
    );
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "$call-answer" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createMockMatrixClient({
      crypto: { forceDiscardSession },
      getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
      on,
      rooms: [createRoom({ roomId: "!chat:cop.local" })],
      sendEvent: rawSend
    });
    const call = createMockVoiceCall({ direction: "inbound", roomId: "!chat:cop.local", state: "ringing" });
    call.answer = vi.fn(async () => {
      call.state = "connecting";
      call.emitEvent("state", "connecting", "ringing", call);
      queueMicrotask(() => {
        void client.sendEvent?.("!chat:cop.local", "m.call.answer", { call_id: "call-1", version: "1" });
      });
    });
    matrixSdkMock.createClient.mockReturnValue(client);

    const session = await createMatrixMessagingSession(createBootstrap());
    listeners.get("Call.incoming")?.(call);
    const answerCall = session.answerVoiceCall("call-1");
    await vi.advanceTimersByTimeAsync(1_200);
    await answerCall;
    await vi.runAllTicks();

    expect(forceDiscardSession).toHaveBeenCalledWith("!chat:cop.local");
    expect(rawSend).toHaveBeenCalledWith(
      "!chat:cop.local",
      "cz.zeleznalady.cop.call.preflight",
      expect.objectContaining({ probe_id: expect.any(String) })
    );
    expect(rawSend).not.toHaveBeenCalledWith("!chat:cop.local", "m.call.answer", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/rooms/!chat%3Acop.local/send/m.call.answer/"),
      expect.objectContaining({ body: JSON.stringify({ call_id: "call-1", version: "1" }), method: "PUT" })
    );
  });

  it("answers an incoming Matrix voice call", async () => {
    stubVoiceCallBrowserSupport();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const on = vi.fn<MatrixEventSubscription>((event, listener) => listeners.set(event, listener));
    const call = createMockVoiceCall({ direction: "inbound", roomId: "!chat:cop.local", state: "ringing" });
    const onVoiceCallChanged = vi.fn();
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        on,
        rooms: [createRoom({ roomId: "!chat:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onVoiceCallChanged });
    listeners.get("Call.incoming")?.(call);
    await session.answerVoiceCall("call-1");

    expect(call.answer).toHaveBeenCalledWith(true, false);
    expect(session.getVoiceCall()).toMatchObject({
      callId: "call-1",
      direction: "incoming",
      phase: "connected",
      roomId: "!chat:cop.local"
    });
    expect(onVoiceCallChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ callId: "call-1", phase: "connected" })
    );
  });

  it("ends a call that remains connecting for 45 seconds with the TURN error", async () => {
    vi.useFakeTimers();
    stubVoiceCallBrowserSupport();
    const call = createMockVoiceCall({ direction: "outbound", roomId: "!chat:cop.local" });
    matrixSdkMock.createNewMatrixCall.mockReturnValue(call);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    await session.startVoiceCall("!chat:cop.local");
    await vi.advanceTimersByTimeAsync(45_000);

    expect(call.hangup).toHaveBeenCalledWith("ice_failed", false);
    expect(session.getVoiceCall()).toMatchObject({
      callId: "call-1",
      error: "Hovor se nepodařilo spojit. Pravděpodobně chybí dostupný TURN server.",
      phase: "failed"
    });
  });

  it("clears the connecting watchdog when the call connects", async () => {
    vi.useFakeTimers();
    stubVoiceCallBrowserSupport();
    const call = createMockVoiceCall({ direction: "outbound", roomId: "!chat:cop.local" });
    matrixSdkMock.createNewMatrixCall.mockReturnValue(call);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!chat:cop.local"] }),
        rooms: [createRoom({ roomId: "!chat:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    await session.startVoiceCall("!chat:cop.local");
    call.state = "connected";
    call.emitEvent("state", "connected", "invite_sent", call);
    await vi.advanceTimersByTimeAsync(45_000);

    expect(call.hangup).not.toHaveBeenCalled();
    expect(session.getVoiceCall()).toMatchObject({ callId: "call-1", phase: "connected" });
  });

  it("refreshes direct chat avatars from Matrix profile info when room member state has no avatar", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const onRoomsChanged = vi.fn();
    const getProfileInfo = vi.fn<NonNullable<MockMatrixClient["getProfileInfo"]>>(async (userId) =>
      userId === "@peer:cop.local" ? { avatar_url: "mxc://cop.local/peer-avatar", displayname: "Peer User" } : {}
    );
    const mxcUrlToHttp = vi.fn<MatrixMxcUrlToHttp>(
      (mxcUrl) => `https://msg.zeleznalady.cz/media/${encodeURIComponent(mxcUrl)}`
    );
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getProfileInfo,
        mxcUrlToHttp,
        rooms: [
          createRoom({
            members: [
              { displayName: "COP Operator", userId: "@operator:cop.local" },
              { displayName: "Peer User", userId: "@peer:cop.local" }
            ],
            roomId: "!direct:cop.local"
          })
        ]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onRoomsChanged });

    expect(session.getRooms()[0]?.avatarUrl).toBeUndefined();

    await vi.runOnlyPendingTimersAsync();

    const latestRooms = onRoomsChanged.mock.calls.at(-1)?.[0];
    expect(getProfileInfo).toHaveBeenCalledWith("@peer:cop.local");
    expect(latestRooms?.[0]?.avatarUrl).toBe("https://msg.zeleznalady.cz/media/mxc%3A%2F%2Fcop.local%2Fpeer-avatar");
    expect(latestRooms?.[0]?.directPeer?.avatarUrl).toBe(
      "https://msg.zeleznalady.cz/media/mxc%3A%2F%2Fcop.local%2Fpeer-avatar"
    );
  });

  it("prefers the current Matrix profile name over an opaque UUID stored in room membership", async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const peerUserId = "@c6abf160-f5af-48fb-a79d-07511380e06a:cop.local";
    const onRoomsChanged = vi.fn();
    const getProfileInfo = vi.fn<NonNullable<MockMatrixClient["getProfileInfo"]>>(async (userId) =>
      userId === peerUserId ? { displayname: "Daniel Bambušek" } : {}
    );
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getProfileInfo,
        getUser: (userId) =>
          userId === peerUserId ? { displayName: "c6abf160-f5af-48fb-a79d-07511380e06a", userId } : undefined,
        on: (event, listener) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        },
        rooms: [
          createRoom({
            members: [
              { displayName: "COP Operator", userId: "@operator:cop.local" },
              { displayName: "c6abf160-f5af-48fb-a79d-07511380e06a", userId: peerUserId }
            ],
            roomId: "!direct-uuid:cop.local"
          })
        ]
      })
    );

    await createMatrixMessagingSession(createBootstrap(), { onRoomsChanged });
    await vi.runOnlyPendingTimersAsync();

    const latestRooms = onRoomsChanged.mock.calls.at(-1)?.[0];
    expect(getProfileInfo).toHaveBeenCalledWith(peerUserId);
    expect(latestRooms?.[0]?.directPeer?.displayName).toBe("Daniel Bambušek");

    for (const listener of listeners.get("User.presence") ?? []) {
      listener();
    }
    await vi.advanceTimersByTimeAsync(750);

    expect(onRoomsChanged.mock.calls.at(-1)?.[0]?.[0]?.directPeer?.displayName).toBe("Daniel Bambušek");
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
    const getProfileInfo = vi.fn<NonNullable<MockMatrixClient["getProfileInfo"]>>(async (userId) =>
      userId === "@peer:cop.local" ? { displayname: "Peer User" } : {}
    );
    const mxcUrlToHttp = vi.fn<MatrixMxcUrlToHttp>(
      (mxcUrl) => `https://msg.zeleznalady.cz/media/${encodeURIComponent(mxcUrl)}`
    );
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getProfileInfo,
        mxcUrlToHttp,
        rooms: [
          createRoom({
            members: [
              { displayName: "COP Operator", userId: "@operator:cop.local" },
              { displayName: "Peer User", userId: "@peer:cop.local" }
            ],
            roomId: "!direct:cop.local"
          })
        ]
      })
    );

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
    expect(latestRooms?.[0]?.avatarUrl).toBe(
      "https://msg.zeleznalady.cz/media/mxc%3A%2F%2Fcop.local%2Fhttp-peer-avatar"
    );
    expect(latestRooms?.[0]?.directPeer?.avatarUrl).toBe(
      "https://msg.zeleznalady.cz/media/mxc%3A%2F%2Fcop.local%2Fhttp-peer-avatar"
    );
  });

  it("stores disappearing-message settings as Matrix room retention state", async () => {
    const sendStateEvent = vi.fn<MatrixSendStateEvent>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        sendStateEvent
      })
    );

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
    expect(sendStateEvent).toHaveBeenNthCalledWith(2, "!chat:cop.local", "m.room.retention", {}, "");
  });

  it("turns Matrix retention permission failures into a user-facing error", async () => {
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        sendStateEvent: vi.fn<MatrixSendStateEvent>().mockRejectedValue(new Error("M_FORBIDDEN: power level too low"))
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.setMessageRetentionPolicy("!chat:cop.local", 86_400)).rejects.toThrow(
      "Automatické mazání zpráv může v této místnosti změnit jen správce chatu."
    );
  });

  it("reads retention state and hides messages older than the configured interval", async () => {
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [
          createRoom({
            retentionSeconds: 86_400,
            roomId: "!chat:cop.local",
            timeline: [
              createMessageEvent("old", Date.parse("2026-06-22T12:00:00.000Z")),
              createMessageEvent("recent", Date.parse("2026-06-24T11:00:00.000Z"))
            ]
          })
        ]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getRooms()[0]?.messageRetentionSeconds).toBe(86_400);
    expect(session.getTimeline("!chat:cop.local").map((message) => message.body)).toEqual(["recent"]);
  });

  it("keeps undecrypted encrypted events pending until Matrix can decrypt them", async () => {
    const readable = createMessageEvent(
      "readable",
      Date.parse("2026-07-07T13:13:00.000Z"),
      "$readable",
      "@peer:cop.local"
    );
    const undecrypted = createEncryptedEvent(Date.parse("2026-07-07T13:15:00.000Z"), "$undecrypted", "@peer:cop.local");
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local", timeline: [readable, undecrypted] })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getTimeline("!chat:cop.local").map((message) => [message.eventId, message.body])).toEqual([
      ["$readable", "readable"]
    ]);
    expect(session.getRooms()[0]?.latestMessage).toMatchObject({
      body: "readable",
      eventId: "$readable"
    });
  });

  it("does not expose a synthetic Matrix decryption diagnostic as a sender message", async () => {
    const diagnostic = createMessageEvent(
      "** Unable to decrypt: DecryptionError: The sender's device has not sent us the keys for this message. **",
      Date.parse("2026-07-10T13:51:00.000Z"),
      "$diagnostic",
      "@peer:cop.local"
    );
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local", timeline: [diagnostic] })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getTimeline("!chat:cop.local")).toEqual([]);
    expect(session.getRooms()[0]?.latestMessage).toBeUndefined();
  });

  it("keeps all undecrypted E2EE events out of messages and previews", async () => {
    const preflightAt = Date.parse("2026-07-10T13:09:15.000Z");
    const unrelated = createEncryptedEvent(preflightAt - 6_000, "$unrelated", "@peer:cop.local");
    const callPreflight = createEncryptedEvent(preflightAt, "$call-preflight", "@peer:cop.local");
    const otherSender = createEncryptedEvent(preflightAt + 1_000, "$other-sender", "@other:cop.local");
    const callInvite = createCallEvent("m.call.invite", preflightAt + 4_000, "$call-invite", "@peer:cop.local");
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [
          createRoom({
            roomId: "!chat:cop.local",
            timeline: [unrelated, callPreflight, otherSender, callInvite]
          })
        ]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getTimeline("!chat:cop.local")).toEqual([]);
    expect(session.getRooms()[0]?.latestMessage).toBeUndefined();
  });

  it("maps decrypted encrypted events from Matrix clear content", async () => {
    const decrypted = createEncryptedEvent(Date.parse("2026-07-07T13:18:00.000Z"), "$decrypted", "@peer:cop.local", {
      body: "obnovená zpráva",
      msgtype: "m.text"
    });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local", timeline: [decrypted] })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getTimeline("!chat:cop.local").map((message) => [message.eventId, message.body])).toEqual([
      ["$decrypted", "obnovená zpráva"]
    ]);
    expect(session.getRooms()[0]?.latestMessage).toMatchObject({
      body: "obnovená zpráva",
      eventId: "$decrypted"
    });
  });

  it("keeps Matrix voice call signalling out of timeline and chat previews", async () => {
    const readable = createMessageEvent(
      "readable",
      Date.parse("2026-07-07T13:13:00.000Z"),
      "$readable",
      "@peer:cop.local"
    );
    const callInvite = createCallEvent(
      "m.call.invite",
      Date.parse("2026-07-07T13:14:00.000Z"),
      "$call-invite",
      "@peer:cop.local"
    );
    const encryptedCallAnswer = createEncryptedEvent(
      Date.parse("2026-07-07T13:15:00.000Z"),
      "$encrypted-call-answer",
      "@peer:cop.local",
      { call_id: "call-1", version: "1" },
      "m.call.answer"
    );
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local", timeline: [readable, callInvite, encryptedCallAnswer] })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getTimeline("!chat:cop.local").map((message) => [message.eventId, message.body])).toEqual([
      ["$readable", "readable"]
    ]);
    expect(session.getRooms()[0]?.latestMessage).toMatchObject({
      body: "readable",
      eventId: "$readable"
    });
  });

  it("optimistically clears room unread count after a read marker and restores it for a newer message", async () => {
    let unreadCount = 2;
    const older = createMessageEvent("older", Date.parse("2026-06-24T10:59:00.000Z"), "$older", "@peer:cop.local");
    const latest = createMessageEvent("latest", Date.parse("2026-06-24T11:00:00.000Z"), "$latest", "@peer:cop.local");
    const newer = createMessageEvent("newer", Date.parse("2026-06-24T11:01:00.000Z"), "$newer", "@peer:cop.local");
    const timeline = [older, latest];
    const sendReadReceipt = vi.fn<MatrixSendReadReceipt>().mockResolvedValue(undefined);
    const setRoomReadMarkers = vi.fn<MatrixSetRoomReadMarkers>().mockResolvedValue(undefined);
    const onRoomsChanged = vi.fn();
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local", timeline, unreadCount: () => unreadCount })],
        sendReadReceipt,
        setRoomReadMarkers
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onRoomsChanged });

    expect(session.getRooms()[0]?.unreadCount).toBe(2);
    await session.markRoomRead("!chat:cop.local");
    expect(sendReadReceipt).toHaveBeenCalledWith(latest);
    expect(setRoomReadMarkers).toHaveBeenCalledWith("!chat:cop.local", "$latest", latest);
    expect(session.getRooms()[0]?.unreadCount).toBe(0);
    expect(onRoomsChanged.mock.calls.at(-1)?.[0]?.[0]?.unreadCount).toBe(0);

    unreadCount = 1;
    timeline.push(newer);
    expect(session.getRooms()[0]?.unreadCount).toBe(1);
  });

  it("keeps an empty initial scrollback retryable while Matrix sync warms the timeline", async () => {
    const timeline: unknown[] = [];
    const scrollback = vi.fn<MatrixScrollback>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local", timeline })],
        scrollback
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    const first = await session.loadMoreTimeline("!chat:cop.local", 50);
    timeline.push(createMessageEvent("synced after first attempt", Date.parse("2026-06-24T11:00:00.000Z")));
    const second = await session.loadMoreTimeline("!chat:cop.local", 50);

    expect(first).toEqual({ exhausted: false, messages: [] });
    expect(scrollback).toHaveBeenCalledTimes(2);
    expect(second.messages.map((message) => message.body)).toEqual(["synced after first attempt"]);
  });

  it("does not mark partially synced room history exhausted while a pagination token remains", async () => {
    const timeline: unknown[] = [createMessageEvent("recent", Date.parse("2026-06-24T11:00:00.000Z"))];
    const room = createRoom({ paginationToken: "older-token", roomId: "!chat:cop.local", timeline });
    const scrollback = vi.fn<MatrixScrollback>().mockResolvedValue(room);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [room],
        scrollback
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    const first = await session.loadMoreTimeline("!chat:cop.local", 50);
    timeline.unshift(createMessageEvent("older", Date.parse("2026-06-24T10:59:00.000Z")));
    const second = await session.loadMoreTimeline("!chat:cop.local", 50);

    expect(first.exhausted).toBe(false);
    expect(scrollback).toHaveBeenCalledTimes(2);
    expect(second.messages.map((message) => message.body)).toEqual(["older", "recent"]);
  });

  it("marks room history exhausted only when Matrix reports no backward pagination token", async () => {
    const room = createRoom({
      paginationToken: null,
      roomId: "!chat:cop.local",
      timeline: [createMessageEvent("recent", Date.parse("2026-06-24T11:00:00.000Z"))]
    });
    const scrollback = vi.fn<MatrixScrollback>().mockResolvedValue(room);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [room],
        scrollback
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    const first = await session.loadMoreTimeline("!chat:cop.local", 50);
    const second = await session.loadMoreTimeline("!chat:cop.local", 50);

    expect(first.exhausted).toBe(true);
    expect(second.exhausted).toBe(true);
    expect(scrollback).toHaveBeenCalledTimes(1);
  });

  it("hides local cached rooms that are no longer joined on the homeserver", async () => {
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!active:cop.local"] }),
        rooms: [createRoom({ roomId: "!active:cop.local" }), createRoom({ roomId: "!purged-local-cache:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getRooms().map((room) => room.roomId)).toEqual(["!active:cop.local"]);
  });

  it("publishes no cached rooms before the first homeserver membership check", async () => {
    const onRoomsChanged = vi.fn();
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!active:cop.local"] }),
        rooms: [createRoom({ roomId: "!active:cop.local" }), createRoom({ roomId: "!stale:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onRoomsChanged });

    expect(onRoomsChanged.mock.calls[0]?.[0]).toEqual([]);
    expect(onRoomsChanged.mock.calls.at(-1)?.[0]?.map((room: { roomId: string }) => room.roomId)).toEqual([
      "!active:cop.local"
    ]);
    session.stop();
  });

  it("reads a room preview from the timeline tail without walking old history", async () => {
    const events = Array.from({ length: 2_000 }, (_, index) =>
      createMessageEvent(`message-${index}`, Date.parse("2026-06-24T10:00:00.000Z") + index * 1_000)
    );
    let indexedReads = 0;
    const timeline = new Proxy(events, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/u.test(property)) {
          indexedReads += 1;
        }
        return Reflect.get(target, property, receiver);
      }
    });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({ rooms: [createRoom({ roomId: "!chat:cop.local", timeline })] })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    indexedReads = 0;

    expect(session.getRooms()[0]?.latestMessage?.body).toBe("message-1999");
    expect(indexedReads).toBeLessThanOrEqual(2);
    session.stop();
  });

  it("reuses a stable mapped timeline until Matrix reports a room mutation", async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const timeline = [createMessageEvent("first", Date.parse("2026-06-24T10:00:00.000Z"), "$first")];
    const room = createRoom({ roomId: "!chat:cop.local", timeline });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
        rooms: [room]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    const first = session.getTimeline("!chat:cop.local");

    expect(session.getTimeline("!chat:cop.local")).toBe(first);

    const secondEvent = createMessageEvent("second", Date.parse("2026-06-24T10:01:00.000Z"), "$second");
    timeline.push(secondEvent);
    for (const listener of listeners.get("Room.timeline") ?? []) {
      listener(secondEvent, room);
    }

    const refreshed = session.getTimeline("!chat:cop.local");
    expect(refreshed).not.toBe(first);
    expect(refreshed.map((message) => message.eventId)).toEqual(["$first", "$second"]);
    session.stop();
  });

  it("does not schedule a second presence refresh for every timeline event", async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const onRoomsChanged = vi.fn();
    const room = createRoom({ roomId: "!chat:cop.local" });
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
        rooms: [room]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap(), { onRoomsChanged });
    await vi.runOnlyPendingTimersAsync();
    onRoomsChanged.mockClear();

    for (const listener of listeners.get("Room.timeline") ?? []) {
      listener(createMessageEvent("new", Date.now()), room);
    }
    await Promise.resolve();
    expect(onRoomsChanged).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRoomsChanged).toHaveBeenCalledTimes(1);
    session.stop();
  });

  it("coalesces a burst of decrypted events into a single timeline callback", async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const on = vi.fn<MatrixEventSubscription>((event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    });
    const off = vi.fn<MatrixEventSubscription>();
    const onTimelineChanged = vi.fn();
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        off,
        on,
        rooms: [createRoom({ roomId: "!chat:cop.local" })]
      })
    );

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
    expect(off).toHaveBeenCalledWith("received_voip_event", expect.any(Function));
  });

  it("does not flush timeline callbacks scheduled after the session stops", async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const on = vi.fn<MatrixEventSubscription>((event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    });
    const onTimelineChanged = vi.fn();
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        on,
        rooms: [createRoom({ roomId: "!chat:cop.local" })]
      })
    );

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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [createRoom({ roomId: "!chat:cop.local" })],
        sendEvent
      })
    );

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
          mapActions: [
            {
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
            }
          ],
          policyReason: "allowed",
          provider: "mock",
          question: "Co je teď důležité?",
          requestId: "request-1",
          responsePlaybook: {
            allowedActions: ["focus-map"],
            confidence: 0.9,
            domain: "weather",
            forbiddenActions: ["route"],
            intentId: "weather.rain.now",
            requiredSources: ["sim-search-data", "map-search"]
          },
          status: "COMPLETED",
          type: "chat-agent"
        },
        kind: "ai-agent-response",
        source: "cop-chat"
      },
      body: "AI odpověď",
      msgtype: "m.text"
    };
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [
          createRoom({
            roomId: "!chat:cop.local",
            timeline: [
              createMessageEvent(
                content.body,
                Date.parse("2026-06-24T11:00:00.000Z"),
                "$ai",
                "@operator:cop.local",
                content
              )
            ]
          })
        ],
        sendMessage
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.sendMessage("!chat:cop.local", "AI odpověď", {
      cop: {
        ai: {
          auditId: "audit-1",
          mapActions: [
            {
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
            }
          ],
          policyReason: "allowed",
          provider: "mock",
          question: "Co je teď důležité?",
          requestId: "request-1",
          responsePlaybook: {
            allowedActions: ["focus-map"],
            confidence: 0.9,
            domain: "weather",
            forbiddenActions: ["route"],
            intentId: "weather.rain.now",
            requiredSources: ["sim-search-data", "map-search"]
          },
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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        redactEvent,
        rooms: [
          createRoom({
            roomId: "!chat:cop.local",
            timeline: [
              createMessageEvent("hello", Date.parse("2026-06-24T11:00:00.000Z"), "$hello", "@other:cop.local"),
              createReactionEvent("$hello", "👀", "@operator:cop.local", "$reaction-own-old"),
              createReactionEvent("$hello", "👍", "@operator:cop.local", "$reaction-own")
            ]
          })
        ],
        sendEvent
      })
    );

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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        redactEvent,
        rooms: [
          createRoom({
            roomId: "!chat:cop.local",
            timeline: [
              createMessageEvent("hello", Date.parse("2026-06-24T11:00:00.000Z"), "$hello", "@other:cop.local"),
              createReactionEvent("$hello", "👀", "@operator:cop.local", "$reaction-own")
            ]
          })
        ],
        sendEvent
      })
    );

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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        redactEvent,
        rooms: [createRoom({ roomId: "!chat:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.deleteMessage("!chat:cop.local", "$message");

    expect(redactEvent).toHaveBeenCalledWith("!chat:cop.local", "$message", undefined, {
      reason: "Odstraněno uživatelem"
    });
  });

  it("leaves a Matrix room when leaving a group", async () => {
    const leave = vi.fn<MatrixLeaveRoom>().mockResolvedValue(undefined);
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        leave,
        rooms: [createRoom({ roomId: "!group:cop.local" })]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    await session.leaveRoom("!group:cop.local");

    expect(leave).toHaveBeenCalledWith("!group:cop.local");
  });

  it("reads grouped Matrix reactions from timeline relation events", async () => {
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        rooms: [
          createRoom({
            roomId: "!chat:cop.local",
            timeline: [
              createMessageEvent("hello", Date.parse("2026-06-24T11:00:00.000Z"), "$hello", "@other:cop.local"),
              createReactionEvent("$hello", "👍", "@operator:cop.local", "$reaction-own"),
              createReactionEvent("$hello", "👍", "@other:cop.local", "$reaction-other")
            ]
          })
        ]
      })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    expect(session.getTimeline("!chat:cop.local")[0]?.reactions).toEqual([
      {
        count: 2,
        key: "👍",
        own: true,
        ownEventId: "$reaction-own",
        senders: ["@operator:cop.local", "@other:cop.local"]
      }
    ]);
  });

  it("reports that user-controlled E2EE recovery needs setup when no key backup exists", async () => {
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        crypto: {
          getActiveSessionBackupVersion: vi.fn().mockResolvedValue(null),
          getKeyBackupInfo: vi.fn().mockResolvedValue(null),
          isCrossSigningReady: vi.fn().mockResolvedValue(false),
          isSecretStorageReady: vi.fn().mockResolvedValue(false)
        },
        rooms: []
      })
    );

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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({
        crypto: {
          getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
          getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
          isCrossSigningReady: vi.fn().mockResolvedValue(false),
          isSecretStorageReady: vi.fn().mockResolvedValue(true)
        },
        rooms: []
      })
    );

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
    const bootstrapCrossSigning = vi
      .fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>()
      .mockResolvedValue(undefined);
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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({ crypto, getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }), rooms: [] })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    const recoveryKey = await session.createEncryptionRecovery();

    expect(recoveryKey).toBe("EsTK aBCd user held recovery key");
    expect(bootstrapCrossSigning).toHaveBeenCalled();
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        setupNewKeyBackup: true,
        setupNewSecretStorage: true
      })
    );
  });

  it("prepares a complete Matrix Rust compatible recovery set for iPhone and iPad", async () => {
    const bootstrapCrossSigning = vi
      .fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>()
      .mockResolvedValue(undefined);
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(
      async (authUploadDeviceSigningKeys) => {
        await authUploadDeviceSigningKeys((authData) => Promise.resolve(authData));
      }
    );
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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({ crypto, getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }), rooms: [] })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    const recoveryKey = await session.prepareEncryptionRecoveryForMobile();

    expect(recoveryKey).toBe("EsTK mobile compatible recovery key");
    expect(resetEncryption).toHaveBeenCalled();
    expect(bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        setupNewKeyBackup: false,
        setupNewSecretStorage: true
      })
    );
    await expect(session.getEncryptionRecoveryStatus()).resolves.toMatchObject({
      matrixRustCompatible: true,
      ready: true
    });
  });

  it("accepts a completed recovery when Matrix reports a duplicate one-time key upload", async () => {
    const duplicateUploadError = new Error(
      'MatrixError: [400] One time key signed_curve25519:AAAAAAAAAGO already exists. Old key: {"key":"old-secret","signatures":{"@user:server":{"ed25519:DEVICE":"old-signature"}}}; new key: {"key":"new-secret"} (https://msg.zeleznalady.cz/_matrix/client/v3/keys/upload)'
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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({ crypto, getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }), rooms: [] })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.prepareEncryptionRecoveryForMobile()).resolves.toBe("EsTK duplicate upload recovery key");
    expect(crypto.checkKeyBackupAndEnable).toHaveBeenCalled();
  });

  it("sanitizes duplicate one-time key upload failures when recovery cannot be confirmed", async () => {
    const duplicateUploadError = new Error(
      'MatrixError: [400] One time key signed_curve25519:AAAAAAAAAGO already exists. Old key: {"key":"old-secret","signatures":{"@user:server":{"ed25519:DEVICE":"old-signature"}}}; new key: {"key":"new-secret"} (https://msg.zeleznalady.cz/_matrix/client/v3/keys/upload)'
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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({ crypto, getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }), rooms: [] })
    );

    const session = await createMatrixMessagingSession(createBootstrap());
    let caught: unknown;
    try {
      await session.prepareEncryptionRecoveryForMobile();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("původní webové zařízení");
    expect((caught as Error).message).not.toMatch(
      /signed_curve25519|old-secret|new-secret|old-signature|\/keys\/upload/iu
    );
  });

  it("keeps the generated secret-storage key available during iOS recovery preparation", async () => {
    let createClientOptions: Record<string, unknown> | undefined;
    const bootstrapCrossSigning = vi
      .fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>()
      .mockResolvedValue(undefined);
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
      const callbacks = createClientOptions?.cryptoCallbacks as
        | {
            getSecretStorageKey?: (
              options: { keys: Record<string, unknown> },
              name: string
            ) => Promise<[string, Uint8Array] | null>;
          }
        | undefined;
      const returnedKey = await callbacks?.getSecretStorageKey?.(
        {
          keys: {
            "generated-key": { algorithm: "m.secret_storage.v1.aes-hmac-sha2" }
          }
        },
        "m.cross_signing.master"
      );
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
      return createMockMatrixClient({
        crypto,
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }),
        rooms: []
      });
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
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({ crypto, getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }), rooms: [] })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    await expect(session.prepareEncryptionRecoveryForMobile()).resolves.toBe("EsTK mobile compatible recovery key");
    expect(resetEncryption).toHaveBeenCalled();
    expect(bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it("resets legacy Matrix E2EE metadata before preparing iOS recovery", async () => {
    const bootstrapCrossSigning = vi
      .fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>()
      .mockRejectedValue(new Error("getSecretStorageKey callback returned falsey"));
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
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        setupNewKeyBackup: false,
        setupNewSecretStorage: true
      })
    );
  });

  it("completes Matrix UIA with dummy auth when the homeserver offers it", async () => {
    const authAttempts: Array<Record<string, unknown> | null> = [];
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(
      async (authUploadDeviceSigningKeys) => {
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
      }
    );
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
    expect(authAttempts).toEqual([null, { session: "UIA_SESSION", type: "m.login.dummy" }]);
  });

  it("delegates password UIA with public cross-signing keys while keeping the password server-side", async () => {
    let createClientOptions: Record<string, unknown> | undefined;
    const masterKey = signingPublicKey("master");
    const selfSigningKey = signingPublicKey("self_signing");
    const userSigningKey = signingPublicKey("user_signing");
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(
      async (authUploadDeviceSigningKeys) => {
        await authUploadDeviceSigningKeys(async (authData) => {
          if (!authData) {
            throw Object.assign(new Error("UIA required"), {
              data: {
                flows: [{ stages: ["m.login.password"] }],
                session: "PASSWORD_UIA"
              }
            });
          }
          const fetchFn = createClientOptions?.fetchFn as typeof fetch | undefined;
          const response = await fetchFn?.("https://matrix.example.test/_matrix/client/v3/keys/device_signing/upload", {
            body: JSON.stringify({
              auth: authData,
              master_key: masterKey,
              self_signing_key: selfSigningKey,
              user_signing_key: userSigningKey
            }),
            method: "POST"
          });
          expect(response?.status).toBe(200);
          return response?.json();
        });
      }
    );
    const crypto: MockMatrixCrypto = {
      bootstrapCrossSigning: vi.fn(),
      bootstrapSecretStorage,
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      createRecoveryKeyFromPassphrase: vi.fn().mockResolvedValue({
        encodedPrivateKey: "EsTK delegated uia recovery key",
        privateKey: new Uint8Array([4, 5, 6])
      }),
      getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      resetEncryption
    };
    matrixSdkMock.createClient.mockImplementation((options: Record<string, unknown>) => {
      createClientOptions = options;
      return createMockMatrixClient({ crypto, rooms: [] });
    });
    const completeDeviceSigningAuth = vi.fn().mockResolvedValue(undefined);

    const session = await createMatrixMessagingSession(createBootstrap(), { completeDeviceSigningAuth });

    await expect(session.prepareEncryptionRecoveryForMobile()).resolves.toBe("EsTK delegated uia recovery key");
    expect(completeDeviceSigningAuth).toHaveBeenCalledWith({
      deviceId: "TESTDEVICE",
      masterKey,
      selfSigningKey,
      userSigningKey
    });
    expect(JSON.stringify(completeDeviceSigningAuth.mock.calls)).not.toMatch(/password|PASSWORD_UIA/u);
  });

  it("surfaces Matrix UIA requirements instead of masking them as COP login failures", async () => {
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(
      async (authUploadDeviceSigningKeys) => {
        await authUploadDeviceSigningKeys(async () => {
          throw Object.assign(new Error("UIA required"), {
            data: {
              flows: [{ stages: ["m.login.password"] }],
              session: "PASSWORD_UIA"
            }
          });
        });
      }
    );
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

    await expect(session.prepareEncryptionRecoveryForMobile()).rejects.toThrow(
      /Matrix interactive auth.*m\.login\.password/u
    );
  });

  it("resets Matrix encryption metadata before rotating the recovery key", async () => {
    const bootstrapCrossSigning = vi
      .fn<NonNullable<MockMatrixCrypto["bootstrapCrossSigning"]>>()
      .mockResolvedValue(undefined);
    const bootstrapSecretStorage = vi.fn<NonNullable<MockMatrixCrypto["bootstrapSecretStorage"]>>(async (options) => {
      await options.createSecretStorageKey?.();
    });
    const resetEncryption = vi.fn<NonNullable<MockMatrixCrypto["resetEncryption"]>>(
      async (authUploadDeviceSigningKeys) => {
        await authUploadDeviceSigningKeys((authData) => Promise.resolve(authData));
      }
    );
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
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        setupNewKeyBackup: false,
        setupNewSecretStorage: true
      })
    );
  });

  it("restores an existing key backup after the user enters a recovery key", async () => {
    const storage = installLocalStorageStub();
    const recoveryKey = await createValidRecoveryKey(7);
    let finishRestoreKeyBackup!: () => void;
    let restoreCompleted = false;
    const getActiveSessionBackupVersion = vi.fn().mockResolvedValueOnce(null).mockResolvedValue("1");
    const crypto: MockMatrixCrypto = {
      checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
      getActiveSessionBackupVersion,
      getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
      isCrossSigningReady: vi.fn().mockResolvedValue(true),
      isSecretStorageReady: vi.fn().mockResolvedValue(true),
      loadSessionBackupPrivateKeyFromSecretStorage: vi.fn().mockResolvedValue(undefined),
      restoreKeyBackup: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishRestoreKeyBackup = () => {
              restoreCompleted = true;
              resolve();
            };
          })
      )
    };
    matrixSdkMock.createClient.mockReturnValue(
      createMockMatrixClient({ crypto, getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }), rooms: [] })
    );

    const session = await createMatrixMessagingSession(createBootstrap());

    const restorePromise = session.restoreEncryptionRecovery(recoveryKey);
    await Promise.resolve();
    expect(restoreCompleted).toBe(false);
    await vi.waitFor(() => expect(crypto.restoreKeyBackup).toHaveBeenCalled());
    finishRestoreKeyBackup();
    await expect(restorePromise).resolves.toBeUndefined();
    expect(crypto.loadSessionBackupPrivateKeyFromSecretStorage).toHaveBeenCalled();
    expect(crypto.checkKeyBackupAndEnable).toHaveBeenCalled();
    expect(crypto.restoreKeyBackup).toHaveBeenCalledWith(
      expect.objectContaining({ progressCallback: expect.any(Function) })
    );
    expect(Array.from(storage.values()).some((value) => value.includes(recoveryKey))).toBe(true);
  }, 10_000);

  it("uses a locally stored recovery key to enable key backup on the next PWA start", async () => {
    const storage = installLocalStorageStub();
    const recoveryKey = await createValidRecoveryKey(11);
    const expectedPrivateKey = new Uint8Array(32).fill(11);
    let decodedLoads = 0;
    let restoreCalls = 0;
    matrixSdkMock.createClient.mockImplementation((options: Record<string, unknown>) => {
      const cryptoCallbacks = options.cryptoCallbacks as {
        getSecretStorageKey?: (options: { keys: Record<string, unknown> }) => Promise<[string, Uint8Array] | null>;
      };
      const crypto: MockMatrixCrypto = {
        checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
        getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
        getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
        isCrossSigningReady: vi.fn().mockResolvedValue(true),
        isSecretStorageReady: vi.fn().mockResolvedValue(true),
        loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(async () => {
          const result = await cryptoCallbacks.getSecretStorageKey?.({ keys: { "recovery-key-id": {} } });
          if (!result) {
            throw new Error("missing recovery key");
          }
          decodedLoads += 1;
          expect(result?.[0]).toBe("recovery-key-id");
          expect(Array.from(result?.[1] ?? [])).toEqual(Array.from(expectedPrivateKey));
        }),
        restoreKeyBackup: vi.fn(async () => {
          restoreCalls += 1;
        })
      };
      return createMockMatrixClient({
        crypto,
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }),
        rooms: []
      });
    });

    const firstSession = await createMatrixMessagingSession(createBootstrap());
    await firstSession.restoreEncryptionRecovery(recoveryKey);
    expect(Array.from(storage.values()).some((value) => value.includes(recoveryKey))).toBe(true);

    const onTimelineChanged = vi.fn();
    await createMatrixMessagingSession(createBootstrap(), { onTimelineChanged });

    expect(decodedLoads).toBe(2);
    await vi.waitFor(() => expect(restoreCalls).toBe(2));
    await vi.waitFor(() => expect(onTimelineChanged).toHaveBeenCalled());
  }, 10_000);

  it("reuses a sealed recovery key after rotating to a distinct Matrix device crypto store", async () => {
    const storage = installLocalStorageStub();
    const indexedDb = installIndexedDbStub();
    const recoveryKey = await createValidRecoveryKey(13);
    const expectedPrivateKey = new Uint8Array(32).fill(13);
    const cryptoDatabasePrefixes: Array<string | undefined> = [];
    let decodedLoads = 0;
    matrixSdkMock.createClient.mockImplementation((options: Record<string, unknown>) => {
      const cryptoCallbacks = options.cryptoCallbacks as {
        getSecretStorageKey?: (options: { keys: Record<string, unknown> }) => Promise<[string, Uint8Array] | null>;
      };
      const crypto: MockMatrixCrypto = {
        checkKeyBackupAndEnable: vi.fn().mockResolvedValue(undefined),
        getActiveSessionBackupVersion: vi.fn().mockResolvedValue("1"),
        getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
        isCrossSigningReady: vi.fn().mockResolvedValue(true),
        isSecretStorageReady: vi.fn().mockResolvedValue(true),
        loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(async () => {
          const result = await cryptoCallbacks.getSecretStorageKey?.({ keys: { "recovery-key-id": {} } });
          if (!result) {
            throw new Error("missing recovery key");
          }
          decodedLoads += 1;
          expect(Array.from(result[1])).toEqual(Array.from(expectedPrivateKey));
        }),
        restoreKeyBackup: vi.fn().mockResolvedValue(undefined)
      };
      return createMockMatrixClient({
        crypto,
        getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: [] }),
        initRustCrypto: vi.fn(async (args?: { cryptoDatabasePrefix?: string }) => {
          cryptoDatabasePrefixes.push(args?.cryptoDatabasePrefix);
        }),
        rooms: []
      });
    });

    const firstSession = await createMatrixMessagingSession(createBootstrap());
    await firstSession.restoreEncryptionRecovery(recoveryKey);

    expect(Array.from(storage.values()).join("\n")).not.toContain(recoveryKey);
    expect(indexedDb.dump()).not.toContain(recoveryKey);

    firstSession.stop();
    const repairedSession = await createMatrixMessagingSession({ ...createBootstrap(), deviceId: "COPWEB.REPAIRED" });

    expect(decodedLoads).toBe(2);
    expect(cryptoDatabasePrefixes).toHaveLength(2);
    expect(cryptoDatabasePrefixes[0]).toContain("testdevice");
    expect(cryptoDatabasePrefixes[1]).toContain("copweb.repaired");
    expect(new Set(cryptoDatabasePrefixes).size).toBe(2);
    repairedSession.stop();
  }, 10_000);
});

function installLocalStorageStub(): Map<string, string> {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    }
  });
  return storage;
}

function installIndexedDbStub(): { dump: () => string } {
  const stores = new Map<string, Map<string, unknown>>();
  let opened = false;
  const database = {
    close: vi.fn(),
    createObjectStore: (name: string) => {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      return {};
    },
    objectStoreNames: {
      contains: (name: string) => stores.has(name)
    },
    transaction: (storeName: string) => createFakeTransaction(stores, storeName)
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = createFakeRequest<IDBDatabase>();
      setTimeout(() => {
        request.result = database as unknown as IDBDatabase;
        if (!opened) {
          opened = true;
          request.onupgradeneeded?.({ target: request } as unknown as IDBVersionChangeEvent);
        }
        setTimeout(() => request.onsuccess?.({ target: request } as unknown as Event), 0);
      }, 0);
      return request as unknown as IDBOpenDBRequest;
    }
  });
  return {
    dump: () => JSON.stringify(Array.from(stores.entries()))
  };
}

function createFakeTransaction(stores: Map<string, Map<string, unknown>>, storeName: string): IDBTransaction {
  const transaction = {
    error: null,
    mode: "readonly",
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: (requestedStoreName: string) => {
      const store = stores.get(requestedStoreName) ?? stores.get(storeName) ?? new Map<string, unknown>();
      if (!stores.has(requestedStoreName)) {
        stores.set(requestedStoreName, store);
      }
      return {
        delete: (key: IDBValidKey) =>
          completeFakeRequest(createFakeRequest<undefined>(), () => {
            store.delete(String(key));
            completeFakeTransaction(transaction);
            return undefined;
          }),
        get: (key: IDBValidKey) => completeFakeRequest(createFakeRequest<unknown>(), () => store.get(String(key))),
        put: (value: { id?: unknown }) =>
          completeFakeRequest(createFakeRequest<IDBValidKey>(), () => {
            const id = typeof value.id === "string" ? value.id : "";
            store.set(id, value);
            completeFakeTransaction(transaction);
            return id;
          })
      };
    }
  };
  return transaction as unknown as IDBTransaction;
}

function createFakeRequest<T>(): IDBRequest<T> & {
  error: DOMException | null;
  onerror: ((event: Event) => void) | null;
  onsuccess: ((event: Event) => void) | null;
  onupgradeneeded?: ((event: IDBVersionChangeEvent) => void) | null;
  result: T;
} {
  return {
    error: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
    result: undefined as T
  } as IDBRequest<T> & {
    error: DOMException | null;
    onerror: ((event: Event) => void) | null;
    onsuccess: ((event: Event) => void) | null;
    onupgradeneeded?: ((event: IDBVersionChangeEvent) => void) | null;
    result: T;
  };
}

function completeFakeRequest<T>(request: ReturnType<typeof createFakeRequest<T>>, read: () => T): IDBRequest<T> {
  setTimeout(() => {
    request.result = read();
    request.onsuccess?.({ target: request } as unknown as Event);
  }, 0);
  return request;
}

function completeFakeTransaction(transaction: { oncomplete: ((event: Event) => void) | null }): void {
  setTimeout(() => transaction.oncomplete?.({ target: transaction } as unknown as Event), 0);
}

async function createValidRecoveryKey(fill: number): Promise<string> {
  const { encodeRecoveryKey } = (await import("matrix-js-sdk/lib/crypto-api/recovery-key.js")) as {
    encodeRecoveryKey: (key: Uint8Array) => string;
  };
  return encodeRecoveryKey(new Uint8Array(32).fill(fill));
}

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

function signingPublicKey(usage: "master" | "self_signing" | "user_signing") {
  return {
    keys: { [`ed25519:${usage}`]: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    usage: [usage],
    user_id: "@operator:cop.local"
  };
}

function createMockMatrixClient({
  createGroupCall,
  crypto,
  getGroupCallForRoom,
  getJoinedRooms,
  getProfileInfo,
  getTurnServers,
  getUser,
  initRustCrypto = vi.fn().mockResolvedValue(undefined),
  leave,
  mxcUrlToHttp,
  redactEvent = vi.fn<MatrixRedactEvent>().mockResolvedValue(undefined),
  off,
  on,
  rooms,
  sendReadReceipt,
  sendEvent = vi.fn<MatrixSendEvent>().mockResolvedValue(undefined),
  sendMessage = vi.fn<MatrixSendMessage>().mockResolvedValue(undefined),
  sendStateEvent = vi.fn<MatrixSendStateEvent>().mockResolvedValue(undefined),
  setAccessToken = vi.fn(),
  setRoomReadMarkers,
  setAvatarUrl,
  setDisplayName,
  setPusher,
  scrollback,
  uploadContent,
  waitUntilRoomReadyForGroupCalls
}: {
  createGroupCall?: MockMatrixClient["createGroupCall"];
  crypto?: MockMatrixCrypto;
  getGroupCallForRoom?: MockMatrixClient["getGroupCallForRoom"];
  getJoinedRooms?: MockMatrixClient["getJoinedRooms"];
  getProfileInfo?: MockMatrixClient["getProfileInfo"];
  getTurnServers?: MockMatrixClient["getTurnServers"];
  getUser?: MockMatrixClient["getUser"];
  initRustCrypto?: MockMatrixClient["initRustCrypto"];
  leave?: MockMatrixClient["leave"];
  mxcUrlToHttp?: MockMatrixClient["mxcUrlToHttp"];
  off?: MockMatrixClient["off"];
  on?: MockMatrixClient["on"];
  redactEvent?: MockMatrixClient["redactEvent"];
  rooms: unknown[];
  sendReadReceipt?: MockMatrixClient["sendReadReceipt"];
  sendEvent?: MockMatrixClient["sendEvent"];
  sendMessage?: MockMatrixClient["sendMessage"];
  sendStateEvent?: MockMatrixClient["sendStateEvent"];
  setAccessToken?: MockMatrixClient["setAccessToken"];
  setRoomReadMarkers?: MockMatrixClient["setRoomReadMarkers"];
  setAvatarUrl?: MockMatrixClient["setAvatarUrl"];
  setDisplayName?: MockMatrixClient["setDisplayName"];
  setPusher?: MockMatrixClient["setPusher"];
  scrollback?: MockMatrixClient["scrollback"];
  uploadContent?: MockMatrixClient["uploadContent"];
  waitUntilRoomReadyForGroupCalls?: MockMatrixClient["waitUntilRoomReadyForGroupCalls"];
}): MockMatrixClient {
  return {
    ...(createGroupCall ? { createGroupCall } : {}),
    ...(crypto ? { getCrypto: () => crypto } : {}),
    ...(getGroupCallForRoom ? { getGroupCallForRoom } : {}),
    ...(getJoinedRooms ? { getJoinedRooms } : {}),
    ...(getProfileInfo ? { getProfileInfo } : {}),
    getRooms: () => rooms,
    ...(getTurnServers ? { getTurnServers } : {}),
    ...(getUser ? { getUser } : {}),
    getUserId: () => "@operator:cop.local",
    initRustCrypto,
    isRoomEncrypted: () => true,
    ...(leave ? { leave } : {}),
    ...(mxcUrlToHttp ? { mxcUrlToHttp } : {}),
    ...(off ? { off } : {}),
    ...(on ? { on } : {}),
    redactEvent,
    ...(sendReadReceipt ? { sendReadReceipt } : {}),
    sendEvent,
    sendMessage,
    sendStateEvent,
    setAccessToken,
    ...(setRoomReadMarkers ? { setRoomReadMarkers } : {}),
    ...(setAvatarUrl ? { setAvatarUrl } : {}),
    ...(setDisplayName ? { setDisplayName } : {}),
    ...(setPusher ? { setPusher } : {}),
    ...(scrollback ? { scrollback } : {}),
    ...(uploadContent ? { uploadContent } : {}),
    startClient: () => Promise.resolve(),
    ...(waitUntilRoomReadyForGroupCalls ? { waitUntilRoomReadyForGroupCalls } : {})
  };
}

function createMockVoiceCall({
  direction,
  roomId,
  state = "fledgling"
}: {
  direction: "inbound" | "outbound";
  roomId: string;
  state?: string;
}): MockMatrixCall {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };
  let microphoneMuted = false;
  const call: MockMatrixCall = {
    answer: vi.fn(async () => {
      call.state = "connected";
      emit("state", "connected", state, call);
    }),
    callId: "call-1",
    direction,
    emitEvent: emit,
    hangup: vi.fn(() => {
      call.state = "ended";
      emit("state", "ended", state, call);
      emit("hangup", call);
    }),
    isMicrophoneMuted: () => microphoneMuted,
    off: (event, listener) => {
      listeners.get(event)?.delete(listener);
    },
    on: (event, listener) => {
      const current = listeners.get(event) ?? new Set();
      current.add(listener);
      listeners.set(event, current);
    },
    placeVoiceCall: vi.fn(async () => {
      call.state = "invite_sent";
      emit("state", "invite_sent", state, call);
    }),
    reject: vi.fn(() => {
      call.state = "ended";
      emit("state", "ended", state, call);
      emit("hangup", call);
    }),
    roomId,
    setMicrophoneMuted: vi.fn(async (muted: boolean) => {
      microphoneMuted = muted;
      return microphoneMuted;
    }),
    state
  };
  return call;
}

function createMockGroupVoiceCall(
  room: ReturnType<typeof createRoom>,
  participants = new Map<{ displayName?: string; userId: string }, Map<string, unknown>>()
): MockMatrixGroupCall {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  let microphoneMuted = false;
  const call: MockMatrixGroupCall = {
    enter: vi.fn(async () => {
      call.state = "entered";
      emit("group_call_state_changed", "entered", "local_call_feed_initialized");
    }),
    groupCallId: "group-call-1",
    leave: vi.fn(() => {
      call.state = "local_call_feed_initialized";
      emit("group_call_state_changed", call.state, "entered");
    }),
    off: (event, listener) => listeners.get(event)?.delete(listener),
    on: (event, listener) => {
      const current = listeners.get(event) ?? new Set();
      current.add(listener);
      listeners.set(event, current);
    },
    participants,
    room,
    setMicrophoneMuted: vi.fn(async (muted: boolean) => {
      microphoneMuted = muted;
      emit("local_mute_state_changed", microphoneMuted, true);
      return microphoneMuted;
    }),
    state: "local_call_feed_initialized",
    terminate: vi.fn(async () => {
      call.state = "ended";
      emit("group_call_state_changed", "ended", "entered");
    }),
    userMediaFeeds: []
  };
  return call;
}

function stubVoiceCallBrowserSupport(): void {
  vi.stubGlobal("RTCPeerConnection", class MockRTCPeerConnection {});
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn()
    }
  });
}

function createRoom({
  members,
  paginationToken,
  retentionSeconds,
  roomId,
  timeline = [],
  unreadCount = 0
}: {
  members?: Array<{ avatarUrl?: string; displayName?: string; userId: string }>;
  paginationToken?: string | null;
  retentionSeconds?: number;
  roomId: string;
  timeline?: unknown[];
  unreadCount?: number | (() => number);
}) {
  return {
    currentState: {
      getStateEvents: (eventType: string) =>
        eventType === "m.room.retention" && retentionSeconds
          ? {
              getContent: () => ({ max_lifetime: retentionSeconds * 1000 }),
              getType: () => "m.room.retention"
            }
          : null
    },
    ...(members ? { getJoinedMembers: () => members } : {}),
    getMyMembership: () => "join",
    getUnreadNotificationCount: () => (typeof unreadCount === "function" ? unreadCount() : unreadCount),
    name: "Test Chat",
    ...(paginationToken !== undefined ? { oldState: { paginationToken } } : {}),
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

function createCallEvent(eventType: string, timestamp: number, eventId: string, sender = "@operator:cop.local") {
  return {
    getContent: () => ({
      call_id: "call-1",
      version: "1"
    }),
    getId: () => eventId,
    getRoomId: () => "!chat:cop.local",
    getSender: () => sender,
    getTs: () => timestamp,
    getType: () => eventType,
    getWireType: () => eventType
  };
}

function createCallControlEvent(
  eventType: string,
  content: Record<string, unknown>,
  eventId: string,
  sender: string,
  roomId: string,
  wireType = eventType
) {
  return {
    getClearContent: () => content,
    getContent: () => content,
    getEffectiveEvent: () => ({ content, type: eventType }),
    getId: () => eventId,
    getRoomId: () => roomId,
    getSender: () => sender,
    getTs: () => Date.now(),
    getType: () => eventType,
    getWireType: () => wireType
  };
}

function createEncryptedEvent(
  timestamp: number,
  eventId: string,
  sender = "@operator:cop.local",
  clearContent?: Record<string, unknown>,
  clearType = "m.room.message"
) {
  const wireContent = {
    algorithm: "m.megolm.v1.aes-sha2",
    ciphertext: "encrypted",
    device_id: "DEVICE",
    sender_key: "sender-key",
    session_id: "session-id"
  };
  return {
    ...(clearContent ? { getClearContent: () => clearContent } : {}),
    getContent: () => (clearContent ? clearContent : wireContent),
    getEffectiveEvent: () => ({
      content: clearContent ?? wireContent,
      type: clearContent ? clearType : "m.room.encrypted"
    }),
    getId: () => eventId,
    getSender: () => sender,
    getTs: () => timestamp,
    getType: () => (clearContent ? clearType : "m.room.encrypted")
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
