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
  model?: string;
  policyReason?: string;
  provider?: string;
  question?: string;
  requestId?: string;
  status?: "COMPLETED" | "NEEDS_HUMAN_REVIEW" | "REJECTED";
  type?: "chat-agent" | "situation-summary";
}

export interface MatrixLocationShare {
  accuracyM?: number | null;
  label?: string;
  lat: number;
  lon: number;
  source: "device" | "map";
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
  createEncryptionRecovery(reset?: boolean): Promise<string>;
  createGroupRoom(name: string, inviteUserIds?: string[]): Promise<string>;
  deleteMessage(roomId: string, eventId: string): Promise<void>;
  downloadAttachment(message: MatrixTimelineMessage): Promise<Blob>;
  getEncryptionRecoveryStatus(): Promise<MatrixEncryptionRecoveryStatus>;
  getRooms(): MatrixRoomSummary[];
  getTimeline(roomId: string): MatrixTimelineMessage[];
  inviteUsersToRoom(roomId: string, userIds: string[]): Promise<void>;
  joinInvitedRooms(): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  loadMoreTimeline(roomId: string, limit?: number): Promise<{ exhausted: boolean; messages: MatrixTimelineMessage[] }>;
  markRoomRead(roomId: string): Promise<void>;
  prepareEncryptionRecoveryForMobile(): Promise<string>;
  restoreEncryptionRecovery(recoveryKey: string): Promise<void>;
  setMessageRetentionPolicy(roomId: string, seconds: number | null): Promise<void>;
  sendAttachment(roomId: string, attachment: MatrixAttachmentUpload): Promise<void>;
  sendLocation(roomId: string, location: MatrixLocationShare): Promise<void>;
  sendMessage(roomId: string, body: string, options?: { cop?: MatrixCopMessageMetadata; replyTo?: MatrixMessageReplyTarget }): Promise<void>;
  sendReaction(roomId: string, eventId: string, key: string): Promise<void>;
  sendTransitShare(roomId: string, transit: MatrixTransitShare): Promise<void>;
  setReaction(roomId: string, eventId: string, key: string): Promise<void>;
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
