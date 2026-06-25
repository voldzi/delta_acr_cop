import type { MessagingBootstrapResponse } from "../cop-data";

export interface MatrixUserProfileSyncInput {
  avatarUrl?: string;
  displayName?: string;
}

export interface MatrixRoomSummary {
  avatarUrl?: string;
  encrypted: boolean;
  messageRetentionSeconds?: number;
  name: string;
  presence?: MatrixRoomPresenceSummary;
  roomId: string;
  unreadCount: number;
}

export type MatrixPresenceState = "offline" | "online" | "unavailable" | "unknown";

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
}

export type MatrixMessageKind = "file" | "image" | "location" | "text" | "video";

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

export interface MatrixLocationShare {
  accuracyM?: number | null;
  label?: string;
  lat: number;
  lon: number;
  source: "device" | "map";
}

export interface MatrixTimelineAttachment {
  contentType?: string;
  encrypted?: MatrixEncryptedFileRef;
  fileName: string;
  mediaUrl?: string;
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
  loadMoreTimeline(roomId: string, limit?: number): Promise<{ exhausted: boolean; messages: MatrixTimelineMessage[] }>;
  restoreEncryptionRecovery(recoveryKey: string): Promise<void>;
  setMessageRetentionPolicy(roomId: string, seconds: number | null): Promise<void>;
  sendAttachment(roomId: string, attachment: MatrixAttachmentUpload): Promise<void>;
  sendLocation(roomId: string, location: MatrixLocationShare): Promise<void>;
  sendMessage(roomId: string, body: string, options?: { replyTo?: MatrixMessageReplyTarget }): Promise<void>;
  sendReaction(roomId: string, eventId: string, key: string): Promise<void>;
  setReaction(roomId: string, eventId: string, key: string): Promise<void>;
  syncUserProfile(profile: MatrixUserProfileSyncInput | undefined): Promise<void>;
  stop(): void;
}

export interface MatrixEncryptionRecoveryStatus {
  activeBackupVersion?: string;
  keyBackupEnabled: boolean;
  keyBackupExists: boolean;
  needsRecovery: boolean;
  needsSetup: boolean;
  ready: boolean;
  secretStorageReady: boolean;
  supported: boolean;
}
