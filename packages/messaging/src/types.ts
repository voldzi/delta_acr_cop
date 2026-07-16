export interface MessagingBootstrapResponse {
  accessToken?: string;
  chatAvailable: boolean;
  contractVersion: "cop-messaging-bootstrap-v1";
  detail?: string;
  deviceId?: string;
  e2eeRequired?: boolean;
  enabled: boolean;
  expiresAt?: string;
  homeserverBaseUrl?: string;
  providerId: "csm.messaging";
  serverName?: string;
  status: "degraded" | "disabled" | "online";
  tokenAvailable: boolean;
  userId?: string;
  warnings: string[];
}

export interface MatrixCrossSigningPublicKey {
  keys: Record<string, string>;
  signatures?: Record<string, Record<string, string>>;
  usage: ["master" | "self_signing" | "user_signing"];
  user_id: string;
}

export interface MatrixDeviceSigningAuthRequest {
  deviceId: string;
  masterKey: MatrixCrossSigningPublicKey;
  selfSigningKey: MatrixCrossSigningPublicKey;
  userSigningKey: MatrixCrossSigningPublicKey;
}

export interface MatrixUserProfileSyncInput {
  avatarUrl?: string;
  displayName?: string;
}

export interface MatrixRoomSummary {
  avatarUrl?: string;
  directPeer?: MatrixRoomMemberSummary;
  encrypted: boolean;
  latestMessage?: MatrixTimelineMessage;
  messageRetentionSeconds?: number;
  name: string;
  presence?: MatrixRoomPresenceSummary;
  roomId: string;
  unreadCount: number;
}

export type MatrixPresenceState = "offline" | "online" | "unavailable" | "unknown";

export interface MatrixRoomMemberSummary {
  avatarUrl?: string;
  displayName: string;
  userId: string;
}

export interface MatrixRoomPresenceSummary {
  activeMemberCount: number;
  offlineMemberCount: number;
  onlineMemberCount: number;
  state: MatrixPresenceState;
  totalMemberCount: number;
  unavailableMemberCount: number;
  unknownMemberCount: number;
  updatedAt?: string;
}

export interface MatrixTimelineMessage {
  attachment?: MatrixTimelineAttachment;
  body: string;
  cop?: MatrixCopMessageMetadata;
  decryptionState?: "undecryptable";
  eventId: string;
  geoUri?: string;
  kind: MatrixMessageKind;
  location?: MatrixLocationShare;
  own: boolean;
  reactions?: MatrixMessageReaction[];
  replyToEventId?: string;
  sender: string;
  senderDisplayName?: string;
  timestamp: string;
  transit?: MatrixTransitShare;
}

export type MatrixMessageKind = "file" | "image" | "location" | "text" | "transit" | "video";

export type MatrixAttachmentKind = "file" | "image" | "video";

export type MatrixVoiceCallDirection = "incoming" | "outgoing";

export type MatrixVoiceCallKind = "direct" | "group";

export interface MatrixVoiceCallParticipant {
  avatarUrl?: string;
  connected: boolean;
  displayName: string;
  userId: string;
}

export type MatrixVoiceCallPhase = "connecting" | "connected" | "ended" | "failed" | "ringing";

export interface MatrixVoiceCallSnapshot {
  callId: string;
  direction: MatrixVoiceCallDirection;
  eligibleParticipants?: MatrixVoiceCallParticipant[];
  error?: string;
  kind: MatrixVoiceCallKind;
  localStream?: MediaStream;
  microphoneMuted: boolean;
  opponentUserId?: string;
  participants: MatrixVoiceCallParticipant[];
  phase: MatrixVoiceCallPhase;
  remoteStream?: MediaStream;
  remoteStreams?: MediaStream[];
  roomId: string;
  startedAt?: string;
}

export interface MatrixVoiceCallOptions {
  additionalIceServerUrls?: string[];
  fallbackIceServerAllowed?: boolean;
  forceTurn?: boolean;
}

export interface MatrixVoiceCallWakeRequest {
  action: "ended" | "invite";
  callId: string;
  participantUserIds?: string[];
  roomId: string;
}

export interface MatrixWebPushPusherOptions {
  appDisplayName?: string;
  appId?: string;
  deviceDisplayName?: string;
  deviceId?: string;
  lang?: string;
  pushGatewayUrl?: string;
  registered?: boolean;
}

export interface MatrixAttachmentUpload {
  caption?: string;
  file: File;
  kind: MatrixAttachmentKind;
}

export interface MatrixMessageReaction {
  count: number;
  key: string;
  own: boolean;
  ownEventId?: string;
  senders: string[];
}

export interface MatrixMessageReplyTarget {
  body: string;
  eventId: string;
  sender: string;
}

export interface MatrixCopMessageMetadata {
  ai?: MatrixCopAiMessageMetadata;
  kind?: "ai-agent-response" | "ai-situation-summary";
  source: "cop-chat";
}

export interface MatrixCopAiMessageMetadata {
  auditId?: string;
  citationCount?: number;
  conversation?: MatrixCopAiConversationMetadata;
  indexedDocumentCount?: number;
  indexedStatus?: "degraded" | "disabled" | "ok";
  mapActions?: MatrixCopMapAction[];
  model?: string;
  policyReason?: string;
  provider?: string;
  question?: string;
  requestId?: string;
  responsePlaybook?: MatrixCopAiResponsePlaybookMetadata;
  semanticDocumentCount?: number;
  semanticStatus?: "degraded" | "disabled" | "ok";
  status?: "COMPLETED" | "NEEDS_HUMAN_REVIEW" | "REJECTED";
  type?: "chat-agent" | "situation-summary";
}

export interface MatrixCopAiConversationMetadata {
  confidence?: {
    label?: string;
    level?: "high" | "low" | "medium";
  };
  followUp?: boolean;
  followUpKind?: string;
  followUpSuggestions?: MatrixCopAiFollowUpSuggestion[];
  needsClarification?: boolean;
}

export interface MatrixCopAiFollowUpSuggestion {
  id: string;
  label: string;
  question: string;
}

export interface MatrixCopAiResponsePlaybookMetadata {
  allowedActions?: string[];
  confidence?: number;
  domain?: string;
  forbiddenActions?: string[];
  intentId?: string;
  requiredSources?: string[];
}

export interface MatrixCopMapAction {
  action: "focus-map";
  category?: string;
  distanceText?: string;
  entityId?: string;
  entityType?: string;
  label: string;
  layerId?: string;
  lat: number;
  lon: number;
  sourceName?: string;
  sourceSystemIds?: string[];
  title?: string;
  zoom?: number;
}

export interface MatrixLocationShare {
  accuracyM?: number | null;
  label?: string;
  lat: number;
  live?: MatrixLiveLocationShare;
  lon: number;
  source: "device" | "map";
  updatedAt?: string;
}

export type MatrixLiveLocationStatus = "ended" | "live";

export interface MatrixLiveLocationShare {
  durationSeconds?: number;
  expiresAt?: string;
  shareId: string;
  startedAt?: string;
  status: MatrixLiveLocationStatus;
  updatedAt?: string;
}

export interface MatrixTransitShare {
  detailUrl?: string;
  destination?: string;
  featureId: string;
  label?: string;
  lat?: number;
  lon?: number;
  nextStopName?: string;
  observedAt?: string;
  operator?: string;
  routeShortName?: string;
  sourceId?: string;
  status?: string;
  transportMode?: string;
  vehicleId?: string;
  warnings?: string[];
}

export interface MatrixTimelineAttachment {
  contentType?: string;
  encrypted?: MatrixEncryptedFileRef;
  fileName: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  size?: number;
}

export interface MatrixEncryptedFileRef {
  hashes: Record<string, string>;
  iv: string;
  key: {
    alg: string;
    ext: boolean;
    k: string;
    key_ops: string[];
    kty: string;
  };
  url: string;
  v: string;
}

export interface MatrixMessagingSession {
  bootstrap: MessagingBootstrapResponse;
  answerVoiceCall(callId: string): Promise<void>;
  createEncryptionRecovery(reset?: boolean, onProgress?: MatrixEncryptionRecoveryProgressCallback): Promise<string>;
  createGroupRoom(name: string, inviteUserIds?: string[]): Promise<string>;
  deleteMessage(roomId: string, eventId: string): Promise<void>;
  downloadAttachment(message: MatrixTimelineMessage): Promise<Blob>;
  getEncryptionRecoveryStatus(): Promise<MatrixEncryptionRecoveryStatus>;
  getRooms(): MatrixRoomSummary[];
  getTimeline(roomId: string): MatrixTimelineMessage[];
  getVoiceCall(): MatrixVoiceCallSnapshot | null;
  hangupVoiceCall(callId: string): Promise<void>;
  inviteVoiceCallParticipants(callId: string, participantUserIds: string[]): Promise<void>;
  inviteUsersToRoom(roomId: string, userIds: string[]): Promise<void>;
  joinInvitedRooms(): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  loadMoreTimeline(roomId: string, limit?: number): Promise<{ exhausted: boolean; messages: MatrixTimelineMessage[] }>;
  markRoomRead(roomId: string): Promise<void>;
  prepareEncryptionRecoveryForMobile(onProgress?: MatrixEncryptionRecoveryProgressCallback): Promise<string>;
  refreshBootstrap(bootstrap: MessagingBootstrapResponse): boolean;
  rejectVoiceCall(callId: string): Promise<void>;
  restoreEncryptionRecovery(recoveryKey: string): Promise<void>;
  setMessageRetentionPolicy(roomId: string, seconds: number | null): Promise<void>;
  setVoiceCallMuted(callId: string, muted: boolean): Promise<boolean>;
  sendAttachment(roomId: string, attachment: MatrixAttachmentUpload): Promise<void>;
  sendLocation(roomId: string, location: MatrixLocationShare): Promise<void>;
  sendMessage(
    roomId: string,
    body: string,
    options?: { cop?: MatrixCopMessageMetadata; replyTo?: MatrixMessageReplyTarget }
  ): Promise<void>;
  sendReaction(roomId: string, eventId: string, key: string): Promise<void>;
  sendTransitShare(roomId: string, transit: MatrixTransitShare): Promise<void>;
  startVoiceCall(roomId: string, options?: { group?: boolean }): Promise<void>;
  setReaction(roomId: string, eventId: string, key: string): Promise<void>;
  syncWebPushPusher(options: MatrixWebPushPusherOptions | undefined): Promise<void>;
  syncUserProfile(profile: MatrixUserProfileSyncInput | undefined): Promise<void>;
  stop(): void;
}

export interface MatrixEncryptionRecoveryStatus {
  activeBackupVersion?: string;
  canPrepareForMobile: boolean;
  crossSigningReady: boolean;
  keyBackupEnabled: boolean;
  keyBackupExists: boolean;
  matrixRustCompatible: boolean;
  needsRecovery: boolean;
  needsSetup: boolean;
  ready: boolean;
  secretStorageReady: boolean;
  supported: boolean;
}

export type MatrixEncryptionRecoveryPhase =
  "checking" | "cleaning" | "cross-signing" | "secret-storage" | "backup" | "verifying";

export type MatrixEncryptionRecoveryProgressCallback = (phase: MatrixEncryptionRecoveryPhase) => void;
