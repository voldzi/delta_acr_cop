import type {
  MessagingBootstrapResponse,
  MatrixAttachmentKind,
  MatrixAttachmentUpload,
  MatrixEncryptedFileRef,
  MatrixEncryptionRecoveryStatus,
  MatrixLocationShare,
  MatrixMessageReaction,
  MatrixMessageReplyTarget,
  MatrixMessagingSession,
  MatrixTransitShare,
  MatrixUserProfileSyncInput,
  MatrixPresenceState,
  MatrixRoomSummary,
  MatrixTimelineAttachment,
  MatrixTimelineMessage
} from "./types.js";

interface MatrixClientLike {
  createRoom?: (options: Record<string, unknown>) => Promise<{ room_id?: string; roomId?: string }>;
  getCrypto?: () => MatrixCryptoApiLike | undefined;
  getJoinedRooms?: () => Promise<{ joined_rooms?: unknown } | unknown[]>;
  getProfileInfo?: (userId: string) => Promise<Record<string, unknown>>;
  getRooms?: () => unknown[];
  getUserId?: () => string | null;
  getUser?: (userId: string) => MatrixUserPresenceLike | undefined;
  initRustCrypto?: (args?: { cryptoDatabasePrefix?: string }) => Promise<void>;
  invite?: (roomId: string, userId: string) => Promise<unknown>;
  isRoomEncrypted?: (roomId: string) => boolean;
  joinRoom?: (roomIdOrAlias: string) => Promise<{ room_id?: string; roomId?: string }>;
  leave?: (roomId: string) => Promise<unknown>;
  mxcUrlToHttp?: (mxcUrl: string, width?: number, height?: number, resizeMethod?: string, allowDirectLinks?: boolean, allowRedirects?: boolean, useAuthentication?: boolean) => string | null;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  redactEvent?: (roomId: string, eventId: string, txnId?: string, opts?: Record<string, unknown>) => Promise<unknown>;
  sendReadReceipt?: (event: MatrixEventLike, receiptType?: string) => Promise<unknown>;
  sendEvent?: (roomId: string, eventType: string, content: Record<string, unknown>, txnId?: string) => Promise<unknown>;
  sendMessage?: (roomId: string, content: Record<string, unknown>) => Promise<unknown>;
  sendStateEvent?: (roomId: string, eventType: string, content: Record<string, unknown>, stateKey?: string) => Promise<unknown>;
  sendTextMessage?: (roomId: string, body: string) => Promise<unknown>;
  setRoomReadMarkers?: (roomId: string, readMarkerEventId: string, readReceiptEvent?: MatrixEventLike) => Promise<unknown>;
  setPresence?: (options: { presence: "offline" | "online" | "unavailable" }) => Promise<unknown>;
  startClient?: (options?: Record<string, unknown>) => Promise<void> | void;
  stopClient?: () => void;
  scrollback?: (room: MatrixRoomLike, limit?: number) => Promise<unknown>;
  setAvatarUrl?: (mxcUrl: string) => Promise<unknown>;
  setDisplayName?: (displayName: string) => Promise<unknown>;
  uploadContent?: (file: Blob | File, opts?: Record<string, unknown>) => Promise<{ content_uri?: string; contentUri?: string }>;
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
  getActiveSessionBackupVersion?: () => Promise<string | null>;
  getKeyBackupInfo?: () => Promise<unknown | null>;
  isCrossSigningReady?: () => Promise<boolean>;
  isSecretStorageReady?: () => Promise<boolean>;
  loadSessionBackupPrivateKeyFromSecretStorage?: () => Promise<void>;
  resetEncryption?: (authUploadDeviceSigningKeys: MatrixInteractiveAuthCallback) => Promise<void>;
  restoreKeyBackup?: (options?: Record<string, unknown>) => Promise<unknown>;
}

type MatrixInteractiveAuthCallback = (makeRequest: (authData: Record<string, unknown> | null) => Promise<unknown>) => Promise<unknown>;

interface MatrixRecoveryController {
  readonly cryptoCallbacks: Record<string, unknown>;
  setGeneratedSecretStorageKey(generatedKey: unknown): void;
  setRecoveryKey(recoveryKey: string): void;
}

interface MatrixSdkLike {
  createClient: (options: Record<string, unknown>) => MatrixClientLike;
  Room?: {
    prototype?: {
      __copChatPollAggregationDisabled?: boolean;
      processPollEvents?: (events: unknown[]) => Promise<void> | void;
    };
  };
}

interface MatrixRoomLike {
  getJoinedMembers?: () => MatrixRoomMemberLike[];
  getMember?: (userId: string) => MatrixRoomMemberLike | null;
  getMyMembership?: () => string;
  getUnreadNotificationCount?: () => number;
  currentState?: MatrixRoomStateLike;
  name?: string;
  relations?: MatrixRelationsContainerLike;
  roomId?: string;
  timeline?: unknown[];
}

interface MatrixRelationsContainerLike {
  getChildEventsForEvent?: (eventId: string, relationType: string, eventType: string) => MatrixRelationsLike | undefined;
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

interface MatrixEventLike {
  getAssociatedId?: () => string | undefined;
  getContent?: () => Record<string, unknown>;
  getId?: () => string | undefined;
  getRelation?: () => Record<string, unknown> | null;
  getRoomId?: () => string | undefined;
  getSender?: () => string | undefined;
  getStateKey?: () => string | undefined;
  getTs?: () => number | undefined;
  getType?: () => string | undefined;
}

export async function createMatrixMessagingSession(
  bootstrap: MessagingBootstrapResponse,
  callbacks: {
    onRoomsChanged?: (rooms: MatrixRoomSummary[]) => void;
    profile?: MatrixUserProfileSyncInput;
    onSyncState?: (state: string) => void;
    onTimelineChanged?: () => void;
  } = {}
): Promise<MatrixMessagingSession> {
  validateBootstrap(bootstrap);
  const homeserverBaseUrl = bootstrap.homeserverBaseUrl;
  if (!homeserverBaseUrl) {
    throw new Error("Zabezpečený chat nemá připravenou adresu služby.");
  }
  await assertBrowserCanReachHomeserver(homeserverBaseUrl);
  const matrixSdk = await import("matrix-js-sdk/lib/browser-index.js") as unknown as MatrixSdkLike;
  disableMatrixPollAggregation(matrixSdk);
  const createClient = matrixSdk.createClient;
  const recoveryController = createUserControlledRecoveryController();
  const client = createClient({
    accessToken: bootstrap.accessToken,
    baseUrl: homeserverBaseUrl,
    deviceId: bootstrap.deviceId,
    cryptoCallbacks: recoveryController.cryptoCallbacks,
    userId: bootstrap.userId
  });

  if (bootstrap.e2eeRequired) {
    if (typeof client.initRustCrypto !== "function") {
      throw new Error("Tento prohlížeč nepodporuje potřebné šifrování zpráv.");
    }
    try {
      await client.initRustCrypto({
        cryptoDatabasePrefix: matrixCryptoDatabasePrefix(bootstrap)
      });
    } catch (caught) {
      if (isMatrixAccountStoreMismatch(caught)) {
        throw new MatrixAccountStoreMismatchError(caught);
      }
      throw caught;
    }
    await enableKnownMatrixKeyBackup(client);
  }

  let inviteJoinInFlight: Promise<void> | null = null;
  const canReadServerJoinedRooms = typeof client.getJoinedRooms === "function" || typeof window !== "undefined";
  let joinedRoomIds: Set<string> | null = canReadServerJoinedRooms ? new Set() : null;
  let presenceRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const roomPresenceByUserId = new Map<string, MatrixUserPresenceLike & { fetchedAt: number }>();
  const refreshJoinedRoomIds = async () => {
    joinedRoomIds = await readServerJoinedRoomIds(client, homeserverBaseUrl, bootstrap.accessToken, joinedRoomIds);
  };
  const readVisibleRooms = () => readRooms(client, {
    allowedRoomIds: joinedRoomIds,
    homeserverBaseUrl,
    ownUserId: bootstrap.userId,
    presenceByUserId: roomPresenceByUserId
  });
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
        if (userId && userId !== bootstrap.userId) {
          userIds.add(userId);
        }
      }
    }
    const nowMs = Date.now();
    const staleUserIds = Array.from(userIds)
      .filter((userId) => nowMs - (roomPresenceByUserId.get(userId)?.fetchedAt ?? 0) > 30_000)
      .slice(0, 48);
    if (staleUserIds.length === 0) {
      return;
    }
    await Promise.all(staleUserIds.map(async (userId) => {
      const [presence, profile] = await Promise.all([
        fetchMatrixPresence(homeserverBaseUrl, bootstrap.accessToken, userId),
        fetchMatrixUserProfile(client, homeserverBaseUrl, bootstrap.accessToken, userId)
      ]);
      if (presence || profile) {
        roomPresenceByUserId.set(userId, {
          ...roomPresenceByUserId.get(userId),
          ...presence,
          ...profile,
          fetchedAt: Date.now(),
          userId
        });
      }
    }));
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

  const syncListener = (state: unknown) => {
    callbacks.onSyncState?.(typeof state === "string" ? state : "sync");
    scheduleNotify({ rooms: true, timeline: true });
    void joinInvitedRooms().then(() => {
      scheduleNotify({ rooms: true, timeline: true });
      schedulePresenceRefresh();
    });
  };
  const timelineListener = () => {
    scheduleNotify({ rooms: true, timeline: true });
    schedulePresenceRefresh();
  };
  const presenceListener = () => {
    scheduleNotify({ rooms: true });
    schedulePresenceRefresh(750);
  };
  client.on?.("sync", syncListener);
  client.on?.("Room.timeline", timelineListener);
  client.on?.("Event.decrypted", timelineListener);
  client.on?.("User.presence", presenceListener);
  client.on?.("RoomMember.membership", presenceListener);
  await refreshJoinedRoomIds();
  await client.startClient?.({ initialSyncLimit: 30 });
  void syncMatrixUserProfile(client, bootstrap, callbacks.profile).catch(() => undefined);
  void client.setPresence?.({ presence: "online" }).catch(() => undefined);
  await joinInvitedRooms();
  await refreshJoinedRoomIds();
  publishRooms();
  schedulePresenceRefresh(0);
  const exhaustedTimelineRooms = new Set<string>();

  return {
    bootstrap,
    createEncryptionRecovery: async (reset = false) => createUserControlledEncryptionRecovery(client, recoveryController, { reset }),
    createGroupRoom: async (name, inviteUserIds = []) => {
      if (typeof client.createRoom !== "function") {
        throw new Error("Chat se nepodařilo založit.");
      }
      let response: { room_id?: string; roomId?: string };
      try {
        response = await client.createRoom({
          invite: inviteUserIds,
          initial_state: bootstrap.e2eeRequired ? [{
            content: {
              algorithm: "m.megolm.v1.aes-sha2"
            },
            state_key: "",
            type: "m.room.encryption"
          }] : [],
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
      return downloadMatrixAttachment(client, bootstrap, homeserverBaseUrl, message.attachment);
    },
    getEncryptionRecoveryStatus: async () => readMatrixEncryptionRecoveryStatus(client),
    getRooms: readVisibleRooms,
    getTimeline: (roomId) => readTimeline(client, roomId, homeserverBaseUrl),
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
    joinInvitedRooms,
    leaveRoom: async (roomId) => {
      if (typeof client.leave !== "function") {
        throw new Error("Opuštění skupiny služba zpráv nepodporuje.");
      }
      try {
        await client.leave(roomId);
        joinedRoomIds?.delete(roomId);
        publishRooms();
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "opustit skupinu");
      }
    },
    loadMoreTimeline: async (roomId, limit = 80) => {
      if (exhaustedTimelineRooms.has(roomId)) {
        return {
          exhausted: true,
          messages: readTimeline(client, roomId, homeserverBaseUrl)
        };
      }
      if (typeof client.scrollback !== "function") {
        exhaustedTimelineRooms.add(roomId);
        return {
          exhausted: true,
          messages: readTimeline(client, roomId, homeserverBaseUrl)
        };
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        const room = findMatrixRoom(client, roomId);
        if (!room) {
          return { exhausted: false, messages: [] };
        }
        const beforeCount = room.timeline?.length ?? 0;
        await client.scrollback(room, Math.max(1, Math.min(250, Math.trunc(limit))));
        const nextRoom = findMatrixRoom(client, roomId) ?? room;
        const afterCount = nextRoom.timeline?.length ?? 0;
        const exhausted = beforeCount > 0 && afterCount <= beforeCount;
        if (exhausted) {
          exhaustedTimelineRooms.add(roomId);
        }
        return {
          exhausted,
          messages: readTimeline(client, roomId, homeserverBaseUrl)
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
        await Promise.allSettled(operations);
        publishRooms();
      } catch {
        // Read receipts are a best-effort UX signal. Message delivery must not fail because of them.
      }
    },
    prepareEncryptionRecoveryForMobile: async () => createUserControlledEncryptionRecovery(client, recoveryController, {
      mobileCompatible: true,
      reset: true
    }),
    restoreEncryptionRecovery: async (recoveryKey) => restoreUserControlledEncryptionRecovery(client, recoveryController, recoveryKey),
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
        publishRooms();
      } catch (caught) {
        if (isLikelyMatrixForbiddenError(caught)) {
          throw new Error("Automatické mazání zpráv může v této místnosti změnit jen správce chatu.");
        }
        throw formatMatrixClientError(caught, homeserverBaseUrl, "nastavit automatické mazání zpráv");
      }
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
      if (options?.replyTo && typeof client.sendMessage !== "function") {
        throw new Error("Odpověď se nepodařilo odeslat.");
      }
      if (!options?.replyTo && typeof client.sendTextMessage !== "function") {
        throw new Error("Zprávu se nepodařilo odeslat.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        if (options?.replyTo) {
          await client.sendMessage?.(roomId, createTextMessageContent(message, options.replyTo));
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
          await Promise.all(existingReactions.map((reaction) => client.redactEvent?.(roomId, reaction.eventId, undefined, {
            reason: removingExistingReaction ? "Reakce odstraněna uživatelem" : "Reakce změněna uživatelem"
          })));
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
    syncUserProfile: async (profile) => syncMatrixUserProfile(client, bootstrap, profile),
    stop: () => {
      sessionDisposed = true;
      if (presenceRefreshTimer !== undefined) {
        clearTimeout(presenceRefreshTimer);
      }
      void client.setPresence?.({ presence: "offline" }).catch(() => undefined);
      client.off?.("sync", syncListener);
      client.off?.("Room.timeline", timelineListener);
      client.off?.("Event.decrypted", timelineListener);
      client.off?.("User.presence", presenceListener);
      client.off?.("RoomMember.membership", presenceListener);
      client.stopClient?.();
    }
  };
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

function createUserControlledRecoveryController(): MatrixRecoveryController {
  const keyCache = new Map<string, Uint8Array>();
  let generatedSecretStorageKey: Uint8Array | null = null;
  let recoveryKey: string | null = null;
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
  const { decodeRecoveryKey } = await import("matrix-js-sdk/lib/crypto-api/recovery-key.js") as {
    decodeRecoveryKey: (recoveryKey: string) => Uint8Array;
  };
  try {
    return decodeRecoveryKey(recoveryKey.trim());
  } catch {
    throw new Error("Obnovovací klíč nemá platný formát.");
  }
}

async function enableKnownMatrixKeyBackup(client: MatrixClientLike): Promise<void> {
  const crypto = client.getCrypto?.();
  if (!crypto) {
    return;
  }
  await loadUserSessionBackupKey(crypto);
  await crypto.checkKeyBackupAndEnable?.();
  if (await hasActiveUserBackup(crypto)) {
    restoreUserKeyBackupInBackground(crypto);
  }
}

async function syncMatrixUserProfile(
  client: MatrixClientLike,
  bootstrap: MessagingBootstrapResponse,
  profile: MatrixUserProfileSyncInput | undefined
): Promise<void> {
  const displayName = profile?.displayName?.trim();
  const avatarSourceUrl = profile?.avatarUrl?.trim();
  const currentProfile = bootstrap.userId && (displayName || avatarSourceUrl) && client.getProfileInfo
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
    return typeof window !== "undefined" ? window.localStorage.getItem(key) ?? undefined : undefined;
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
    crypto.getActiveSessionBackupVersion ? crypto.getActiveSessionBackupVersion().catch(() => null) : Promise.resolve(null),
    crypto.isSecretStorageReady ? crypto.isSecretStorageReady().catch(() => false) : Promise.resolve(false),
    crypto.isCrossSigningReady ? crypto.isCrossSigningReady().catch(() => false) : Promise.resolve(false)
  ]);
  const keyBackupExists = Boolean(backupInfo);
  const keyBackupEnabled = Boolean(activeBackupVersion);
  const supported = typeof crypto.bootstrapSecretStorage === "function"
    && typeof crypto.bootstrapCrossSigning === "function"
    && typeof crypto.createRecoveryKeyFromPassphrase === "function"
    && typeof crypto.isCrossSigningReady === "function"
    && typeof crypto.isSecretStorageReady === "function";
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
  options: { mobileCompatible?: boolean; reset?: boolean } = {}
): Promise<string> {
  const crypto = requireMatrixCrypto(client);
  if (typeof crypto.bootstrapSecretStorage !== "function"
    || typeof crypto.bootstrapCrossSigning !== "function"
    || typeof crypto.createRecoveryKeyFromPassphrase !== "function") {
    throw new Error("Tento prohlížeč nepodporuje vytvoření obnovovacího klíče.");
  }

  let resetEncryptionApplied = false;
  if (options.reset) {
    resetEncryptionApplied = await resetMatrixEncryptionForRecovery(crypto);
  }

  let encodedRecoveryKey = "";
  const createSecretStorageKey = async () => {
    const recoveryKey = await crypto.createRecoveryKeyFromPassphrase?.();
    encodedRecoveryKey = readEncodedRecoveryKey(recoveryKey);
    recoveryController.setGeneratedSecretStorageKey(recoveryKey);
    return recoveryKey;
  };

  try {
    const authUploadDeviceSigningKeys = createDefaultMatrixInteractiveAuthCallback();
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
      throw new Error("Nová E2EE obnova není kompletní pro iPhone/iPad. Zkuste akci zopakovat z tohoto důvěryhodného prohlížeče.");
    }
  } catch (caught) {
    if (isMatrixDuplicateOneTimeKeyUploadError(caught)
      && await acceptCompletedRecoveryAfterDuplicateOneTimeKeyUpload(client, crypto, encodedRecoveryKey)) {
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

async function resetMatrixEncryptionForRecovery(crypto: MatrixCryptoApiLike): Promise<boolean> {
  const authUploadDeviceSigningKeys = createDefaultMatrixInteractiveAuthCallback();
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

function createDefaultMatrixInteractiveAuthCallback(): MatrixInteractiveAuthCallback {
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
    restoreUserKeyBackupInBackground(crypto);
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

function restoreUserKeyBackupInBackground(crypto: MatrixCryptoApiLike): void {
  if (typeof crypto.restoreKeyBackup !== "function") {
    return;
  }
  void crypto.restoreKeyBackup({ progressCallback: () => undefined })
    .catch(() => undefined);
}

async function createEncryptedAttachmentMessage(client: MatrixClientLike, attachment: MatrixAttachmentUpload): Promise<Record<string, unknown>> {
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
  const key = await globalThis.crypto.subtle.generateKey(
    { length: 256, name: "AES-CTR" },
    true,
    ["decrypt", "encrypt"]
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const plain = await file.arrayBuffer();
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { counter: iv, length: 64, name: "AES-CTR" },
    key,
    plain
  );
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
  const key = await globalThis.crypto.subtle.importKey(
    "jwk",
    encrypted.key,
    { name: "AES-CTR" },
    false,
    ["decrypt"]
  );
  return globalThis.crypto.subtle.decrypt(
    { counter: decodeBase64(encrypted.iv), length: 64, name: "AES-CTR" },
    key,
    payload
  );
}

function createTextMessageContent(body: string, replyTo: MatrixMessageReplyTarget): Record<string, unknown> {
  const quoted = replyTo.body
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .slice(0, 4)
    .map((line) => `> <${replyTo.sender}> ${line}`)
    .join("\n") || `> <${replyTo.sender}> Zpráva`;
  return {
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: replyTo.eventId
      }
    },
    body: `${quoted}\n\n${body}`,
    msgtype: "m.text"
  };
}

function createLocationMessage(location: MatrixLocationShare): Record<string, unknown> {
  const roundedLat = Number(location.lat.toFixed(6));
  const roundedLon = Number(location.lon.toFixed(6));
  const geoUri = `geo:${roundedLat},${roundedLon}${typeof location.accuracyM === "number" ? `;u=${Math.max(0, Math.round(location.accuracyM))}` : ""}`;
  const label = location.label?.trim() || (location.source === "device" ? "Moje poloha" : "Poloha v mapě");
  return {
    "cz.cop.location": {
      accuracyM: location.accuracyM ?? undefined,
      lat: roundedLat,
      lon: roundedLon,
      source: location.source
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

async function joinInvitedRoomsOnce(client: MatrixClientLike, homeserverBaseUrl: string): Promise<void> {
  const invitedRoomIds = (client.getRooms?.() ?? [])
    .map(asRoom)
    .filter((room): room is MatrixRoomLike & { roomId: string } => Boolean(room?.roomId && room.getMyMembership?.() === "invite"))
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
  if (typeof client.getJoinedRooms !== "function" && (typeof window === "undefined" || !accessToken || typeof fetch !== "function")) {
    return fallback;
  }
  try {
    const response = typeof client.getJoinedRooms === "function"
      ? await client.getJoinedRooms()
      : await fetchJoinedRooms(homeserverBaseUrl, accessToken);
    const rawRoomIds = Array.isArray(response)
      ? response
      : Array.isArray(response.joined_rooms)
        ? response.joined_rooms
        : [];
    return new Set(rawRoomIds.filter((roomId): roomId is string => typeof roomId === "string" && roomId.startsWith("!")));
  } catch {
    return fallback;
  }
}

async function fetchJoinedRooms(homeserverBaseUrl: string, accessToken: string | undefined): Promise<{ joined_rooms?: unknown }> {
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
  return await response.json() as { joined_rooms?: unknown };
}

async function fetchMatrixPresence(
  homeserverBaseUrl: string,
  accessToken: string | undefined,
  userId: string
): Promise<MatrixUserPresenceLike | undefined> {
  if (!accessToken || typeof fetch !== "function") {
    return undefined;
  }
  try {
    const response = await fetch(`${homeserverBaseUrl.replace(/\/+$/u, "")}/_matrix/client/v3/presence/${encodeURIComponent(userId)}/status`, {
      cache: "no-store",
      credentials: "omit",
      headers: { Authorization: `Bearer ${accessToken}` },
      mode: "cors"
    });
    if (!response.ok) {
      return undefined;
    }
    const payload = await response.json() as Record<string, unknown>;
    const lastActiveAgo = typeof payload.last_active_ago === "number" ? payload.last_active_ago : undefined;
    const presence = typeof payload.presence === "string" ? payload.presence : undefined;
    return {
      currentlyActive: payload.currently_active === true,
      ...(lastActiveAgo !== undefined ? { lastActiveAgo } : {}),
      ...(presence ? { presence } : {}),
      userId
    };
  } catch {
    return undefined;
  }
}

async function fetchMatrixUserProfile(
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  accessToken: string | undefined,
  userId: string
): Promise<MatrixUserPresenceLike | undefined> {
  const sdkProfile = client.getProfileInfo
    ? await client.getProfileInfo(userId).catch(() => undefined)
    : undefined;
  const payload = sdkProfile ?? await fetchMatrixProfile(homeserverBaseUrl, accessToken, userId);
  if (!payload) {
    return undefined;
  }
  const displayName = stringValue(payload.displayname) ?? stringValue(payload.displayName);
  const avatarUrl = stringValue(payload.avatar_url) ?? stringValue(payload.avatarUrl);
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
    const response = await fetch(`${homeserverBaseUrl.replace(/\/+$/u, "")}/_matrix/client/v3/profile/${encodeURIComponent(userId)}`, {
      cache: "no-store",
      credentials: "omit",
      headers,
      mode: "cors"
    });
    if (!response.ok) {
      return undefined;
    }
    return await response.json() as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function clearMatrixMessagingCryptoStateForBootstrap(bootstrap: MessagingBootstrapResponse): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  const prefix = matrixCryptoDatabasePrefix(bootstrap);
  const indexedDb = window.indexedDB;
  const databases = typeof indexedDb?.databases === "function" ? await indexedDb.databases() : [];
  await Promise.all(databases
    .map((database) => database.name)
    .filter((name): name is string => Boolean(name && (name === prefix || name.startsWith(prefix) || name.includes(prefix))))
    .map((name) => new Promise<void>((resolve) => {
      const request = indexedDb.deleteDatabase(name);
      request.onerror = () => resolve();
      request.onsuccess = () => resolve();
      request.onblocked = () => resolve();
    })));
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

async function assertBrowserCanReachHomeserver(baseUrl: string): Promise<void> {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  const versionsUrl = `${baseUrl.replace(/\/+$/u, "")}/_matrix/client/versions`;
  try {
    const response = await window.fetch(versionsUrl, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (caught) {
    throw formatMatrixClientError(caught, baseUrl, "ověřit službu zpráv v prohlížeči");
  }
}

export function formatMatrixClientError(caught: unknown, baseUrl: string, action: string): Error {
  if (isLikelyBrowserNetworkError(caught)) {
    return new Error(`Nelze ${action}. Služba zpráv teď není z tohoto zařízení dostupná. Zkontrolujte připojení nebo VPN a zkuste to znovu.`);
  }
  return caught instanceof Error ? caught : new Error(`Nelze ${action}: ${String(caught)}`);
}

function isMatrixAccountStoreMismatch(caught: unknown): boolean {
  if (!(caught instanceof Error)) {
    return false;
  }
  const message = caught.message.toLowerCase();
  return message.includes("account in the store doesn't match the account in the constructor") ||
    message.includes("account in the store does not match the account in the constructor");
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
  return text.includes("one time key")
    && text.includes("already exists")
    && (text.includes("signed_curve25519") || text.includes("keys/upload") || text.includes("/keys/upload"));
}

function isSensitiveMatrixCryptoError(caught: unknown): boolean {
  const text = matrixErrorDiagnosticText(caught);
  return /signed_curve25519|ed25519|curve25519|one time key|old key|new key|signatures|\/keys\/upload|_matrix\/client\/v3\/keys/iu.test(text);
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

function readRooms(client: MatrixClientLike, options: {
  allowedRoomIds?: Set<string> | null;
  homeserverBaseUrl?: string;
  ownUserId?: string;
  presenceByUserId?: Map<string, MatrixUserPresenceLike & { fetchedAt: number }>;
} = {}): MatrixRoomSummary[] {
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
      return {
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(directPeer ? { directPeer } : {}),
        encrypted: Boolean(client.isRoomEncrypted?.(room.roomId)),
        ...(latestMessage ? { latestMessage } : {}),
        ...(messageRetentionSeconds ? { messageRetentionSeconds } : {}),
        name: room.name?.trim() || room.roomId,
        ...(presence ? { presence } : {}),
        roomId: room.roomId,
        unreadCount: Math.max(0, room.getUnreadNotificationCount?.() ?? 0)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "cs"));
}

function readRoomPresence(
  room: MatrixRoomLike,
  client: MatrixClientLike,
  ownUserId: string | undefined,
  presenceByUserId: Map<string, MatrixUserPresenceLike & { fetchedAt: number }> | undefined
): MatrixRoomSummary["presence"] {
  const members = readRoomJoinedMembers(room)
    .filter((member) => member.userId && member.userId !== ownUserId);
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

  const state: MatrixPresenceState = onlineMemberCount > 0
    ? "online"
    : unavailableMemberCount > 0 || unknownMemberCount > 0
      ? "unknown"
      : "offline";
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
  return stateMembers
    .map(asEvent)
    .flatMap((event) => {
      if (!event) {
        return [];
      }
      const content = event.getContent?.() ?? {};
      if (content.membership !== "join") {
        return [];
      }
      const userId = event.getStateKey?.() ?? event.getSender?.();
      return userId ? [{
        avatarUrl: stringValue(content.avatar_url),
        displayName: stringValue(content.displayname),
        name: stringValue(content.displayname),
        rawDisplayName: stringValue(content.displayname),
        userId
      }] : [];
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

  const otherMembers = readRoomJoinedMembers(room)
    .filter((member) => member.userId && member.userId !== ownUserId);
  if (otherMembers.length !== 1) {
    return undefined;
  }
  const userId = otherMembers[0]?.userId;
  return readMemberAvatarUrl(otherMembers[0], client, homeserverBaseUrl, userId ? presenceByUserId?.get(userId) : undefined);
}

function readRoomDirectPeer(
  room: MatrixRoomLike,
  client: MatrixClientLike,
  homeserverBaseUrl: string,
  ownUserId: string | undefined,
  presenceByUserId: Map<string, MatrixUserPresenceLike & { fetchedAt: number }> | undefined
): MatrixRoomSummary["directPeer"] {
  const otherMembers = readRoomJoinedMembers(room)
    .filter((member) => member.userId && member.userId !== ownUserId);
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
  const displayName = trimmedMatrixString(member.name)
    ?? trimmedMatrixString(member.rawDisplayName)
    ?? trimmedMatrixString(member.displayName)
    ?? trimmedMatrixString(cached?.displayName)
    ?? trimmedMatrixString(user?.displayName)
    ?? matrixLocalpart(userId);
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
    .map((value) => typeof value === "string" && value.trim() ? value.trim() : undefined)
    .find((value): value is string => Boolean(value));
  return avatarUrl ? matrixMediaHttpUrl(client, homeserverBaseUrl, avatarUrl, true) ?? avatarUrl : undefined;
}

function trimmedMatrixString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
  const messageEvents = timelineEvents.filter((event) => event.getType?.() === "m.room.message");
  const redactedEventIds = readRedactedEventIds(timelineEvents);
  const reactionsByEventId = readMessageReactions(room, messageEvents, timelineEvents, currentUserId, redactedEventIds);
  return messageEvents
    .flatMap((event) => {
      const eventId = event.getId?.() ?? `${event.getSender?.() ?? "sender"}-${event.getTs?.() ?? Date.now()}`;
      if (redactedEventIds.has(eventId)) {
        return [];
      }
      const mapped = mapMatrixMessageEvent(client, room ?? undefined, homeserverBaseUrl, event, currentUserId, reactionsByEventId.get(eventId));
      return mapped ? [mapped] : [];
    })
    .filter((message) => messageWithinRetention(message, retentionSeconds));
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
  const content = event.getContent?.() ?? {};
  const body = normalizeMatrixMessageBody(stripMatrixReplyFallback(typeof content.body === "string" ? content.body.trim() : ""));
  const kind = matrixMessageKind(content);
  const attachment = matrixAttachmentFromContent(client, homeserverBaseUrl, content);
  const geoUri = readLocationUri(content);
  const location = geoUri ? matrixLocationFromGeoUri(geoUri, content) : undefined;
  const transit = matrixTransitShareFromContent(content);
  if (!body && !attachment && !location && !transit) {
    return null;
  }
  const sender = event.getSender?.() ?? "";
  const senderDisplayName = displayNameForMatrixSender(room, sender);
  return {
    ...(attachment ? { attachment } : {}),
    body,
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
  const events = (room?.timeline ?? [])
    .map(asEvent)
    .filter((event): event is MatrixEventLike => Boolean(event));
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.getType?.() !== "m.room.message") {
      continue;
    }
    const mapped = mapMatrixMessageEvent(client, room, homeserverBaseUrl, event, currentUserId);
    if (mapped && messageWithinRetention(mapped, retentionSeconds)) {
      return mapped;
    }
  }
  return undefined;
}

function latestReadableMessageEvent(room: MatrixRoomLike | undefined): MatrixEventLike | undefined {
  const events = (room?.timeline ?? [])
    .map(asEvent)
    .filter((event): event is MatrixEventLike => Boolean(event));
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.getType?.() === "m.room.message" && event.getId?.()) {
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
    const relations = room?.relations?.getChildEventsForEvent?.(eventId, "m.annotation", "m.reaction")?.getRelations?.() ?? [];
    for (const relation of relations) {
      const reactionEvent = asEvent(relation);
      if (reactionEvent) {
        const reactionEventId = reactionEvent.getId?.();
        if (reactionEventId && redactedEventIds.has(reactionEventId)) {
          continue;
        }
        reactionEvents.set(reactionEventId ?? `${reactionEvent.getSender?.() ?? ""}:${reactionEvent.getTs?.() ?? ""}:${eventId}`, reactionEvent);
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
    const buckets = bucketsByEventId.get(targetEventId) ?? new Map<string, Map<string, { eventId?: string; label: string }>>();
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
    reactionsByEventId.set(eventId, [...buckets.entries()]
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
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "cs-CZ")));
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
  const relatedEvents = room?.relations?.getChildEventsForEvent?.(targetEventId, "m.annotation", "m.reaction")?.getRelations?.() ?? [];
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
    if (relationTargetEventId === targetEventId && relationType === "m.annotation" && key && sender === currentUserId && reactionEventId) {
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
  return isUndecryptableMatrixBody(body)
    ? "Zprávu zatím nelze zobrazit. V tomto prohlížeči chybí šifrovací klíč pro starší zprávy."
    : body;
}

function isUndecryptableMatrixBody(body: string): boolean {
  return /unable to decrypt|decryptionerror|no key backup|before this device logged in/iu.test(body);
}

function displayNameForMatrixSender(room: MatrixRoomLike | undefined, sender: string): string | undefined {
  if (!sender) {
    return undefined;
  }
  const member = room?.getMember?.(sender) ?? undefined;
  const candidates = [
    member?.rawDisplayName,
    member?.name,
    member?.user?.displayName
  ];
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
    ...(Array.isArray(transit.warnings) ? { warnings: transit.warnings.filter((item) => stringValue(item)).map((item) => item.trim()).slice(0, 5) } : {})
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
    warnings: Array.isArray(data.warnings) ? data.warnings.filter((item): item is string => typeof item === "string") : undefined
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
  const fileName = typeof content.filename === "string" && content.filename.trim()
    ? content.filename.trim()
    : typeof content.body === "string" && content.body.trim()
      ? content.body.trim()
      : defaultAttachmentName(kind);
  return {
    contentType: typeof info?.mimetype === "string" ? info.mimetype : undefined,
    ...(encrypted ? { encrypted } : {}),
    fileName,
    ...(rawUrl ? { mediaUrl: encrypted ? rawUrl : matrixMediaHttpUrl(client, homeserverBaseUrl, rawUrl, false) ?? rawUrl } : {}),
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
  return {
    accuracyM: match[3] ? Number(match[3]) : undefined,
    label: typeof extensibleLocation?.description === "string" ? extensibleLocation.description : undefined,
    lat,
    lon,
    source
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
    hashes: Object.fromEntries(Object.entries(hashes).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    iv: file.iv,
    key: {
      alg: typeof key.alg === "string" ? key.alg : "A256CTR",
      ext: key.ext === true,
      k: key.k,
      key_ops: Array.isArray(key.key_ops) ? key.key_ops.filter((item): item is string => typeof item === "string") : ["encrypt", "decrypt"],
      kty: typeof key.kty === "string" ? key.kty : "oct"
    },
    url: file.url,
    v: file.v
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function matrixMediaHttpUrl(client: MatrixClientLike, homeserverBaseUrl: string, mxcUrl: string, authenticated: boolean): string | undefined {
  if (!mxcUrl.startsWith("mxc://")) {
    return mxcUrl;
  }
  return client.mxcUrlToHttp?.(mxcUrl, undefined, undefined, undefined, false, true, authenticated) ?? fallbackMxcDownloadUrl(homeserverBaseUrl, mxcUrl);
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
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function asRoom(value: unknown): MatrixRoomLike | null {
  return typeof value === "object" && value !== null ? value as MatrixRoomLike : null;
}

function asEvent(value: unknown): MatrixEventLike | null {
  return typeof value === "object" && value !== null ? value as MatrixEventLike : null;
}
