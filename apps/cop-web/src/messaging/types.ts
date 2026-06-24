import type { AuthConfig, AuthSession } from "../auth";
import type {
  CommunityGroup,
  CommunityGroupVisibility,
  MessagingBootstrapResponse,
  MessagingMatrixIdentityResolutionResponse,
  MessagingMatrixRoomBindingResponse,
  MessagingConversationSummary,
  MessagingStatusResponse,
  UserDirectoryEntry
} from "../cop-data";

export interface MessagingPanelProps {
  apiBase: string;
  authenticated: boolean;
  authConfig: AuthConfig;
  authToken?: string;
  conversations: MessagingConversationSummary[];
  conversationsError: string | null;
  communityGroups: CommunityGroup[];
  communityGroupsError: string | null;
  dockWidth: number;
  error: string | null;
  loading: boolean;
  mapContext: MessagingMapContext;
  pinned: boolean;
  session: AuthSession;
  status: MessagingStatusResponse | null;
  onAddGroupMember: (groupId: string, subjectId: string, displayName?: string) => Promise<CommunityGroup>;
  onBindMatrixRoom: (conversationId: string, roomId: string, encrypted: boolean) => Promise<MessagingMatrixRoomBindingResponse>;
  onClose: () => void;
  onCreateDirectConversation: (user: UserDirectoryEntry) => Promise<MessagingConversationSummary>;
  onCreateGroup: (name: string, visibility: CommunityGroupVisibility) => Promise<{ conversation?: MessagingConversationSummary; group: CommunityGroup }>;
  onCreateReportFromChat: (seed: MessagingReportSeed) => void;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onDockWidthChange: (width: number) => void;
  onLogin: () => void;
  onPinnedChange: (pinned: boolean) => void;
  onRefresh: () => void;
  onResolveMatrixIdentities: (userIds: string[]) => Promise<MessagingMatrixIdentityResolutionResponse>;
  onSearchUsers: (query: string) => Promise<UserDirectoryEntry[]>;
}

export interface MessagingMapContext {
  center: {
    lat: number;
    lon: number;
  };
  selectedFeature?: {
    id: string;
    title: string;
  };
  userLocation?: {
    accuracyM?: number | null;
    lat: number;
    lon: number;
  };
}

export interface MessagingReportSeed {
  conversationId?: string;
  groupId?: string;
  groupName?: string;
  location?: MatrixLocationShare;
  roomId?: string;
  title?: string;
}

export interface MatrixRoomSummary {
  encrypted: boolean;
  messageRetentionSeconds?: number;
  name: string;
  roomId: string;
  unreadCount: number;
}

export interface MatrixTimelineMessage {
  attachment?: MatrixTimelineAttachment;
  body: string;
  eventId: string;
  geoUri?: string;
  kind: MatrixMessageKind;
  location?: MatrixLocationShare;
  own: boolean;
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
  sendMessage(roomId: string, body: string): Promise<void>;
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
