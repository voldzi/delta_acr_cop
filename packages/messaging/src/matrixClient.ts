import type {
  MessagingBootstrapResponse,
  MatrixAttachmentKind,
  MatrixAttachmentUpload,
  MatrixCopAiMessageMetadata,
  MatrixCopMapAction,
  MatrixCopMessageMetadata,
  MatrixDeviceSigningAuthRequest,
  MatrixEncryptedFileRef,
  MatrixEncryptionRecoveryStatus,
  MatrixLocationShare,
  MatrixMessageReaction,
  MatrixMessageReplyTarget,
  MatrixMessagingSession,
  MatrixTransitShare,
  MatrixVoiceCallOptions,
  MatrixVoiceCallPhase,
  MatrixVoiceCallSnapshot,
  MatrixVoiceCallWakeRequest,
  MatrixWebPushPusherOptions,
  MatrixUserProfileSyncInput,
  MatrixPresenceState,
  MatrixRoomSummary,
  MatrixTimelineAttachment,
  MatrixTimelineMessage
} from "./types.js";
import {
  readSealedBrowserSecret,
  requestDurableBrowserStorage,
  writeSealedBrowserSecret,
  type BrowserSecretScope
} from "./secureSecrets.js";

const matrixVoiceCallPreflightEventType = "cz.zeleznalady.cop.call.preflight";
const matrixVoiceCallPreflightAckEventType = "cz.zeleznalady.cop.call.preflight_ack";
const matrixVoiceCallPreflightTimeoutMs = 1_200;
const matrixVoiceCallConnectingTimeoutMs = 45_000;
const matrixVoiceCallIceFailureMessage = "Hovor se nepodařilo spojit. Pravděpodobně chybí dostupný TURN server.";
const matrixGroupVoiceCallParticipantLimit = 6;
const matrixServerManagedAuthType = "cz.zeleznalady.cop.server_managed_password";

interface MatrixClientLike {
  createRoom?: (options: Record<string, unknown>) => Promise<{ room_id?: string; roomId?: string }>;
  createGroupCall?: (roomId: string, type: string, isPtt: boolean, intent: string) => Promise<MatrixGroupCallLike>;
  getCrypto?: () => MatrixCryptoApiLike | undefined;
  getJoinedRooms?: () => Promise<{ joined_rooms?: unknown } | unknown[]>;
  getProfileInfo?: (userId: string) => Promise<Record<string, unknown>>;
  getGroupCallForRoom?: (roomId: string) => MatrixGroupCallLike | null;
  getRooms?: () => unknown[];
  getTurnServers?: () => RTCIceServer[];
  getUserId?: () => string | null;
  getUser?: (userId: string) => MatrixUserPresenceLike | undefined;
  initRustCrypto?: (args?: { cryptoDatabasePrefix?: string }) => Promise<void>;
  invite?: (roomId: string, userId: string) => Promise<unknown>;
  isRoomEncrypted?: (roomId: string) => boolean;
  joinRoom?: (roomIdOrAlias: string) => Promise<{ room_id?: string; roomId?: string }>;
  leave?: (roomId: string) => Promise<unknown>;
  mxcUrlToHttp?: (
    mxcUrl: string,
    width?: number,
    height?: number,
    resizeMethod?: string,
    allowDirectLinks?: boolean,
    allowRedirects?: boolean,
    useAuthentication?: boolean
  ) => string | null;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  redactEvent?: (roomId: string, eventId: string, txnId?: string, opts?: Record<string, unknown>) => Promise<unknown>;
  sendReadReceipt?: (event: MatrixEventLike, receiptType?: string) => Promise<unknown>;
  sendEvent?: MatrixSendEventLike;
  sendMessage?: (roomId: string, content: Record<string, unknown>) => Promise<unknown>;
  setPusher?: (pusher: Record<string, unknown>) => Promise<unknown>;
  sendStateEvent?: (
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
    stateKey?: string
  ) => Promise<unknown>;
  sendTextMessage?: (roomId: string, body: string) => Promise<unknown>;
  setAccessToken?: (accessToken: string) => void;
  setRoomReadMarkers?: (
    roomId: string,
    readMarkerEventId: string,
    readReceiptEvent?: MatrixEventLike
  ) => Promise<unknown>;
  setPresence?: (options: { presence: "offline" | "online" | "unavailable" }) => Promise<unknown>;
  startClient?: (options?: Record<string, unknown>) => Promise<void> | void;
  stopClient?: () => void;
  syncApi?: MatrixSyncApiLike;
  scrollback?: (room: MatrixRoomLike, limit?: number) => Promise<unknown>;
  setAvatarUrl?: (mxcUrl: string) => Promise<unknown>;
  setDisplayName?: (displayName: string) => Promise<unknown>;
  uploadContent?: (
    file: Blob | File,
    opts?: Record<string, unknown>
  ) => Promise<{ content_uri?: string; contentUri?: string }>;
  waitUntilRoomReadyForGroupCalls?: (roomId: string) => Promise<void>;
}

interface MatrixSyncApiLike {
  stop: () => void;
  sync: () => Promise<void>;
}

type MatrixSendEventArgs =
  | [roomId: string, eventType: string, content: Record<string, unknown>, txnId?: string]
  | [roomId: string, threadId: string | null, eventType: string, content: Record<string, unknown>, txnId?: string];

type MatrixSendEventLike = (...args: MatrixSendEventArgs) => Promise<unknown>;

interface MatrixCallLike {
  callId?: string;
  direction?: string;
  invitee?: string;
  localUsermediaStream?: MediaStream;
  remoteUsermediaStream?: MediaStream;
  roomId?: string;
  state?: string;
  answer?: (audio?: boolean, video?: boolean) => Promise<void>;
  getOpponentMember?: () => { userId?: string } | undefined;
  hangup?: (reason: string, suppressEvent: boolean) => void;
  isMicrophoneMuted?: () => boolean;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  placeVoiceCall?: () => Promise<void>;
  reject?: () => void;
  setMicrophoneMuted?: (muted: boolean) => Promise<boolean>;
}

interface MatrixCallFeedLike {
  stream?: MediaStream;
  userId?: string;
}

interface MatrixGroupCallLike {
  groupCallId?: string;
  localCallFeed?: MatrixCallFeedLike;
  participants?: Map<MatrixRoomMemberLike, Map<string, unknown>>;
  room?: MatrixRoomLike;
  state?: string;
  userMediaFeeds?: MatrixCallFeedLike[];
  enter?: () => Promise<void>;
  isMicrophoneMuted?: () => boolean;
  leave?: () => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  setMicrophoneMuted?: (muted: boolean) => Promise<boolean>;
  terminate?: (emitStateEvent?: boolean) => Promise<void>;
}

interface MatrixCryptoApiLike {
  bootstrapCrossSigning?: (options: {
    authUploadDeviceSigningKeys?: MatrixInteractiveAuthCallback;
    setupNewCrossSigning?: boolean;
  }) => Promise<void>;
  bootstrapSecretStorage?: (options: {
    createSecretStorageKey?: () => Promise<unknown>;
    setupNewKeyBackup?: boolean;
    setupNewSecretStorage?: boolean;
  }) => Promise<void>;
  checkKeyBackupAndEnable?: () => Promise<unknown>;
  createRecoveryKeyFromPassphrase?: (password?: string) => Promise<unknown>;
  disableKeyStorage?: () => Promise<void>;
  forceDiscardSession?: (roomId: string) => Promise<void>;
  getActiveSessionBackupVersion?: () => Promise<string | null>;
  getKeyBackupInfo?: () => Promise<unknown | null>;
  isCrossSigningReady?: () => Promise<boolean>;
  isSecretStorageReady?: () => Promise<boolean>;
  loadSessionBackupPrivateKeyFromSecretStorage?: () => Promise<void>;
  resetEncryption?: (authUploadDeviceSigningKeys: MatrixInteractiveAuthCallback) => Promise<void>;
  restoreKeyBackup?: (options?: Record<string, unknown>) => Promise<unknown>;
}

type MatrixInteractiveAuthCallback = (
  makeRequest: (authData: Record<string, unknown> | null) => Promise<unknown>
) => Promise<unknown>;

interface MatrixRecoveryController {
  readonly cryptoCallbacks: Record<string, unknown>;
  setGeneratedSecretStorageKey(generatedKey: unknown): void;
  setRecoveryKey(recoveryKey: string): void;
}

interface MatrixSdkLike {
  createClient: (options: Record<string, unknown>) => MatrixClientLike;
  createNewMatrixCall?: (
    client: MatrixClientLike,
    roomId: string,
    options?: Record<string, unknown>
  ) => MatrixCallLike | null;
  Room?: {
    prototype?: {
      __copChatPollAggregationDisabled?: boolean;
      processPollEvents?: (events: unknown[]) => Promise<void> | void;
    };
  };
  IndexedDBStore?: new (options: {
    dbName?: string;
    indexedDB: IDBFactory;
    localStorage?: Storage;
  }) => MatrixSyncStoreLike;
}

interface MatrixSyncStoreLike {
  destroy?: () => Promise<void>;
  save?: (force?: boolean) => Promise<void>;
  startup: () => Promise<void>;
}

interface MatrixRoomLike {
  getJoinedMembers?: () => MatrixRoomMemberLike[];
  getMember?: (userId: string) => MatrixRoomMemberLike | null;
  getMyMembership?: () => string;
  getUnreadNotificationCount?: () => number;
  currentState?: MatrixRoomStateLike;
  name?: string;
  oldState?: {
    paginationToken?: string | null;
  };
  relations?: MatrixRelationsContainerLike;
  roomId?: string;
  timeline?: unknown[];
}

interface MatrixRelationsContainerLike {
  getChildEventsForEvent?: (
    eventId: string,
    relationType: string,
    eventType: string
  ) => MatrixRelationsLike | undefined;
}

interface MatrixRelationsLike {
  getRelations?: () => unknown[];
}

interface MatrixRoomStateLike {
  getStateEvents?: (eventType: string, stateKey?: string) => unknown | unknown[];
}

interface MatrixRoomMemberLike {
  avatarUrl?: string;
  displayName?: string;
  getMxcAvatarUrl?: () => string | null;
  membership?: string;
  name?: string;
  rawDisplayName?: string;
  user?: MatrixUserPresenceLike;
  userId?: string;
}

interface MatrixUserPresenceLike {
  avatarUrl?: string;
  currentlyActive?: boolean;
  displayName?: string;
  lastActiveAgo?: number;
  lastPresenceTs?: number;
  presence?: string;
  userId?: string;
}

interface CachedMatrixUserProfile {
  avatarUrl?: string;
  currentlyActive?: boolean;
  displayName?: string;
  fetchedAt: number;
  lastActiveAgo?: number;
  lastPresenceTs?: number;
  presence?: string;
  userId: string;
}

interface MatrixEventLike {
  getAssociatedId?: () => string | undefined;
  getClearContent?: () => Record<string, unknown> | null;
  getContent?: () => Record<string, unknown>;
  getEffectiveEvent?: () => { content?: Record<string, unknown>; type?: string } | null;
  getId?: () => string | undefined;
  getRelation?: () => Record<string, unknown> | null;
  getRoomId?: () => string | undefined;
  getSender?: () => string | undefined;
  getStateKey?: () => string | undefined;
  getTs?: () => number | undefined;
  getType?: () => string | undefined;
  getWireType?: () => string | undefined;
}

export async function createMatrixMessagingSession(
  bootstrap: MessagingBootstrapResponse,
  callbacks: {
    completeDeviceSigningAuth?: (request: MatrixDeviceSigningAuthRequest) => Promise<void>;
    onRoomsChanged?: (rooms: MatrixRoomSummary[]) => void;
    profile?: MatrixUserProfileSyncInput;
    onSyncState?: (state: string) => void;
    onTimelineChanged?: () => void;
    webPush?: MatrixWebPushPusherOptions;
    voip?: MatrixVoiceCallOptions;
    onVoiceCallWake?: (request: MatrixVoiceCallWakeRequest) => Promise<void> | void;
    onVoiceCallChanged?: (call: MatrixVoiceCallSnapshot | null) => void;
  } = {}
): Promise<MatrixMessagingSession> {
  validateBootstrap(bootstrap);
  let activeBootstrap: MessagingBootstrapResponse = { ...bootstrap };
  const homeserverBaseUrl = activeBootstrap.homeserverBaseUrl;
  if (!homeserverBaseUrl) {
    throw new Error("Zabezpečený chat nemá připravenou adresu služby.");
  }
  const durableStorageWarmup = requestDurableBrowserStorage();
  const storedRecoveryKey = readStoredMatrixRecoveryKey(activeBootstrap);
  await assertBrowserCanReachHomeserver(homeserverBaseUrl);
  const [matrixSdk, initialRecoveryKey] = await Promise.all([
    import("matrix-js-sdk/lib/browser-index.js") as Promise<unknown>,
    storedRecoveryKey
  ]);
  void durableStorageWarmup;
  const typedMatrixSdk = matrixSdk as MatrixSdkLike;
  disableMatrixPollAggregation(typedMatrixSdk);
  const createClient = typedMatrixSdk.createClient;
  const recoveryController = createUserControlledRecoveryController(initialRecoveryKey);
  const syncStore = createMatrixSyncStore(typedMatrixSdk, activeBootstrap);
  const tlsVoiceCallIds = new Set<string>();
  const client = createClient({
    accessToken: activeBootstrap.accessToken,
    baseUrl: homeserverBaseUrl,
    deviceId: activeBootstrap.deviceId,
    fallbackICEServerAllowed: callbacks.voip?.fallbackIceServerAllowed === true,
    forceTURN: callbacks.voip?.forceTurn === true,
    cryptoCallbacks: recoveryController.cryptoCallbacks,
    ...(callbacks.completeDeviceSigningAuth && activeBootstrap.deviceId
      ? {
          fetchFn: createMatrixServerManagedAuthFetch(callbacks.completeDeviceSigningAuth, activeBootstrap.deviceId)
        }
      : {}),
    ...(syncStore ? { store: syncStore } : {}),
    userId: activeBootstrap.userId
  });
  const ownMatrixUserId = () => activeBootstrap.userId ?? client.getUserId?.() ?? "";
  installAdditionalMatrixIceServers(client, callbacks.voip?.additionalIceServerUrls);
  installMatrixVoipSignalingFallback(client, () => activeBootstrap, tlsVoiceCallIds);
  await syncStore?.startup().catch(() => undefined);

  let restoreKeyBackupOnStart = false;
  if (activeBootstrap.e2eeRequired) {
    if (typeof client.initRustCrypto !== "function") {
      throw new Error("Tento prohlížeč nepodporuje potřebné šifrování zpráv.");
    }
    try {
      await client.initRustCrypto({
        cryptoDatabasePrefix: matrixCryptoDatabasePrefix(activeBootstrap)
      });
    } catch (caught) {
      if (isMatrixAccountStoreMismatch(caught)) {
        throw new MatrixAccountStoreMismatchError(caught);
      }
      throw caught;
    }
    restoreKeyBackupOnStart = await enableKnownMatrixKeyBackup(client);
  }

  let inviteJoinInFlight: Promise<void> | null = null;
  // Until the first membership lookup finishes, expose no cached rooms.
  // IndexedDB can legitimately retain rooms that the user has already left.
  let joinedRoomIds: Set<string> | null = null;
  let joinedRoomIdsChecked = false;
  const noJoinedRooms = new Set<string>();
  let presenceRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const roomPresenceByUserId = new Map<string, MatrixUserPresenceLike & { fetchedAt: number }>();
  const profileLookupAttemptByUserId = new Map<string, number>();
  const readOverrideByRoomId = new Map<string, string>();
  const timelineByRoomId = new Map<string, MatrixTimelineMessage[]>();
  const invalidateTimeline = (roomId?: string) => {
    if (roomId) {
      timelineByRoomId.delete(roomId);
      return;
    }
    timelineByRoomId.clear();
  };
  const refreshJoinedRoomIds = async () => {
    const refreshedRoomIds = await readServerJoinedRoomIds(
      client,
      homeserverBaseUrl,
      activeBootstrap.accessToken,
      joinedRoomIds
    );
    joinedRoomIds = refreshedRoomIds;
    joinedRoomIdsChecked = true;
    if (refreshedRoomIds) {
      for (const cachedRoomId of timelineByRoomId.keys()) {
        if (!refreshedRoomIds.has(cachedRoomId)) {
          invalidateTimeline(cachedRoomId);
        }
      }
    }
  };
  const readVisibleRooms = () =>
    readRooms(client, {
      allowedRoomIds: joinedRoomIdsChecked ? joinedRoomIds : noJoinedRooms,
      homeserverBaseUrl,
      ownUserId: activeBootstrap.userId,
      presenceByUserId: roomPresenceByUserId,
      readOverrideByRoomId
    });
  const readVisibleTimeline = (roomId: string) => {
    const room = findMatrixRoom(client, roomId);
    // A retained message can expire without a Matrix event, so those rooms are
    // intentionally read live. Normal rooms keep a stable snapshot until the
    // SDK reports a timeline/decryption/sync mutation.
    if (room && readRoomRetentionSeconds(room)) {
      return readTimeline(client, roomId, homeserverBaseUrl);
    }
    const cached = timelineByRoomId.get(roomId);
    if (cached) {
      return cached;
    }
    const timeline = readTimeline(client, roomId, homeserverBaseUrl);
    timelineByRoomId.set(roomId, timeline);
    return timeline;
  };
  const publishRooms = () => {
    callbacks.onRoomsChanged?.(readVisibleRooms());
  };
  // High-frequency Matrix events (Room.timeline, Event.decrypted, sync,
  // presence) are coalesced into a single microtask flush so that a burst of
  // events during initial sync or a busy room produces one React update and one
  // readVisibleRooms() pass instead of one per event. Imperative, user-initiated
  // operations keep calling publishRooms directly for immediate feedback.
  let notifyScheduled = false;
  let pendingRoomsNotify = false;
  let pendingTimelineNotify = false;
  let sessionDisposed = false;
  let activeVoiceCall: MatrixCallLike | null = null;
  let activeGroupVoiceCall: MatrixGroupCallLike | null = null;
  let activeGroupVoiceCallDirection: "incoming" | "outgoing" = "incoming";
  let activeGroupVoiceCallStartedAt: string | undefined;
  let activeGroupVoiceCallError: string | undefined;
  let activeVoiceCallStartedAt: string | undefined;
  let activeVoiceCallError: string | undefined;
  let activeVoiceCallClearTimer: ReturnType<typeof setTimeout> | undefined;
  let activeVoiceCallConnectingTimer: ReturnType<typeof setTimeout> | undefined;
  let activeVoiceCallConnectingCallId: string | undefined;
  const sentVoiceCallWakeKeys = new Set<string>();
  const voiceCallWakeChains = new Map<string, Promise<void>>();
  const voiceCallPreflightSettlers = new Map<string, (ready: boolean) => void>();
  const handledVoiceCallControlEvents = new Set<string>();
  const notifyVoiceCallWakeRequest = (request: MatrixVoiceCallWakeRequest): Promise<void> => {
    const onVoiceCallWake = callbacks.onVoiceCallWake;
    const { action, callId, roomId } = request;
    if (!onVoiceCallWake || !callId || !roomId) {
      return Promise.resolve();
    }
    const participantKey = [...(request.participantUserIds ?? [])].sort().join(",");
    const key = `${action}:${callId}:${participantKey}`;
    if (sentVoiceCallWakeKeys.has(key)) {
      return voiceCallWakeChains.get(callId) ?? Promise.resolve();
    }
    sentVoiceCallWakeKeys.add(key);
    const previous = voiceCallWakeChains.get(callId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => onVoiceCallWake(request))
      .catch(() => {
        sentVoiceCallWakeKeys.delete(key);
      });
    voiceCallWakeChains.set(callId, current);
    void current.finally(() => {
      if (voiceCallWakeChains.get(callId) === current) {
        voiceCallWakeChains.delete(callId);
      }
    });
    return current;
  };
  const notifyVoiceCallWake = (action: MatrixVoiceCallWakeRequest["action"], call: MatrixCallLike): Promise<void> =>
    notifyVoiceCallWakeRequest({ action, callId: call.callId ?? "", roomId: call.roomId ?? "" });
  const notifyGroupVoiceCallWake = (
    action: MatrixVoiceCallWakeRequest["action"],
    call: MatrixGroupCallLike,
    participantUserIds?: string[]
  ): Promise<void> =>
    notifyVoiceCallWakeRequest({
      action,
      callId: call.groupCallId ?? "",
      ...(participantUserIds?.length ? { participantUserIds } : {}),
      roomId: call.room?.roomId ?? ""
    });
  const handleVoiceCallSignalingEvent = (eventValue: unknown, roomValue?: unknown) => {
    const event = asEvent(eventValue);
    if (!event) {
      return;
    }
    const eventType = matrixTimelineEventType(event);
    const content = matrixTimelineEventContent(event);
    const sender = event.getSender?.();
    const roomId = event.getRoomId?.() ?? asRoom(roomValue)?.roomId;
    if (isMatrixCallEventType(eventType) && matrixTimelineWireEventType(event) !== "m.room.encrypted") {
      const callId = stringValue(content.call_id);
      if (callId) {
        tlsVoiceCallIds.add(callId);
      }
    }
    if (
      (eventType !== matrixVoiceCallPreflightEventType && eventType !== matrixVoiceCallPreflightAckEventType) ||
      !sender ||
      sender === activeBootstrap.userId
    ) {
      return;
    }
    const probeId = stringValue(content.probe_id);
    if (!probeId) {
      return;
    }
    if (eventType === matrixVoiceCallPreflightAckEventType) {
      voiceCallPreflightSettlers.get(probeId)?.(true);
      return;
    }
    if (!roomId || !client.sendEvent) {
      return;
    }
    const dedupeKey = event.getId?.() ?? `${eventType}:${sender}:${probeId}`;
    if (handledVoiceCallControlEvents.has(dedupeKey)) {
      return;
    }
    handledVoiceCallControlEvents.add(dedupeKey);
    void client
      .sendEvent(roomId, matrixVoiceCallPreflightAckEventType, {
        probe_id: probeId,
        recipient_device_id: activeBootstrap.deviceId,
        timestamp: Date.now()
      })
      .catch(() => undefined);
  };
  const verifyEncryptedVoiceCallSignaling = (roomId: string): Promise<boolean> => {
    const crypto = client.getCrypto?.();
    if (!client.sendEvent || !crypto?.forceDiscardSession) {
      return Promise.resolve(true);
    }
    const probeId = createMatrixTransactionId("cop-call-probe");
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const settle = (ready: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (voiceCallPreflightSettlers.get(probeId) === settle) {
          voiceCallPreflightSettlers.delete(probeId);
        }
        resolve(ready);
      };
      timer = setTimeout(() => settle(false), matrixVoiceCallPreflightTimeoutMs);
      voiceCallPreflightSettlers.set(probeId, settle);
      void (async () => {
        await crypto.forceDiscardSession?.(roomId);
        if (voiceCallPreflightSettlers.get(probeId) !== settle || sessionDisposed) {
          return;
        }
        await client.sendEvent?.(roomId, matrixVoiceCallPreflightEventType, {
          probe_id: probeId,
          sender_device_id: activeBootstrap.deviceId,
          timestamp: Date.now()
        });
      })().catch(() => settle(false));
    });
  };
  const flushNotifications = () => {
    notifyScheduled = false;
    if (sessionDisposed) {
      return;
    }
    if (pendingRoomsNotify) {
      pendingRoomsNotify = false;
      publishRooms();
    }
    if (pendingTimelineNotify) {
      pendingTimelineNotify = false;
      callbacks.onTimelineChanged?.();
    }
  };
  const scheduleNotify = (options: { rooms?: boolean; timeline?: boolean }) => {
    if (options.rooms) {
      pendingRoomsNotify = true;
    }
    if (options.timeline) {
      pendingTimelineNotify = true;
    }
    if (notifyScheduled || sessionDisposed) {
      return;
    }
    notifyScheduled = true;
    queueMicrotask(flushNotifications);
  };
  const refreshVisibleRoomPresence = async () => {
    const rooms = (client.getRooms?.() ?? [])
      .map(asRoom)
      .filter((room): room is MatrixRoomLike & { roomId: string } => Boolean(room?.roomId))
      .filter((room) => !joinedRoomIds || joinedRoomIds.has(room.roomId));
    const userIds = new Set<string>();
    for (const room of rooms) {
      for (const member of readRoomJoinedMembers(room)) {
        const userId = member.userId;
        if (userId && userId !== activeBootstrap.userId) {
          userIds.add(userId);
        }
      }
    }
    let hydratedFromCache = false;
    const nowMs = Date.now();
    const missingProfileUserIds: string[] = [];
    for (const userId of userIds) {
      const cachedProfile = readCachedMatrixUserProfile(userId);
      const currentProfile = roomPresenceByUserId.get(userId);
      const livePresence = client.getUser?.(userId);
      const nextProfile = {
        ...cachedProfile,
        ...currentProfile,
        ...livePresence,
        displayName: preferredMatrixDisplayName(userId, [
          livePresence?.displayName,
          currentProfile?.displayName,
          cachedProfile?.displayName
        ]),
        fetchedAt: currentProfile?.fetchedAt ?? cachedProfile?.fetchedAt ?? 0,
        userId
      };
      if (livePresence || cachedProfile) {
        if (nextProfile.fetchedAt === 0 && (nextProfile.displayName || nextProfile.avatarUrl)) {
          nextProfile.fetchedAt = nowMs;
          writeCachedMatrixUserProfile(userId, nextProfile);
        }
        roomPresenceByUserId.set(userId, nextProfile);
        hydratedFromCache = true;
      }
      if (
        ((!nextProfile.displayName && !nextProfile.avatarUrl) ||
          (Boolean(nextProfile.displayName) && isOpaqueMatrixIdentityLabel(nextProfile.displayName, userId))) &&
        nowMs - (profileLookupAttemptByUserId.get(userId) ?? 0) > matrixMissingProfileRetryMs
      ) {
        missingProfileUserIds.push(userId);
      }
    }
    if (hydratedFromCache) {
      scheduleNotify({ rooms: true });
    }
    if (missingProfileUserIds.length === 0) {
      return;
    }
    for (let index = 0; index < Math.min(missingProfileUserIds.length, 12); index += 4) {
      await Promise.all(
        missingProfileUserIds.slice(index, index + 4).map(async (userId) => {
          profileLookupAttemptByUserId.set(userId, nowMs);
          const profile = await fetchMatrixUserProfile(client, homeserverBaseUrl, activeBootstrap.accessToken, userId);
          if (!profile) {
            return;
          }
          const nextPresence = {
            ...roomPresenceByUserId.get(userId),
            ...profile,
            fetchedAt: Date.now(),
            userId
          };
          roomPresenceByUserId.set(userId, nextPresence);
          writeCachedMatrixUserProfile(userId, nextPresence);
        })
      );
    }
  };
  const schedulePresenceRefresh = (delayMs = 250) => {
    if (presenceRefreshTimer !== undefined) {
      return;
    }
    presenceRefreshTimer = setTimeout(() => {
      presenceRefreshTimer = undefined;
      void refreshVisibleRoomPresence()
        .then(publishRooms)
        .catch(() => undefined);
    }, delayMs);
  };
  const joinInvitedRooms = async () => {
    if (inviteJoinInFlight) {
      return inviteJoinInFlight;
    }
    inviteJoinInFlight = joinInvitedRoomsOnce(client, homeserverBaseUrl)
      .then(refreshJoinedRoomIds)
      .finally(() => {
        inviteJoinInFlight = null;
      });
    return inviteJoinInFlight;
  };
  const clearVoiceCallConnectingWatchdog = () => {
    if (activeVoiceCallConnectingTimer !== undefined) {
      clearTimeout(activeVoiceCallConnectingTimer);
      activeVoiceCallConnectingTimer = undefined;
    }
    activeVoiceCallConnectingCallId = undefined;
  };
  const syncVoiceCallConnectingWatchdog = (call: MatrixCallLike | null) => {
    const callId = call?.callId;
    if (!call || !callId || matrixVoiceCallPhase(call.state, activeVoiceCallError) !== "connecting") {
      clearVoiceCallConnectingWatchdog();
      return;
    }
    if (activeVoiceCallConnectingTimer !== undefined && activeVoiceCallConnectingCallId === callId) {
      return;
    }
    clearVoiceCallConnectingWatchdog();
    activeVoiceCallConnectingCallId = callId;
    activeVoiceCallConnectingTimer = setTimeout(() => {
      activeVoiceCallConnectingTimer = undefined;
      activeVoiceCallConnectingCallId = undefined;
      if (
        sessionDisposed ||
        activeVoiceCall !== call ||
        matrixVoiceCallPhase(call.state, activeVoiceCallError) !== "connecting"
      ) {
        return;
      }
      activeVoiceCallError = matrixVoiceCallIceFailureMessage;
      call.hangup?.("ice_failed", false);
      publishVoiceCall();
      clearVoiceCallSoon();
    }, matrixVoiceCallConnectingTimeoutMs);
  };
  const publishVoiceCall = () => {
    syncVoiceCallConnectingWatchdog(activeVoiceCall);
    callbacks.onVoiceCallChanged?.(
      activeGroupVoiceCall
        ? matrixGroupVoiceCallSnapshot(
            activeGroupVoiceCall,
            activeGroupVoiceCallDirection,
            activeGroupVoiceCallStartedAt,
            activeGroupVoiceCallError,
            ownMatrixUserId()
          )
        : activeVoiceCall
          ? matrixVoiceCallSnapshot(activeVoiceCall, activeVoiceCallStartedAt, activeVoiceCallError)
          : null
    );
  };
  const clearVoiceCallSoon = () => {
    if (activeVoiceCallClearTimer !== undefined) {
      clearTimeout(activeVoiceCallClearTimer);
    }
    activeVoiceCallClearTimer = setTimeout(() => {
      activeVoiceCallClearTimer = undefined;
      if (activeVoiceCall && (activeVoiceCallError || matrixVoiceCallPhase(activeVoiceCall.state) === "ended")) {
        activeVoiceCall = null;
        activeVoiceCallStartedAt = undefined;
        activeVoiceCallError = undefined;
        clearVoiceCallConnectingWatchdog();
        publishVoiceCall();
      }
    }, 1_800);
  };
  const bindVoiceCall = (call: MatrixCallLike): MatrixCallLike => {
    const stateListener = (state: unknown) => {
      const phase = matrixVoiceCallPhase(typeof state === "string" ? state : call.state);
      if (phase === "connected" && !activeVoiceCallStartedAt) {
        activeVoiceCallStartedAt = new Date().toISOString();
      }
      if (phase === "ended") {
        void notifyVoiceCallWake("ended", call);
        clearVoiceCallSoon();
      }
      publishVoiceCall();
    };
    const feedsListener = () => publishVoiceCall();
    const hangupListener = () => {
      if (activeVoiceCall === call) {
        publishVoiceCall();
        clearVoiceCallSoon();
      }
    };
    const errorListener = (error: unknown) => {
      if (activeVoiceCall === call) {
        activeVoiceCallError = matrixVoiceCallErrorMessage(error);
        publishVoiceCall();
        clearVoiceCallSoon();
      }
    };
    call.on?.("state", stateListener);
    call.on?.("feeds_changed", feedsListener);
    call.on?.("hangup", hangupListener);
    call.on?.("error", errorListener);
    return call;
  };
  const clearGroupVoiceCall = () => {
    activeGroupVoiceCall = null;
    activeGroupVoiceCallStartedAt = undefined;
    activeGroupVoiceCallError = undefined;
    publishVoiceCall();
  };
  const bindGroupVoiceCall = (call: MatrixGroupCallLike, direction: "incoming" | "outgoing"): MatrixGroupCallLike => {
    activeGroupVoiceCallDirection = direction;
    const stateListener = (state: unknown) => {
      const currentState = typeof state === "string" ? state : call.state;
      if (currentState === "entered" && !activeGroupVoiceCallStartedAt) {
        activeGroupVoiceCallStartedAt = new Date().toISOString();
      }
      if (currentState === "ended") {
        clearGroupVoiceCall();
        return;
      }
      publishVoiceCall();
    };
    const updateListener = () => publishVoiceCall();
    const errorListener = (error: unknown) => {
      if (activeGroupVoiceCall === call) {
        activeGroupVoiceCallError = matrixVoiceCallErrorMessage(error);
        publishVoiceCall();
      }
    };
    call.on?.("group_call_state_changed", stateListener);
    call.on?.("participants_changed", updateListener);
    call.on?.("user_media_feeds_changed", updateListener);
    call.on?.("local_mute_state_changed", updateListener);
    call.on?.("group_call_error", errorListener);
    return call;
  };
  const incomingCallListener = (call: unknown) => {
    const nextCall = asMatrixCallLike(call);
    if (!nextCall?.callId || !nextCall.roomId) {
      return;
    }
    if (
      activeVoiceCall &&
      activeVoiceCall.callId !== nextCall.callId &&
      matrixVoiceCallPhase(activeVoiceCall.state) !== "ended"
    ) {
      nextCall.reject?.();
      return;
    }
    activeVoiceCall = bindVoiceCall(nextCall);
    activeVoiceCallStartedAt = undefined;
    activeVoiceCallError = undefined;
    publishVoiceCall();
  };
  const incomingGroupCallListener = (callValue: unknown) => {
    const call = asMatrixGroupCallLike(callValue);
    if (!call?.groupCallId || !call.room?.roomId) {
      return;
    }
    if (
      (activeVoiceCall && matrixVoiceCallPhase(activeVoiceCall.state) !== "ended") ||
      (activeGroupVoiceCall && activeGroupVoiceCall.groupCallId !== call.groupCallId)
    ) {
      return;
    }
    activeVoiceCall = null;
    activeGroupVoiceCall = bindGroupVoiceCall(call, "incoming");
    activeGroupVoiceCallStartedAt = undefined;
    activeGroupVoiceCallError = undefined;
    publishVoiceCall();
  };
  const endedGroupCallListener = (callValue: unknown) => {
    const call = asMatrixGroupCallLike(callValue);
    if (call?.groupCallId && call.groupCallId === activeGroupVoiceCall?.groupCallId) {
      clearGroupVoiceCall();
    }
  };

  const syncListener = (state: unknown) => {
    invalidateTimeline();
    callbacks.onSyncState?.(typeof state === "string" ? state : "sync");
    void refreshJoinedRoomIds().finally(() => scheduleNotify({ rooms: true, timeline: true }));
    schedulePresenceRefresh();
  };
  const timelineListener = (eventValue?: unknown, roomValue?: unknown) => {
    invalidateTimeline(asEvent(eventValue)?.getRoomId?.() ?? asRoom(roomValue)?.roomId ?? undefined);
    handleVoiceCallSignalingEvent(eventValue, roomValue);
    scheduleNotify({ rooms: true, timeline: true });
  };
  const receivedVoipEventListener = (eventValue?: unknown) => {
    handleVoiceCallSignalingEvent(eventValue);
  };
  const presenceListener = () => {
    scheduleNotify({ rooms: true });
    schedulePresenceRefresh(750);
  };
  const membershipListener = () => {
    invalidateTimeline();
    presenceListener();
    void joinInvitedRooms()
      .then(refreshJoinedRoomIds)
      .finally(() => scheduleNotify({ rooms: true, timeline: true }));
  };
  client.on?.("sync", syncListener);
  client.on?.("Room.timeline", timelineListener);
  client.on?.("Event.decrypted", timelineListener);
  client.on?.("received_voip_event", receivedVoipEventListener);
  client.on?.("User.presence", presenceListener);
  client.on?.("RoomMember.membership", membershipListener);
  client.on?.("Call.incoming", incomingCallListener);
  client.on?.("GroupCall.incoming", incomingGroupCallListener);
  client.on?.("GroupCall.ended", endedGroupCallListener);
  publishRooms();
  await client.startClient?.({ initialSyncLimit: 20, lazyLoadMembers: true });
  void syncMatrixUserProfile(client, activeBootstrap, callbacks.profile).catch(() => undefined);
  void syncMatrixWebPushPusher(client, homeserverBaseUrl, callbacks.webPush).catch(() => undefined);
  void client.setPresence?.({ presence: "online" }).catch(() => undefined);
  await joinInvitedRooms();
  await refreshJoinedRoomIds();
  publishRooms();
  schedulePresenceRefresh(0);
  if (restoreKeyBackupOnStart) {
    restoreUserKeyBackupInBackground(client.getCrypto?.(), () => scheduleNotify({ rooms: true, timeline: true }));
  }
  const exhaustedTimelineRooms = new Set<string>();
  let sessionApi: MatrixMessagingSession;

  sessionApi = {
    bootstrap: activeBootstrap,
    answerVoiceCall: async (callId) => {
      if (activeGroupVoiceCall?.groupCallId === callId) {
        assertBrowserCanUseVoiceCalls();
        try {
          await primeMicrophoneForWebKit();
          await activeGroupVoiceCall.enter?.();
          activeGroupVoiceCallStartedAt = new Date().toISOString();
          publishVoiceCall();
          return;
        } catch (caught) {
          activeGroupVoiceCallError = matrixVoiceCallErrorMessage(caught);
          publishVoiceCall();
          throw formatMatrixClientError(caught, homeserverBaseUrl, "přijmout skupinový hovor");
        }
      }
      const call = requireActiveVoiceCall(activeVoiceCall, callId);
      if (typeof call.answer !== "function") {
        throw new Error("Příchozí hovor se nepodařilo přijmout.");
      }
      assertBrowserCanUseVoiceCalls();
      try {
        await primeMicrophoneForWebKit();
        if (!tlsVoiceCallIds.has(callId)) {
          if (!call.roomId) {
            throw new Error("Příchozí hovor nemá platnou místnost.");
          }
          const encryptedSignalingReady = await verifyEncryptedVoiceCallSignaling(call.roomId);
          if (!encryptedSignalingReady) {
            tlsVoiceCallIds.add(callId);
          }
        }
        await call.answer(true, false);
        activeVoiceCall = call;
        publishVoiceCall();
      } catch (caught) {
        activeVoiceCallError = matrixVoiceCallErrorMessage(caught);
        publishVoiceCall();
        throw formatMatrixClientError(caught, homeserverBaseUrl, "přijmout hovor");
      }
    },
    createEncryptionRecovery: async (reset = false) => {
      const recoveryKey = await runWithMatrixSyncPausedForRecovery(
        client,
        async () =>
          createUserControlledEncryptionRecovery(
            client,
            recoveryController,
            // Every newly issued COP recovery key is promised to work on both the
            // web client and the Matrix Rust SDK used by iOS.  In particular, do
            // not let the initial-setup path read legacy cross-signing account-data
            // records: an interrupted reset intentionally leaves those records as
            // empty objects, which ServerSideSecretStorage rejects as unencrypted.
            { mobileCompatible: true, reset },
            Boolean(callbacks.completeDeviceSigningAuth)
          )
      );
      await writeStoredMatrixRecoveryKey(activeBootstrap, recoveryKey);
      return recoveryKey;
    },
    createGroupRoom: async (name, inviteUserIds = []) => {
      if (typeof client.createRoom !== "function") {
        throw new Error("Chat se nepodařilo založit.");
      }
      let response: { room_id?: string; roomId?: string };
      try {
        response = await client.createRoom({
          invite: inviteUserIds,
          initial_state: activeBootstrap.e2eeRequired
            ? [
                {
                  content: {
                    algorithm: "m.megolm.v1.aes-sha2"
                  },
                  state_key: "",
                  type: "m.room.encryption"
                }
              ]
            : [],
          name,
          preset: inviteUserIds.length > 0 ? "private_chat" : "trusted_private_chat",
          visibility: "private"
        });
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "založit chatovou místnost");
      }
      const roomId = response.room_id ?? response.roomId;
      if (!roomId) {
        throw new Error("Služba zpráv nevrátila identifikátor konverzace.");
      }
      joinedRoomIds?.add(roomId);
      publishRooms();
      return roomId;
    },
    deleteMessage: async (roomId, eventId) => {
      if (typeof client.redactEvent !== "function") {
        throw new Error("Smazání zprávy služba zpráv nepodporuje.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        await client.redactEvent(roomId, eventId, undefined, { reason: "Odstraněno uživatelem" });
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "smazat zprávu");
      }
    },
    downloadAttachment: async (message) => {
      if (!message.attachment) {
        throw new Error("Zpráva neobsahuje přílohu ke stažení.");
      }
      return downloadMatrixAttachment(client, activeBootstrap, homeserverBaseUrl, message.attachment);
    },
    getEncryptionRecoveryStatus: async () => readMatrixEncryptionRecoveryStatus(client),
    getRooms: readVisibleRooms,
    getTimeline: readVisibleTimeline,
    getVoiceCall: () =>
      activeGroupVoiceCall
        ? matrixGroupVoiceCallSnapshot(
            activeGroupVoiceCall,
            activeGroupVoiceCallDirection,
            activeGroupVoiceCallStartedAt,
            activeGroupVoiceCallError,
            ownMatrixUserId()
          )
        : activeVoiceCall
          ? matrixVoiceCallSnapshot(activeVoiceCall, activeVoiceCallStartedAt, activeVoiceCallError)
          : null,
    hangupVoiceCall: async (callId) => {
      if (activeGroupVoiceCall?.groupCallId === callId) {
        const call = activeGroupVoiceCall;
        const participantCount = matrixGroupVoiceCallParticipants(call, ownMatrixUserId()).filter(
          (participant) => participant.connected
        ).length;
        if (participantCount <= 1 && typeof call.terminate === "function") {
          await call.terminate(true);
          void notifyGroupVoiceCallWake("ended", call);
        } else {
          call.leave?.();
        }
        clearGroupVoiceCall();
        return;
      }
      const call = requireActiveVoiceCall(activeVoiceCall, callId);
      call.hangup?.("user_hangup", false);
      void notifyVoiceCallWake("ended", call);
      publishVoiceCall();
      clearVoiceCallSoon();
    },
    inviteUsersToRoom: async (roomId, userIds) => {
      if (userIds.length === 0) {
        return;
      }
      if (typeof client.invite !== "function") {
        throw new Error("Člena se nepodařilo pozvat do chatové místnosti.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        for (const userId of [...new Set(userIds)]) {
          await client.invite(roomId, userId);
        }
        publishRooms();
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "pozvat člena do chatové místnosti");
      }
    },
    inviteVoiceCallParticipants: async (callId, participantUserIds) => {
      const call = requireActiveGroupVoiceCall(activeGroupVoiceCall, callId);
      const participants = matrixGroupVoiceCallParticipants(call, ownMatrixUserId());
      const connectedUserIds = new Set(
        participants.filter((participant) => participant.connected).map((participant) => participant.userId)
      );
      const eligibleUserIds = new Set(
        participants
          .filter((participant) => participant.userId !== ownMatrixUserId())
          .map((participant) => participant.userId)
      );
      const selected = [...new Set(participantUserIds)]
        .filter((userId) => eligibleUserIds.has(userId) && !connectedUserIds.has(userId))
        .slice(0, Math.max(0, matrixGroupVoiceCallParticipantLimit - connectedUserIds.size));
      if (selected.length === 0) {
        throw new Error("Vybraní členové už v hovoru jsou nebo je nelze pozvat.");
      }
      await notifyGroupVoiceCallWake("invite", call, selected);
    },
    joinInvitedRooms,
    leaveRoom: async (roomId) => {
      if (typeof client.leave !== "function") {
        throw new Error("Opuštění skupiny služba zpráv nepodporuje.");
      }
      try {
        await client.leave(roomId);
        joinedRoomIds?.delete(roomId);
        invalidateTimeline(roomId);
        publishRooms();
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "opustit skupinu");
      }
    },
    loadMoreTimeline: async (roomId, limit = 80) => {
      if (exhaustedTimelineRooms.has(roomId)) {
        return {
          exhausted: true,
          messages: readVisibleTimeline(roomId)
        };
      }
      if (typeof client.scrollback !== "function") {
        exhaustedTimelineRooms.add(roomId);
        return {
          exhausted: true,
          messages: readVisibleTimeline(roomId)
        };
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        const room = findMatrixRoom(client, roomId);
        if (!room) {
          return { exhausted: false, messages: [] };
        }
        await client.scrollback(room, Math.max(1, Math.min(250, Math.trunc(limit))));
        invalidateTimeline(roomId);
        const nextRoom = findMatrixRoom(client, roomId) ?? room;
        const exhausted = nextRoom.oldState?.paginationToken === null;
        if (exhausted) {
          exhaustedTimelineRooms.add(roomId);
        }
        return {
          exhausted,
          messages: readVisibleTimeline(roomId)
        };
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "načíst starší zprávy");
      }
    },
    markRoomRead: async (roomId) => {
      if (typeof client.sendReadReceipt !== "function" && typeof client.setRoomReadMarkers !== "function") {
        return;
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        const room = findMatrixRoom(client, roomId);
        const latestEvent = latestReadableMessageEvent(room);
        const latestEventId = latestEvent?.getId?.();
        if (!latestEvent || !latestEventId) {
          return;
        }
        const operations: Array<Promise<unknown>> = [];
        if (typeof client.sendReadReceipt === "function") {
          operations.push(client.sendReadReceipt(latestEvent));
        }
        if (typeof client.setRoomReadMarkers === "function") {
          operations.push(client.setRoomReadMarkers(roomId, latestEventId, latestEvent));
        }
        const results = await Promise.allSettled(operations);
        if (results.some((result) => result.status === "fulfilled")) {
          readOverrideByRoomId.set(roomId, latestEventId);
        }
        publishRooms();
      } catch {
        // Read receipts are a best-effort UX signal. Message delivery must not fail because of them.
      }
    },
    prepareEncryptionRecoveryForMobile: async () => {
      const recoveryKey = await runWithMatrixSyncPausedForRecovery(
        client,
        async () =>
          createUserControlledEncryptionRecovery(
            client,
            recoveryController,
            {
              mobileCompatible: true,
              reset: true
            },
            Boolean(callbacks.completeDeviceSigningAuth)
          )
      );
      await writeStoredMatrixRecoveryKey(activeBootstrap, recoveryKey);
      return recoveryKey;
    },
    refreshBootstrap: (nextBootstrap) => {
      if (!client.setAccessToken || !canRefreshMatrixBootstrap(activeBootstrap, nextBootstrap)) {
        return false;
      }
      client.setAccessToken(nextBootstrap.accessToken as string);
      activeBootstrap = { ...nextBootstrap };
      sessionApi.bootstrap = activeBootstrap;
      return true;
    },
    rejectVoiceCall: async (callId) => {
      if (activeGroupVoiceCall?.groupCallId === callId) {
        activeGroupVoiceCall.leave?.();
        clearGroupVoiceCall();
        return;
      }
      const call = requireActiveVoiceCall(activeVoiceCall, callId);
      if (typeof call.reject === "function" && matrixVoiceCallPhase(call.state) === "ringing") {
        call.reject();
      } else {
        call.hangup?.("user_hangup", false);
      }
      void notifyVoiceCallWake("ended", call);
      publishVoiceCall();
      clearVoiceCallSoon();
    },
    restoreEncryptionRecovery: async (recoveryKey) => {
      await restoreUserControlledEncryptionRecovery(client, recoveryController, recoveryKey);
      await writeStoredMatrixRecoveryKey(activeBootstrap, recoveryKey);
      invalidateTimeline();
      scheduleNotify({ rooms: true, timeline: true });
    },
    setMessageRetentionPolicy: async (roomId, seconds) => {
      if (typeof client.sendStateEvent !== "function") {
        throw new Error("Nastavení automatického mazání služba zpráv nepodporuje.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        await client.sendStateEvent(
          roomId,
          "m.room.retention",
          seconds && seconds > 0 ? { max_lifetime: seconds * 1000 } : {},
          ""
        );
        invalidateTimeline(roomId);
        publishRooms();
      } catch (caught) {
        if (isLikelyMatrixForbiddenError(caught)) {
          throw new Error("Automatické mazání zpráv může v této místnosti změnit jen správce chatu.");
        }
        throw formatMatrixClientError(caught, homeserverBaseUrl, "nastavit automatické mazání zpráv");
      }
    },
    setVoiceCallMuted: async (callId, muted) => {
      if (activeGroupVoiceCall?.groupCallId === callId) {
        if (typeof activeGroupVoiceCall.setMicrophoneMuted !== "function") {
          throw new Error("Ztlumení mikrofonu tento prohlížeč nepodporuje.");
        }
        const nextMuted = await activeGroupVoiceCall.setMicrophoneMuted(muted);
        publishVoiceCall();
        return nextMuted;
      }
      const call = requireActiveVoiceCall(activeVoiceCall, callId);
      if (typeof call.setMicrophoneMuted !== "function") {
        throw new Error("Ztlumení mikrofonu tento prohlížeč nepodporuje.");
      }
      const nextMuted = await call.setMicrophoneMuted(muted);
      publishVoiceCall();
      return nextMuted;
    },
    sendAttachment: async (roomId, attachment) => {
      if (typeof client.uploadContent !== "function" || typeof client.sendMessage !== "function") {
        throw new Error("Přílohu se nepodařilo bezpečně odeslat.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        const content = await createEncryptedAttachmentMessage(client, attachment);
        await client.sendMessage(roomId, content);
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "odeslat šifrovanou přílohu");
      }
    },
    sendLocation: async (roomId, location) => {
      if (typeof client.sendMessage !== "function") {
        throw new Error("Polohu se nepodařilo odeslat.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        await client.sendMessage(roomId, createLocationMessage(location));
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "odeslat polohu");
      }
    },
    sendTransitShare: async (roomId, transit) => {
      if (typeof client.sendMessage !== "function") {
        throw new Error("Spoj se nepodařilo odeslat.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        await client.sendMessage(roomId, createTransitShareMessage(transit));
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "odeslat informaci o spoji");
      }
    },
    sendMessage: async (roomId, body, options) => {
      const message = body.trim();
      if (!message) {
        return;
      }
      const cop = sanitizeCopMessageMetadata(options?.cop);
      if ((options?.replyTo || cop) && typeof client.sendMessage !== "function") {
        throw new Error(
          options?.replyTo ? "Odpověď se nepodařilo odeslat." : "Zprávu s COP metadaty se nepodařilo odeslat."
        );
      }
      if (!options?.replyTo && !cop && typeof client.sendTextMessage !== "function") {
        throw new Error("Zprávu se nepodařilo odeslat.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        if (options?.replyTo) {
          await client.sendMessage?.(roomId, createTextMessageContent(message, { cop, replyTo: options.replyTo }));
        } else if (cop) {
          await client.sendMessage?.(roomId, createTextMessageContent(message, { cop }));
        } else {
          await client.sendTextMessage?.(roomId, message);
        }
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "odeslat zprávu");
      }
    },
    sendReaction: async (roomId, eventId, key) => {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return;
      }
      if (typeof client.sendEvent !== "function") {
        throw new Error("Reakci se nepodařilo odeslat.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        await client.sendEvent(roomId, "m.reaction", {
          "m.relates_to": {
            event_id: eventId,
            key: normalizedKey,
            rel_type: "m.annotation"
          }
        });
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "odeslat reakci");
      }
    },
    startVoiceCall: async (roomId, options) => {
      assertBrowserCanUseVoiceCalls();
      if (!options?.group && !typedMatrixSdk.createNewMatrixCall) {
        throw new Error("Hlasové hovory nejsou v této verzi chatu dostupné.");
      }
      if ((activeVoiceCall && matrixVoiceCallPhase(activeVoiceCall.state) !== "ended") || activeGroupVoiceCall) {
        throw new Error("Nejdřív ukončete aktuální hovor.");
      }
      try {
        await primeMicrophoneForWebKit();
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        if (options?.group) {
          if (
            typeof client.waitUntilRoomReadyForGroupCalls !== "function" ||
            typeof client.getGroupCallForRoom !== "function" ||
            typeof client.createGroupCall !== "function"
          ) {
            throw new Error("Skupinové hovory nejsou v této verzi chatu dostupné.");
          }
          await client.waitUntilRoomReadyForGroupCalls(roomId);
          let groupCall = client.getGroupCallForRoom(roomId);
          if (!groupCall) {
            groupCall = await client.createGroupCall(roomId, "m.voice", false, "m.ring");
          }
          if (!groupCall.groupCallId || !groupCall.room?.roomId || typeof groupCall.enter !== "function") {
            throw new Error("Skupinový hovor se nepodařilo připravit.");
          }
          activeVoiceCall = null;
          activeGroupVoiceCall = bindGroupVoiceCall(groupCall, "outgoing");
          activeGroupVoiceCallStartedAt = undefined;
          activeGroupVoiceCallError = undefined;
          publishVoiceCall();
          await groupCall.enter();
          activeGroupVoiceCallStartedAt = new Date().toISOString();
          await notifyGroupVoiceCallWake("invite", groupCall);
          publishVoiceCall();
          return;
        }
        const call = typedMatrixSdk.createNewMatrixCall!(client, roomId);
        if (!call?.callId || typeof call.placeVoiceCall !== "function") {
          throw new Error("Hlasový hovor se nepodařilo připravit.");
        }
        activeVoiceCall = bindVoiceCall(call);
        activeVoiceCallStartedAt = undefined;
        activeVoiceCallError = undefined;
        publishVoiceCall();
        const encryptedSignalingReady = await verifyEncryptedVoiceCallSignaling(roomId);
        if (!encryptedSignalingReady) {
          tlsVoiceCallIds.add(call.callId);
        }
        await call.placeVoiceCall();
        void notifyVoiceCallWake("invite", call);
        publishVoiceCall();
      } catch (caught) {
        if (activeGroupVoiceCall) {
          activeGroupVoiceCallError = matrixVoiceCallErrorMessage(caught);
        } else {
          activeVoiceCallError = matrixVoiceCallErrorMessage(caught);
        }
        publishVoiceCall();
        throw formatMatrixClientError(caught, homeserverBaseUrl, "zahájit hovor");
      }
    },
    setReaction: async (roomId, eventId, key) => {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return;
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        const existingReactions = findOwnReactionEvents(client, roomId, eventId);
        const removingExistingReaction = existingReactions.some((reaction) => reaction.key === normalizedKey);
        if (existingReactions.length > 0) {
          if (typeof client.redactEvent !== "function") {
            throw new Error("Reakci se nepodařilo změnit.");
          }
          await Promise.all(
            existingReactions.map((reaction) =>
              client.redactEvent?.(roomId, reaction.eventId, undefined, {
                reason: removingExistingReaction ? "Reakce odstraněna uživatelem" : "Reakce změněna uživatelem"
              })
            )
          );
          if (removingExistingReaction) {
            return;
          }
        }
        if (typeof client.sendEvent !== "function") {
          throw new Error("Reakci se nepodařilo odeslat.");
        }
        await client.sendEvent(roomId, "m.reaction", {
          "m.relates_to": {
            event_id: eventId,
            key: normalizedKey,
            rel_type: "m.annotation"
          }
        });
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "změnit reakci");
      }
    },
    syncWebPushPusher: async (options) => syncMatrixWebPushPusher(client, homeserverBaseUrl, options),
    syncUserProfile: async (profile) => syncMatrixUserProfile(client, activeBootstrap, profile),
    stop: () => {
      if (sessionDisposed) {
        return;
      }
      sessionDisposed = true;
      invalidateTimeline();
      if (presenceRefreshTimer !== undefined) {
        clearTimeout(presenceRefreshTimer);
      }
      void client.setPresence?.({ presence: "offline" }).catch(() => undefined);
      client.off?.("sync", syncListener);
      client.off?.("Room.timeline", timelineListener);
      client.off?.("Event.decrypted", timelineListener);
      client.off?.("received_voip_event", receivedVoipEventListener);
      client.off?.("User.presence", presenceListener);
      client.off?.("RoomMember.membership", membershipListener);
      client.off?.("Call.incoming", incomingCallListener);
      client.off?.("GroupCall.incoming", incomingGroupCallListener);
      client.off?.("GroupCall.ended", endedGroupCallListener);
      if (activeVoiceCallClearTimer !== undefined) {
        clearTimeout(activeVoiceCallClearTimer);
      }
      clearVoiceCallConnectingWatchdog();
      for (const settle of Array.from(voiceCallPreflightSettlers.values())) {
        settle(false);
      }
      if (activeGroupVoiceCall) {
        activeGroupVoiceCall.leave?.();
      }
      activeGroupVoiceCall = null;
      if (activeVoiceCall) {
        if (activeVoiceCall.callId) {
          tlsVoiceCallIds.add(activeVoiceCall.callId);
        }
        void notifyVoiceCallWake("ended", activeVoiceCall);
        activeVoiceCall.hangup?.("user_hangup", false);
      }
      activeVoiceCall = null;
      callbacks.onVoiceCallChanged?.(null);
      client.stopClient?.();
      if (syncStore) {
        void (syncStore.save?.(true) ?? Promise.resolve())
          .catch(() => undefined)
          .finally(() => syncStore.destroy?.().catch(() => undefined));
      }
    }
  };
  return sessionApi;
}

async function runWithMatrixSyncPausedForRecovery<T>(
  client: MatrixClientLike,
  action: () => Promise<T>
): Promise<T> {
  const syncApi = client.syncApi;
  if (!syncApi) {
    return action();
  }

  // Password UIA can take several seconds. During that window the server still
  // advertises the previous public cross-signing identity. If an ordinary
  // /sync response imports it after Rust generated the replacement identity,
  // Rust correctly discards the new private keys as mismatched. Pause only the
  // sync loop (not the crypto backend) until the replacement identity and 4S
  // records have been published and verified.
  syncApi.stop();
  await Promise.resolve();
  try {
    return await action();
  } finally {
    void syncApi.sync().catch(() => undefined);
  }
}

function asMatrixCallLike(value: unknown): MatrixCallLike | null {
  return typeof value === "object" && value !== null ? (value as MatrixCallLike) : null;
}

function asMatrixGroupCallLike(value: unknown): MatrixGroupCallLike | null {
  return typeof value === "object" && value !== null ? (value as MatrixGroupCallLike) : null;
}

function assertBrowserCanUseVoiceCalls(): void {
  const globalScope = globalThis as typeof globalThis & { RTCPeerConnection?: typeof RTCPeerConnection };
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const win = typeof window !== "undefined" ? window : undefined;
  const peerConnection = win?.RTCPeerConnection ?? globalScope.RTCPeerConnection;
  if (!peerConnection || !nav?.mediaDevices?.getUserMedia) {
    throw new Error("Tento prohlížeč nepodporuje hlasové hovory.");
  }
}

async function primeMicrophoneForWebKit(): Promise<void> {
  const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!mediaDevices?.getUserMedia) return;
  const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
  stream?.getTracks?.().forEach((track) => track.stop());
}

function requireActiveVoiceCall(call: MatrixCallLike | null, callId: string): MatrixCallLike {
  if (!call || call.callId !== callId) {
    throw new Error("Aktuální hovor už není dostupný.");
  }
  return call;
}

function requireActiveGroupVoiceCall(call: MatrixGroupCallLike | null, callId: string): MatrixGroupCallLike {
  if (!call || call.groupCallId !== callId) {
    throw new Error("Aktuální skupinový hovor už není dostupný.");
  }
  return call;
}

function matrixVoiceCallSnapshot(
  call: MatrixCallLike,
  startedAt: string | undefined,
  error: string | undefined
): MatrixVoiceCallSnapshot {
  const phase = matrixVoiceCallPhase(call.state, error);
  return {
    callId: call.callId ?? "unknown",
    direction: call.direction === "inbound" ? "incoming" : "outgoing",
    ...(error ? { error } : {}),
    kind: "direct",
    ...(call.localUsermediaStream ? { localStream: call.localUsermediaStream } : {}),
    microphoneMuted: Boolean(call.isMicrophoneMuted?.()),
    ...(call.getOpponentMember?.()?.userId ? { opponentUserId: call.getOpponentMember?.()?.userId } : {}),
    participants: call.getOpponentMember?.()?.userId
      ? [
          {
            connected: phase === "connected",
            displayName: call.getOpponentMember?.()?.userId ?? "Účastník",
            userId: call.getOpponentMember?.()?.userId ?? "unknown"
          }
        ]
      : [],
    phase,
    ...(call.remoteUsermediaStream ? { remoteStream: call.remoteUsermediaStream } : {}),
    roomId: call.roomId ?? "",
    ...(startedAt ? { startedAt } : {})
  };
}

function matrixGroupVoiceCallSnapshot(
  call: MatrixGroupCallLike,
  direction: "incoming" | "outgoing",
  startedAt: string | undefined,
  error: string | undefined,
  ownUserId: string
): MatrixVoiceCallSnapshot {
  const participants = matrixGroupVoiceCallParticipants(call, ownUserId);
  const remoteStreams = (call.userMediaFeeds ?? [])
    .filter((feed) => feed.userId !== ownUserId && feed.stream)
    .map((feed) => feed.stream as MediaStream);
  const phase = matrixGroupVoiceCallPhase(call.state, direction, error);
  return {
    callId: call.groupCallId ?? "unknown",
    direction,
    eligibleParticipants: participants.filter(
      (participant) => participant.userId !== ownUserId && !participant.connected
    ),
    ...(error ? { error } : {}),
    kind: "group",
    ...(call.localCallFeed?.stream ? { localStream: call.localCallFeed.stream } : {}),
    microphoneMuted: Boolean(call.isMicrophoneMuted?.()),
    participants,
    phase,
    ...(remoteStreams[0] ? { remoteStream: remoteStreams[0] } : {}),
    remoteStreams,
    roomId: call.room?.roomId ?? "",
    ...(startedAt ? { startedAt } : {})
  };
}

function matrixGroupVoiceCallParticipants(
  call: MatrixGroupCallLike,
  ownUserId: string
): MatrixVoiceCallSnapshot["participants"] {
  const connectedUserIds = new Set<string>();
  for (const [member, devices] of call.participants ?? []) {
    if (member.userId && devices.size > 0) {
      connectedUserIds.add(member.userId);
    }
  }
  const roomMembers = call.room ? readRoomJoinedMembers(call.room) : [];
  const byUserId = new Map(roomMembers.flatMap((member) => (member.userId ? [[member.userId, member] as const] : [])));
  if (ownUserId && !byUserId.has(ownUserId)) {
    byUserId.set(ownUserId, { displayName: "Vy", userId: ownUserId });
  }
  return [...byUserId.values()]
    .flatMap((member) => {
      const userId = member.userId;
      if (!userId) return [];
      return [
        {
          ...(member.avatarUrl ? { avatarUrl: member.avatarUrl } : {}),
          connected: connectedUserIds.has(userId) || (userId === ownUserId && call.state === "entered"),
          displayName: member.displayName ?? member.rawDisplayName ?? member.name ?? userId,
          userId
        }
      ];
    })
    .sort(
      (left, right) =>
        Number(right.connected) - Number(left.connected) || left.displayName.localeCompare(right.displayName, "cs-CZ")
    );
}

function matrixGroupVoiceCallPhase(
  state: string | undefined,
  direction: "incoming" | "outgoing",
  error?: string
): MatrixVoiceCallPhase {
  if (error) return "failed";
  if (state === "ended") return "ended";
  if (state === "entered") return "connected";
  return direction === "incoming" ? "ringing" : "connecting";
}

function matrixVoiceCallPhase(state: string | undefined, error?: string): MatrixVoiceCallPhase {
  if (error) {
    return "failed";
  }
  if (state === "ringing") {
    return "ringing";
  }
  if (state === "connected") {
    return "connected";
  }
  if (state === "ended") {
    return "ended";
  }
  return "connecting";
}

function matrixVoiceCallErrorMessage(error: unknown): string {
  const record = asRecord(error);
  if (record) {
    const code = stringValue(record.code);
    if (code === "no_user_media") {
      const nested = asRecord(record.err);
      const nestedName = nested ? stringValue(nested.name) : undefined;
      const nestedMessage = nested ? stringValue(nested.message) : undefined;
      const detail = [nestedName, nestedMessage].filter(Boolean).join(": ");
      return detail
        ? `Mikrofon není dostupný nebo nemá povolený přístup. (${detail})`
        : "Mikrofon není dostupný nebo nemá povolený přístup.";
    }
    if (code === "ice_failed") {
      return matrixVoiceCallIceFailureMessage;
    }
  }
  return errorMessage(error);
}

function disableMatrixPollAggregation(matrixSdk: MatrixSdkLike): void {
  const roomPrototype = matrixSdk.Room?.prototype;
  if (!roomPrototype || roomPrototype.__copChatPollAggregationDisabled) {
    return;
  }
  if (typeof roomPrototype.processPollEvents !== "function") {
    return;
  }

  // COP Chat does not expose Matrix polls. matrix-js-sdk 41.6.0 can emit
  // unhandled poll-processing rejections for older encrypted events with no
  // usable type, which pollutes the UI runtime without affecting chat messages.
  roomPrototype.processPollEvents = () => Promise.resolve();
  roomPrototype.__copChatPollAggregationDisabled = true;
}

function createUserControlledRecoveryController(initialRecoveryKey?: string): MatrixRecoveryController {
  const keyCache = new Map<string, Uint8Array>();
  let generatedSecretStorageKey: Uint8Array | null = null;
  let recoveryKey: string | null = initialRecoveryKey?.trim() || null;
  return {
    cryptoCallbacks: {
      cacheSecretStorageKey: (keyId: string, _keyInfo: unknown, key: Uint8Array) => {
        keyCache.set(keyId, key);
        generatedSecretStorageKey = null;
      },
      getSecretStorageKey: async (options: { keys: Record<string, unknown> }) => {
        for (const keyId of Object.keys(options.keys)) {
          const cachedKey = keyCache.get(keyId);
          if (cachedKey) {
            return [keyId, cachedKey];
          }
        }
        const keyId = Object.keys(options.keys)[0];
        if (!keyId) {
          return null;
        }
        if (generatedSecretStorageKey) {
          return [keyId, generatedSecretStorageKey];
        }
        if (!recoveryKey) {
          return null;
        }
        const decodedKey = await decodeUserRecoveryKey(recoveryKey);
        return [keyId, decodedKey];
      }
    },
    setGeneratedSecretStorageKey(generatedKey: unknown) {
      const encodedRecoveryKey = readEncodedRecoveryKey(generatedKey);
      if (encodedRecoveryKey) {
        recoveryKey = encodedRecoveryKey.trim();
      }
      generatedSecretStorageKey = readSecretStoragePrivateKey(generatedKey);
    },
    setRecoveryKey(nextRecoveryKey: string) {
      recoveryKey = nextRecoveryKey.trim();
      generatedSecretStorageKey = null;
    }
  };
}

async function decodeUserRecoveryKey(recoveryKey: string): Promise<Uint8Array> {
  const { decodeRecoveryKey } = (await import("matrix-js-sdk/lib/crypto-api/recovery-key.js")) as {
    decodeRecoveryKey: (recoveryKey: string) => Uint8Array;
  };
  try {
    return decodeRecoveryKey(recoveryKey.trim());
  } catch {
    throw new Error("Obnovovací klíč nemá platný formát.");
  }
}

async function enableKnownMatrixKeyBackup(client: MatrixClientLike): Promise<boolean> {
  const crypto = client.getCrypto?.();
  if (!crypto) {
    return false;
  }
  const backupKeyLoaded = await loadUserSessionBackupKey(crypto);
  await crypto.checkKeyBackupAndEnable?.();
  return backupKeyLoaded && (await hasActiveUserBackup(crypto));
}

async function syncMatrixUserProfile(
  client: MatrixClientLike,
  bootstrap: MessagingBootstrapResponse,
  profile: MatrixUserProfileSyncInput | undefined
): Promise<void> {
  const displayName = profile?.displayName?.trim();
  const avatarSourceUrl = profile?.avatarUrl?.trim();
  const currentProfile =
    bootstrap.userId && (displayName || avatarSourceUrl) && client.getProfileInfo
      ? await client.getProfileInfo(bootstrap.userId).catch(() => undefined)
      : undefined;

  if (displayName && typeof client.setDisplayName === "function" && currentProfile?.displayname !== displayName) {
    await client.setDisplayName(displayName).catch(() => undefined);
  }

  if (!avatarSourceUrl || typeof client.setAvatarUrl !== "function") {
    return;
  }
  const avatarMxcUrl = await resolveProfileAvatarMxcUrl(client, bootstrap, avatarSourceUrl).catch(() => undefined);
  if (avatarMxcUrl && currentProfile?.avatar_url !== avatarMxcUrl) {
    await client.setAvatarUrl(avatarMxcUrl).catch(() => undefined);
  }
}

async function syncMatrixWebPushPusher(
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  options: MatrixWebPushPusherOptions | undefined
): Promise<void> {
  if (typeof client.setPusher !== "function") {
    return;
  }

  const appId = options?.appId?.trim() || "cz.zeleznalady.cop.web";
  const deviceId = options?.deviceId?.trim();
  const pusherRegistered = options?.registered ?? Boolean(deviceId);
  if (!pusherRegistered) {
    const storedPusher = readStoredMatrixWebPushPusher();
    const pushkey = deviceId || storedPusher?.pushkey;
    if (!pushkey) {
      return;
    }
    await client.setPusher({
      app_id: storedPusher?.appId || appId,
      kind: null,
      pushkey
    });
    clearStoredMatrixWebPushPusher();
    return;
  }

  if (!deviceId) {
    return;
  }

  const pushGatewayUrl = options?.pushGatewayUrl?.trim() || defaultMatrixPushGatewayUrl(homeserverBaseUrl);

  await client.setPusher({
    app_display_name: options?.appDisplayName?.trim() || "COP Chat",
    app_id: appId,
    data: {
      url: pushGatewayUrl
    },
    device_display_name: options?.deviceDisplayName?.trim() || "COP web",
    kind: "http",
    lang: options?.lang?.trim() || "cs",
    pushkey: deviceId
  });
  writeStoredMatrixWebPushPusher({ appId, pushkey: deviceId });
}

function defaultMatrixPushGatewayUrl(homeserverBaseUrl: string): string {
  return new URL("/_matrix/push/v1/notify", browserLocationOrigin() ?? homeserverBaseUrl).toString();
}

function browserLocationOrigin(): string | undefined {
  try {
    if (typeof window !== "undefined" && typeof window.location?.origin === "string" && window.location.origin) {
      return window.location.origin;
    }
  } catch {
    // Fall back to the Matrix homeserver URL outside a browser context.
  }
  return undefined;
}

async function resolveProfileAvatarMxcUrl(
  client: MatrixClientLike,
  bootstrap: MessagingBootstrapResponse,
  avatarSourceUrl: string
): Promise<string | undefined> {
  if (avatarSourceUrl.startsWith("mxc://")) {
    return avatarSourceUrl;
  }
  const cacheKey = matrixProfileAvatarCacheKey(bootstrap.userId ?? "unknown", avatarSourceUrl);
  const cached = readLocalStorageValue(cacheKey);
  if (cached?.startsWith("mxc://")) {
    return cached;
  }
  if (typeof client.uploadContent !== "function") {
    return undefined;
  }

  const avatarBlob = await fetchProfileAvatarBlob(avatarSourceUrl);
  const uploaded = await client.uploadContent(avatarBlob, {
    includeFilename: false,
    name: "avatar",
    type: avatarBlob.type || "image/jpeg"
  });
  const mxcUrl = uploaded.content_uri ?? uploaded.contentUri;
  if (mxcUrl?.startsWith("mxc://")) {
    writeLocalStorageValue(cacheKey, mxcUrl);
    return mxcUrl;
  }
  return undefined;
}

async function fetchProfileAvatarBlob(avatarSourceUrl: string): Promise<Blob> {
  const response = avatarSourceUrl.startsWith("data:")
    ? await fetch(avatarSourceUrl)
    : await fetch(avatarSourceUrl, { credentials: "include", mode: "cors" });
  if (!response.ok) {
    throw new Error(`Avatar profile fetch returned HTTP ${response.status}.`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("Avatar profile source is not an image.");
  }
  return blob;
}

function matrixProfileAvatarCacheKey(userId: string, avatarSourceUrl: string): string {
  return `cop.matrix.profile.avatar.v1:${encodeURIComponent(userId)}:${stableStringHash(avatarSourceUrl)}`;
}

function stableStringHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function readLocalStorageValue(key: string): string | undefined {
  try {
    return typeof window !== "undefined" ? (window.localStorage.getItem(key) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

function writeLocalStorageValue(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Profile avatar cache is only an optimization.
  }
}

function readStoredMatrixWebPushPusher(): { appId: string; pushkey: string } | undefined {
  try {
    if (typeof window === "undefined") {
      return undefined;
    }
    const raw = window.localStorage.getItem(matrixWebPushPusherStorageKey);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<{ appId: string; pushkey: string }>;
    if (typeof parsed.appId !== "string" || typeof parsed.pushkey !== "string") {
      return undefined;
    }
    return {
      appId: parsed.appId,
      pushkey: parsed.pushkey
    };
  } catch {
    return undefined;
  }
}

function writeStoredMatrixWebPushPusher(pusher: { appId: string; pushkey: string }): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(matrixWebPushPusherStorageKey, JSON.stringify(pusher));
    }
  } catch {
    // Matrix pusher cleanup remains best effort if browser storage is unavailable.
  }
}

function clearStoredMatrixWebPushPusher(): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(matrixWebPushPusherStorageKey);
    }
  } catch {
    // Best effort.
  }
}

async function readMatrixEncryptionRecoveryStatus(client: MatrixClientLike): Promise<MatrixEncryptionRecoveryStatus> {
  const crypto = client.getCrypto?.();
  if (!crypto) {
    return {
      canPrepareForMobile: false,
      crossSigningReady: false,
      keyBackupEnabled: false,
      keyBackupExists: false,
      matrixRustCompatible: false,
      needsRecovery: false,
      needsSetup: true,
      ready: false,
      secretStorageReady: false,
      supported: false
    };
  }
  const [backupInfo, activeBackupVersion, secretStorageReady, crossSigningReady] = await Promise.all([
    crypto.getKeyBackupInfo ? crypto.getKeyBackupInfo().catch(() => null) : Promise.resolve(null),
    crypto.getActiveSessionBackupVersion
      ? crypto.getActiveSessionBackupVersion().catch(() => null)
      : Promise.resolve(null),
    crypto.isSecretStorageReady ? crypto.isSecretStorageReady().catch(() => false) : Promise.resolve(false),
    crypto.isCrossSigningReady ? crypto.isCrossSigningReady().catch(() => false) : Promise.resolve(false)
  ]);
  const keyBackupExists = Boolean(backupInfo);
  const keyBackupEnabled = Boolean(activeBackupVersion);
  const supported =
    typeof crypto.bootstrapSecretStorage === "function" &&
    typeof crypto.bootstrapCrossSigning === "function" &&
    typeof crypto.createRecoveryKeyFromPassphrase === "function" &&
    typeof crypto.isCrossSigningReady === "function" &&
    typeof crypto.isSecretStorageReady === "function";
  const matrixRustCompatible = Boolean(keyBackupEnabled && secretStorageReady && crossSigningReady);
  return {
    ...(activeBackupVersion ? { activeBackupVersion } : {}),
    canPrepareForMobile: supported && keyBackupEnabled,
    crossSigningReady,
    keyBackupEnabled,
    keyBackupExists,
    matrixRustCompatible,
    needsRecovery: keyBackupExists && !keyBackupEnabled,
    needsSetup: !keyBackupExists,
    ready: keyBackupEnabled,
    secretStorageReady,
    supported
  };
}

async function createUserControlledEncryptionRecovery(
  client: MatrixClientLike,
  recoveryController: MatrixRecoveryController,
  options: { mobileCompatible?: boolean; reset?: boolean } = {},
  serverManagedPasswordAuth = false
): Promise<string> {
  const crypto = requireMatrixCrypto(client);
  if (
    typeof crypto.bootstrapSecretStorage !== "function" ||
    typeof crypto.bootstrapCrossSigning !== "function" ||
    typeof crypto.createRecoveryKeyFromPassphrase !== "function"
  ) {
    throw new Error("Tento prohlížeč nepodporuje vytvoření obnovovacího klíče.");
  }

  let resetEncryptionApplied = false;
  if (options.reset) {
    resetEncryptionApplied = await resetMatrixEncryptionForRecovery(crypto, serverManagedPasswordAuth);
  }

  let encodedRecoveryKey = "";
  const createSecretStorageKey = async () => {
    const recoveryKey = await crypto.createRecoveryKeyFromPassphrase?.();
    encodedRecoveryKey = readEncodedRecoveryKey(recoveryKey);
    recoveryController.setGeneratedSecretStorageKey(recoveryKey);
    return recoveryKey;
  };

  try {
    const authUploadDeviceSigningKeys = createDefaultMatrixInteractiveAuthCallback(serverManagedPasswordAuth);
    if (!options.reset) {
      await crypto.bootstrapCrossSigning({
        authUploadDeviceSigningKeys,
        ...(options.mobileCompatible ? { setupNewCrossSigning: true } : {})
      });
    }
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey,
      setupNewKeyBackup: !resetEncryptionApplied,
      setupNewSecretStorage: true
    });
    // The mobile preparation path has just reset cross-signing and exported the
    // fresh private keys to new secret storage. Calling bootstrapCrossSigning
    // again without setupNewCrossSigning would read legacy 4S records, which can
    // be incomplete on older web-created accounts and rejected by Matrix Rust.
    if (!options.mobileCompatible) {
      await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys });
    }
    await crypto.checkKeyBackupAndEnable?.();
    const status = await readMatrixEncryptionRecoveryStatus(client);
    if (!status.matrixRustCompatible) {
      throw new Error(
        "Nová E2EE obnova není kompletní pro iPhone/iPad. Zkuste akci zopakovat z tohoto důvěryhodného prohlížeče."
      );
    }
  } catch (caught) {
    if (
      isMatrixDuplicateOneTimeKeyUploadError(caught) &&
      (await acceptCompletedRecoveryAfterDuplicateOneTimeKeyUpload(client, crypto, encodedRecoveryKey))
    ) {
      return encodedRecoveryKey;
    }
    const action = options.mobileCompatible ? "připravit pro iPhone/iPad" : "vytvořit";
    throw new Error(`Obnovovací klíč se nepodařilo ${action}: ${recoveryErrorMessage(caught)}`);
  }
  if (!encodedRecoveryKey) {
    throw new Error("Matrix nevydal obnovovací klíč. Zkuste nastavení zopakovat.");
  }
  return encodedRecoveryKey;
}

async function acceptCompletedRecoveryAfterDuplicateOneTimeKeyUpload(
  client: MatrixClientLike,
  crypto: MatrixCryptoApiLike,
  encodedRecoveryKey: string
): Promise<boolean> {
  if (!encodedRecoveryKey) {
    return false;
  }
  try {
    await crypto.checkKeyBackupAndEnable?.();
  } catch (caught) {
    if (!isMatrixDuplicateOneTimeKeyUploadError(caught)) {
      return false;
    }
  }
  try {
    const status = await readMatrixEncryptionRecoveryStatus(client);
    return status.ready && status.matrixRustCompatible;
  } catch {
    return false;
  }
}

async function resetMatrixEncryptionForRecovery(
  crypto: MatrixCryptoApiLike,
  serverManagedPasswordAuth: boolean
): Promise<boolean> {
  const authUploadDeviceSigningKeys = createDefaultMatrixInteractiveAuthCallback(serverManagedPasswordAuth);
  try {
    if (typeof crypto.resetEncryption === "function") {
      await crypto.resetEncryption(authUploadDeviceSigningKeys);
      return true;
    }
    await crypto.disableKeyStorage?.();
    await crypto.bootstrapCrossSigning?.({
      authUploadDeviceSigningKeys,
      setupNewCrossSigning: true
    });
    return false;
  } catch (caught) {
    throw new Error(`Reset E2EE metadat se nepodařil: ${errorMessage(caught)}`);
  }
}

function createMatrixServerManagedAuthFetch(
  completeDeviceSigningAuth: (request: MatrixDeviceSigningAuthRequest) => Promise<void>,
  deviceId: string
): typeof globalThis.fetch {
  return async (resource, options) => {
    const url = matrixFetchUrl(resource);
    const method = (options?.method ?? matrixFetchRequestMethod(resource)).toUpperCase();
    if (url?.pathname === "/_matrix/client/v3/keys/device_signing/upload" && method === "POST") {
      const body = await matrixFetchRequestBody(resource, options);
      const parsed = body ? asRecord(safeJsonParse(body)) : null;
      const auth = asRecord(parsed?.auth);
      if (auth?.type === matrixServerManagedAuthType) {
        const masterKey = asRecord(parsed?.master_key);
        const selfSigningKey = asRecord(parsed?.self_signing_key);
        const userSigningKey = asRecord(parsed?.user_signing_key);
        if (!masterKey || !selfSigningKey || !userSigningKey) {
          return matrixAuthProxyResponse(400, "Veřejné cross-signing klíče nejsou kompletní.");
        }
        try {
          await completeDeviceSigningAuth({
            deviceId,
            masterKey: masterKey as unknown as MatrixDeviceSigningAuthRequest["masterKey"],
            selfSigningKey: selfSigningKey as unknown as MatrixDeviceSigningAuthRequest["selfSigningKey"],
            userSigningKey: userSigningKey as unknown as MatrixDeviceSigningAuthRequest["userSigningKey"]
          });
          return new Response("{}", {
            headers: { "Content-Type": "application/json" },
            status: 200
          });
        } catch {
          return matrixAuthProxyResponse(502, "CSM Messaging nedokončil ověření resetu E2EE.");
        }
      }
    }
    return globalThis.fetch(resource, options);
  };
}

function matrixFetchUrl(resource: RequestInfo | URL): URL | null {
  try {
    if (resource instanceof URL) {
      return resource;
    }
    if (typeof resource === "string") {
      return new URL(resource);
    }
    return new URL(resource.url);
  } catch {
    return null;
  }
}

function matrixFetchRequestMethod(resource: RequestInfo | URL): string {
  return typeof Request !== "undefined" && resource instanceof Request ? resource.method : "GET";
}

async function matrixFetchRequestBody(resource: RequestInfo | URL, options?: RequestInit): Promise<string | null> {
  if (typeof options?.body === "string") {
    return options.body;
  }
  if (typeof Request !== "undefined" && resource instanceof Request) {
    return resource.clone().text();
  }
  return null;
}

function matrixAuthProxyResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ errcode: "M_COP_UIA_FAILED", error: message }), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createDefaultMatrixInteractiveAuthCallback(serverManagedPasswordAuth = false): MatrixInteractiveAuthCallback {
  return async (makeRequest) => {
    try {
      return await makeRequest(null);
    } catch (caught) {
      const authData = readMatrixInteractiveAuthData(caught);
      if (authData && matrixInteractiveAuthSupportsDummy(authData)) {
        try {
          return await makeRequest({
            ...(typeof authData.session === "string" ? { session: authData.session } : {}),
            type: "m.login.dummy"
          });
        } catch (dummyCaught) {
          throw new MatrixInteractiveAuthRequiredError(dummyCaught, authData);
        }
      }
      if (authData && serverManagedPasswordAuth && matrixInteractiveAuthSupportsPassword(authData)) {
        try {
          return await makeRequest({ type: matrixServerManagedAuthType });
        } catch (serverManagedCaught) {
          throw new MatrixInteractiveAuthRequiredError(serverManagedCaught, authData);
        }
      }
      throw new MatrixInteractiveAuthRequiredError(caught, authData);
    }
  };
}

class MatrixInteractiveAuthRequiredError extends Error {
  constructor(caught: unknown, authData: MatrixInteractiveAuthData | null) {
    const flows = summarizeMatrixInteractiveAuthFlows(authData);
    super(`Matrix interactive auth je vyžadovaný pro E2EE reset${flows ? ` (${flows})` : ""}: ${errorMessage(caught)}`);
    this.name = "MatrixInteractiveAuthRequiredError";
  }
}

interface MatrixInteractiveAuthData {
  flows: Array<{ stages: string[] }>;
  session?: string;
}

function readMatrixInteractiveAuthData(caught: unknown): MatrixInteractiveAuthData | null {
  const data = asRecord(asRecord(caught)?.data) ?? asRecord(caught);
  const flows = Array.isArray(data?.flows)
    ? data.flows
        .map((flow) => {
          const stages = asRecord(flow)?.stages;
          return Array.isArray(stages)
            ? { stages: stages.filter((stage): stage is string => typeof stage === "string") }
            : null;
        })
        .filter((flow): flow is { stages: string[] } => Boolean(flow && flow.stages.length > 0))
    : [];
  if (flows.length === 0) {
    return null;
  }
  const session = stringValue(data?.session);
  return {
    flows,
    ...(session ? { session } : {})
  };
}

function matrixInteractiveAuthSupportsDummy(authData: MatrixInteractiveAuthData): boolean {
  return authData.flows.some((flow) => flow.stages.includes("m.login.dummy"));
}

function matrixInteractiveAuthSupportsPassword(authData: MatrixInteractiveAuthData): boolean {
  return authData.flows.some((flow) => flow.stages.includes("m.login.password"));
}

function summarizeMatrixInteractiveAuthFlows(authData: MatrixInteractiveAuthData | null): string {
  if (!authData) {
    return "";
  }
  return authData.flows
    .map((flow) => flow.stages.join(" + "))
    .filter(Boolean)
    .join("; ");
}

async function restoreUserControlledEncryptionRecovery(
  client: MatrixClientLike,
  recoveryController: MatrixRecoveryController,
  recoveryKey: string
): Promise<void> {
  const crypto = requireMatrixCrypto(client);
  if (!recoveryKey.trim()) {
    throw new Error("Zadejte obnovovací klíč.");
  }
  recoveryController.setRecoveryKey(recoveryKey);
  try {
    const loaded = await loadUserSessionBackupKey(crypto);
    if (!loaded) {
      throw new Error("Obnovovací klíč neodpovídá záloze tohoto účtu.");
    }
    await crypto.checkKeyBackupAndEnable?.();
    if (!(await hasActiveUserBackup(crypto))) {
      throw new Error("Key backup se nepodařilo aktivovat.");
    }
    await restoreUserKeyBackup(crypto);
  } catch (caught) {
    throw new Error(`Zařízení se nepodařilo obnovit: ${errorMessage(caught)}`);
  }
}

function requireMatrixCrypto(client: MatrixClientLike): MatrixCryptoApiLike {
  const crypto = client.getCrypto?.();
  if (!crypto) {
    throw new Error("Tento prohlížeč nepodporuje potřebné E2EE funkce.");
  }
  return crypto;
}

function readEncodedRecoveryKey(value: unknown): string {
  const encoded = asRecord(value)?.encodedPrivateKey;
  return typeof encoded === "string" ? encoded : "";
}

function readSecretStoragePrivateKey(value: unknown): Uint8Array | null {
  const privateKey = asRecord(value)?.privateKey;
  return privateKey instanceof Uint8Array ? privateKey : null;
}

async function loadUserSessionBackupKey(crypto: MatrixCryptoApiLike): Promise<boolean> {
  if (typeof crypto.loadSessionBackupPrivateKeyFromSecretStorage !== "function") {
    return false;
  }
  try {
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    return true;
  } catch {
    return false;
  }
}

async function hasActiveUserBackup(crypto: MatrixCryptoApiLike): Promise<boolean> {
  if (typeof crypto.getActiveSessionBackupVersion !== "function") {
    return true;
  }
  try {
    return Boolean(await crypto.getActiveSessionBackupVersion());
  } catch {
    return false;
  }
}

async function restoreUserKeyBackup(crypto: MatrixCryptoApiLike): Promise<void> {
  if (typeof crypto.restoreKeyBackup !== "function") {
    return;
  }
  await crypto.restoreKeyBackup({ progressCallback: () => undefined });
}

function restoreUserKeyBackupInBackground(crypto: MatrixCryptoApiLike | undefined, onRestored?: () => void): void {
  if (!crypto || typeof crypto.restoreKeyBackup !== "function") {
    return;
  }
  void hasActiveUserBackup(crypto)
    .then((active) => {
      if (!active) {
        return undefined;
      }
      return restoreUserKeyBackup(crypto).then(() => {
        onRestored?.();
      });
    })
    .catch(() => undefined);
}

async function createEncryptedAttachmentMessage(
  client: MatrixClientLike,
  attachment: MatrixAttachmentUpload
): Promise<Record<string, unknown>> {
  if (typeof client.uploadContent !== "function") {
    throw new Error("Přílohu se nepodařilo nahrát.");
  }
  const encrypted = await encryptAttachmentFile(attachment.file);
  const upload = await client.uploadContent(encrypted.blob, {
    includeFilename: false,
    name: "encrypted",
    type: "application/octet-stream"
  });
  const contentUri = upload.content_uri ?? upload.contentUri;
  if (!contentUri) {
    throw new Error("Služba zpráv nevrátila odkaz na nahranou přílohu.");
  }
  const fileName = attachment.file.name || defaultAttachmentName(attachment.kind);
  const contentType = attachment.file.type || "application/octet-stream";
  return {
    body: attachment.caption?.trim() || fileName,
    file: {
      ...encrypted.file,
      url: contentUri
    },
    filename: fileName,
    info: {
      mimetype: contentType,
      size: attachment.file.size
    },
    msgtype: matrixMsgTypeForAttachment(attachment.kind)
  };
}

async function encryptAttachmentFile(file: File): Promise<{ blob: Blob; file: Omit<MatrixEncryptedFileRef, "url"> }> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Prohlížeč nepodporuje Web Crypto potřebné pro šifrované přílohy.");
  }
  const key = await globalThis.crypto.subtle.generateKey({ length: 256, name: "AES-CTR" }, true, [
    "decrypt",
    "encrypt"
  ]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const plain = await file.arrayBuffer();
  const encrypted = await globalThis.crypto.subtle.encrypt({ counter: iv, length: 64, name: "AES-CTR" }, key, plain);
  const exported = await globalThis.crypto.subtle.exportKey("jwk", key);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encrypted);
  const k = typeof exported.k === "string" ? exported.k : "";
  if (!k) {
    throw new Error("Nepodařilo se připravit šifrovací klíč přílohy.");
  }
  return {
    blob: new Blob([encrypted], { type: "application/octet-stream" }),
    file: {
      hashes: {
        sha256: encodeBase64(digest)
      },
      iv: encodeBase64(iv),
      key: {
        alg: "A256CTR",
        ext: true,
        k,
        key_ops: ["encrypt", "decrypt"],
        kty: "oct"
      },
      v: "v2"
    }
  };
}

async function downloadMatrixAttachment(
  client: MatrixClientLike,
  bootstrap: MessagingBootstrapResponse,
  homeserverBaseUrl: string,
  attachment: MatrixTimelineAttachment
): Promise<Blob> {
  const encryptedUrl = attachment.encrypted?.url;
  const mxcUrl = encryptedUrl ?? attachment.mediaUrl;
  if (!mxcUrl) {
    throw new Error("Příloha nemá platný odkaz ke stažení.");
  }
  const downloadUrl = matrixMediaHttpUrl(client, homeserverBaseUrl, mxcUrl, true);
  if (!downloadUrl) {
    throw new Error("Přílohu se nepodařilo převést na download URL.");
  }
  const response = await fetch(downloadUrl, {
    headers: bootstrap.accessToken ? { Authorization: `Bearer ${bootstrap.accessToken}` } : undefined
  });
  if (!response.ok) {
    throw new Error(`Stažení přílohy selhalo: HTTP ${response.status}.`);
  }
  const payload = await response.arrayBuffer();
  if (!attachment.encrypted) {
    return new Blob([payload], { type: attachment.contentType || "application/octet-stream" });
  }
  await verifyEncryptedAttachmentHash(payload, attachment.encrypted);
  const decrypted = await decryptAttachmentPayload(payload, attachment.encrypted);
  return new Blob([decrypted], { type: attachment.contentType || "application/octet-stream" });
}

async function verifyEncryptedAttachmentHash(payload: ArrayBuffer, encrypted: MatrixEncryptedFileRef): Promise<void> {
  const expected = encrypted.hashes.sha256;
  if (!expected) {
    return;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  if (encodeBase64(digest) !== expected) {
    throw new Error("Kontrola integrity šifrované přílohy selhala.");
  }
}

async function decryptAttachmentPayload(payload: ArrayBuffer, encrypted: MatrixEncryptedFileRef): Promise<ArrayBuffer> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Prohlížeč nepodporuje Web Crypto potřebné pro přílohy.");
  }
  const key = await globalThis.crypto.subtle.importKey("jwk", encrypted.key, { name: "AES-CTR" }, false, ["decrypt"]);
  return globalThis.crypto.subtle.decrypt(
    { counter: decodeBase64(encrypted.iv), length: 64, name: "AES-CTR" },
    key,
    payload
  );
}

function createTextMessageContent(
  body: string,
  options: { cop?: MatrixCopMessageMetadata; replyTo?: MatrixMessageReplyTarget } = {}
): Record<string, unknown> {
  const content: Record<string, unknown> = {
    body,
    msgtype: "m.text"
  };
  const replyTo = options.replyTo;
  if (replyTo) {
    const quoted =
      replyTo.body
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .slice(0, 4)
        .map((line) => `> <${replyTo.sender}> ${line}`)
        .join("\n") || `> <${replyTo.sender}> Zpráva`;
    content["m.relates_to"] = {
      "m.in_reply_to": {
        event_id: replyTo.eventId
      }
    };
    content.body = `${quoted}\n\n${body}`;
  }
  if (options.cop) {
    content["cz.cop"] = options.cop;
  }
  return content;
}

function createLocationMessage(location: MatrixLocationShare): Record<string, unknown> {
  const roundedLat = Number(location.lat.toFixed(6));
  const roundedLon = Number(location.lon.toFixed(6));
  const geoUri = `geo:${roundedLat},${roundedLon}${typeof location.accuracyM === "number" ? `;u=${Math.max(0, Math.round(location.accuracyM))}` : ""}`;
  const live = sanitizeLiveLocationShare(location.live);
  const label =
    location.label?.trim() ||
    (live?.status === "ended"
      ? "Živé sdílení polohy ukončeno"
      : live
        ? "Živá poloha"
        : location.source === "device"
          ? "Moje poloha"
          : "Poloha v mapě");
  const updatedAt = location.updatedAt ?? live?.updatedAt;
  return {
    "cz.cop.location": {
      accuracyM: location.accuracyM ?? undefined,
      lat: roundedLat,
      live,
      lon: roundedLon,
      source: location.source,
      updatedAt
    },
    "m.asset": {
      type: location.source === "device" ? "m.self" : "cz.cop.map"
    },
    "m.location": {
      description: label,
      uri: geoUri
    },
    "m.text": `${label}: ${roundedLat.toFixed(6)}, ${roundedLon.toFixed(6)}`,
    "m.ts": Date.now(),
    body: `${label}: ${roundedLat.toFixed(6)}, ${roundedLon.toFixed(6)}`,
    geo_uri: geoUri,
    msgtype: "m.location"
  };
}

function sanitizeLiveLocationShare(value: MatrixLocationShare["live"]): MatrixLocationShare["live"] | undefined {
  if (!value?.shareId?.trim()) {
    return undefined;
  }
  return {
    ...(typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0
      ? { durationSeconds: Math.trunc(value.durationSeconds) }
      : {}),
    ...(typeof value.expiresAt === "string" && value.expiresAt.trim() ? { expiresAt: value.expiresAt.trim() } : {}),
    shareId: value.shareId.trim().slice(0, 160),
    ...(typeof value.startedAt === "string" && value.startedAt.trim() ? { startedAt: value.startedAt.trim() } : {}),
    status: value.status === "ended" ? "ended" : "live",
    ...(typeof value.updatedAt === "string" && value.updatedAt.trim() ? { updatedAt: value.updatedAt.trim() } : {})
  };
}

function createTransitShareMessage(transit: MatrixTransitShare): Record<string, unknown> {
  const sanitized = sanitizeTransitShare(transit);
  const body = formatTransitShareBody(sanitized);
  return {
    "cz.cop.transit": sanitized,
    "m.text": body,
    "m.ts": Date.now(),
    body,
    msgtype: "m.text"
  };
}

export class MatrixAccountStoreMismatchError extends Error {
  constructor(readonly cause: unknown) {
    super("Lokální šifrovací úložiště patří jinému účtu. Chat se bezpečně obnoví pro aktuálně přihlášeného uživatele.");
    this.name = "MatrixAccountStoreMismatchError";
  }
}

export function isMatrixAccountStoreMismatchError(caught: unknown): caught is MatrixAccountStoreMismatchError {
  return caught instanceof MatrixAccountStoreMismatchError;
}

function matrixCryptoDatabasePrefix(bootstrap: MessagingBootstrapResponse): string {
  const identity = `${bootstrap.userId}.${bootstrap.deviceId}`;
  return `cop-web-matrix-${identity
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._=-]+/gu, "_")
    .slice(0, 140)}`;
}

function createMatrixSyncStore(
  matrixSdk: MatrixSdkLike,
  bootstrap: MessagingBootstrapResponse
): MatrixSyncStoreLike | undefined {
  if (typeof window === "undefined" || !window.indexedDB || !matrixSdk.IndexedDBStore) {
    return undefined;
  }
  try {
    return new matrixSdk.IndexedDBStore({
      dbName: `${matrixCryptoDatabasePrefix(bootstrap)}-sync-v1`,
      indexedDB: window.indexedDB,
      localStorage: window.localStorage
    });
  } catch {
    return undefined;
  }
}

async function joinInvitedRoomsOnce(client: MatrixClientLike, homeserverBaseUrl: string): Promise<void> {
  const invitedRoomIds = (client.getRooms?.() ?? [])
    .map(asRoom)
    .filter((room): room is MatrixRoomLike & { roomId: string } =>
      Boolean(room?.roomId && room.getMyMembership?.() === "invite")
    )
    .map((room) => room.roomId);

  for (const roomId of invitedRoomIds) {
    await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
  }
}

async function ensureJoinedRoom(client: MatrixClientLike, roomId: string, homeserverBaseUrl: string): Promise<void> {
  const room = (client.getRooms?.() ?? []).map(asRoom).find((candidate) => candidate?.roomId === roomId);
  if (room?.getMyMembership?.() !== "invite") {
    return;
  }
  if (typeof client.joinRoom !== "function") {
    throw new Error("Pozvánku do konverzace se nepodařilo přijmout.");
  }
  try {
    await client.joinRoom(roomId);
  } catch (caught) {
    throw formatMatrixClientError(caught, homeserverBaseUrl, "přijmout pozvánku do konverzace");
  }
}

async function readServerJoinedRoomIds(
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  accessToken: string | undefined,
  fallback: Set<string> | null
): Promise<Set<string> | null> {
  if (
    typeof client.getJoinedRooms !== "function" &&
    (typeof window === "undefined" || !accessToken || typeof fetch !== "function")
  ) {
    return fallback;
  }
  try {
    const response =
      typeof client.getJoinedRooms === "function"
        ? await client.getJoinedRooms()
        : await fetchJoinedRooms(homeserverBaseUrl, accessToken);
    const rawRoomIds = Array.isArray(response)
      ? response
      : Array.isArray(response.joined_rooms)
        ? response.joined_rooms
        : [];
    return new Set(
      rawRoomIds.filter((roomId): roomId is string => typeof roomId === "string" && roomId.startsWith("!"))
    );
  } catch {
    return fallback;
  }
}

async function fetchJoinedRooms(
  homeserverBaseUrl: string,
  accessToken: string | undefined
): Promise<{ joined_rooms?: unknown }> {
  if (!accessToken || typeof fetch !== "function") {
    return {};
  }
  const response = await fetch(`${homeserverBaseUrl.replace(/\/+$/u, "")}/_matrix/client/v3/joined_rooms`, {
    cache: "no-store",
    credentials: "omit",
    headers: { Authorization: `Bearer ${accessToken}` },
    mode: "cors"
  });
  if (!response.ok) {
    throw new Error(`Matrix joined_rooms failed: HTTP ${response.status}`);
  }
  return (await response.json()) as { joined_rooms?: unknown };
}

const matrixUserProfileCachePrefix = "cop.matrix.profile.v1";
const matrixUserProfileCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
const matrixMissingProfileRetryMs = 5 * 60 * 1000;
const matrixWebPushPusherStorageKey = "cop.matrix.webPushPusher.v1";
const matrixRecoveryKeyStoragePrefix = "cop.matrix.recoveryKey.v1";

interface StoredMatrixRecoveryKey {
  homeserverBaseUrl: string;
  recoveryKey: string;
  storedAt: string;
  userId: string;
}

async function readStoredMatrixRecoveryKey(bootstrap: MessagingBootstrapResponse): Promise<string | undefined> {
  const scope = matrixRecoverySecretScope(bootstrap);
  if (!scope) {
    return undefined;
  }
  const sealedRecoveryKey = await readSealedBrowserSecret(scope);
  if (isPlausibleMatrixRecoveryKey(sealedRecoveryKey)) {
    clearLegacyStoredMatrixRecoveryKey(scope.id);
    return sealedRecoveryKey.trim();
  }
  const legacyRecoveryKey = readLegacyStoredMatrixRecoveryKey(scope.id, bootstrap);
  if (legacyRecoveryKey) {
    if (await writeSealedBrowserSecret(scope, legacyRecoveryKey)) {
      clearLegacyStoredMatrixRecoveryKey(scope.id);
    }
    return legacyRecoveryKey;
  }
  return undefined;
}

function readLegacyStoredMatrixRecoveryKey(key: string, bootstrap: MessagingBootstrapResponse): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<StoredMatrixRecoveryKey>;
    if (
      parsed.userId !== bootstrap.userId ||
      parsed.homeserverBaseUrl !== bootstrap.homeserverBaseUrl ||
      !isPlausibleMatrixRecoveryKey(parsed.recoveryKey)
    ) {
      clearLegacyStoredMatrixRecoveryKey(key);
      return undefined;
    }
    return parsed.recoveryKey.trim();
  } catch {
    return undefined;
  }
}

async function writeStoredMatrixRecoveryKey(bootstrap: MessagingBootstrapResponse, recoveryKey: string): Promise<void> {
  const scope = matrixRecoverySecretScope(bootstrap);
  if (!scope) {
    return;
  }
  if (await writeSealedBrowserSecret(scope, recoveryKey)) {
    clearLegacyStoredMatrixRecoveryKey(scope.id);
    return;
  }
  writeLegacyStoredMatrixRecoveryKey(bootstrap, recoveryKey);
}

function writeLegacyStoredMatrixRecoveryKey(bootstrap: MessagingBootstrapResponse, recoveryKey: string): void {
  const key = matrixRecoveryKeyStorageKey(bootstrap);
  const homeserverBaseUrl = bootstrap.homeserverBaseUrl;
  const userId = bootstrap.userId;
  if (
    !key ||
    !homeserverBaseUrl ||
    !userId ||
    !isPlausibleMatrixRecoveryKey(recoveryKey) ||
    typeof window === "undefined"
  ) {
    return;
  }
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        homeserverBaseUrl,
        recoveryKey: recoveryKey.trim(),
        storedAt: new Date().toISOString(),
        userId
      } satisfies StoredMatrixRecoveryKey)
    );
  } catch {
    // Persisted recovery is a local convenience only; the entered key remains active for the current Matrix session.
  }
}

function clearLegacyStoredMatrixRecoveryKey(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Legacy cleanup is best-effort.
  }
}

function matrixRecoveryKeyStorageKey(bootstrap: MessagingBootstrapResponse): string | undefined {
  if (!bootstrap.userId || !bootstrap.homeserverBaseUrl) {
    return undefined;
  }
  return [
    matrixRecoveryKeyStoragePrefix,
    encodeURIComponent(bootstrap.userId),
    stableStringHash(bootstrap.homeserverBaseUrl)
  ].join(".");
}

function matrixRecoverySecretScope(bootstrap: MessagingBootstrapResponse): BrowserSecretScope | undefined {
  const id = matrixRecoveryKeyStorageKey(bootstrap);
  if (!id || !bootstrap.userId || !bootstrap.homeserverBaseUrl) {
    return undefined;
  }
  return {
    homeserverBaseUrl: bootstrap.homeserverBaseUrl,
    id,
    userId: bootstrap.userId
  };
}

function isPlausibleMatrixRecoveryKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 16 && value.trim().length <= 512;
}

function readCachedMatrixUserProfile(userId: string): CachedMatrixUserProfile | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const key = `${matrixUserProfileCachePrefix}.${encodeURIComponent(userId)}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<CachedMatrixUserProfile>;
    const fetchedAt = typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0;
    if (!parsed.userId || parsed.userId !== userId || Date.now() - fetchedAt > matrixUserProfileCacheTtlMs) {
      window.localStorage.removeItem(key);
      return undefined;
    }
    return {
      ...(typeof parsed.avatarUrl === "string" ? { avatarUrl: parsed.avatarUrl } : {}),
      ...(parsed.currentlyActive === true ? { currentlyActive: true } : {}),
      ...(typeof parsed.displayName === "string" ? { displayName: parsed.displayName } : {}),
      fetchedAt,
      ...(typeof parsed.lastActiveAgo === "number" ? { lastActiveAgo: parsed.lastActiveAgo } : {}),
      ...(typeof parsed.lastPresenceTs === "number" ? { lastPresenceTs: parsed.lastPresenceTs } : {}),
      ...(typeof parsed.presence === "string" ? { presence: parsed.presence } : {}),
      userId
    };
  } catch {
    return undefined;
  }
}

function writeCachedMatrixUserProfile(
  userId: string,
  profile: MatrixUserPresenceLike & { fetchedAt: number; userId: string }
): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!profile.avatarUrl && !profile.displayName && !profile.presence) {
    return;
  }
  try {
    window.localStorage.setItem(
      `${matrixUserProfileCachePrefix}.${encodeURIComponent(userId)}`,
      JSON.stringify({
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        ...(profile.currentlyActive !== undefined ? { currentlyActive: profile.currentlyActive } : {}),
        ...(profile.displayName ? { displayName: profile.displayName } : {}),
        fetchedAt: profile.fetchedAt,
        ...(profile.lastActiveAgo !== undefined ? { lastActiveAgo: profile.lastActiveAgo } : {}),
        ...(profile.lastPresenceTs !== undefined ? { lastPresenceTs: profile.lastPresenceTs } : {}),
        ...(profile.presence ? { presence: profile.presence } : {}),
        userId
      })
    );
  } catch {
    // localStorage is best-effort only; Matrix profile loading must not depend on it.
  }
}

async function fetchMatrixUserProfile(
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  accessToken: string | undefined,
  userId: string
): Promise<MatrixUserPresenceLike | undefined> {
  const sdkProfile = client.getProfileInfo ? await client.getProfileInfo(userId).catch(() => undefined) : undefined;
  const sdkDisplayName = stringValue(sdkProfile?.displayname) ?? stringValue(sdkProfile?.displayName);
  const sdkAvatarUrl = stringValue(sdkProfile?.avatar_url) ?? stringValue(sdkProfile?.avatarUrl);
  const needsHttpFallback =
    !sdkProfile || !sdkDisplayName || isOpaqueMatrixIdentityLabel(sdkDisplayName, userId) || !sdkAvatarUrl;
  const httpProfile = needsHttpFallback ? await fetchMatrixProfile(homeserverBaseUrl, accessToken, userId) : undefined;
  if (!sdkProfile && !httpProfile) {
    return undefined;
  }
  const displayName = preferredMatrixDisplayName(userId, [
    sdkDisplayName,
    httpProfile?.displayname,
    httpProfile?.displayName
  ]);
  const avatarUrl = sdkAvatarUrl ?? stringValue(httpProfile?.avatar_url) ?? stringValue(httpProfile?.avatarUrl);
  if (!displayName && !avatarUrl) {
    return undefined;
  }
  return {
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(displayName ? { displayName } : {}),
    userId
  };
}

async function fetchMatrixProfile(
  homeserverBaseUrl: string,
  accessToken: string | undefined,
  userId: string
): Promise<Record<string, unknown> | undefined> {
  if (typeof fetch !== "function") {
    return undefined;
  }
  try {
    const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    const response = await fetch(
      `${homeserverBaseUrl.replace(/\/+$/u, "")}/_matrix/client/v3/profile/${encodeURIComponent(userId)}`,
      {
        cache: "no-store",
        credentials: "omit",
        headers,
        mode: "cors"
      }
    );
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function clearMatrixMessagingCryptoStateForBootstrap(
  bootstrap: MessagingBootstrapResponse
): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  const prefix = matrixCryptoDatabasePrefix(bootstrap);
  const indexedDb = window.indexedDB;
  const databases = typeof indexedDb?.databases === "function" ? await indexedDb.databases() : [];
  await Promise.all(
    databases
      .map((database) => database.name)
      .filter((name): name is string =>
        Boolean(name && (name === prefix || name.startsWith(prefix) || name.includes(prefix)))
      )
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const request = indexedDb.deleteDatabase(name);
            request.onerror = () => resolve();
            request.onsuccess = () => resolve();
            request.onblocked = () => resolve();
          })
      )
  );
}

function validateBootstrap(bootstrap: MessagingBootstrapResponse): void {
  if (!bootstrap.chatAvailable || !bootstrap.tokenAvailable || !bootstrap.accessToken) {
    throw new Error("Zabezpečený chat zatím nemá připravené přihlášení uživatele.");
  }
  if (!bootstrap.homeserverBaseUrl || !bootstrap.userId || !bootstrap.deviceId) {
    throw new Error("Zabezpečený chat nemá všechny potřebné údaje.");
  }
  if (bootstrap.e2eeRequired !== true) {
    throw new Error("Služba zpráv nepotvrdila požadované šifrování.");
  }
}

function canRefreshMatrixBootstrap(
  current: MessagingBootstrapResponse,
  next: MessagingBootstrapResponse
): next is MessagingBootstrapResponse & { accessToken: string } {
  try {
    validateBootstrap(next);
  } catch {
    return false;
  }
  const normalizeBaseUrl = (value: string | undefined) => value?.replace(/\/+$/u, "");
  return (
    normalizeBaseUrl(current.homeserverBaseUrl) === normalizeBaseUrl(next.homeserverBaseUrl) &&
    current.userId === next.userId &&
    current.deviceId === next.deviceId &&
    current.e2eeRequired === next.e2eeRequired
  );
}

async function assertBrowserCanReachHomeserver(baseUrl: string): Promise<void> {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  const versionsUrl = `${baseUrl.replace(/\/+$/u, "")}/_matrix/client/versions`;
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timeout = controller ? window.setTimeout(() => controller.abort(), 8_000) : undefined;
  try {
    const response = await window.fetch(versionsUrl, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (caught) {
    throw formatMatrixClientError(caught, baseUrl, "ověřit službu zpráv v prohlížeči");
  } finally {
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }
  }
}

function installAdditionalMatrixIceServers(client: MatrixClientLike, configuredUrls: string[] | undefined): void {
  const configuredUrlKeys = new Set<string>();
  const additionalUrls = (configuredUrls ?? []).flatMap((configuredUrl) => {
    const value = configuredUrl.trim();
    const key = value.toLowerCase();
    if (!/^(?:stun|stuns|turn|turns):/iu.test(value) || configuredUrlKeys.has(key)) {
      return [];
    }
    configuredUrlKeys.add(key);
    return [value];
  });
  if (additionalUrls.length === 0) {
    return;
  }
  const originalGetTurnServers = client.getTurnServers?.bind(client);
  client.getTurnServers = () => {
    const existingServers = originalGetTurnServers?.() ?? [];
    const existingUrls = new Set(
      existingServers
        .flatMap((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]))
        .map((value) => value.trim().toLowerCase())
    );
    const missingUrls = additionalUrls.filter((value) => !existingUrls.has(value.toLowerCase()));
    return missingUrls.length > 0 ? [...existingServers, { urls: missingUrls }] : existingServers;
  };
}

function installMatrixVoipSignalingFallback(
  client: MatrixClientLike,
  getBootstrap: () => MessagingBootstrapResponse,
  tlsVoiceCallIds: ReadonlySet<string>
): void {
  const originalSendEvent = client.sendEvent?.bind(client);
  if (!originalSendEvent) {
    return;
  }
  client.sendEvent = (...args) => {
    const parsed = parseMatrixSendEventArgs(args);
    const callId = parsed ? stringValue(parsed.content.call_id) : undefined;
    if (parsed && callId && isMatrixCallEventType(parsed.eventType) && tlsVoiceCallIds.has(callId)) {
      return sendMatrixEventOverAuthenticatedTls(
        getBootstrap(),
        parsed.roomId,
        parsed.eventType,
        parsed.content,
        parsed.txnId
      );
    }
    return originalSendEvent(...args);
  };
}

function parseMatrixSendEventArgs(args: MatrixSendEventArgs):
  | {
      content: Record<string, unknown>;
      eventType: string;
      roomId: string;
      txnId?: string;
    }
  | undefined {
  const [roomId, second, third, fourth, fifth] = args;
  const directContent = asRecord(third);
  if (typeof second === "string" && directContent) {
    return {
      content: directContent,
      eventType: second,
      roomId,
      ...(typeof fourth === "string" ? { txnId: fourth } : {})
    };
  }
  const threadedContent = asRecord(fourth);
  if ((typeof second === "string" || second === null) && typeof third === "string" && threadedContent) {
    return {
      content: threadedContent,
      eventType: third,
      roomId,
      ...(typeof fifth === "string" ? { txnId: fifth } : {})
    };
  }
  return undefined;
}

async function sendMatrixEventOverAuthenticatedTls(
  bootstrap: MessagingBootstrapResponse,
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
  txnId?: string
): Promise<unknown> {
  if (typeof fetch !== "function") {
    throw new Error("Hlasovou signalizaci se nepodařilo odeslat bez dostupného síťového rozhraní.");
  }
  const homeserverBaseUrl = bootstrap.homeserverBaseUrl?.replace(/\/+$/u, "");
  const accessToken = bootstrap.accessToken;
  if (!homeserverBaseUrl || !accessToken) {
    throw new Error("Hlasovou signalizaci se nepodařilo odeslat bez přihlášení ke službě zpráv.");
  }
  const transactionId = txnId ?? createMatrixTransactionId("cop-voip-tls");
  const response = await fetch(
    `${homeserverBaseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
    {
      body: JSON.stringify(content),
      cache: "no-store",
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      method: "PUT",
      mode: "cors"
    }
  );
  if (!response.ok) {
    throw new Error(`Matrix voice call signalling failed: HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

function createMatrixTransactionId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function formatMatrixClientError(caught: unknown, baseUrl: string, action: string): Error {
  if (isLikelyBrowserNetworkError(caught)) {
    return new Error(
      `Nelze ${action}. Služba zpráv teď není z tohoto zařízení dostupná. Zkontrolujte připojení nebo VPN a zkuste to znovu.`
    );
  }
  return caught instanceof Error ? caught : new Error(`Nelze ${action}: ${String(caught)}`);
}

function isMatrixAccountStoreMismatch(caught: unknown): boolean {
  if (!(caught instanceof Error)) {
    return false;
  }
  const message = caught.message.toLowerCase();
  return (
    message.includes("account in the store doesn't match the account in the constructor") ||
    message.includes("account in the store does not match the account in the constructor")
  );
}

function isLikelyBrowserNetworkError(caught: unknown): boolean {
  if (!(caught instanceof Error)) {
    return false;
  }
  const message = caught.message.toLowerCase();
  return (
    caught.name === "ConnectionError" ||
    message.includes("fetch failed") ||
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network error")
  );
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function recoveryErrorMessage(caught: unknown): string {
  if (isMatrixDuplicateOneTimeKeyUploadError(caught)) {
    return "Matrix už pro původní webové zařízení evidoval část šifrovacích klíčů. Chat vytvořil nové bezpečné webové zařízení; otevřete dialog znovu a vytvořte nový obnovovací klíč.";
  }
  if (isSensitiveMatrixCryptoError(caught)) {
    return "Matrix odmítl obnovu E2EE kvůli nekonzistentnímu stavu šifrovacích klíčů. Použijte nouzový reset a vytvořte nový obnovovací klíč.";
  }
  return errorMessage(caught);
}

function isMatrixDuplicateOneTimeKeyUploadError(caught: unknown): boolean {
  const text = matrixErrorDiagnosticText(caught).toLowerCase();
  return (
    text.includes("one time key") &&
    text.includes("already exists") &&
    (text.includes("signed_curve25519") || text.includes("keys/upload") || text.includes("/keys/upload"))
  );
}

function isSensitiveMatrixCryptoError(caught: unknown): boolean {
  const text = matrixErrorDiagnosticText(caught);
  return /signed_curve25519|ed25519|curve25519|one time key|old key|new key|signatures|\/keys\/upload|_matrix\/client\/v3\/keys/iu.test(
    text
  );
}

function matrixErrorDiagnosticText(caught: unknown): string {
  const record = asRecord(caught);
  const fragments = [
    errorMessage(caught),
    safeJsonFragment(record?.data),
    safeJsonFragment(record?.body),
    safeJsonFragment(record?.response),
    record?.cause === undefined ? "" : errorMessage(record.cause)
  ];
  return fragments.filter(Boolean).join(" ");
}

function safeJsonFragment(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isLikelyMatrixForbiddenError(caught: unknown): boolean {
  if (asRecord(caught)?.errcode === "M_FORBIDDEN") {
    return true;
  }
  return caught instanceof Error && /m_forbidden|forbidden|permission|power level/iu.test(caught.message);
}

function readRooms(
  client: MatrixClientLike,
  options: {
    allowedRoomIds?: Set<string> | null;
    homeserverBaseUrl?: string;
    ownUserId?: string;
    presenceByUserId?: Map<string, MatrixUserPresenceLike & { fetchedAt: number }>;
    readOverrideByRoomId?: Map<string, string>;
  } = {}
): MatrixRoomSummary[] {
  const currentUserId = client.getUserId?.() ?? undefined;
  return (client.getRooms?.() ?? [])
    .map(asRoom)
    .filter((room): room is MatrixRoomLike & { roomId: string } => Boolean(room?.roomId))
    .filter((room) => !options.allowedRoomIds || options.allowedRoomIds.has(room.roomId))
    .filter((room) => {
      const membership = room.getMyMembership?.();
      return !membership || membership === "join" || membership === "invite";
    })
    .map((room) => {
      const messageRetentionSeconds = readRoomRetentionSeconds(room);
      const presence = readRoomPresence(room, client, options.ownUserId, options.presenceByUserId);
      const avatarUrl = options.homeserverBaseUrl
        ? readRoomAvatarUrl(room, client, options.homeserverBaseUrl, options.ownUserId, options.presenceByUserId)
        : undefined;
      const directPeer = options.homeserverBaseUrl
        ? readRoomDirectPeer(room, client, options.homeserverBaseUrl, options.ownUserId, options.presenceByUserId)
        : undefined;
      const latestMessage = options.homeserverBaseUrl
        ? readRoomLatestMessage(client, room, options.homeserverBaseUrl, currentUserId)
        : undefined;
      const unreadCount = roomUnreadCount(room, latestMessage, options.readOverrideByRoomId);
      return {
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(directPeer ? { directPeer } : {}),
        encrypted: Boolean(client.isRoomEncrypted?.(room.roomId)),
        ...(latestMessage ? { latestMessage } : {}),
        ...(messageRetentionSeconds ? { messageRetentionSeconds } : {}),
        name: room.name?.trim() || room.roomId,
        ...(presence ? { presence } : {}),
        roomId: room.roomId,
        unreadCount
      };
    })
    .sort((left, right) => {
      const latestDifference = matrixRoomLatestTimestamp(right) - matrixRoomLatestTimestamp(left);
      return latestDifference || left.name.localeCompare(right.name, "cs");
    });
}

function matrixRoomLatestTimestamp(room: MatrixRoomSummary): number {
  const timestamp = room.latestMessage?.timestamp;
  if (!timestamp) {
    return 0;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roomUnreadCount(
  room: MatrixRoomLike & { roomId: string },
  latestMessage: MatrixTimelineMessage | undefined,
  readOverrideByRoomId: Map<string, string> | undefined
): number {
  const sdkUnreadCount = Math.max(0, room.getUnreadNotificationCount?.() ?? 0);
  const readOverrideEventId = readOverrideByRoomId?.get(room.roomId);
  if (!readOverrideEventId) {
    return sdkUnreadCount;
  }
  if (latestMessage?.eventId === readOverrideEventId) {
    return 0;
  }
  readOverrideByRoomId?.delete(room.roomId);
  return sdkUnreadCount;
}

function readRoomPresence(
  room: MatrixRoomLike,
  client: MatrixClientLike,
  ownUserId: string | undefined,
  presenceByUserId: Map<string, MatrixUserPresenceLike & { fetchedAt: number }> | undefined
): MatrixRoomSummary["presence"] {
  const members = readRoomJoinedMembers(room).filter((member) => member.userId && member.userId !== ownUserId);
  if (members.length === 0) {
    return {
      activeMemberCount: 0,
      offlineMemberCount: 0,
      onlineMemberCount: 0,
      state: "unknown",
      totalMemberCount: 0,
      unavailableMemberCount: 0,
      unknownMemberCount: 0
    };
  }

  let onlineMemberCount = 0;
  let unavailableMemberCount = 0;
  let offlineMemberCount = 0;
  let unknownMemberCount = 0;
  let latestPresenceAt = 0;

  for (const member of members) {
    const cached = member.userId ? presenceByUserId?.get(member.userId) : undefined;
    const sdkUser = member.userId ? client.getUser?.(member.userId) : undefined;
    const user = cached ?? sdkUser ?? member.user;
    const presence = normalizeMatrixPresence(user);
    if (cached?.fetchedAt) {
      latestPresenceAt = Math.max(latestPresenceAt, cached.fetchedAt);
    }
    switch (presence) {
      case "online":
        onlineMemberCount += 1;
        break;
      case "unavailable":
        unavailableMemberCount += 1;
        break;
      case "offline":
        offlineMemberCount += 1;
        break;
      default:
        unknownMemberCount += 1;
        break;
    }
  }

  const state: MatrixPresenceState =
    onlineMemberCount > 0 ? "online" : unavailableMemberCount > 0 || unknownMemberCount > 0 ? "unknown" : "offline";
  return {
    activeMemberCount: onlineMemberCount + unavailableMemberCount,
    offlineMemberCount,
    onlineMemberCount,
    state,
    totalMemberCount: members.length,
    unavailableMemberCount,
    unknownMemberCount,
    ...(latestPresenceAt > 0 ? { updatedAt: new Date(latestPresenceAt).toISOString() } : {})
  };
}

function readRoomJoinedMembers(room: MatrixRoomLike): MatrixRoomMemberLike[] {
  const joinedMembers = room.getJoinedMembers?.();
  if (Array.isArray(joinedMembers) && joinedMembers.length > 0) {
    return joinedMembers.filter((member) => !member.membership || member.membership === "join");
  }
  const stateMembers = room.currentState?.getStateEvents?.("m.room.member");
  if (!Array.isArray(stateMembers)) {
    return [];
  }
  return stateMembers.map(asEvent).flatMap((event) => {
    if (!event) {
      return [];
    }
    const content = event.getContent?.() ?? {};
    if (content.membership !== "join") {
      return [];
    }
    const userId = event.getStateKey?.() ?? event.getSender?.();
    return userId
      ? [
          {
            avatarUrl: stringValue(content.avatar_url),
            displayName: stringValue(content.displayname),
            name: stringValue(content.displayname),
            rawDisplayName: stringValue(content.displayname),
            userId
          }
        ]
      : [];
  });
}

function readRoomAvatarUrl(
  room: MatrixRoomLike,
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  ownUserId: string | undefined,
  presenceByUserId: Map<string, MatrixUserPresenceLike & { fetchedAt: number }> | undefined
): string | undefined {
  const roomAvatarEvent = room.currentState?.getStateEvents?.("m.room.avatar", "");
  const roomAvatarContent = Array.isArray(roomAvatarEvent)
    ? asEvent(roomAvatarEvent.find((item) => asEvent(item)?.getType?.() === "m.room.avatar"))?.getContent?.()
    : asEvent(roomAvatarEvent)?.getContent?.();
  const roomAvatarUrl = stringValue(roomAvatarContent?.url);
  if (roomAvatarUrl) {
    return matrixMediaHttpUrl(client, homeserverBaseUrl, roomAvatarUrl, true) ?? roomAvatarUrl;
  }

  const otherMembers = readRoomJoinedMembers(room).filter((member) => member.userId && member.userId !== ownUserId);
  if (otherMembers.length !== 1) {
    return undefined;
  }
  const userId = otherMembers[0]?.userId;
  return readMemberAvatarUrl(
    otherMembers[0],
    client,
    homeserverBaseUrl,
    userId ? presenceByUserId?.get(userId) : undefined
  );
}

function readRoomDirectPeer(
  room: MatrixRoomLike,
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  ownUserId: string | undefined,
  presenceByUserId: Map<string, MatrixUserPresenceLike & { fetchedAt: number }> | undefined
): MatrixRoomSummary["directPeer"] {
  const otherMembers = readRoomJoinedMembers(room).filter((member) => member.userId && member.userId !== ownUserId);
  if (otherMembers.length !== 1) {
    return undefined;
  }
  const member = otherMembers[0];
  const userId = member?.userId;
  if (!member || !userId) {
    return undefined;
  }
  const cached = presenceByUserId?.get(userId);
  const user = client.getUser?.(userId) ?? member.user;
  const displayName = preferredMatrixDisplayName(userId, [
    member.name,
    member.rawDisplayName,
    member.displayName,
    cached?.displayName,
    user?.displayName
  ]);
  const avatarUrl = readMemberAvatarUrl(member, client, homeserverBaseUrl, cached);
  return {
    ...(avatarUrl ? { avatarUrl } : {}),
    displayName,
    userId
  };
}

function readMemberAvatarUrl(
  member: MatrixRoomMemberLike | undefined,
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  profile: MatrixUserPresenceLike | undefined = undefined
): string | undefined {
  const candidates = [
    member?.getMxcAvatarUrl?.() ?? undefined,
    member?.avatarUrl,
    profile?.avatarUrl,
    member?.user?.avatarUrl
  ];
  const avatarUrl = candidates
    .map((value) => (typeof value === "string" && value.trim() ? value.trim() : undefined))
    .find((value): value is string => Boolean(value));
  return avatarUrl ? (matrixMediaHttpUrl(client, homeserverBaseUrl, avatarUrl, true) ?? avatarUrl) : undefined;
}

function trimmedMatrixString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function preferredMatrixDisplayName(userId: string, values: unknown[]): string {
  const candidates = values.map(trimmedMatrixString).filter((value): value is string => Boolean(value));
  return (
    candidates.find((value) => !isOpaqueMatrixIdentityLabel(value, userId)) ?? candidates[0] ?? matrixLocalpart(userId)
  );
}

function isOpaqueMatrixIdentityLabel(value: string, userId: string): boolean {
  const normalizedValue = value.trim().toLocaleLowerCase("cs-CZ");
  const normalizedUserId = userId.trim().toLocaleLowerCase("cs-CZ");
  const normalizedLocalpart = matrixLocalpart(userId).trim().toLocaleLowerCase("cs-CZ");
  return (
    normalizedValue === normalizedUserId ||
    normalizedValue === normalizedLocalpart ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalizedValue)
  );
}

function matrixLocalpart(userId: string): string {
  const localpart = /^@([^:]+):/u.exec(userId)?.[1];
  return localpart ? localpart.replace(/[._-]+/gu, " ") : userId;
}

function normalizeMatrixPresence(user: MatrixUserPresenceLike | undefined): MatrixPresenceState {
  if (user?.currentlyActive === true) {
    return "online";
  }
  const presence = typeof user?.presence === "string" ? user.presence.toLowerCase() : "";
  if (presence === "online") {
    return "online";
  }
  if (presence === "unavailable" || presence === "busy") {
    return "unavailable";
  }
  if (presence === "offline") {
    return "offline";
  }
  return "unknown";
}

function findMatrixRoom(client: MatrixClientLike, roomId: string): MatrixRoomLike | undefined {
  return (client.getRooms?.() ?? [])
    .map(asRoom)
    .find((candidate): candidate is MatrixRoomLike & { roomId: string } => candidate?.roomId === roomId);
}

function readTimeline(client: MatrixClientLike, roomId: string, homeserverBaseUrl: string): MatrixTimelineMessage[] {
  const room = findMatrixRoom(client, roomId);
  const currentUserId = client.getUserId?.() ?? undefined;
  const retentionSeconds = room ? readRoomRetentionSeconds(room) : undefined;
  const timelineEvents = (room?.timeline ?? [])
    .map(asEvent)
    .filter((event): event is MatrixEventLike => Boolean(event));
  const messageEvents = timelineEvents.filter(isTimelineMessageEvent);
  const readableMessageEvents = messageEvents.filter((event) => matrixTimelineEventType(event) === "m.room.message");
  const redactedEventIds = readRedactedEventIds(timelineEvents);
  const reactionsByEventId = readMessageReactions(
    room,
    readableMessageEvents,
    timelineEvents,
    currentUserId,
    redactedEventIds
  );
  return messageEvents
    .flatMap((event) => {
      const eventId = event.getId?.() ?? `${event.getSender?.() ?? "sender"}-${event.getTs?.() ?? Date.now()}`;
      if (redactedEventIds.has(eventId)) {
        return [];
      }
      if (matrixTimelineEventType(event) === "m.room.encrypted") {
        // Keep pending encrypted events in the Matrix SDK timeline so they can
        // appear as soon as Event.decrypted fires, but never present a crypto
        // diagnostic as if it were a chat message from the sender.
        return [];
      }
      const mapped = mapMatrixMessageEvent(
        client,
        room ?? undefined,
        homeserverBaseUrl,
        event,
        currentUserId,
        reactionsByEventId.get(eventId)
      );
      return mapped && mapped.decryptionState !== "undecryptable" ? [mapped] : [];
    })
    .filter((message) => messageWithinRetention(message, retentionSeconds));
}

function isTimelineMessageEvent(event: MatrixEventLike): boolean {
  const type = matrixTimelineEventType(event);
  if (isMatrixCallEventType(type)) {
    return false;
  }
  return type === "m.room.message" || type === "m.room.encrypted";
}

function matrixTimelineEventType(event: MatrixEventLike): string | undefined {
  const type = event.getType?.();
  const effectiveType = stringValue(asRecord(event.getEffectiveEvent?.())?.type);
  if (type === "m.room.encrypted" && effectiveType && effectiveType !== "m.room.encrypted") {
    return effectiveType;
  }
  return type;
}

function matrixTimelineWireEventType(event: MatrixEventLike): string | undefined {
  return event.getWireType?.() ?? event.getType?.();
}

function isMatrixCallEventType(type: string | undefined): boolean {
  return Boolean(type?.startsWith("m.call.") || type?.startsWith("org.matrix.call."));
}

function matrixTimelineEventContent(event: MatrixEventLike): Record<string, unknown> {
  return event.getClearContent?.() ?? event.getContent?.() ?? {};
}

// Maps a single m.room.message event to a timeline message. Returns null for
// empty/redacted content. Shared by full-timeline reads and the cheap
// last-message summary so both stay in sync.
function mapMatrixMessageEvent(
  client: MatrixClientLike,
  room: MatrixRoomLike | undefined,
  homeserverBaseUrl: string,
  event: MatrixEventLike,
  currentUserId: string | undefined,
  reactions?: MatrixMessageReaction[]
): MatrixTimelineMessage | null {
  const eventId = event.getId?.() ?? `${event.getSender?.() ?? "sender"}-${event.getTs?.() ?? Date.now()}`;
  const content = matrixTimelineEventContent(event);
  const rawBody = stripMatrixReplyFallback(typeof content.body === "string" ? content.body.trim() : "");
  const body = normalizeMatrixMessageBody(rawBody);
  const kind = matrixMessageKind(content);
  const attachment = matrixAttachmentFromContent(client, homeserverBaseUrl, content);
  const geoUri = readLocationUri(content);
  const location = geoUri ? matrixLocationFromGeoUri(geoUri, content) : undefined;
  const transit = matrixTransitShareFromContent(content);
  if (!body && !attachment && !location && !transit) {
    return null;
  }
  const cop = matrixCopMessageMetadataFromContent(content);
  const sender = event.getSender?.() ?? "";
  const senderDisplayName = displayNameForMatrixSender(room, sender);
  return {
    ...(attachment ? { attachment } : {}),
    body,
    ...(cop ? { cop } : {}),
    ...(isUndecryptableMatrixBody(rawBody) && !attachment && !location && !transit
      ? { decryptionState: "undecryptable" as const }
      : {}),
    eventId,
    ...(geoUri ? { geoUri } : {}),
    kind,
    ...(location ? { location } : {}),
    own: Boolean(currentUserId && sender === currentUserId),
    ...(reactions?.length ? { reactions } : {}),
    ...(readReplyToEventId(content) ? { replyToEventId: readReplyToEventId(content) } : {}),
    sender,
    ...(senderDisplayName ? { senderDisplayName } : {}),
    timestamp: new Date(event.getTs?.() ?? Date.now()).toISOString(),
    ...(transit ? { transit } : {})
  };
}

// Cheap last-message preview for the chat list: scans the room timeline from the
// end and maps only the first readable message, instead of materializing the
// whole timeline for every room on every update. Reactions are omitted (the list
// preview does not render them).
function readRoomLatestMessage(
  client: MatrixClientLike,
  room: MatrixRoomLike | undefined,
  homeserverBaseUrl: string,
  currentUserId: string | undefined
): MatrixTimelineMessage | undefined {
  const retentionSeconds = room ? readRoomRetentionSeconds(room) : undefined;
  const events = room?.timeline ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = asEvent(events[index]);
    if (!event || !isTimelineMessageEvent(event)) {
      continue;
    }
    if (matrixTimelineEventType(event) === "m.room.encrypted") {
      continue;
    }
    const mapped = mapMatrixMessageEvent(client, room, homeserverBaseUrl, event, currentUserId);
    if (mapped && mapped.decryptionState !== "undecryptable" && messageWithinRetention(mapped, retentionSeconds)) {
      return mapped;
    }
  }
  return undefined;
}

function latestReadableMessageEvent(room: MatrixRoomLike | undefined): MatrixEventLike | undefined {
  const events = room?.timeline ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = asEvent(events[index]);
    if (
      event &&
      matrixTimelineEventType(event) === "m.room.message" &&
      !isUndecryptableMatrixBody(stringValue(matrixTimelineEventContent(event).body) ?? "")
    ) {
      return event;
    }
  }
  return undefined;
}

function readRedactedEventIds(events: MatrixEventLike[]): Set<string> {
  const redacted = new Set<string>();
  for (const event of events) {
    if (event.getType?.() !== "m.room.redaction") {
      continue;
    }
    const targetId = event.getAssociatedId?.() ?? stringValue(asRecord(event.getContent?.())?.redacts);
    if (targetId) {
      redacted.add(targetId);
    }
  }
  return redacted;
}

function readMessageReactions(
  room: MatrixRoomLike | undefined,
  messageEvents: MatrixEventLike[],
  timelineEvents: MatrixEventLike[],
  currentUserId: string | undefined,
  redactedEventIds: Set<string>
): Map<string, MatrixMessageReaction[]> {
  const reactionEvents = new Map<string, MatrixEventLike>();
  for (const event of timelineEvents) {
    if (event.getType?.() === "m.reaction") {
      const reactionEventId = event.getId?.();
      if (reactionEventId && redactedEventIds.has(reactionEventId)) {
        continue;
      }
      reactionEvents.set(reactionEventId ?? `${event.getSender?.() ?? ""}:${event.getTs?.() ?? ""}`, event);
    }
  }
  for (const event of messageEvents) {
    const eventId = event.getId?.();
    if (!eventId) {
      continue;
    }
    const relations =
      room?.relations?.getChildEventsForEvent?.(eventId, "m.annotation", "m.reaction")?.getRelations?.() ?? [];
    for (const relation of relations) {
      const reactionEvent = asEvent(relation);
      if (reactionEvent) {
        const reactionEventId = reactionEvent.getId?.();
        if (reactionEventId && redactedEventIds.has(reactionEventId)) {
          continue;
        }
        reactionEvents.set(
          reactionEventId ?? `${reactionEvent.getSender?.() ?? ""}:${reactionEvent.getTs?.() ?? ""}:${eventId}`,
          reactionEvent
        );
      }
    }
  }

  const bucketsByEventId = new Map<string, Map<string, Map<string, { eventId?: string; label: string }>>>();
  for (const event of reactionEvents.values()) {
    const reactionEventId = event.getId?.();
    const relation = readEventRelation(event);
    const targetEventId = stringValue(relation?.event_id);
    const relationType = stringValue(relation?.rel_type);
    const key = stringValue(relation?.key);
    const sender = event.getSender?.() ?? "";
    if (!targetEventId || relationType !== "m.annotation" || !key || !sender) {
      continue;
    }
    const senderLabel = displayNameForMatrixSender(room, sender) ?? sender;
    const buckets =
      bucketsByEventId.get(targetEventId) ?? new Map<string, Map<string, { eventId?: string; label: string }>>();
    const senders = buckets.get(key) ?? new Map<string, { eventId?: string; label: string }>();
    senders.set(sender, {
      ...(reactionEventId ? { eventId: reactionEventId } : {}),
      label: senderLabel
    });
    buckets.set(key, senders);
    bucketsByEventId.set(targetEventId, buckets);
  }

  const reactionsByEventId = new Map<string, MatrixMessageReaction[]>();
  for (const [eventId, buckets] of bucketsByEventId.entries()) {
    reactionsByEventId.set(
      eventId,
      [...buckets.entries()]
        .map(([key, senders]) => {
          const ownSender = currentUserId ? senders.get(currentUserId) : undefined;
          return {
            count: senders.size,
            key,
            own: Boolean(ownSender),
            ...(ownSender?.eventId ? { ownEventId: ownSender.eventId } : {}),
            senders: [...senders.values()].map((sender) => sender.label)
          };
        })
        .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "cs-CZ"))
    );
  }
  return reactionsByEventId;
}

function findOwnReactionEvents(
  client: MatrixClientLike,
  roomId: string,
  targetEventId: string
): Array<{ eventId: string; key: string }> {
  const currentUserId = client.getUserId?.() ?? undefined;
  if (!currentUserId) {
    return [];
  }
  const room = findMatrixRoom(client, roomId);
  const timelineEvents = (room?.timeline ?? [])
    .map(asEvent)
    .filter((event): event is MatrixEventLike => Boolean(event));
  const redactedEventIds = readRedactedEventIds(timelineEvents);
  const reactionEvents = new Map<string, MatrixEventLike>();
  for (const event of timelineEvents) {
    if (event.getType?.() !== "m.reaction") {
      continue;
    }
    const reactionEventId = event.getId?.();
    if (!reactionEventId || redactedEventIds.has(reactionEventId)) {
      continue;
    }
    reactionEvents.set(reactionEventId, event);
  }
  const relatedEvents =
    room?.relations?.getChildEventsForEvent?.(targetEventId, "m.annotation", "m.reaction")?.getRelations?.() ?? [];
  for (const relation of relatedEvents) {
    const reactionEvent = asEvent(relation);
    const reactionEventId = reactionEvent?.getId?.();
    if (!reactionEvent || !reactionEventId || redactedEventIds.has(reactionEventId)) {
      continue;
    }
    reactionEvents.set(reactionEventId, reactionEvent);
  }

  const ownReactions: Array<{ eventId: string; key: string }> = [];
  for (const event of reactionEvents.values()) {
    const relation = readEventRelation(event);
    const relationTargetEventId = stringValue(relation?.event_id);
    const relationType = stringValue(relation?.rel_type);
    const key = stringValue(relation?.key);
    const sender = event.getSender?.() ?? "";
    const reactionEventId = event.getId?.();
    if (
      relationTargetEventId === targetEventId &&
      relationType === "m.annotation" &&
      key &&
      sender === currentUserId &&
      reactionEventId
    ) {
      ownReactions.push({ eventId: reactionEventId, key });
    }
  }
  return ownReactions;
}

function readEventRelation(event: MatrixEventLike): Record<string, unknown> | undefined {
  const sdkRelation = event.getRelation?.();
  if (sdkRelation) {
    return sdkRelation;
  }
  return asRecord(event.getContent?.()?.["m.relates_to"]);
}

function readReplyToEventId(content: Record<string, unknown>): string | undefined {
  const relation = asRecord(content["m.relates_to"]);
  const reply = asRecord(relation?.["m.in_reply_to"]);
  return stringValue(reply?.event_id);
}

function stripMatrixReplyFallback(body: string): string {
  if (!body.startsWith("> ")) {
    return body;
  }
  const dividerIndex = body.indexOf("\n\n");
  if (dividerIndex === -1) {
    return body;
  }
  return body.slice(dividerIndex + 2).trimStart();
}

function readRoomRetentionSeconds(room: MatrixRoomLike): number | undefined {
  const event = room.currentState?.getStateEvents?.("m.room.retention", "");
  const content = Array.isArray(event)
    ? asEvent(event.find((item) => asEvent(item)?.getType?.() === "m.room.retention"))?.getContent?.()
    : asEvent(event)?.getContent?.();
  const maxLifetimeMs = typeof content?.max_lifetime === "number" ? content.max_lifetime : undefined;
  if (!Number.isFinite(maxLifetimeMs) || !maxLifetimeMs || maxLifetimeMs <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(maxLifetimeMs / 1000));
}

function messageWithinRetention(message: MatrixTimelineMessage, retentionSeconds: number | undefined): boolean {
  if (!retentionSeconds) {
    return true;
  }
  const timestamp = Date.parse(message.timestamp);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return timestamp >= Date.now() - retentionSeconds * 1000;
}

export function normalizeMatrixMessageBody(body: string): string {
  return isUndecryptableMatrixBody(body) ? undecryptableMatrixMessageBody : body;
}

const undecryptableMatrixMessageBody =
  "Zprávu zatím nelze zobrazit. V tomto prohlížeči chybí šifrovací klíč pro starší zprávy.";

function isUndecryptableMatrixBody(body: string): boolean {
  return /unable to decrypt|decryptionerror|no key backup|before this device logged in/iu.test(body);
}

function displayNameForMatrixSender(room: MatrixRoomLike | undefined, sender: string): string | undefined {
  if (!sender) {
    return undefined;
  }
  const member = room?.getMember?.(sender) ?? undefined;
  const candidates = [member?.rawDisplayName, member?.name, member?.user?.displayName];
  return candidates
    .map((value) => cleanMatrixDisplayName(value, sender))
    .find((value): value is string => Boolean(value));
}

function cleanMatrixDisplayName(value: string | undefined, sender: string): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned || cleaned === sender || looksLikeMatrixUserId(cleaned)) {
    return undefined;
  }
  return cleaned.replace(/\s+\(@[^)]+:[^)]+\)$/u, "").trim() || undefined;
}

function looksLikeMatrixUserId(value: string): boolean {
  return /^@[^:\s]+:[^:\s]+$/u.test(value);
}

function matrixMessageKind(content: Record<string, unknown>): MatrixTimelineMessage["kind"] {
  if (asRecord(content["cz.cop.transit"])) {
    return "transit";
  }
  if (content.msgtype === "m.image") {
    return "image";
  }
  if (content.msgtype === "m.video") {
    return "video";
  }
  if (content.msgtype === "m.file") {
    return "file";
  }
  if (content.msgtype === "m.location") {
    return "location";
  }
  return "text";
}

function matrixCopMessageMetadataFromContent(content: Record<string, unknown>): MatrixCopMessageMetadata | undefined {
  return sanitizeCopMessageMetadata(asRecord(content["cz.cop"]));
}

function sanitizeCopMessageMetadata(value: unknown): MatrixCopMessageMetadata | undefined {
  const record = asRecord(value);
  if (!record || record.source !== "cop-chat") {
    return undefined;
  }
  const kind = record.kind === "ai-agent-response" || record.kind === "ai-situation-summary" ? record.kind : undefined;
  const ai = sanitizeCopAiMessageMetadata(record.ai);
  if (!kind && !ai) {
    return undefined;
  }
  return {
    ...(ai ? { ai } : {}),
    ...(kind ? { kind } : {}),
    source: "cop-chat"
  };
}

function sanitizeCopAiMessageMetadata(value: unknown): MatrixCopMessageMetadata["ai"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const type: MatrixCopAiMessageMetadata["type"] =
    record.type === "chat-agent" || record.type === "situation-summary" ? record.type : undefined;
  const status: MatrixCopAiMessageMetadata["status"] =
    record.status === "COMPLETED" || record.status === "NEEDS_HUMAN_REVIEW" || record.status === "REJECTED"
      ? record.status
      : undefined;
  const auditId = stringValue(record.auditId)?.slice(0, 160);
  const model = stringValue(record.model)?.slice(0, 120);
  const policyReason = stringValue(record.policyReason)?.slice(0, 240);
  const provider = stringValue(record.provider)?.slice(0, 80);
  const question = stringValue(record.question)?.slice(0, 500);
  const requestId = stringValue(record.requestId)?.slice(0, 160);
  const responsePlaybook = sanitizeCopAiResponsePlaybook(record.responsePlaybook);
  const indexedDocumentCount = nonNegativeInteger(record.indexedDocumentCount, 0, 1000);
  const indexedStatus: MatrixCopAiMessageMetadata["indexedStatus"] =
    record.indexedStatus === "ok" || record.indexedStatus === "degraded" || record.indexedStatus === "disabled"
      ? record.indexedStatus
      : undefined;
  const mapActions = sanitizeCopMapActions(record.mapActions);
  const semanticDocumentCount = nonNegativeInteger(record.semanticDocumentCount, 0, 1000);
  const semanticStatus: MatrixCopAiMessageMetadata["semanticStatus"] =
    record.semanticStatus === "ok" || record.semanticStatus === "degraded" || record.semanticStatus === "disabled"
      ? record.semanticStatus
      : undefined;
  const ai: MatrixCopAiMessageMetadata = {
    ...(auditId ? { auditId } : {}),
    ...(indexedDocumentCount !== undefined ? { indexedDocumentCount } : {}),
    ...(indexedStatus ? { indexedStatus } : {}),
    ...(mapActions ? { mapActions } : {}),
    ...(model ? { model } : {}),
    ...(policyReason ? { policyReason } : {}),
    ...(provider ? { provider } : {}),
    ...(question ? { question } : {}),
    ...(requestId ? { requestId } : {}),
    ...(responsePlaybook ? { responsePlaybook } : {}),
    ...(semanticDocumentCount !== undefined ? { semanticDocumentCount } : {}),
    ...(semanticStatus ? { semanticStatus } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {})
  };
  return Object.keys(ai).length ? ai : undefined;
}

function sanitizeCopAiResponsePlaybook(value: unknown): MatrixCopAiMessageMetadata["responsePlaybook"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const allowedActions = stringListValue(record.allowedActions, 12, 40);
  const forbiddenActions = stringListValue(record.forbiddenActions, 12, 40);
  const requiredSources = stringListValue(record.requiredSources, 16, 80);
  const confidence = finiteNumber(record.confidence, 0, 1);
  const domain = stringValue(record.domain)?.slice(0, 80);
  const intentId = stringValue(record.intentId)?.slice(0, 120);
  const responsePlaybook: NonNullable<MatrixCopAiMessageMetadata["responsePlaybook"]> = {
    ...(allowedActions.length > 0 ? { allowedActions } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(domain ? { domain } : {}),
    ...(forbiddenActions.length > 0 ? { forbiddenActions } : {}),
    ...(intentId ? { intentId } : {}),
    ...(requiredSources.length > 0 ? { requiredSources } : {})
  };
  return Object.keys(responsePlaybook).length ? responsePlaybook : undefined;
}

function sanitizeCopMapActions(value: unknown): MatrixCopMapAction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const actions = value
    .map(sanitizeCopMapAction)
    .filter((action): action is MatrixCopMapAction => action !== undefined)
    .slice(0, 3);
  return actions.length > 0 ? actions : undefined;
}

function sanitizeCopMapAction(value: unknown): MatrixCopMapAction | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const lat = finiteNumber(record.lat, -90, 90);
  const lon = finiteNumber(record.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  const category = stringValue(record.category)?.slice(0, 80);
  const distanceText = stringValue(record.distanceText)?.slice(0, 80);
  const entityId = stringValue(record.entityId)?.slice(0, 200);
  const entityType = stringValue(record.entityType)?.slice(0, 80);
  const layerId = stringValue(record.layerId)?.slice(0, 160);
  const sourceName = stringValue(record.sourceName)?.slice(0, 160);
  const sourceSystemIds = stringListValue(record.sourceSystemIds, 16, 160);
  const title = stringValue(record.title)?.slice(0, 200);
  const zoom = finiteNumber(record.zoom, 3, 20);
  return {
    action: "focus-map",
    ...(category ? { category } : {}),
    ...(distanceText ? { distanceText } : {}),
    ...(entityId ? { entityId } : {}),
    ...(entityType ? { entityType } : {}),
    label: stringValue(record.label)?.slice(0, 240) ?? title ?? "Zobrazit na mapě",
    ...(layerId ? { layerId } : {}),
    lat,
    lon,
    ...(sourceName ? { sourceName } : {}),
    ...(sourceSystemIds.length > 0 ? { sourceSystemIds } : {}),
    ...(title ? { title } : {}),
    ...(zoom !== undefined ? { zoom } : {})
  };
}

function sanitizeTransitShare(transit: MatrixTransitShare): MatrixTransitShare {
  return {
    ...(stringValue(transit.detailUrl) ? { detailUrl: stringValue(transit.detailUrl) } : {}),
    ...(stringValue(transit.destination) ? { destination: stringValue(transit.destination) } : {}),
    featureId: stringValue(transit.featureId) ?? "transit",
    ...(stringValue(transit.label) ? { label: stringValue(transit.label) } : {}),
    ...(typeof transit.lat === "number" && Number.isFinite(transit.lat) ? { lat: Number(transit.lat.toFixed(6)) } : {}),
    ...(typeof transit.lon === "number" && Number.isFinite(transit.lon) ? { lon: Number(transit.lon.toFixed(6)) } : {}),
    ...(stringValue(transit.nextStopName) ? { nextStopName: stringValue(transit.nextStopName) } : {}),
    ...(stringValue(transit.observedAt) ? { observedAt: stringValue(transit.observedAt) } : {}),
    ...(stringValue(transit.operator) ? { operator: stringValue(transit.operator) } : {}),
    ...(stringValue(transit.routeShortName) ? { routeShortName: stringValue(transit.routeShortName) } : {}),
    ...(stringValue(transit.sourceId) ? { sourceId: stringValue(transit.sourceId) } : {}),
    ...(stringValue(transit.status) ? { status: stringValue(transit.status) } : {}),
    ...(stringValue(transit.transportMode) ? { transportMode: stringValue(transit.transportMode) } : {}),
    ...(stringValue(transit.vehicleId) ? { vehicleId: stringValue(transit.vehicleId) } : {}),
    ...(Array.isArray(transit.warnings)
      ? {
          warnings: transit.warnings
            .filter((item) => stringValue(item))
            .map((item) => item.trim())
            .slice(0, 5)
        }
      : {})
  };
}

function matrixTransitShareFromContent(content: Record<string, unknown>): MatrixTransitShare | undefined {
  const data = asRecord(content["cz.cop.transit"]);
  const featureId = stringValue(data?.featureId);
  if (!data || !featureId) {
    return undefined;
  }
  return sanitizeTransitShare({
    detailUrl: stringValue(data.detailUrl),
    destination: stringValue(data.destination),
    featureId,
    label: stringValue(data.label),
    lat: typeof data.lat === "number" ? data.lat : undefined,
    lon: typeof data.lon === "number" ? data.lon : undefined,
    nextStopName: stringValue(data.nextStopName),
    observedAt: stringValue(data.observedAt),
    operator: stringValue(data.operator),
    routeShortName: stringValue(data.routeShortName),
    sourceId: stringValue(data.sourceId),
    status: stringValue(data.status),
    transportMode: stringValue(data.transportMode),
    vehicleId: stringValue(data.vehicleId),
    warnings: Array.isArray(data.warnings)
      ? data.warnings.filter((item): item is string => typeof item === "string")
      : undefined
  });
}

function formatTransitShareBody(transit: MatrixTransitShare): string {
  const route = transit.routeShortName ? ` ${transit.routeShortName}` : "";
  const destination = transit.destination ? ` → ${transit.destination}` : "";
  const status = transit.status ? ` (${transit.status})` : "";
  const nextStop = transit.nextStopName ? `\nPříští zastávka: ${transit.nextStopName}` : "";
  const observed = transit.observedAt ? `\nPozorováno: ${transit.observedAt}` : "";
  return `Jsem ve spoji${route}${destination}${status}.${nextStop}${observed}`.trim();
}

function matrixAttachmentFromContent(
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  content: Record<string, unknown>
): MatrixTimelineAttachment | undefined {
  const kind = matrixMessageKind(content);
  if (kind !== "file" && kind !== "image" && kind !== "video") {
    return undefined;
  }
  const info = asRecord(content.info);
  const encrypted = asEncryptedFile(content.file);
  const rawUrl = typeof content.url === "string" ? content.url : encrypted?.url;
  const fileName =
    typeof content.filename === "string" && content.filename.trim()
      ? content.filename.trim()
      : typeof content.body === "string" && content.body.trim()
        ? content.body.trim()
        : defaultAttachmentName(kind);
  return {
    contentType: typeof info?.mimetype === "string" ? info.mimetype : undefined,
    ...(encrypted ? { encrypted } : {}),
    fileName,
    ...(rawUrl
      ? { mediaUrl: encrypted ? rawUrl : (matrixMediaHttpUrl(client, homeserverBaseUrl, rawUrl, false) ?? rawUrl) }
      : {}),
    size: typeof info?.size === "number" ? info.size : undefined
  };
}

function readLocationUri(content: Record<string, unknown>): string | undefined {
  if (typeof content.geo_uri === "string") {
    return content.geo_uri;
  }
  const extensibleLocation = asRecord(content["m.location"]);
  return typeof extensibleLocation?.uri === "string" ? extensibleLocation.uri : undefined;
}

function matrixLocationFromGeoUri(geoUri: string, content: Record<string, unknown>): MatrixLocationShare | undefined {
  const match = /^geo:([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)(?:[;,]u=([-+]?\d+(?:\.\d+)?))?/iu.exec(geoUri);
  if (!match) {
    return undefined;
  }
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return undefined;
  }
  const extensibleLocation = asRecord(content["m.location"]);
  const copLocation = asRecord(content["cz.cop.location"]);
  const source = copLocation?.source === "device" ? "device" : "map";
  const live = matrixLiveLocationShareFromContent(copLocation?.live);
  return {
    accuracyM: match[3] ? Number(match[3]) : undefined,
    label: typeof extensibleLocation?.description === "string" ? extensibleLocation.description : undefined,
    lat,
    ...(live ? { live } : {}),
    lon,
    source,
    ...(typeof copLocation?.updatedAt === "string" ? { updatedAt: copLocation.updatedAt } : {})
  };
}

function matrixLiveLocationShareFromContent(value: unknown): MatrixLocationShare["live"] | undefined {
  const data = asRecord(value);
  if (!data || typeof data.shareId !== "string" || !data.shareId.trim()) {
    return undefined;
  }
  return {
    ...(typeof data.durationSeconds === "number" && Number.isFinite(data.durationSeconds) && data.durationSeconds > 0
      ? { durationSeconds: Math.trunc(data.durationSeconds) }
      : {}),
    ...(typeof data.expiresAt === "string" && data.expiresAt.trim() ? { expiresAt: data.expiresAt.trim() } : {}),
    shareId: data.shareId.trim(),
    ...(typeof data.startedAt === "string" && data.startedAt.trim() ? { startedAt: data.startedAt.trim() } : {}),
    status: data.status === "ended" ? "ended" : "live",
    ...(typeof data.updatedAt === "string" && data.updatedAt.trim() ? { updatedAt: data.updatedAt.trim() } : {})
  };
}

function asEncryptedFile(value: unknown): MatrixEncryptedFileRef | undefined {
  const file = asRecord(value);
  const key = asRecord(file?.key);
  const hashes = asRecord(file?.hashes);
  if (
    typeof file?.url !== "string" ||
    typeof file.iv !== "string" ||
    typeof file.v !== "string" ||
    typeof key?.k !== "string" ||
    typeof hashes?.sha256 !== "string"
  ) {
    return undefined;
  }
  return {
    hashes: Object.fromEntries(
      Object.entries(hashes).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    ),
    iv: file.iv,
    key: {
      alg: typeof key.alg === "string" ? key.alg : "A256CTR",
      ext: key.ext === true,
      k: key.k,
      key_ops: Array.isArray(key.key_ops)
        ? key.key_ops.filter((item): item is string => typeof item === "string")
        : ["encrypt", "decrypt"],
      kty: typeof key.kty === "string" ? key.kty : "oct"
    },
    url: file.url,
    v: file.v
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringListValue(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value.flatMap((item) => {
        const normalized = stringValue(item)?.slice(0, maxLength);
        return normalized ? [normalized] : [];
      })
    )
  ).slice(0, maxItems);
}

function nonNegativeInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : undefined;
}

function finiteNumber(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : undefined;
}

function matrixMsgTypeForAttachment(kind: MatrixAttachmentKind): "m.file" | "m.image" | "m.video" {
  if (kind === "image") {
    return "m.image";
  }
  if (kind === "video") {
    return "m.video";
  }
  return "m.file";
}

function defaultAttachmentName(kind: MatrixAttachmentKind | MatrixTimelineMessage["kind"]): string {
  if (kind === "image") {
    return "fotka";
  }
  if (kind === "video") {
    return "video";
  }
  return "soubor";
}

function matrixMediaHttpUrl(
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  mxcUrl: string,
  authenticated: boolean
): string | undefined {
  if (!mxcUrl.startsWith("mxc://")) {
    return mxcUrl;
  }
  return (
    client.mxcUrlToHttp?.(mxcUrl, undefined, undefined, undefined, false, true, authenticated) ??
    fallbackMxcDownloadUrl(homeserverBaseUrl, mxcUrl)
  );
}

function fallbackMxcDownloadUrl(homeserverBaseUrl: string, mxcUrl: string): string | undefined {
  const match = /^mxc:\/\/([^/]+)\/(.+)$/u.exec(mxcUrl);
  if (!match) {
    return undefined;
  }
  const [, serverName, mediaId] = match;
  if (!serverName || !mediaId) {
    return undefined;
  }
  return `${homeserverBaseUrl.replace(/\/+$/u, "")}/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
}

function encodeBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=+$/u, "");
}

function decodeBase64(value: string): ArrayBuffer {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function asRoom(value: unknown): MatrixRoomLike | null {
  return typeof value === "object" && value !== null ? (value as MatrixRoomLike) : null;
}

function asEvent(value: unknown): MatrixEventLike | null {
  return typeof value === "object" && value !== null ? (value as MatrixEventLike) : null;
}
