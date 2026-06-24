import type { MessagingBootstrapResponse } from "../cop-data";
import type {
  MatrixAttachmentKind,
  MatrixAttachmentUpload,
  MatrixEncryptedFileRef,
  MatrixEncryptionRecoveryStatus,
  MatrixLocationShare,
  MatrixMessageReaction,
  MatrixMessageReplyTarget,
  MatrixMessagingSession,
  MatrixRoomSummary,
  MatrixTimelineAttachment,
  MatrixTimelineMessage
} from "./types";

interface MatrixClientLike {
  createRoom?: (options: Record<string, unknown>) => Promise<{ room_id?: string; roomId?: string }>;
  getCrypto?: () => MatrixCryptoApiLike | undefined;
  getRooms?: () => unknown[];
  getUserId?: () => string | null;
  initRustCrypto?: (args?: { cryptoDatabasePrefix?: string }) => Promise<void>;
  invite?: (roomId: string, userId: string) => Promise<unknown>;
  isRoomEncrypted?: (roomId: string) => boolean;
  joinRoom?: (roomIdOrAlias: string) => Promise<{ room_id?: string; roomId?: string }>;
  mxcUrlToHttp?: (mxcUrl: string, width?: number, height?: number, resizeMethod?: string, allowDirectLinks?: boolean, allowRedirects?: boolean, useAuthentication?: boolean) => string | null;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  redactEvent?: (roomId: string, eventId: string, txnId?: string, opts?: Record<string, unknown>) => Promise<unknown>;
  sendEvent?: (roomId: string, eventType: string, content: Record<string, unknown>, txnId?: string) => Promise<unknown>;
  sendMessage?: (roomId: string, content: Record<string, unknown>) => Promise<unknown>;
  sendStateEvent?: (roomId: string, eventType: string, content: Record<string, unknown>, stateKey?: string) => Promise<unknown>;
  sendTextMessage?: (roomId: string, body: string) => Promise<unknown>;
  startClient?: (options?: Record<string, unknown>) => Promise<void> | void;
  stopClient?: () => void;
  scrollback?: (room: MatrixRoomLike, limit?: number) => Promise<unknown>;
  uploadContent?: (file: Blob | File, opts?: Record<string, unknown>) => Promise<{ content_uri?: string; contentUri?: string }>;
}

interface MatrixCryptoApiLike {
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
  isSecretStorageReady?: () => Promise<boolean>;
  loadSessionBackupPrivateKeyFromSecretStorage?: () => Promise<void>;
  restoreKeyBackup?: (options?: Record<string, unknown>) => Promise<unknown>;
}

interface MatrixRecoveryController {
  readonly cryptoCallbacks: Record<string, unknown>;
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
  name?: string;
  rawDisplayName?: string;
  user?: {
    displayName?: string;
  };
  userId?: string;
}

interface MatrixEventLike {
  getAssociatedId?: () => string | undefined;
  getContent?: () => Record<string, unknown>;
  getId?: () => string | undefined;
  getRelation?: () => Record<string, unknown> | null;
  getRoomId?: () => string | undefined;
  getSender?: () => string | undefined;
  getTs?: () => number | undefined;
  getType?: () => string | undefined;
}

export async function createMatrixMessagingSession(
  bootstrap: MessagingBootstrapResponse,
  callbacks: {
    onRoomsChanged?: (rooms: MatrixRoomSummary[]) => void;
    onSyncState?: (state: string) => void;
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
  const joinInvitedRooms = async () => {
    if (inviteJoinInFlight) {
      return inviteJoinInFlight;
    }
    inviteJoinInFlight = joinInvitedRoomsOnce(client, homeserverBaseUrl)
      .finally(() => {
        inviteJoinInFlight = null;
      });
    return inviteJoinInFlight;
  };

  const syncListener = (state: unknown) => {
    callbacks.onSyncState?.(typeof state === "string" ? state : "sync");
    void joinInvitedRooms().then(() => callbacks.onRoomsChanged?.(readRooms(client)));
    callbacks.onRoomsChanged?.(readRooms(client));
  };
  const timelineListener = () => {
    callbacks.onRoomsChanged?.(readRooms(client));
  };
  client.on?.("sync", syncListener);
  client.on?.("Room.timeline", timelineListener);
  await client.startClient?.({ initialSyncLimit: 30 });
  await joinInvitedRooms();
  callbacks.onRoomsChanged?.(readRooms(client));
  const exhaustedTimelineRooms = new Set<string>();

  return {
    bootstrap,
    createEncryptionRecovery: async (reset = false) => createUserControlledEncryptionRecovery(client, reset),
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
      callbacks.onRoomsChanged?.(readRooms(client));
      const roomId = response.room_id ?? response.roomId;
      if (!roomId) {
        throw new Error("Služba zpráv nevrátila identifikátor konverzace.");
      }
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
    getRooms: () => readRooms(client),
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
        callbacks.onRoomsChanged?.(readRooms(client));
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "pozvat člena do chatové místnosti");
      }
    },
    joinInvitedRooms,
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
          exhaustedTimelineRooms.add(roomId);
          return { exhausted: true, messages: [] };
        }
        const beforeCount = room.timeline?.length ?? 0;
        await client.scrollback(room, Math.max(1, Math.min(250, Math.trunc(limit))));
        const nextRoom = findMatrixRoom(client, roomId) ?? room;
        const afterCount = nextRoom.timeline?.length ?? 0;
        const exhausted = afterCount <= beforeCount;
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
        callbacks.onRoomsChanged?.(readRooms(client));
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
    stop: () => {
      client.off?.("sync", syncListener);
      client.off?.("Room.timeline", timelineListener);
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
  let recoveryKey: string | null = null;
  return {
    cryptoCallbacks: {
      cacheSecretStorageKey: (keyId: string, _keyInfo: unknown, key: Uint8Array) => {
        keyCache.set(keyId, key);
      },
      getSecretStorageKey: async (options: { keys: Record<string, unknown> }) => {
        for (const keyId of Object.keys(options.keys)) {
          const cachedKey = keyCache.get(keyId);
          if (cachedKey) {
            return [keyId, cachedKey];
          }
        }
        if (!recoveryKey) {
          return null;
        }
        const decodedKey = await decodeUserRecoveryKey(recoveryKey);
        const keyId = Object.keys(options.keys)[0];
        return keyId ? [keyId, decodedKey] : null;
      }
    },
    setRecoveryKey(nextRecoveryKey: string) {
      recoveryKey = nextRecoveryKey.trim();
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

async function readMatrixEncryptionRecoveryStatus(client: MatrixClientLike): Promise<MatrixEncryptionRecoveryStatus> {
  const crypto = client.getCrypto?.();
  if (!crypto) {
    return {
      keyBackupEnabled: false,
      keyBackupExists: false,
      needsRecovery: false,
      needsSetup: true,
      ready: false,
      secretStorageReady: false,
      supported: false
    };
  }
  const [backupInfo, activeBackupVersion, secretStorageReady] = await Promise.all([
    crypto.getKeyBackupInfo ? crypto.getKeyBackupInfo().catch(() => null) : Promise.resolve(null),
    crypto.getActiveSessionBackupVersion ? crypto.getActiveSessionBackupVersion().catch(() => null) : Promise.resolve(null),
    crypto.isSecretStorageReady ? crypto.isSecretStorageReady().catch(() => false) : Promise.resolve(false)
  ]);
  const keyBackupExists = Boolean(backupInfo);
  const keyBackupEnabled = Boolean(activeBackupVersion);
  return {
    ...(activeBackupVersion ? { activeBackupVersion } : {}),
    keyBackupEnabled,
    keyBackupExists,
    needsRecovery: keyBackupExists && !keyBackupEnabled,
    needsSetup: !keyBackupExists,
    ready: keyBackupEnabled,
    secretStorageReady,
    supported: typeof crypto.bootstrapSecretStorage === "function" && typeof crypto.createRecoveryKeyFromPassphrase === "function"
  };
}

async function createUserControlledEncryptionRecovery(client: MatrixClientLike, reset: boolean): Promise<string> {
  const crypto = requireMatrixCrypto(client);
  if (typeof crypto.bootstrapSecretStorage !== "function" || typeof crypto.createRecoveryKeyFromPassphrase !== "function") {
    throw new Error("Tento prohlížeč nepodporuje vytvoření obnovovacího klíče.");
  }

  if (reset) {
    await crypto.disableKeyStorage?.();
  }

  let encodedRecoveryKey = "";
  const createSecretStorageKey = async () => {
    const recoveryKey = await crypto.createRecoveryKeyFromPassphrase?.();
    encodedRecoveryKey = readEncodedRecoveryKey(recoveryKey);
    return recoveryKey;
  };

  try {
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey,
      setupNewKeyBackup: true,
      ...(reset ? { setupNewSecretStorage: true } : {})
    });
    await crypto.checkKeyBackupAndEnable?.();
  } catch (caught) {
    throw new Error(`Obnovovací klíč se nepodařilo vytvořit: ${errorMessage(caught)}`);
  }
  if (!encodedRecoveryKey) {
    throw new Error("Matrix nevydal obnovovací klíč. Zkuste nastavení zopakovat.");
  }
  return encodedRecoveryKey;
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

function isLikelyMatrixForbiddenError(caught: unknown): boolean {
  if (asRecord(caught)?.errcode === "M_FORBIDDEN") {
    return true;
  }
  return caught instanceof Error && /m_forbidden|forbidden|permission|power level/iu.test(caught.message);
}

function readRooms(client: MatrixClientLike): MatrixRoomSummary[] {
  return (client.getRooms?.() ?? [])
    .map(asRoom)
    .filter((room): room is MatrixRoomLike & { roomId: string } => Boolean(room?.roomId))
    .map((room) => {
      const messageRetentionSeconds = readRoomRetentionSeconds(room);
      return {
        encrypted: Boolean(client.isRoomEncrypted?.(room.roomId)),
        ...(messageRetentionSeconds ? { messageRetentionSeconds } : {}),
        name: room.name?.trim() || room.roomId,
        roomId: room.roomId,
        unreadCount: Math.max(0, room.getUnreadNotificationCount?.() ?? 0)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "cs"));
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
  const reactionsByEventId = readMessageReactions(room, messageEvents, timelineEvents, currentUserId);
  return messageEvents
    .flatMap((event) => {
      const eventId = event.getId?.() ?? `${event.getSender?.() ?? "sender"}-${event.getTs?.() ?? Date.now()}`;
      if (redactedEventIds.has(eventId)) {
        return [];
      }
      const content = event.getContent?.() ?? {};
      const body = normalizeMatrixMessageBody(stripMatrixReplyFallback(typeof content.body === "string" ? content.body.trim() : ""));
      const kind = matrixMessageKind(content);
      const attachment = matrixAttachmentFromContent(client, homeserverBaseUrl, content);
      const geoUri = readLocationUri(content);
      const location = geoUri ? matrixLocationFromGeoUri(geoUri, content) : undefined;
      if (!body && !attachment && !location) {
        return [];
      }
      const sender = event.getSender?.() ?? "";
      const senderDisplayName = displayNameForMatrixSender(room ?? undefined, sender);
      return [{
        ...(attachment ? { attachment } : {}),
        body,
        eventId,
        ...(geoUri ? { geoUri } : {}),
        kind,
        ...(location ? { location } : {}),
        own: Boolean(currentUserId && sender === currentUserId),
        ...(reactionsByEventId.get(eventId)?.length ? { reactions: reactionsByEventId.get(eventId) } : {}),
        ...(readReplyToEventId(content) ? { replyToEventId: readReplyToEventId(content) } : {}),
        sender,
        ...(senderDisplayName ? { senderDisplayName } : {}),
        timestamp: new Date(event.getTs?.() ?? Date.now()).toISOString()
      }];
    })
    .filter((message) => messageWithinRetention(message, retentionSeconds));
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
  currentUserId: string | undefined
): Map<string, MatrixMessageReaction[]> {
  const reactionEvents = new Map<string, MatrixEventLike>();
  for (const event of timelineEvents) {
    if (event.getType?.() === "m.reaction") {
      reactionEvents.set(event.getId?.() ?? `${event.getSender?.() ?? ""}:${event.getTs?.() ?? ""}`, event);
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
        reactionEvents.set(reactionEvent.getId?.() ?? `${reactionEvent.getSender?.() ?? ""}:${reactionEvent.getTs?.() ?? ""}:${eventId}`, reactionEvent);
      }
    }
  }

  const bucketsByEventId = new Map<string, Map<string, Map<string, string>>>();
  for (const event of reactionEvents.values()) {
    const relation = readEventRelation(event);
    const targetEventId = stringValue(relation?.event_id);
    const relationType = stringValue(relation?.rel_type);
    const key = stringValue(relation?.key);
    const sender = event.getSender?.() ?? "";
    if (!targetEventId || relationType !== "m.annotation" || !key || !sender) {
      continue;
    }
    const senderLabel = displayNameForMatrixSender(room, sender) ?? sender;
    const buckets = bucketsByEventId.get(targetEventId) ?? new Map<string, Map<string, string>>();
    const senders = buckets.get(key) ?? new Map<string, string>();
    senders.set(sender, senderLabel);
    buckets.set(key, senders);
    bucketsByEventId.set(targetEventId, buckets);
  }

  const reactionsByEventId = new Map<string, MatrixMessageReaction[]>();
  for (const [eventId, buckets] of bucketsByEventId.entries()) {
    reactionsByEventId.set(eventId, [...buckets.entries()]
      .map(([key, senders]) => ({
        count: senders.size,
        key,
        own: Boolean(currentUserId && senders.has(currentUserId)),
        senders: [...senders.values()]
      }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "cs-CZ")));
  }
  return reactionsByEventId;
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
