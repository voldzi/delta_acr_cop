import React from "react";
import clsx from "clsx";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  Bell,
  BellOff,
  Bus,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Copy,
  Download,
  FileText,
  ExternalLink,
  Forward,
  Image as ImageIcon,
  Info,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  MicOff,
  MoreVertical,
  Navigation,
  Phone,
  PhoneOff,
  Pin,
  PinOff,
  Plus,
  RefreshCcw,
  Reply,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Smile,
  Sparkles,
  Sticker,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X
} from "lucide-react";
import {
  beginLogin,
  createInitialAuthSession,
  endSession,
  getAuthorizationToken,
  initializeAuth,
  authSessionStorageKey,
  isAuthSessionActive,
  isAuthSessionRetainedForOffline,
  isOidcEnabled,
  plannedAuthRefreshDelayMs,
  readAuthConfig,
  retainAuthSessionAfterRefreshFailure,
  refreshAuthSession,
  shouldRefreshAuthSessionOnResume,
  shouldExpireAuthSessionAfterRefreshFailure
} from "@cop/core/auth";
import type { AuthConfig, AuthSession } from "@cop/core/auth";
import {
  chatComposerSuggestions as sharedChatComposerSuggestions,
  parseChatAiInvocation as parseSharedChatAiInvocation,
  parseChatAiMention as parseSharedChatAiMention,
  type ChatAiCommandId
} from "@cop/core/chat-interactions";
import {
  createAiSituationSummary,
  createCommunityGroup,
  createMessagingConversation,
  deleteCommunityGroup,
  fetchCommunityGroups,
  fetchAiChatAgentJob,
  fetchMessagingConversations,
  fetchMessagingStatus,
  fetchUserProfile,
  ensureMessagingConversationMatrixRoom,
  leaveCommunityGroup,
  removeCommunityGroupMember,
  searchUserDirectory,
  startAiChatAgentJob,
  syncMessagingConversationMembers,
  updateCommunityGroupMetadata,
  upsertCommunityGroupMember
} from "@cop/core/cop-data";
import type {
  AiChatAgentContextSnapshot,
  AiChatAgentJobResponse,
  AiChatAgentQueryOptions,
  AiContextGeoContext,
  AiContextTimeWindow,
  AiCopResponse,
  AiModelPreference,
  CommunityGroup,
  MessagingConversationSummary,
  MessagingMatrixRoomBindingResponse,
  MessagingStatusResponse,
  ServerUserProfile,
  UserDirectoryEntry
} from "@cop/core/cop-data";
import { publishChatSummarySnapshot, publishChatVoiceCallSnapshot, rotateMatrixDeviceId } from "@cop/messaging/runtime";
import {
  enableWebPushNotifications,
  fetchWebPushConfig,
  readWebPushPermissionState,
  type WebPushUiState
} from "@cop/messaging/webPush";
import type {
  MatrixAttachmentKind,
  MatrixAttachmentUpload,
  MatrixCopAiResponsePlaybookMetadata,
  MatrixCopAiConversationMetadata,
  MatrixCopAiFollowUpSuggestion,
  MatrixCopMapAction,
  MatrixCopMessageMetadata,
  MatrixLocationShare,
  MatrixMessagingSession,
  MatrixRoomSummary,
  MatrixTimelineMessage,
  MatrixTransitShare,
  MatrixVoiceCallSnapshot
} from "@cop/messaging/types";
import {
  decodeChatCurrentLocation,
  decodeChatShareTransit,
  decodeChatVoiceCallCommand,
  decodeCopMapFocusSearch,
  encodeChatLiveLocations,
  encodeChatReportDraft,
  encodeChatVoiceCallCommandAcknowledgement,
  encodeCopReportDraftUrl,
  type ChatReportDraftPayload,
  type ChatVoiceCallCommandAcknowledgementMessage,
  type ChatVoiceCallCommandMessage,
  type ChatVoiceCallMessage,
  type ChatSummaryMessage,
  type ChatSummarySyncState,
  type ChatSummaryUnreadRoom,
  encodeChatCenterLocation,
  encodeCopMapFocusUrl
} from "@cop/messaging/bridge";
import { chatText } from "./i18n";
import { Avatar } from "./components/Avatar";
import { AiMarkdownOutput } from "./components/AiMarkdownOutput";
import { ChatActionMenu, MessageSearchBar, SelectionToolbar } from "./components/ConversationControls";
import { DocumentThumb } from "./components/DocumentThumb";
import { StaticLocationMap, formatCoordinates } from "./components/LocationPreview";
import {
  embeddedChatSelectionFromMessage,
  readRouteSelection,
  useChatRouting,
  writeChatRoute
} from "./hooks/useChatRouting";
import { deriveChatWorkflowState } from "./hooks/chatWorkflowState";
import { useMatrixSession } from "./hooks/useMatrixSession";
import { useEventCallback, useModalFocus } from "./hooks/useModalFocus";
import { preferredChatScrollBehavior, useVirtualTimelineRows, type TimelineRow } from "./hooks/useVirtualTimelineRows";
import { useVisibleNow } from "./hooks/useVisibleNow";
import {
  buildTimelineRows,
  filterTimelineByRetention,
  isChatMuted,
  mergeTimelineMessages,
  messageMatchesQuery,
  normalizeChatPreferences,
  selectReadableTimelineMessagesForStorage,
  timelineNeedsBridgeBackfill,
  type ChatPreferences
} from "./chat-model";
import { deleteStoredRoomTimeline, readStoredRoomTimeline, writeStoredRoomTimeline } from "./timeline-cache";
import { createAsyncRefreshCoordinator } from "./async-refresh-coordinator";
import type { ForwardTarget } from "./dialogs/ForwardDialog";
import type { MediaPreviewItem } from "./dialogs/MediaPreviewDialog";
import type { MuteChoice } from "./dialogs/MuteDialog";
import type { NewChatMode } from "./dialogs/NewChatDialog";
import {
  messageRetentionLabel,
  messageRetentionShortLabel,
  normalizeMessageRetentionSeconds,
  type MessageRetentionSeconds
} from "./dialogs/messageRetention";
import { aiResponseSummary, aiStatusLabel } from "./dialogs/aiResponse";

const liveLocationUpdateMinIntervalMs = 15_000;
const liveLocationDurationOptions = [
  { label: "15 min", seconds: 15 * 60 },
  { label: "1 h", seconds: 60 * 60 },
  { label: "8 h", seconds: 8 * 60 * 60 }
] as const;

interface ActiveLiveLocationSession {
  durationSeconds: number;
  expiresAt: string;
  roomId: string;
  shareId: string;
  startedAt: string;
}

export { embeddedChatSelectionFromMessage, readRouteSelection, writeChatRoute } from "./hooks/useChatRouting";
export { centerLocationInCop } from "./components/LocationPreview";
export {
  buildTimelineRows,
  filterTimelineByRetention,
  isChatMuted,
  mergeTimelineMessages,
  messageMatchesQuery,
  normalizeChatPreferences,
  selectReadableTimelineMessagesForStorage,
  timelineNeedsBridgeBackfill
} from "./chat-model";
export type { ChatPreferences } from "./chat-model";

const AiSituationDialog = React.lazy(() => import("./dialogs/AiSituationDialog"));
const AiAgentDialog = React.lazy(() => import("./dialogs/AiAgentDialog"));
const EncryptionRecoveryDialog = React.lazy(() => import("./dialogs/EncryptionRecoveryDialog"));
const DeleteChatDialog = React.lazy(() => import("./dialogs/DeleteChatDialog"));
const ForwardDialog = React.lazy(() => import("./dialogs/ForwardDialog"));
const MediaPreviewDialog = React.lazy(() => import("./dialogs/MediaPreviewDialog"));
const MessageRetentionDialog = React.lazy(() => import("./dialogs/MessageRetentionDialog"));
const MuteDialog = React.lazy(() => import("./dialogs/MuteDialog"));
const NewChatDialog = React.lazy(() => import("./dialogs/NewChatDialog"));
const RemoveMemberDialog = React.lazy(() => import("./dialogs/RemoveMemberDialog"));

type ChatFilter = "all" | "direct" | "group";
type ChatConnectionState = "offline" | "online" | "syncing";
type InfoPanelTab = "info" | "media" | "members";
type MediaPanelTab = "media" | "documents" | "locations";

interface PendingChatAttachment {
  file: File;
  kind: MatrixAttachmentKind;
  previewUrl?: string;
}

interface ChatSendOptions {
  cop?: MatrixCopMessageMetadata;
  skipAiMention?: boolean;
}

export interface AiAgentInvocation {
  commandId?: ChatAiCommandId;
  modelPreference: AiModelPreference;
  question: string;
  trigger: "direct-ai-chat" | "mention" | "slash";
}

interface LocalUserPreferences {
  operatorProfile?: {
    avatarDataUrl?: string;
    displayName?: string;
  };
}

export interface ChatInfoMember {
  avatarUrl?: string;
  id: string;
  name: string;
  role?: CommunityGroup["members"][number]["role"];
  status?: CommunityGroup["members"][number]["status"];
  subjectId?: string;
  subtitle: string;
}

interface MemberRemovalCandidate {
  groupId: string;
  groupName: string;
  memberName: string;
  memberSubjectId: string;
}

export interface ChatListItem {
  active: boolean;
  avatarVariant?: "ai";
  avatarUrl?: string;
  conversation?: MessagingConversationSummary;
  group?: CommunityGroup;
  id: string;
  muted: boolean;
  latest?: MatrixTimelineMessage;
  memberCount: number;
  manuallyUnread?: boolean;
  pinned: boolean;
  preferenceKey: string;
  preview: string;
  room?: MatrixRoomSummary;
  roomId?: string;
  searchable: string;
  sortAt: number;
  timestamp?: string;
  title: string;
  type: "direct" | "group" | "room";
  unreadCount: number;
}

type ChatVoiceCallBridgeSnapshot = Omit<ChatVoiceCallMessage, "at" | "type">;

interface PendingVoiceCallCommand {
  command: ChatVoiceCallCommandMessage;
  timeoutId: number;
}

interface DemoConversationMetadata {
  media: DemoConversationMedia[];
  messages: DemoConversationMessage[];
  pinnedContext?: string;
  summary?: string;
  title?: string;
}

interface DemoConversationMessage {
  authorName?: string;
  body: string;
  direction?: "incoming" | "outgoing";
  id: string;
  link?: {
    label?: string;
  };
  role?: string;
  sentAt: string;
}

interface DemoConversationMedia {
  byteSizeLabel?: string;
  caption?: string;
  kind: "document" | "location" | "photo" | "video";
  previewUrl?: string;
  title: string;
}

interface MessageActionPopoverState {
  left: number;
  messageId: string;
  mode: "actions" | "reactions";
  stickerTrayOpen: boolean;
  top: number;
}

export interface IncomingChatNotification {
  chat: ChatListItem | null;
  message: MatrixTimelineMessage;
  room: MatrixRoomSummary;
}

export interface ChatNotificationRoomSnapshot {
  activeFocused: boolean;
  chat: ChatListItem | null;
  messages: MatrixTimelineMessage[];
  muted: boolean;
  room: MatrixRoomSummary;
}

export interface ChatNotificationTracker {
  notifiedEventIds: Set<string>;
  primedRoomIds: Set<string>;
  roomWatermarks: Map<string, number>;
}

interface ChatIdentityProfile {
  avatarUrl?: string;
  displayName: string;
  matrixProfile?: {
    avatarUrl?: string;
    displayName?: string;
  };
  subtitle: string;
}

interface ChatDeviceDiagnostics {
  e2eeReady: boolean;
  matrixDeviceId?: string;
  matrixLastSyncAt: number | null;
  matrixLifecycle: string;
  matrixSyncState: string;
  notificationPermission: WebPushUiState["permission"];
  pwaStandalone: boolean;
  serviceWorkerReady?: boolean;
  webPushRegistered: boolean;
  webPushStatus: string;
  webPushSubscriptionActive?: boolean;
}

const apiBase = trimTrailingSlash(import.meta.env.VITE_COP_API_BASE_URL ?? "");
const labToken = import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ?? "dev-lab-token";
const copUserPreferencesStorageKey = "cop.user.preferences.v1";
const chatPreferencesStoragePrefix = "cop.chat.preferences.v1";
const initialHistoryLoadRetryLimit = 8;
const initialHistoryWarmupMessageTarget = 50;
const timelineBridgeBackfillAttemptLimit = 3;
const aiChatAgentJobPollIntervalMs = 1500;
const aiChatAgentJobPollLimit = 90;
const tomatoGameUrl = "https://games.zeleznalady.cz/tomato/";
const copAiAgentUser: UserDirectoryEntry = {
  displayName: "COP AI Assistant",
  subjectId: "cop.ai.agent",
  username: "cop.ai.agent"
};
const quickReactionKeys = ["👍", "❤️", "😂", "😮", "😢", "🙏", "⭐"];
const stickerReactionKeys = ["✅", "🚨", "🔥", "💯", "👀", "🎉", "💪", "🫡", "👏", "🤝", "📍", "⚠️"];
const emptyChatPreferences: ChatPreferences = {
  hiddenByKey: {},
  manualUnreadKeys: [],
  mutedUntilByKey: {},
  pinnedKeys: [],
  readOverrideByKey: {}
};

export function shouldPublishChatUnreadBridgeSnapshot({
  authTokenAvailable,
  chatAvailable,
  matrixSessionActive
}: {
  authTokenAvailable: boolean;
  chatAvailable?: boolean;
  matrixSessionActive: boolean;
}): boolean {
  if (!authTokenAvailable) {
    return true;
  }
  if (chatAvailable === false) {
    return true;
  }
  return chatAvailable === true && matrixSessionActive;
}

export function openReportDraftInCop(report: ChatReportDraftPayload): void {
  const message = encodeChatReportDraft(report);
  if (window.parent !== window) {
    window.parent.postMessage(message, window.location.origin);
    return;
  }
  const target = encodeCopReportDraftUrl(new URL("/", window.location.origin), message.report);
  window.open(target, "_self", "noopener,noreferrer");
}

export function chatSummarySnapshotFromItems(
  items: ChatListItem[],
  state: {
    authTokenAvailable: boolean;
    chatAvailable?: boolean;
    matrixLoading: boolean;
    matrixSessionActive: boolean;
    matrixSessionLifecycle: string;
  }
): Omit<ChatSummaryMessage, "at" | "type"> {
  const unreadRooms = items.flatMap((item) => {
    const room = chatSummaryUnreadRoomFromItem(item);
    return room ? [room] : [];
  });
  return {
    syncState: chatSummarySyncState(state),
    totalUnread: items.reduce((count, item) => count + (!item.muted ? item.unreadCount : 0), 0),
    unreadRooms
  };
}

export function canMarkActiveChatRead({
  item,
  selectedRoomId,
  timeline
}: {
  item: ChatListItem | null;
  selectedRoomId: string | null;
  timeline: MatrixTimelineMessage[];
}): boolean {
  if (!item || !selectedRoomId) {
    return false;
  }
  if (item.roomId && item.roomId !== selectedRoomId) {
    return false;
  }
  if (!item.latest?.eventId) {
    return true;
  }
  return timeline.some((message) => message.eventId === item.latest?.eventId);
}

function chatSummarySyncState({
  authTokenAvailable,
  chatAvailable,
  matrixLoading,
  matrixSessionActive,
  matrixSessionLifecycle
}: {
  authTokenAvailable: boolean;
  chatAvailable?: boolean;
  matrixLoading: boolean;
  matrixSessionActive: boolean;
  matrixSessionLifecycle: string;
}): ChatSummarySyncState {
  if (!authTokenAvailable) {
    return "offline";
  }
  if (chatAvailable === false) {
    return "unavailable";
  }
  if (matrixSessionActive && !matrixLoading && matrixSessionLifecycle === "ready") {
    return "ready";
  }
  return "syncing";
}

function chatSummaryUnreadRoomFromItem(item: ChatListItem): ChatSummaryUnreadRoom | null {
  if (item.muted || item.unreadCount <= 0) {
    return null;
  }
  const selection = chatSummarySelectionForItem(item);
  if (!selection) {
    return null;
  }
  return {
    ...(item.roomId ? { roomId: item.roomId } : {}),
    preview: item.preview,
    selection,
    ...(item.timestamp ? { timestamp: item.timestamp } : {}),
    title: item.title,
    type: item.type,
    unreadCount: item.unreadCount
  };
}

function chatSummarySelectionForItem(item: ChatListItem): string | null {
  if (item.roomId) {
    return item.roomId;
  }
  if (item.conversation?.conversationId) {
    return item.conversation.conversationId;
  }
  if (item.group?.groupId) {
    return item.group.groupId;
  }
  const prefixed = /^(room|conversation|group):(.+)$/u.exec(item.id);
  return prefixed?.[2] ?? null;
}

// Memoized row components: re-render only when their own props change. Combined
// with the stable handlers above, a parent state update (e.g. typing elsewhere)
// no longer re-renders every chat row and message bubble.
const ChatRowMemo = React.memo(ChatRow);
const MessageRowMemo = React.memo(MessageRow);

export function ChatApp() {
  const authConfig = React.useMemo(() => readAuthConfig(), []);
  const [authSession, setAuthSession] = React.useState<AuthSession>(() => createInitialAuthSession(authConfig));
  const [authRefreshRetry, setAuthRefreshRetry] = React.useState(0);
  const [status, setStatus] = React.useState<MessagingStatusResponse | null>(null);
  const [serverUserProfile, setServerUserProfile] = React.useState<ServerUserProfile | null>(null);
  const [conversations, setConversations] = React.useState<MessagingConversationSummary[]>([]);
  const [groups, setGroups] = React.useState<CommunityGroup[]>([]);
  const [rooms, setRooms] = React.useState<MatrixRoomSummary[]>([]);
  const [timeline, setTimeline] = React.useState<MatrixTimelineMessage[]>([]);
  const [timelineRevision, setTimelineRevision] = React.useState(0);
  const [timelineCacheRevision, setTimelineCacheRevision] = React.useState(0);
  const [historyExhaustedByRoom, setHistoryExhaustedByRoom] = React.useState<Record<string, boolean>>({});
  const [historyBackfillRevision, setHistoryBackfillRevision] = React.useState(0);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const {
    clearChatSelection,
    markRouteApplied,
    resetRouteOpenAttempt,
    routeOpenAttemptKey,
    selectedConversationId,
    selectedGroupId,
    selectedRoomId,
    setRouteOpenAttempt,
    setSelectedConversationId,
    setSelectedGroupId,
    setSelectedRoomId
  } = useChatRouting();
  const [pendingAttachment, setPendingAttachment] = React.useState<PendingChatAttachment | null>(null);
  const [conversationQuery, setConversationQuery] = React.useState("");
  const [messageSearchQuery, setMessageSearchQuery] = React.useState("");
  const [chatFilter, setChatFilter] = React.useState<ChatFilter>("all");
  const [webPushState, setWebPushState] = React.useState<WebPushUiState>(() => readWebPushPermissionState());
  const [webPushBusy, setWebPushBusy] = React.useState(false);
  const [voiceCall, setVoiceCall] = React.useState<MatrixVoiceCallSnapshot | null>(null);
  const [composeMode, setComposeMode] = React.useState<NewChatMode>(null);
  const [directQuery, setDirectQuery] = React.useState("");
  const [directSuggestions, setDirectSuggestions] = React.useState<UserDirectoryEntry[]>([]);
  const [newGroupName, setNewGroupName] = React.useState("");
  const [memberQuery, setMemberQuery] = React.useState("");
  const [memberSuggestions, setMemberSuggestions] = React.useState<UserDirectoryEntry[]>([]);
  const [memberAddPendingIds, setMemberAddPendingIds] = React.useState<Set<string>>(() => new Set());
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [preparingChatId, setPreparingChatId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [previewItem, setPreviewItem] = React.useState<MediaPreviewItem | null>(null);
  const [chatPreferences, setChatPreferences] = React.useState<ChatPreferences>(() => readChatPreferences("anonymous"));
  const [infoPanelOpen, setInfoPanelOpen] = React.useState(false);
  const [infoPanelTab, setInfoPanelTab] = React.useState<InfoPanelTab>("info");
  const [mediaPanelTab, setMediaPanelTab] = React.useState<MediaPanelTab>("media");
  const [messageMenuOpen, setMessageMenuOpen] = React.useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = React.useState(false);
  const [messageActionPopover, setMessageActionPopover] = React.useState<MessageActionPopoverState | null>(null);
  const [replyDraft, setReplyDraft] = React.useState<MatrixTimelineMessage | null>(null);
  const [forwardDraftMessages, setForwardDraftMessages] = React.useState<MatrixTimelineMessage[]>([]);
  const [forwardQuery, setForwardQuery] = React.useState("");
  const [forwardSearchLoading, setForwardSearchLoading] = React.useState(false);
  const [forwardSelectedTargetKeys, setForwardSelectedTargetKeys] = React.useState<Set<string>>(() => new Set());
  const [forwardSelectedTargetsByKey, setForwardSelectedTargetsByKey] = React.useState<Record<string, ForwardTarget>>(
    {}
  );
  const [forwardUserSuggestions, setForwardUserSuggestions] = React.useState<UserDirectoryEntry[]>([]);
  const [forwardWorkingId, setForwardWorkingId] = React.useState<string | null>(null);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = React.useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = React.useState("");
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = React.useState<string | null>(null);
  const [recoveryWorking, setRecoveryWorking] = React.useState(false);
  const [chatRemovalWorking, setChatRemovalWorking] = React.useState(false);
  const [memberRemovalCandidate, setMemberRemovalCandidate] = React.useState<MemberRemovalCandidate | null>(null);
  const [memberRemovalWorking, setMemberRemovalWorking] = React.useState(false);
  const [recoveryManualRestore, setRecoveryManualRestore] = React.useState(false);
  const [aiSituationDialogOpen, setAiSituationDialogOpen] = React.useState(false);
  const [aiSituationResponse, setAiSituationResponse] = React.useState<AiCopResponse | null>(null);
  const [aiSituationError, setAiSituationError] = React.useState<string | null>(null);
  const [aiSituationWorking, setAiSituationWorking] = React.useState(false);
  const [aiAgentDialogOpen, setAiAgentDialogOpen] = React.useState(false);
  const [aiAgentQuestion, setAiAgentQuestion] = React.useState("");
  const [aiAgentModelPreference, setAiAgentModelPreference] = React.useState<AiModelPreference>("auto");
  const [aiAgentResponse, setAiAgentResponse] = React.useState<AiCopResponse | null>(null);
  const [aiAgentError, setAiAgentError] = React.useState<string | null>(null);
  const [aiAgentJobStatus, setAiAgentJobStatus] = React.useState<string | null>(null);
  const [aiAgentInlineStatus, setAiAgentInlineStatus] = React.useState<string | null>(null);
  const [tomatoGameOpen, setTomatoGameOpen] = React.useState(false);
  const [hostCurrentLocation, setHostCurrentLocation] = React.useState<MatrixLocationShare | null>(() =>
    initialEmbeddedHostLocation()
  );
  const [standaloneAiLocation, setStandaloneAiLocation] = React.useState<MatrixLocationShare | null>(null);
  const [standaloneAiLocationBusy, setStandaloneAiLocationBusy] = React.useState(false);
  const [liveLocationSession, setLiveLocationSession] = React.useState<ActiveLiveLocationSession | null>(null);
  const [liveLocationExpiryTick, setLiveLocationExpiryTick] = React.useState(0);
  const [aiAgentWorking, setAiAgentWorking] = React.useState(false);
  const [aiAgentGroupUpdating, setAiAgentGroupUpdating] = React.useState(false);
  const [muteDialogOpen, setMuteDialogOpen] = React.useState(false);
  const [deleteChatCandidate, setDeleteChatCandidate] = React.useState<ChatListItem | null>(null);
  const [retentionDialogOpen, setRetentionDialogOpen] = React.useState(false);
  const [retentionSaving, setRetentionSaving] = React.useState(false);
  const [retentionOverrideByRoom, setRetentionOverrideByRoom] = React.useState<Record<string, MessageRetentionSeconds>>(
    {}
  );
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = React.useState<Set<string>>(() => new Set());
  const [activeSearchIndex, setActiveSearchIndex] = React.useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [localPreferencesRevision, setLocalPreferencesRevision] = React.useState(0);
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const messageMenuRef = React.useRef<HTMLDivElement | null>(null);
  const messageCanvasRef = React.useRef<HTMLDivElement | null>(null);
  const timelineEndRef = React.useRef<HTMLDivElement | null>(null);
  const showJumpToLatestRef = React.useRef(false);
  const jumpVisibilityFrameRef = React.useRef<number | null>(null);
  const matrixAttemptKeyRef = React.useRef<string | null>(null);
  const matrixResumeInFlightRef = React.useRef(false);
  const matrixWebPushPusherDeviceIdRef = React.useRef<string | undefined>(undefined);
  const webPushAutoSyncKeyRef = React.useRef<string | null>(null);
  const initialHistoryLoadAttemptsRef = React.useRef<Map<string, number>>(new Map());
  const timelineBridgeBackfillAttemptsRef = React.useRef<Map<string, number>>(new Map());
  const liveLocationSessionRef = React.useRef<ActiveLiveLocationSession | null>(null);
  const liveLocationWatchIdRef = React.useRef<number | null>(null);
  const liveLocationExpiryTimerRef = React.useRef<number | null>(null);
  const liveLocationLastSentAtRef = React.useRef(0);
  const liveLocationLastPositionRef = React.useRef<MatrixLocationShare | null>(null);
  const liveLocationSendInFlightRef = React.useRef(false);
  const historyLoadingRoomsRef = React.useRef<Set<string>>(new Set());
  const notifiedEventIdsRef = React.useRef<Set<string>>(new Set());
  const notificationPrimedRoomIdsRef = React.useRef<Set<string>>(new Set());
  const notificationRoomWatermarksRef = React.useRef<Map<string, number>>(new Map());
  const lastVoiceCallBridgeSnapshotRef = React.useRef<ChatVoiceCallBridgeSnapshot | null>(null);
  const voiceCallRef = React.useRef<MatrixVoiceCallSnapshot | null>(null);
  const pendingVoiceCallCommandsRef = React.useRef<Map<string, PendingVoiceCallCommand>>(new Map());
  const executingVoiceCallCommandIdsRef = React.useRef<Set<string>>(new Set());
  const completedVoiceCallCommandAcksRef = React.useRef<Map<string, ChatVoiceCallCommandAcknowledgementMessage>>(
    new Map()
  );
  const authSessionRef = React.useRef(authSession);
  const selectedRoomIdRef = React.useRef<string | null>(null);
  const timelineCacheRef = React.useRef<Map<string, MatrixTimelineMessage[]>>(new Map());
  const timelinePersistFingerprintRef = React.useRef<Map<string, string>>(new Map());
  const conversationsRef = React.useRef<MessagingConversationSummary[]>(conversations);
  const memberAddPendingIdsRef = React.useRef<Set<string>>(new Set());
  const webPushRefreshCoordinator = React.useMemo(
    () =>
      createAsyncRefreshCoordinator({
        load: () => fetchWebPushConfig(apiBase),
        onError: () =>
          setWebPushState({
            ...readWebPushPermissionState(),
            warnings: ["Stav webových push notifikací se nepodařilo ověřit."]
          }),
        onSuccess: setWebPushState
      }),
    []
  );

  React.useEffect(() => installChatHapticFeedback(), []);

  const updateJumpToLatestVisibility = useEventCallback((node: HTMLElement) => {
    const nextVisible = node.scrollHeight - node.scrollTop - node.clientHeight > 180;
    if (nextVisible === showJumpToLatestRef.current) {
      return;
    }
    showJumpToLatestRef.current = nextVisible;
    const commitVisibility = () => {
      jumpVisibilityFrameRef.current = null;
      setShowJumpToLatest(showJumpToLatestRef.current);
    };
    if (typeof window.requestAnimationFrame !== "function") {
      commitVisibility();
      return;
    }
    if (jumpVisibilityFrameRef.current === null) {
      jumpVisibilityFrameRef.current = window.requestAnimationFrame(commitVisibility);
    }
  });

  React.useEffect(
    () => () => {
      if (jumpVisibilityFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(jumpVisibilityFrameRef.current);
      }
      jumpVisibilityFrameRef.current = null;
    },
    []
  );

  const authToken = getAuthorizationToken(authSession, labToken);
  const authenticated = Boolean(authToken) || isAuthSessionRetainedForOffline(authSession);
  const authSubjectId = authSession.profile?.subjectId ?? authSession.profile?.username ?? authSession.profile?.email;
  const preferencesOwner = authSubjectId ?? authSession.profile?.username ?? "anonymous";
  const localUserPreferences = React.useMemo(
    () => readLocalUserPreferences(preferencesOwner),
    [localPreferencesRevision, preferencesOwner]
  );
  const chatIdentity = React.useMemo(
    () => chatIdentityFor(authSession, authConfig, serverUserProfile, localUserPreferences),
    [authConfig, authSession, localUserPreferences, serverUserProfile]
  );
  const matrixWebPushDeviceId = webPushState.registered ? webPushState.deviceId : undefined;
  const matrixWebPushFallbackDeviceId = webPushState.registered ? undefined : webPushState.deviceId;
  const matrixWebPushPusherStateKey = matrixWebPushDeviceId
    ? `registered:${matrixWebPushDeviceId}`
    : matrixWebPushFallbackDeviceId
      ? `disabled:${matrixWebPushFallbackDeviceId}`
      : "disabled";
  const handleMatrixRoomsChanged = React.useCallback(
    (nextRooms: MatrixRoomSummary[], preferredSelection?: string | null) => {
      setRooms(nextRooms);
      setSelectedRoomId(
        (current) => current ?? selectRoomIdFromKey(preferredSelection, conversationsRef.current, nextRooms)
      );
    },
    [setSelectedRoomId]
  );
  const handleMatrixTimelineChanged = React.useCallback(() => setTimelineRevision((value) => value + 1), []);
  const handleMatrixVoiceCallChanged = React.useCallback((nextCall: MatrixVoiceCallSnapshot | null) => {
    setVoiceCall(nextCall);
  }, []);
  const {
    encryptionRecoveryStatus,
    ensureMatrixSession,
    matrixLoading,
    matrixLastReadyAt,
    matrixLastStartedAt,
    matrixLastSyncAt,
    matrixSessionLifecycle,
    matrixSession,
    matrixSessionRef,
    refreshEncryptionRecoveryStatus,
    resetMatrixSession,
    restartMatrixSession,
    startMatrixSession,
    updateMatrixWebPushPusher,
    syncState
  } = useMatrixSession({
    apiBase,
    authSubjectId,
    authToken,
    conversationsRef,
    getSensitiveActionAuthToken: refreshAuthTokenForSensitiveMatrixAction,
    matrixProfile: chatIdentity.matrixProfile,
    matrixWebPushDeviceId,
    matrixWebPushFallbackDeviceId,
    onError: setError,
    onNotice: setNotice,
    onRoomsChanged: handleMatrixRoomsChanged,
    onTimelineChanged: handleMatrixTimelineChanged,
    onVoiceCallChanged: handleMatrixVoiceCallChanged
  });
  const ownIdentityIds = React.useMemo(
    () => ownChatIdentityIds(authSession, matrixSession?.bootstrap.userId),
    [authSession, matrixSession?.bootstrap.userId]
  );
  const timelineStorageOwner = matrixSession?.bootstrap.userId ?? authSubjectId ?? preferencesOwner;
  const persistRoomTimeline = React.useCallback(
    (roomId: string, messages: MatrixTimelineMessage[], options: { replaceEmpty?: boolean } = {}) => {
      const readableMessages = selectReadableTimelineMessagesForStorage(messages);
      if (readableMessages.length === 0) {
        if (options.replaceEmpty) {
          timelinePersistFingerprintRef.current.delete(`${timelineStorageOwner}:${roomId}`);
          void deleteStoredRoomTimeline(timelineStorageOwner, roomId).catch(() => undefined);
        }
        return;
      }
      const fingerprintKey = `${timelineStorageOwner}:${roomId}`;
      const fingerprint = persistentTimelineFingerprint(readableMessages);
      if (timelinePersistFingerprintRef.current.get(fingerprintKey) === fingerprint) {
        return;
      }
      timelinePersistFingerprintRef.current.set(fingerprintKey, fingerprint);
      void writeStoredRoomTimeline(timelineStorageOwner, roomId, readableMessages).catch(() => undefined);
    },
    [timelineStorageOwner]
  );

  React.useEffect(() => {
    authSessionRef.current = authSession;
  }, [authSession]);

  const ensureFreshChatAuthSession = React.useCallback(async (): Promise<AuthSession> => {
    const currentSession = authSessionRef.current;
    if (!isOidcEnabled(authConfig) || !shouldRefreshAuthSessionOnResume(currentSession)) {
      return currentSession;
    }
    let refreshError: unknown;
    const refreshed = await refreshAuthSession(authConfig, currentSession).catch((error: unknown) => {
      refreshError = error;
      return null;
    });
    if (refreshed?.status === "authenticated") {
      const identityChanged = !sameAuthSessionIdentity(currentSession, refreshed);
      authSessionRef.current = refreshed;
      setAuthRefreshRetry(0);
      setAuthSession(refreshed);
      if (identityChanged) {
        matrixAttemptKeyRef.current = null;
        resetMatrixSession();
        setRefreshNonce((value) => value + 1);
      }
      return refreshed;
    }
    const offlineRetainedSession = retainAuthSessionAfterRefreshFailure(currentSession, refreshError);
    if (offlineRetainedSession) {
      authSessionRef.current = offlineRetainedSession;
      setAuthRefreshRetry((current) => current + 1);
      setAuthSession(offlineRetainedSession);
      return offlineRetainedSession;
    }
    if (shouldExpireAuthSessionAfterRefreshFailure(currentSession.expiresAt)) {
      const expiredSession: AuthSession = { status: "anonymous" };
      authSessionRef.current = expiredSession;
      setAuthSession(expiredSession);
      matrixAttemptKeyRef.current = null;
      resetMatrixSession();
      return expiredSession;
    }
    const retainedSession: AuthSession = {
      ...currentSession,
      error:
        refreshError instanceof Error
          ? refreshError.message
          : "Obnova přihlášení se dočasně nepodařila, zkusím to znovu."
    };
    authSessionRef.current = retainedSession;
    setAuthRefreshRetry((current) => current + 1);
    setAuthSession(retainedSession);
    return retainedSession;
  }, [authConfig, resetMatrixSession]);

  React.useEffect(() => {
    if (!isOidcEnabled(authConfig)) {
      return undefined;
    }
    let cancelled = false;
    const syncAuthFromSharedStorage = () => {
      initializeAuth(authConfig)
        .then((nextSession) => {
          if (cancelled) {
            return;
          }
          const identityChanged = !sameAuthSessionIdentity(authSessionRef.current, nextSession);
          authSessionRef.current = nextSession;
          setAuthRefreshRetry(0);
          setAuthSession(nextSession);
          if (identityChanged) {
            matrixAttemptKeyRef.current = null;
            resetMatrixSession();
            setRefreshNonce((value) => value + 1);
          }
        })
        .catch((caught: unknown) => {
          if (cancelled) {
            return;
          }
          setAuthSession({
            error: caught instanceof Error ? caught.message : "Přihlášení se nepodařilo ověřit.",
            status: "error"
          });
          resetMatrixSession();
        });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== authSessionStorageKey || (event.storageArea && event.storageArea !== window.localStorage)) {
        return;
      }
      syncAuthFromSharedStorage();
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
    };
  }, [authConfig, resetMatrixSession]);

  const chatReady = Boolean(authToken && status?.chatAvailable);
  const encryptionRecoveryReady = Boolean(!matrixSession || encryptionRecoveryStatus?.ready);
  const embedded = React.useMemo(() => new URLSearchParams(window.location.search).get("embedded") === "1", []);
  const aiContextLocation = hostCurrentLocation ?? standaloneAiLocation;
  const selectedConversation = selectedConversationId
    ? (conversations.find((conversation) => conversation.conversationId === selectedConversationId) ?? null)
    : selectedRoomId
      ? (conversations.find((conversation) => conversation.matrix?.roomId === selectedRoomId) ?? null)
      : null;
  const selectedGroup = selectedGroupId
    ? (groups.find((group) => group.groupId === selectedGroupId) ?? null)
    : selectedConversation
      ? groupForConversation(selectedConversation, groups)
      : null;
  const canManageSelectedGroupMembers = selectedGroup
    ? canManageCommunityGroupMembers(selectedGroup, authSubjectId)
    : false;
  const selectedGroupAiAssistant = selectedGroup ? communityGroupAiAssistantMetadata(selectedGroup) : null;
  const selectedGroupAiAssistantEnabled = Boolean(selectedGroupAiAssistant?.enabled);
  const selectedRoom = selectedRoomId
    ? (rooms.find((room) => room.roomId === selectedRoomId) ?? null)
    : selectedConversation?.matrix?.roomId
      ? (rooms.find((room) => room.roomId === selectedConversation.matrix?.roomId) ?? null)
      : null;
  const rawChatItems = React.useMemo(
    () =>
      buildChatItems({
        authSubjectId,
        conversations,
        filter: chatFilter,
        groups,
        ownIdentityIds,
        query: conversationQuery,
        rooms,
        selectedConversationId,
        selectedGroupId,
        selectedRoomId
      }),
    [
      authSubjectId,
      chatFilter,
      conversationQuery,
      conversations,
      groups,
      ownIdentityIds,
      rooms,
      selectedConversationId,
      selectedGroupId,
      selectedRoomId
    ]
  );
  const chatItems = React.useMemo(
    () => applyChatPreferences(rawChatItems, chatPreferences),
    [chatPreferences, rawChatItems]
  );
  const pinnedChatItems = React.useMemo(() => chatItems.filter((item) => item.pinned), [chatItems]);
  const regularChatItems = React.useMemo(() => chatItems.filter((item) => !item.pinned), [chatItems]);
  const activeChat = chatItems.find((item) => item.active) ?? null;
  const voiceCallChat = voiceCall ? (chatItems.find((item) => item.roomId === voiceCall.roomId) ?? null) : null;
  const activeVoiceCall = voiceCall && voiceCall.phase !== "ended" ? voiceCall : null;
  const voiceCallTitle =
    voiceCall && voiceCall.roomId
      ? (voiceCallChat?.title ?? rooms.find((room) => room.roomId === voiceCall.roomId)?.name)
      : undefined;
  const voiceCallDifferentChat = Boolean(
    activeVoiceCall && voiceCallRoomToFocusAfterAnswer(activeVoiceCall.roomId, selectedRoomId)
  );
  const canStartVoiceCall = Boolean(
    (activeChat?.type === "direct" || activeChat?.type === "group") &&
    activeChat.roomId &&
    selectedRoomId &&
    matrixSession &&
    chatReady &&
    encryptionRecoveryReady &&
    (!voiceCall || voiceCall.phase === "ended")
  );
  const selectedAiAgentDirectChat = activeChat ? isAiAgentChatItem(activeChat) : false;
  const routeChatSelected = Boolean(activeChat && readRouteSelection());
  const totalUnreadCount = React.useMemo(
    () => chatItems.reduce((count, item) => count + (!item.muted ? item.unreadCount : 0), 0),
    [chatItems]
  );
  React.useEffect(() => {
    updateApplicationBadge(totalUnreadCount);
  }, [totalUnreadCount]);
  React.useEffect(() => {
    if (voiceCall?.callId && voiceCall.roomId) {
      const snapshot: ChatVoiceCallBridgeSnapshot = {
        callId: voiceCall.callId,
        direction: voiceCall.direction,
        eligibleParticipants: voiceCall.eligibleParticipants ?? [],
        kind: voiceCall.kind,
        participants: voiceCall.participants,
        phase: voiceCall.phase,
        roomId: voiceCall.roomId,
        ...(voiceCallTitle ? { title: voiceCallTitle } : {})
      };
      lastVoiceCallBridgeSnapshotRef.current =
        voiceCall.phase === "ended" || voiceCall.phase === "failed" ? null : snapshot;
      publishChatVoiceCallSnapshot(snapshot);
      return;
    }
    const previous = lastVoiceCallBridgeSnapshotRef.current;
    if (previous) {
      publishChatVoiceCallSnapshot({ ...previous, phase: "ended" });
      lastVoiceCallBridgeSnapshotRef.current = null;
    }
  }, [
    voiceCall?.callId,
    voiceCall?.direction,
    voiceCall?.eligibleParticipants,
    voiceCall?.kind,
    voiceCall?.participants,
    voiceCall?.phase,
    voiceCall?.roomId,
    voiceCallTitle
  ]);
  const activeMessageRetentionSeconds =
    selectedRoomId && Object.prototype.hasOwnProperty.call(retentionOverrideByRoom, selectedRoomId)
      ? (retentionOverrideByRoom[selectedRoomId] ?? null)
      : messageRetentionSecondsForActiveChat(selectedRoom, selectedGroup);
  const retainedTimeline = React.useMemo(
    () => filterTimelineByRetention(timeline, activeMessageRetentionSeconds),
    [activeMessageRetentionSeconds, timeline]
  );
  const demoTimeline = React.useMemo(
    () => (selectedGroup ? demoTimelineMessagesForGroup(selectedGroup, authSession) : []),
    [authSession, selectedGroup]
  );
  const showingDemoTimeline = retainedTimeline.length === 0 && demoTimeline.length > 0;
  const visibleTimeline = React.useMemo(
    () => collapseLiveLocationTimeline(showingDemoTimeline ? demoTimeline : retainedTimeline),
    [demoTimeline, retainedTimeline, showingDemoTimeline]
  );
  const timelineRows = React.useMemo(() => buildTimelineRows(visibleTimeline), [visibleTimeline]);
  const virtualTimeline = useVirtualTimelineRows(timelineRows, messageCanvasRef);
  const timelineMessages = React.useMemo(
    () => timelineRows.filter((row) => row.kind === "message").map((row) => row.message),
    [timelineRows]
  );
  const messageById = React.useMemo(
    () => new Map(timelineMessages.map((message) => [message.eventId, message])),
    [timelineMessages]
  );
  const historyExhausted =
    showingDemoTimeline || (selectedRoomId ? historyExhaustedByRoom[selectedRoomId] === true : true);
  const searchMatches = React.useMemo(
    () =>
      messageSearchOpen && messageSearchQuery.trim()
        ? timelineMessages.filter((message) => messageMatchesQuery(message, messageSearchQuery))
        : [],
    [messageSearchOpen, messageSearchQuery, timelineMessages]
  );
  const activeSearchMessageId = searchMatches[activeSearchIndex]?.eventId ?? null;
  const selectedMessages = React.useMemo(
    () => timelineMessages.filter((message) => selectedMessageIds.has(message.eventId)),
    [selectedMessageIds, timelineMessages]
  );
  const activeLiveLocations = React.useMemo(
    () => collectActiveLiveLocations(timelineMessages, selectedRoomId),
    [liveLocationExpiryTick, selectedRoomId, timelineMessages]
  );
  const forwardTargets = React.useMemo(
    () => buildForwardTargets(chatItems, forwardUserSuggestions, forwardQuery),
    [chatItems, forwardQuery, forwardUserSuggestions]
  );
  const selectedForwardTargets = React.useMemo(
    () => Object.values(forwardSelectedTargetsByKey),
    [forwardSelectedTargetsByKey]
  );
  const workflowState = React.useMemo(
    () =>
      deriveChatWorkflowState({
        authenticated,
        chatAvailable: Boolean(status?.chatAvailable),
        forwardDraftCount: forwardDraftMessages.length,
        matrixLifecycle: matrixSessionLifecycle,
        matrixSessionActive: Boolean(matrixSession),
        preparingChat: Boolean(preparingChatId),
        recoveryReady: encryptionRecoveryReady,
        selectedForwardTargetCount: selectedForwardTargets.length,
        selectedRoomId,
        sending,
        surface: "desktop"
      }),
    [
      authenticated,
      encryptionRecoveryReady,
      forwardDraftMessages.length,
      matrixSession,
      matrixSessionLifecycle,
      preparingChatId,
      selectedForwardTargets.length,
      selectedRoomId,
      sending,
      status?.chatAvailable
    ]
  );
  const composerEnabled = workflowState.composerEnabled;
  const actionMessage = messageActionPopover ? (messageById.get(messageActionPopover.messageId) ?? null) : null;
  const statusLabel = statusLabelFor(status, matrixSession, syncState, matrixLoading);
  const matrixMediaAccessToken = matrixSession?.bootstrap.accessToken;
  const recoveryBanner =
    matrixSession && encryptionRecoveryStatus && !encryptionRecoveryStatus.ready
      ? encryptionRecoveryStatus.needsSetup
        ? encryptionRecoveryStatus.keyBackupEnabled
          ? "E2EE je aktivní, ale pro iPhone/iPad je potřeba doplnit kompletní obnovu."
          : "E2EE je aktivní. Pro bezpečné použití na více zařízeních nastavte obnovovací klíč."
        : "Toto zařízení zatím nemá odemčenou E2EE zálohu. Zadejte obnovovací klíč."
      : null;
  const matrixWarmupBanner = React.useMemo(() => {
    if (!authenticated || !selectedRoomId || showingDemoTimeline || !status?.chatAvailable) {
      return null;
    }
    if (matrixLoading || matrixSessionLifecycle === "starting") {
      return "Připravuji bezpečné chatové spojení a synchronizuji E2EE zprávy.";
    }
    if (!matrixSession) {
      return "Obnovuji chatové spojení pro toto zařízení.";
    }
    if (!matrixLastSyncAt || Date.now() - matrixLastSyncAt > 75_000) {
      return "Ověřuji živý Matrix sync po návratu aplikace.";
    }
    return null;
  }, [
    authenticated,
    matrixLastSyncAt,
    matrixLoading,
    matrixSession,
    matrixSessionLifecycle,
    selectedRoomId,
    showingDemoTimeline,
    status?.chatAvailable
  ]);
  const deviceDiagnostics = React.useMemo<ChatDeviceDiagnostics>(
    () => ({
      e2eeReady: encryptionRecoveryReady,
      matrixDeviceId: matrixSession?.bootstrap.deviceId,
      matrixLastSyncAt,
      matrixLifecycle: matrixSessionLifecycle,
      matrixSyncState: syncState,
      notificationPermission: webPushState.permission,
      pwaStandalone: webPushState.standalone,
      serviceWorkerReady: webPushState.serviceWorkerReady,
      webPushRegistered: webPushState.registered,
      webPushStatus: webPushState.status,
      webPushSubscriptionActive: webPushState.subscriptionActive
    }),
    [
      encryptionRecoveryReady,
      matrixLastSyncAt,
      matrixSession?.bootstrap.deviceId,
      matrixSessionLifecycle,
      syncState,
      webPushState.permission,
      webPushState.registered,
      webPushState.serviceWorkerReady,
      webPushState.standalone,
      webPushState.status,
      webPushState.subscriptionActive
    ]
  );

  React.useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

  React.useEffect(() => {
    voiceCallRef.current = voiceCall;
    void drainPendingVoiceCallCommands();
  }, [matrixSession, voiceCall?.callId, voiceCall?.phase, voiceCall?.roomId]);

  React.useEffect(
    () => () => {
      for (const pending of pendingVoiceCallCommandsRef.current.values()) {
        window.clearTimeout(pending.timeoutId);
      }
      pendingVoiceCallCommandsRef.current.clear();
      executingVoiceCallCommandIdsRef.current.clear();
    },
    []
  );

  React.useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  React.useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith("cop.user.preferences.v1")) {
        setLocalPreferencesRevision((current) => current + 1);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  React.useEffect(() => {
    setChatPreferences(readChatPreferences(preferencesOwner));
  }, [preferencesOwner]);

  const refreshChatWebPushState = React.useCallback(
    (force = false) => webPushRefreshCoordinator.refresh({ force }),
    [webPushRefreshCoordinator]
  );

  React.useEffect(() => {
    void refreshChatWebPushState(true);
  }, [refreshChatWebPushState, refreshNonce]);

  React.useEffect(() => {
    if (!authToken || webPushBusy || webPushState.permission !== "granted" || !webPushState.enabled) {
      return;
    }
    const existingOptIn = webPushState.registered || Boolean(webPushState.deviceId) || webPushState.subscriptionActive;
    if (!existingOptIn) {
      return;
    }
    const syncKey = [
      authSubjectId ?? "anonymous",
      webPushState.deviceId ?? "no-device",
      webPushState.registered ? "registered" : "unregistered",
      webPushState.serviceWorkerReady ? "sw-ready" : "sw-missing",
      webPushState.subscriptionActive ? "sub-active" : "sub-missing"
    ].join(":");
    if (webPushAutoSyncKeyRef.current === syncKey) {
      return;
    }
    webPushAutoSyncKeyRef.current = syncKey;
    let cancelled = false;
    enableWebPushNotifications(apiBase, authToken)
      .then((nextState) => {
        if (!cancelled) {
          setWebPushState(nextState);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWebPushState((current) => ({
            ...current,
            warnings: ["Webové push notifikace se nepodařilo automaticky obnovit. Zkuste je zapnout znovu."]
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    apiBase,
    authSubjectId,
    authToken,
    webPushBusy,
    webPushState.deviceId,
    webPushState.enabled,
    webPushState.permission,
    webPushState.registered,
    webPushState.serviceWorkerReady,
    webPushState.subscriptionActive
  ]);

  React.useEffect(() => {
    setMessageMenuOpen(false);
    setMuteDialogOpen(false);
    setRetentionDialogOpen(false);
    setInfoPanelOpen(false);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
    setMessageSearchOpen(false);
    setMessageSearchQuery("");
    setActiveSearchIndex(0);
    showJumpToLatestRef.current = false;
    if (jumpVisibilityFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(jumpVisibilityFrameRef.current);
      jumpVisibilityFrameRef.current = null;
    }
    setShowJumpToLatest(false);
    setMessageActionPopover(null);
    setReplyDraft(null);
  }, [selectedConversationId, selectedGroupId, selectedRoomId]);

  React.useEffect(() => {
    setActiveSearchIndex(0);
  }, [messageSearchQuery, selectedRoomId]);

  React.useEffect(() => {
    if (!activeSearchMessageId) {
      return;
    }
    const selector = `[data-message-id="${cssEscape(activeSearchMessageId)}"]`;
    const existingNode = document.querySelector<HTMLElement>(selector);
    if (existingNode) {
      existingNode.scrollIntoView({ block: "center", behavior: preferredChatScrollBehavior() });
      return;
    }
    const rowIndex = timelineRows.findIndex(
      (row) => row.kind === "message" && row.message.eventId === activeSearchMessageId
    );
    if (rowIndex >= 0) {
      virtualTimeline.scrollToRow(rowIndex, "center");
    }
  }, [activeSearchMessageId, timelineRows, virtualTimeline.scrollToRow]);

  React.useEffect(() => {
    let cancelled = false;
    setAuthSession((current) => (current.status === "anonymous" ? { status: "authenticating" } : current));
    initializeAuth(authConfig)
      .then((nextSession) => {
        if (!cancelled) {
          setAuthRefreshRetry(0);
          setAuthSession(nextSession);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setAuthSession({
            error: caught instanceof Error ? caught.message : "Přihlášení se nepodařilo ověřit.",
            status: "error"
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authConfig]);

  React.useEffect(() => {
    if (!authToken) {
      setServerUserProfile(null);
      return undefined;
    }
    let cancelled = false;
    fetchUserProfile(apiBase, authToken)
      .then((profile) => {
        if (!cancelled) {
          setServerUserProfile(profile);
        }
      })
      .catch(() => {
        // The profile is a convenience for directory search and demo seeding;
        // chat login itself must not fail when profile storage is temporarily degraded.
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, authToken]);

  React.useEffect(() => {
    if (!matrixSession) {
      return;
    }
    void matrixSession.syncUserProfile(chatIdentity.matrixProfile).catch(() => undefined);
  }, [chatIdentity.matrixProfile, matrixSession]);

  React.useEffect(() => {
    if (!authToken || !status?.chatAvailable) {
      return;
    }
    if (matrixWebPushPusherDeviceIdRef.current === matrixWebPushPusherStateKey) {
      return;
    }
    if (!matrixSessionRef.current && !matrixSession) {
      matrixWebPushPusherDeviceIdRef.current = matrixWebPushPusherStateKey;
      return;
    }
    const nextWebPushPusherStateKey = matrixWebPushPusherStateKey;
    void updateMatrixWebPushPusher()
      .then(() => {
        matrixWebPushPusherDeviceIdRef.current = nextWebPushPusherStateKey;
      })
      .catch(() => {
        matrixWebPushPusherDeviceIdRef.current = undefined;
      });
  }, [
    authToken,
    matrixSession,
    matrixSessionRef,
    matrixWebPushPusherStateKey,
    updateMatrixWebPushPusher,
    status?.chatAvailable
  ]);

  const resumeMatrixSessionIfNeeded = React.useCallback(() => {
    if (!authToken || !status?.chatAvailable || matrixLoading || matrixResumeInFlightRef.current) {
      return;
    }
    const nowMs = Date.now();
    if (matrixSessionLifecycle === "starting" && matrixLastStartedAt && nowMs - matrixLastStartedAt < 30_000) {
      return;
    }
    const syncStateNormalized = syncState.toUpperCase();
    const lastActivityAt = matrixLastSyncAt ?? matrixLastReadyAt;
    const stoppedSession = syncStateNormalized.includes("STOPPED");
    const prolongedError =
      Boolean(lastActivityAt && nowMs - lastActivityAt > 5 * 60_000) &&
      (matrixSessionLifecycle === "error" || syncStateNormalized.includes("ERROR"));
    if (matrixSessionRef.current && !stoppedSession && !prolongedError) {
      return;
    }
    matrixResumeInFlightRef.current = true;
    matrixAttemptKeyRef.current = null;
    if (matrixSessionRef.current || matrixSession) {
      resetMatrixSession();
    }
    void startMatrixSession(
      selectedRoomId ?? selectedConversationId ?? selectedGroupId ?? readRouteSelection()
    ).finally(() => {
      matrixResumeInFlightRef.current = false;
    });
  }, [
    authToken,
    matrixLastReadyAt,
    matrixLastStartedAt,
    matrixLastSyncAt,
    matrixLoading,
    matrixSession,
    matrixSessionLifecycle,
    matrixSessionRef,
    resetMatrixSession,
    selectedConversationId,
    selectedGroupId,
    selectedRoomId,
    startMatrixSession,
    status?.chatAvailable,
    syncState
  ]);

  React.useEffect(() => {
    if (!isAuthSessionActive(authSession) || !authSession.expiresAt || !authSession.refreshToken) {
      return undefined;
    }
    const delay = plannedAuthRefreshDelayMs(authSession.expiresAt, Date.now(), authRefreshRetry);
    const timer = window.setTimeout(() => {
      refreshAuthSession(authConfig, authSession)
        .then((nextSession) => {
          if (nextSession) {
            setAuthRefreshRetry(0);
            setAuthSession(nextSession);
            return;
          }
          const offlineRetainedSession = retainAuthSessionAfterRefreshFailure(authSession);
          if (offlineRetainedSession) {
            setAuthRefreshRetry((current) => current + 1);
            setAuthSession(offlineRetainedSession);
            return;
          }
          if (shouldExpireAuthSessionAfterRefreshFailure(authSession.expiresAt)) {
            setAuthSession({ status: "anonymous" });
            return;
          }
          setAuthRefreshRetry((current) => current + 1);
        })
        .catch((error: unknown) => {
          const offlineRetainedSession = retainAuthSessionAfterRefreshFailure(authSession, error);
          if (offlineRetainedSession) {
            setAuthRefreshRetry((current) => current + 1);
            setAuthSession(offlineRetainedSession);
            return;
          }
          setAuthRefreshRetry((current) => current + 1);
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [authConfig, authRefreshRetry, authSession]);

  React.useEffect(() => {
    const stopBeforeUnload = () => {
      matrixSessionRef.current?.stop();
    };
    const resetAfterPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        return;
      }
      matrixAttemptKeyRef.current = null;
      resetMatrixSession();
    };
    window.addEventListener("pagehide", resetAfterPageHide);
    window.addEventListener("beforeunload", stopBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", resetAfterPageHide);
      window.removeEventListener("beforeunload", stopBeforeUnload);
    };
  }, [matrixSessionRef, resetMatrixSession]);

  React.useEffect(() => {
    let watchdogTimer: number | null = null;
    const clearWatchdog = () => {
      if (watchdogTimer !== null) {
        window.clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };
    const scheduleWatchdog = () => {
      clearWatchdog();
      if (document.visibilityState !== "visible") {
        return;
      }
      watchdogTimer = window.setTimeout(() => {
        watchdogTimer = null;
        resumeMatrixSessionIfNeeded();
        scheduleWatchdog();
      }, 30_000);
    };
    const resume = () => {
      if (document.visibilityState !== "visible") {
        clearWatchdog();
        return;
      }
      void refreshChatWebPushState();
      void ensureFreshChatAuthSession()
        .then((session) => {
          if (session.status === "authenticated") {
            resumeMatrixSessionIfNeeded();
          }
        })
        .catch(() => undefined);
      scheduleWatchdog();
    };
    const onPageShow = () => resume();
    const onVisibilityChange = () => resume();
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", onVisibilityChange);
    scheduleWatchdog();
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearWatchdog();
    };
  }, [ensureFreshChatAuthSession, refreshChatWebPushState, resumeMatrixSessionIfNeeded]);

  React.useEffect(
    () => () => {
      if (pendingAttachment?.previewUrl) {
        window.URL.revokeObjectURL(pendingAttachment.previewUrl);
      }
    },
    [pendingAttachment?.previewUrl]
  );

  React.useEffect(() => {
    if (!messageMenuOpen) {
      return undefined;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && messageMenuRef.current?.contains(target)) {
        return;
      }
      setMessageMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMessageMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [messageMenuOpen]);

  React.useEffect(() => {
    if (!authToken) {
      resetMatrixSession();
      setRecoveryDialogOpen(false);
      setGeneratedRecoveryKey(null);
      setRecoveryKeyInput("");
      setRooms([]);
      setTimeline([]);
      timelineCacheRef.current.clear();
      timelinePersistFingerprintRef.current.clear();
      setTimelineCacheRevision((value) => value + 1);
      notifiedEventIdsRef.current.clear();
      notificationPrimedRoomIdsRef.current.clear();
      notificationRoomWatermarksRef.current.clear();
      return;
    }
    void loadMetadata();
  }, [authToken, refreshNonce, resetMatrixSession]);

  React.useEffect(() => {
    if (!authToken || !status?.chatAvailable || matrixSession || matrixLoading) {
      return;
    }
    const attemptKey = `${authSubjectId ?? "anonymous"}:${status.checkedAt}:${refreshNonce}`;
    if (matrixAttemptKeyRef.current === attemptKey) {
      return;
    }
    matrixAttemptKeyRef.current = attemptKey;
    void startMatrixSession(readRouteSelection());
  }, [authSubjectId, authToken, matrixLoading, matrixSession, refreshNonce, status?.chatAvailable, status?.checkedAt]);

  React.useEffect(() => {
    if (!matrixSession?.bootstrap.expiresAt || !authToken) {
      return undefined;
    }
    const expiresAt = Date.parse(matrixSession.bootstrap.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      return undefined;
    }
    const timer = window.setTimeout(
      () => {
        void startMatrixSession(selectedRoomId);
      },
      Math.max(30_000, expiresAt - Date.now() - 60_000)
    );
    return () => window.clearTimeout(timer);
  }, [authToken, matrixSession?.bootstrap.expiresAt, selectedRoomId]);

  React.useEffect(() => {
    if (!authToken || !selectedRoomId) {
      return undefined;
    }
    let cancelled = false;
    void readStoredRoomTimeline(timelineStorageOwner, selectedRoomId)
      .then((storedTimeline) => {
        if (cancelled || selectedRoomIdRef.current !== selectedRoomId || storedTimeline.length === 0) {
          return;
        }
        const cachedTimeline = timelineCacheRef.current.get(selectedRoomId) ?? [];
        const nextTimeline =
          cachedTimeline.length > 0 ? mergeTimelineMessages(storedTimeline, cachedTimeline) : storedTimeline;
        timelineCacheRef.current.set(selectedRoomId, nextTimeline);
        setTimeline(nextTimeline);
        setTimelineCacheRevision((value) => value + 1);
        persistRoomTimeline(selectedRoomId, nextTimeline);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authToken, persistRoomTimeline, selectedRoomId, timelineStorageOwner]);

  React.useEffect(() => {
    if (!matrixSession || !selectedRoomId) {
      return;
    }
    const liveTimeline = matrixSession.getTimeline(selectedRoomId);
    setTimeline(rememberRoomTimeline(selectedRoomId, liveTimeline));
  }, [matrixSession, selectedRoomId, timelineRevision]);

  React.useEffect(() => {
    if (!matrixSession || !selectedRoomId) {
      return;
    }
    const loadKey = `${matrixSession.bootstrap.userId}:${matrixSession.bootstrap.deviceId}:${selectedRoomId}`;
    const attempts = initialHistoryLoadAttemptsRef.current.get(loadKey) ?? 0;
    if (
      attempts >= initialHistoryLoadRetryLimit ||
      historyExhausted ||
      historyLoadingRoomsRef.current.has(selectedRoomId)
    ) {
      return;
    }
    const currentTimeline = matrixSession.getTimeline(selectedRoomId);
    const cachedTimeline = timelineCacheRef.current.get(selectedRoomId) ?? [];
    const bridgeBackfillAttempts = timelineBridgeBackfillAttemptsRef.current.get(loadKey) ?? 0;
    const needsBridgeBackfill =
      bridgeBackfillAttempts < timelineBridgeBackfillAttemptLimit &&
      timelineNeedsBridgeBackfill(cachedTimeline, currentTimeline);
    if (attempts > 0 && currentTimeline.length >= initialHistoryWarmupMessageTarget && !needsBridgeBackfill) {
      return;
    }
    initialHistoryLoadAttemptsRef.current.set(loadKey, attempts + 1);
    if (needsBridgeBackfill) {
      timelineBridgeBackfillAttemptsRef.current.set(loadKey, bridgeBackfillAttempts + 1);
    }
    const delayMs = attempts === 0 ? 0 : Math.min(2_000, attempts * 350);
    const timer = window.setTimeout(() => {
      if (selectedRoomIdRef.current !== selectedRoomId || historyLoadingRoomsRef.current.has(selectedRoomId)) {
        return;
      }
      void loadOlderMessages(selectedRoomId, needsBridgeBackfill ? 240 : 120, true);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    historyBackfillRevision,
    historyExhausted,
    historyLoading,
    matrixSession,
    selectedRoomId,
    syncState,
    timelineCacheRevision,
    timelineRevision
  ]);

  React.useEffect(() => {
    if (!matrixSession) {
      notifiedEventIdsRef.current.clear();
      notificationPrimedRoomIdsRef.current.clear();
      notificationRoomWatermarksRef.current.clear();
      return;
    }

    const roomSnapshots: ChatNotificationRoomSnapshot[] = [];
    for (const room of rooms) {
      const chat = chatItemForRoom(chatItems, room.roomId);
      roomSnapshots.push({
        activeFocused: isActiveFocusedRoom(room.roomId, selectedRoomId),
        chat,
        messages: matrixSession.getTimeline(room.roomId),
        muted: Boolean(chat?.muted),
        room
      });
    }

    const pendingNotifications = collectIncomingChatNotifications(roomSnapshots, {
      notifiedEventIds: notifiedEventIdsRef.current,
      primedRoomIds: notificationPrimedRoomIdsRef.current,
      roomWatermarks: notificationRoomWatermarksRef.current
    });

    if (!shouldShowInAppChatNotification(webPushState)) {
      return;
    }

    for (const candidate of pendingNotifications) {
      showIncomingChatNotification(candidate, () => {
        window.focus();
        if (candidate.chat) {
          void openChat(candidate.chat);
          return;
        }
        setSelectedRoomId(candidate.room.roomId);
        writeChatRoute(candidate.room.roomId);
      });
    }
  }, [
    chatItems,
    matrixSession,
    rooms,
    selectedRoomId,
    timelineRevision,
    webPushState.permission,
    webPushState.registered,
    webPushState.subscriptionActive
  ]);

  React.useEffect(() => {
    markRouteApplied(applyRouteSelection(readRouteSelection()));
    const onPopState = () => {
      markRouteApplied(applyRouteSelection(readRouteSelection()));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [conversations, groups, rooms]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const transit = decodeChatShareTransit(event.data);
      if (transit) {
        void shareTransitFromHost(transit);
        return;
      }
      const currentLocation = decodeChatCurrentLocation(event.data);
      if (currentLocation) {
        setHostCurrentLocation({
          ...(typeof currentLocation.accuracyM === "number" ? { accuracyM: currentLocation.accuracyM } : {}),
          label: currentLocation.label ?? "Moje poloha",
          lat: currentLocation.lat,
          lon: currentLocation.lon,
          source: currentLocation.source ?? "device"
        });
        return;
      }
      const voiceCallCommand = decodeChatVoiceCallCommand(event.data);
      if (voiceCallCommand) {
        queueVoiceCallCommand(voiceCallCommand);
        return;
      }
      const selection = embeddedChatSelectionFromMessage(event.data);
      if (!selection) {
        return;
      }
      resetRouteOpenAttempt();
      void applyAndOpenRouteSelection(selection);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [authenticated, chatItems, chatReady, matrixSession, preparingChatId, selectedRoomId, voiceCall]);

  React.useEffect(() => {
    if (!embedded || window.parent === window) {
      return;
    }
    window.parent.postMessage(encodeChatLiveLocations(activeLiveLocations), window.location.origin);
  }, [activeLiveLocations, embedded]);

  React.useEffect(() => {
    const nextExpiry = activeLiveLocations.reduce<number | null>((nearest, location) => {
      const expiresAt = location.expiresAt ? Date.parse(location.expiresAt) : NaN;
      if (!Number.isFinite(expiresAt)) {
        return nearest;
      }
      return nearest === null ? expiresAt : Math.min(nearest, expiresAt);
    }, null);
    if (nextExpiry === null) {
      return undefined;
    }
    const timer = window.setTimeout(
      () => {
        setLiveLocationExpiryTick((value) => value + 1);
      },
      Math.max(0, nextExpiry - Date.now() + 250)
    );
    return () => window.clearTimeout(timer);
  }, [activeLiveLocations]);

  React.useEffect(() => {
    const routeSelection = readRouteSelection();
    if (!routeSelection || !activeChat || !authenticated || preparingChatId) {
      return;
    }
    if (activeChat.roomId && selectedRoomId === activeChat.roomId) {
      return;
    }
    if (!chatReady && !activeChat.roomId) {
      return;
    }
    const attemptKey = `${routeSelection}:${activeChat.id}:${activeChat.roomId ?? "metadata"}:${chatReady ? "ready" : "offline"}`;
    if (routeOpenAttemptKey === attemptKey) {
      return;
    }
    setRouteOpenAttempt(attemptKey);
    void openChat(activeChat);
  }, [activeChat, authenticated, chatReady, preparingChatId, routeOpenAttemptKey, selectedRoomId, setRouteOpenAttempt]);

  React.useEffect(() => {
    if (!selectedRoomId && !selectedConversationId && !selectedGroupId) {
      return;
    }
    if (!showJumpToLatest) {
      timelineEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [selectedConversationId, selectedGroupId, selectedRoomId, showJumpToLatest, timeline.length]);

  React.useEffect(() => {
    if (!activeChat || !selectedRoomId || !matrixSession) {
      return;
    }
    if (activeChat.unreadCount === 0 && !activeChat.manuallyUnread) {
      return;
    }
    if (!canMarkActiveChatRead({ item: activeChat, selectedRoomId, timeline: timelineMessages })) {
      return;
    }
    markChatRead(activeChat);
    void matrixSession.markRoomRead(selectedRoomId);
  }, [
    activeChat?.latest?.eventId,
    activeChat?.manuallyUnread,
    activeChat?.preferenceKey,
    activeChat?.unreadCount,
    matrixSession,
    selectedRoomId,
    timelineMessages
  ]);

  React.useEffect(() => {
    if (
      !shouldPublishChatUnreadBridgeSnapshot({
        authTokenAvailable: Boolean(authToken),
        chatAvailable: status?.chatAvailable,
        matrixSessionActive: Boolean(matrixSession)
      })
    ) {
      return;
    }
    publishChatSummarySnapshot(
      chatSummarySnapshotFromItems(chatItems, {
        authTokenAvailable: Boolean(authToken),
        chatAvailable: status?.chatAvailable,
        matrixLoading,
        matrixSessionActive: Boolean(matrixSession),
        matrixSessionLifecycle
      })
    );
  }, [
    authToken,
    chatItems,
    matrixLoading,
    matrixSession,
    matrixSessionLifecycle,
    status?.chatAvailable,
    totalUnreadCount
  ]);

  React.useEffect(() => {
    if (!authToken || composeMode !== "direct" || directQuery.trim().length < 2) {
      setDirectSuggestions([]);
      setSearchLoading(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      searchUserDirectory(apiBase, authToken, directQuery.trim(), 10)
        .then((result) => {
          if (!cancelled) {
            setDirectSuggestions(result.items.filter((item) => item.subjectId !== authSubjectId));
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : "Vyhledání uživatele selhalo.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchLoading(false);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authSubjectId, authToken, composeMode, directQuery]);

  React.useEffect(() => {
    if (!authToken || memberQuery.trim().length < 2) {
      setMemberSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchUserDirectory(apiBase, authToken, memberQuery.trim(), 8)
        .then((result) => {
          if (!cancelled) {
            setMemberSuggestions(result.items.filter((item) => item.subjectId !== authSubjectId));
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : "Vyhledání člena selhalo.");
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authSubjectId, authToken, memberQuery]);

  React.useEffect(() => {
    if (!authToken || forwardDraftMessages.length === 0 || forwardQuery.trim().length < 2) {
      setForwardUserSuggestions([]);
      setForwardSearchLoading(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setForwardSearchLoading(true);
      searchUserDirectory(apiBase, authToken, forwardQuery.trim(), 12)
        .then((result) => {
          if (!cancelled) {
            setForwardUserSuggestions(result.items.filter((item) => item.subjectId !== authSubjectId));
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : "Vyhledání příjemce selhalo.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setForwardSearchLoading(false);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authSubjectId, authToken, forwardDraftMessages.length, forwardQuery]);

  function updateChatPreferences(updater: (current: ChatPreferences) => ChatPreferences) {
    setChatPreferences((current) => {
      const next = normalizeChatPreferences(updater(current));
      writeChatPreferences(preferencesOwner, next);
      return next;
    });
  }

  function rememberRoomTimeline(
    roomId: string,
    messages: MatrixTimelineMessage[],
    allowEmpty = false
  ): MatrixTimelineMessage[] {
    const cached = timelineCacheRef.current.get(roomId) ?? [];
    if (messages === cached) {
      return cached;
    }
    if (messages.length === 0 && cached.length > 0 && !allowEmpty) {
      return cached;
    }
    if (messages.length === 0 && cached.length === 0 && !allowEmpty) {
      return cached;
    }
    const nextMessages = messages.length > 0 && cached.length > 0 ? mergeTimelineMessages(cached, messages) : messages;
    timelineCacheRef.current.set(roomId, nextMessages);
    persistRoomTimeline(roomId, nextMessages);
    setTimelineCacheRevision((value) => value + 1);
    return nextMessages;
  }

  function markChatRead(item: ChatListItem | null) {
    if (!item) {
      return;
    }
    updateChatPreferences((current) => {
      const nextReadOverride = { ...current.readOverrideByKey };
      nextReadOverride[item.preferenceKey] = chatPreferenceSnapshot(item);
      return {
        ...current,
        manualUnreadKeys: current.manualUnreadKeys.filter((key) => key !== item.preferenceKey),
        readOverrideByKey: nextReadOverride
      };
    });
  }

  function togglePinnedChat(item: ChatListItem) {
    updateChatPreferences((current) => {
      const pinned = current.pinnedKeys.includes(item.preferenceKey);
      return {
        ...current,
        pinnedKeys: pinned
          ? current.pinnedKeys.filter((key) => key !== item.preferenceKey)
          : [item.preferenceKey, ...current.pinnedKeys]
      };
    });
  }

  function clearChatLocalState(item: ChatListItem) {
    updateChatPreferences((current) => {
      const nextHidden = { ...current.hiddenByKey };
      const nextReadOverride = { ...current.readOverrideByKey };
      delete nextHidden[item.preferenceKey];
      delete nextReadOverride[item.preferenceKey];
      return {
        ...current,
        hiddenByKey: nextHidden,
        manualUnreadKeys: current.manualUnreadKeys.filter((key) => key !== item.preferenceKey),
        readOverrideByKey: nextReadOverride
      };
    });
  }

  function toggleUnreadChat(item: ChatListItem) {
    updateChatPreferences((current) => {
      const nextReadOverride = { ...current.readOverrideByKey };
      const shouldMarkRead = item.unreadCount > 0 || Boolean(item.manuallyUnread);
      if (shouldMarkRead) {
        nextReadOverride[item.preferenceKey] = chatPreferenceSnapshot(item);
        return {
          ...current,
          manualUnreadKeys: current.manualUnreadKeys.filter((key) => key !== item.preferenceKey),
          readOverrideByKey: nextReadOverride
        };
      }
      delete nextReadOverride[item.preferenceKey];
      return {
        ...current,
        manualUnreadKeys: [
          item.preferenceKey,
          ...current.manualUnreadKeys.filter((key) => key !== item.preferenceKey)
        ].slice(0, 200),
        readOverrideByKey: nextReadOverride
      };
    });
  }

  function toggleMutedChat(item: ChatListItem) {
    updateChatPreferences((current) => {
      const nextMuted = { ...current.mutedUntilByKey };
      if (isChatMuted(nextMuted[item.preferenceKey])) {
        delete nextMuted[item.preferenceKey];
      } else {
        nextMuted[item.preferenceKey] = "forever";
      }
      return {
        ...current,
        mutedUntilByKey: nextMuted
      };
    });
  }

  function removeChatLocalCaches(item: ChatListItem) {
    if (!item.roomId) {
      return;
    }
    timelineCacheRef.current.delete(item.roomId);
    timelinePersistFingerprintRef.current.delete(`${timelineStorageOwner}:${item.roomId}`);
    void deleteStoredRoomTimeline(timelineStorageOwner, item.roomId).catch(() => undefined);
    setHistoryExhaustedByRoom((current) => {
      if (!(item.roomId && current[item.roomId])) {
        return current;
      }
      const next = { ...current };
      delete next[item.roomId];
      return next;
    });
    setTimelineCacheRevision((value) => value + 1);
  }

  function hideChatFromList(item: ChatListItem) {
    removeChatLocalCaches(item);
    updateChatPreferences((current) => {
      const nextHidden = {
        ...current.hiddenByKey,
        [item.preferenceKey]: chatPreferenceSnapshot(item)
      };
      const nextMuted = { ...current.mutedUntilByKey };
      const nextReadOverride = { ...current.readOverrideByKey };
      delete nextMuted[item.preferenceKey];
      delete nextReadOverride[item.preferenceKey];
      return {
        ...current,
        hiddenByKey: nextHidden,
        manualUnreadKeys: current.manualUnreadKeys.filter((key) => key !== item.preferenceKey),
        mutedUntilByKey: nextMuted,
        pinnedKeys: current.pinnedKeys.filter((key) => key !== item.preferenceKey),
        readOverrideByKey: nextReadOverride
      };
    });
    if (item.active) {
      clearMobileSelection();
    }
    setDeleteChatCandidate(null);
    setNotice(`Chat ${item.title} byl skryt v tomto zařízení. Nová zpráva ho znovu zobrazí.`);
  }

  async function leaveGroupChat(item: ChatListItem): Promise<void> {
    if (!item.group?.groupId) {
      setError("Tuto skupinu nelze opustit, protože není propojená se skupinou COP.");
      return;
    }
    if (!authToken) {
      setError("Pro opuštění skupiny je potřeba platné přihlášení do COP.");
      return;
    }
    setChatRemovalWorking(true);
    setError(null);
    setNotice(null);
    try {
      const updatedGroup = await leaveCommunityGroup(apiBase, authToken, item.group.groupId);
      setGroups((current) => current.filter((group) => group.groupId !== updatedGroup.groupId));
      const conversation = item.conversation ?? findConversationForGroup(item.group, conversations);
      if (conversation) {
        const sync = await syncMessagingConversationMembers(
          apiBase,
          authToken,
          conversation.conversationId,
          communityGroupMembersToMessagingMembers(updatedGroup)
        );
        if (sync.conversation) {
          setConversations((current) => upsertConversation(current, sync.conversation as MessagingConversationSummary));
        }
      }
      if (item.roomId && matrixSessionRef.current) {
        try {
          await matrixSessionRef.current.leaveRoom(item.roomId);
        } catch {
          // COP membership is authoritative. Matrix leave is best-effort cleanup
          // for this browser session because the room can already be gone.
        }
      }
      setRooms((current) => current.filter((room) => room.roomId !== item.roomId));
      hideChatFromList(item);
      setNotice(`Skupinu ${item.title} jste opustil/a.`);
    } catch (caught) {
      setError(userFacingError(caught instanceof Error ? caught.message : String(caught)));
    } finally {
      setChatRemovalWorking(false);
    }
  }

  async function deleteGroupChat(item: ChatListItem): Promise<void> {
    if (!item.group?.groupId) {
      setError("Tuto skupinu nelze smazat, protože není propojená se skupinou COP.");
      return;
    }
    if (!authToken) {
      setError("Pro smazání skupiny je potřeba platné přihlášení do COP.");
      return;
    }
    setChatRemovalWorking(true);
    setError(null);
    setNotice(null);
    try {
      await deleteCommunityGroup(apiBase, authToken, item.group.groupId);
      if (item.roomId && matrixSessionRef.current) {
        try {
          await matrixSessionRef.current.leaveRoom(item.roomId);
        } catch {
          // Deleting the COP group is the authoritative operation. Leaving the
          // Matrix room is a best-effort cleanup for the current device.
        }
      }
      if (item.roomId) {
        setRooms((current) => current.filter((room) => room.roomId !== item.roomId));
      }
      removeChatLocalCaches(item);
      updateChatPreferences((current) => {
        const nextHidden = { ...current.hiddenByKey };
        const nextMuted = { ...current.mutedUntilByKey };
        const nextReadOverride = { ...current.readOverrideByKey };
        delete nextHidden[item.preferenceKey];
        delete nextMuted[item.preferenceKey];
        delete nextReadOverride[item.preferenceKey];
        return {
          ...current,
          hiddenByKey: nextHidden,
          manualUnreadKeys: current.manualUnreadKeys.filter((key) => key !== item.preferenceKey),
          mutedUntilByKey: nextMuted,
          pinnedKeys: current.pinnedKeys.filter((key) => key !== item.preferenceKey),
          readOverrideByKey: nextReadOverride
        };
      });
      setGroups((current) => current.filter((group) => group.groupId !== item.group?.groupId));
      setConversations((current) =>
        current.filter(
          (conversation) =>
            conversationCommunityGroupId(conversation) !== item.group?.groupId &&
            (!item.roomId || conversation.matrix?.roomId !== item.roomId)
        )
      );
      if (item.active) {
        clearMobileSelection();
      }
      setDeleteChatCandidate(null);
      setNotice(`Skupina ${item.title} byla smazána.`);
    } catch (caught) {
      setError(userFacingError(caught instanceof Error ? caught.message : String(caught)));
    } finally {
      setChatRemovalWorking(false);
    }
  }

  function openChatInfo() {
    setMessageMenuOpen(false);
    setInfoPanelTab("info");
    setMediaPanelTab("media");
    setInfoPanelOpen(true);
  }

  function openActiveChatReport() {
    if (!activeChat) {
      return;
    }
    setMessageMenuOpen(false);
    try {
      openReportDraftInCop({
        ...(selectedConversation?.conversationId ? { conversationId: selectedConversation.conversationId } : {}),
        ...(selectedGroup?.groupId ? { groupId: selectedGroup.groupId } : {}),
        ...(selectedRoomId ? { roomId: selectedRoomId } : {}),
        title: activeChat.title
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hlášení se nepodařilo otevřít.");
    }
  }

  function openAddMemberDialog() {
    if (!selectedGroup) {
      setError("Nejdřív otevřete skupinu, do které chcete člena přidat.");
      return;
    }
    setMessageMenuOpen(false);
    setInfoPanelOpen(false);
    setMemberQuery("");
    setMemberSuggestions([]);
    setComposeMode("member");
  }

  function openRemoveMemberDialog(member: ChatInfoMember) {
    if (!selectedGroup || !member.subjectId) {
      setError("Nejdřív otevřete skupinu a vyberte člena, kterého chcete odebrat.");
      return;
    }
    if (member.subjectId === authSubjectId) {
      setError("Vlastní odchod proveďte přes Správa skupiny -> Opustit skupinu.");
      return;
    }
    setMemberRemovalCandidate({
      groupId: selectedGroup.groupId,
      groupName: selectedGroup.name,
      memberName: member.name,
      memberSubjectId: member.subjectId
    });
  }

  function startMessageSearch() {
    setMessageMenuOpen(false);
    setMessageSearchOpen(true);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  }

  function startSelectionMode() {
    setMessageMenuOpen(false);
    setMessageSearchOpen(false);
    setMessageSearchQuery("");
    setSelectionMode(true);
    setSelectedMessageIds(new Set());
  }

  function toggleSelectedMessage(messageId: string) {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }

  function cancelSelectionMode() {
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  }

  async function copySelectedMessages() {
    if (selectedMessages.length === 0) {
      return;
    }
    const text = selectedMessages.map(formatMessageForClipboard).join("\n\n");
    await navigator.clipboard?.writeText(text);
    setNotice(
      `${selectedMessages.length} ${selectedMessages.length === 1 ? "zpráva zkopírována" : "zprávy zkopírovány"}.`
    );
  }

  async function shareSelectedMessages() {
    if (selectedMessages.length === 0) {
      return;
    }
    const text = selectedMessages.map(formatMessageForClipboard).join("\n\n");
    if (navigator.share) {
      await navigator.share({ text, title: activeChat?.title ?? "COP Chat" });
    } else {
      await navigator.clipboard?.writeText(text);
      setNotice("Sdílení není v tomto prohlížeči dostupné, zprávy jsou zkopírované.");
    }
  }

  function openMessageActions(
    message: MatrixTimelineMessage,
    rect: DOMRect,
    stickerTrayOpen = false,
    mode: MessageActionPopoverState["mode"] = "actions"
  ) {
    if (isDemoTimelineMessage(message)) {
      return;
    }
    const width = Math.min(330, window.innerWidth - 24);
    const leftCandidate = message.own ? rect.right - width : rect.left;
    const left = Math.max(12, Math.min(leftCandidate, window.innerWidth - width - 12));
    const top = Math.max(72, Math.min(rect.top - 58, window.innerHeight - 330));
    setMessageActionPopover({
      left,
      messageId: message.eventId,
      mode,
      stickerTrayOpen,
      top
    });
  }

  async function reactToMessage(message: MatrixTimelineMessage, key: string) {
    if (!matrixSession || !selectedRoomId || isDemoTimelineMessage(message)) {
      return;
    }
    setError(null);
    try {
      await matrixSession.setReaction(selectedRoomId, message.eventId, key);
      const senderLabel = chatIdentity.displayName;
      setTimeline((current) => {
        const next = applyLocalReaction(current, message.eventId, key, senderLabel);
        timelineCacheRef.current.set(selectedRoomId, next);
        persistRoomTimeline(selectedRoomId, next);
        setTimelineCacheRevision((value) => value + 1);
        return next;
      });
      setMessageActionPopover(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reakci se nepodařilo odeslat.");
    }
  }

  function replyToMessage(message: MatrixTimelineMessage) {
    setReplyDraft(message);
    setMessageActionPopover(null);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".message-input textarea")?.focus(), 0);
  }

  async function copyMessage(message: MatrixTimelineMessage) {
    await navigator.clipboard?.writeText(formatMessageForClipboard(message));
    setMessageActionPopover(null);
    setNotice("Zpráva zkopírována.");
  }

  function startForwardMessages(messages: MatrixTimelineMessage[]) {
    if (messages.length === 0) {
      return;
    }
    setMessageActionPopover(null);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
    setForwardDraftMessages(messages);
    setForwardQuery("");
    setForwardSelectedTargetKeys(new Set());
    setForwardSelectedTargetsByKey({});
    setForwardUserSuggestions([]);
  }

  function toggleForwardTarget(target: ForwardTarget) {
    setForwardSelectedTargetKeys((current) => {
      const next = new Set(current);
      if (next.has(target.key)) {
        next.delete(target.key);
      } else {
        next.add(target.key);
      }
      return next;
    });
    setForwardSelectedTargetsByKey((current) => {
      if (current[target.key]) {
        const next = { ...current };
        delete next[target.key];
        return next;
      }
      return {
        ...current,
        [target.key]: target
      };
    });
  }

  async function ensureRoomForForwardTarget(
    target: ForwardTarget,
    session: MatrixMessagingSession
  ): Promise<{ roomId: string; title: string }> {
    if (target.chat) {
      const roomId = await ensureRoomForChatItem(target.chat, session);
      return { roomId, title: target.title };
    }
    if (!target.user) {
      throw new Error("Příjemce chatu není dostupný.");
    }
    const title = target.user.displayName?.trim() || target.user.username || target.user.subjectId;
    const existing = findExistingDirectConversation(target.user, conversations, title);
    const conversation = ensureConversationHasMember(
      existing ?? (await createDirectConversation(target.user, title)),
      target.user
    );
    setConversations((current) => upsertConversation(current, conversation));
    const roomId = conversation.matrix?.roomId ?? (await createRoomForConversation(conversation));
    return { roomId, title };
  }

  async function forwardMessagesToSelectedTargets() {
    if (forwardDraftMessages.length === 0) {
      return;
    }
    if (selectedForwardTargets.length === 0) {
      setError("Vyberte alespoň jednoho příjemce.");
      return;
    }
    setError(null);
    try {
      const session = await ensureMatrixSession(selectedForwardTargets[0]?.key);
      await ensureEncryptionRecoveryReady(session);
      const text = forwardDraftMessages.map(formatMessageForForward).join("\n\n");
      const sentTitles: string[] = [];
      for (const target of selectedForwardTargets) {
        setForwardWorkingId(target.key);
        const { roomId, title } = await ensureRoomForForwardTarget(target, session);
        await session.sendMessage(roomId, text);
        const nextTimeline = rememberRoomTimeline(roomId, session.getTimeline(roomId));
        if (selectedRoomIdRef.current === roomId) {
          setTimeline(nextTimeline);
        }
        sentTitles.push(title);
      }
      setForwardDraftMessages([]);
      setForwardQuery("");
      setForwardSelectedTargetKeys(new Set());
      setForwardSelectedTargetsByKey({});
      setForwardUserSuggestions([]);
      const recipientLabel = sentTitles.length === 1 ? sentTitles[0] : `${sentTitles.length} příjemcům`;
      setNotice(
        `${forwardDraftMessages.length === 1 ? "Zpráva přeposlána" : "Zprávy přeposlány"} do ${recipientLabel}.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Zprávu se nepodařilo přeposlat.");
    } finally {
      setForwardWorkingId(null);
    }
  }

  async function deleteOwnMessage(message: MatrixTimelineMessage) {
    if (!matrixSession || !selectedRoomId || !message.own) {
      return;
    }
    setError(null);
    try {
      await matrixSession.deleteMessage(selectedRoomId, message.eventId);
      setTimeline((current) => {
        const next = current.filter((item) => item.eventId !== message.eventId);
        timelineCacheRef.current.set(selectedRoomId, next);
        persistRoomTimeline(selectedRoomId, next, { replaceEmpty: true });
        setTimelineCacheRevision((value) => value + 1);
        return next;
      });
      setMessageActionPopover(null);
      setNotice("Zpráva odstraněna.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Zprávu se nepodařilo odstranit.");
    }
  }

  async function enableBrowserNotifications() {
    if (!authToken || webPushBusy) {
      return;
    }
    setWebPushBusy(true);
    setError(null);
    try {
      const nextState = await enableWebPushNotifications(apiBase, authToken);
      setWebPushState(nextState);
      if (nextState.registered) {
        setNotice("Webové notifikace pro toto zařízení jsou zapnuté.");
        return;
      }
      if (nextState.permission === "denied") {
        setNotice("Prohlížeč blokuje notifikace pro tento web. Povolte je v nastavení a zkuste to znovu.");
        return;
      }
      setNotice(nextState.warnings[0] ?? "Webové notifikace se nepodařilo plně zaregistrovat.");
    } catch (caught) {
      setError(userFacingError(caught instanceof Error ? caught.message : "Webové notifikace se nepodařilo zapnout."));
    } finally {
      setWebPushBusy(false);
    }
  }

  function forwardSelectedMessages() {
    if (selectedMessages.length === 0) {
      return;
    }
    startForwardMessages(selectedMessages);
  }

  function applyMuteChoice(choice: MuteChoice) {
    if (!activeChat) {
      return;
    }
    const mutedUntil = muteChoiceToStorageValue(choice);
    updateChatPreferences((current) => ({
      ...current,
      mutedUntilByKey: {
        ...current.mutedUntilByKey,
        [activeChat.preferenceKey]: mutedUntil
      }
    }));
    setMuteDialogOpen(false);
    setMessageMenuOpen(false);
  }

  function clearActiveMute() {
    if (!activeChat) {
      return;
    }
    updateChatPreferences((current) => {
      const nextMuted = { ...current.mutedUntilByKey };
      delete nextMuted[activeChat.preferenceKey];
      return {
        ...current,
        mutedUntilByKey: nextMuted
      };
    });
    setMessageMenuOpen(false);
    setMuteDialogOpen(false);
  }

  async function applyMessageRetention(seconds: MessageRetentionSeconds) {
    if (!activeChat || !selectedRoomId || !matrixSession) {
      setError("Automatické mazání lze nastavit až po otevření chatové místnosti.");
      return;
    }
    setRetentionSaving(true);
    setError(null);
    try {
      await matrixSession.setMessageRetentionPolicy(selectedRoomId, seconds);
      setRetentionOverrideByRoom((current) => ({
        ...current,
        [selectedRoomId]: seconds
      }));
      setRooms(matrixSession.getRooms());
      setTimeline(rememberRoomTimeline(selectedRoomId, matrixSession.getTimeline(selectedRoomId)));
      if (selectedGroup && authToken && canUpdateCommunityGroupMetadata(selectedGroup, authSubjectId)) {
        const updatedGroup = await updateCommunityGroupMetadata(apiBase, authToken, selectedGroup.groupId, {
          chat: {
            ...communityGroupChatMetadata(selectedGroup),
            disappearingMessages: {
              enabled: seconds !== null,
              seconds,
              updatedAt: new Date().toISOString()
            }
          }
        });
        setGroups((current) => current.map((group) => (group.groupId === updatedGroup.groupId ? updatedGroup : group)));
      }
      setNotice(
        seconds === null
          ? "Automatické mazání zpráv je vypnuté."
          : `Nové zprávy se budou automaticky odstraňovat po ${messageRetentionLabel(seconds)}.`
      );
      setRetentionDialogOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Automatické mazání zpráv se nepodařilo nastavit.");
    } finally {
      setRetentionSaving(false);
    }
  }

  function moveSearch(delta: number) {
    if (searchMatches.length === 0) {
      return;
    }
    setActiveSearchIndex((current) => (current + delta + searchMatches.length) % searchMatches.length);
  }

  async function loadMetadata() {
    if (!authToken) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextConversations, nextGroups] = await Promise.all([
        fetchMessagingStatus(apiBase, authToken),
        fetchMessagingConversations(apiBase, authToken),
        fetchCommunityGroups(apiBase, authToken)
      ]);
      setStatus(nextStatus);
      setConversations(nextConversations.conversations);
      setGroups(nextGroups.items);
      if (nextStatus.warnings[0]) {
        setNotice(nextStatus.warnings[0]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Konverzace se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }

  async function ensureEncryptionRecoveryReady(session = matrixSessionRef.current): Promise<void> {
    if (!session) {
      return;
    }
    const nextStatus = await refreshEncryptionRecoveryStatus(session);
    if (nextStatus && !nextStatus.ready) {
      setRecoveryManualRestore(false);
      setRecoveryDialogOpen(true);
      throw new Error(
        nextStatus.needsSetup
          ? "Nejdřív nastavte obnovovací klíč E2EE. Potom půjde chat bezpečně používat na více zařízeních."
          : "Nejdřív obnovte toto zařízení pomocí obnovovacího klíče E2EE."
      );
    }
  }

  async function refreshAuthTokenForSensitiveMatrixAction(): Promise<string | null | undefined> {
    if (!isOidcEnabled(authConfig) || authSession.status !== "authenticated" || !authSession.refreshToken) {
      return authToken;
    }
    try {
      const nextSession = await refreshAuthSession(authConfig, authSession);
      if (!nextSession) {
        return authToken;
      }
      setAuthRefreshRetry(0);
      setAuthSession(nextSession);
      return getAuthorizationToken(nextSession, labToken);
    } catch {
      // The current access token can remain valid even when a rotating refresh
      // token request fails transiently. The Matrix callback asks this function
      // just in time, so this is the latest rendered COP token rather than the
      // stale token formerly captured when the Matrix session was created.
      return authToken;
    }
  }

  async function startFreshMatrixSessionForRecovery(): Promise<MatrixMessagingSession> {
    const preferredSelection = selectedConversationId ?? selectedGroupId ?? selectedRoomId;
    const latestAuthToken = await refreshAuthTokenForSensitiveMatrixAction();
    if (!latestAuthToken) {
      throw new Error("Pro tuto akci je potřeba platné přihlášení do COP.");
    }
    const freshMatrixDeviceId = rotateMatrixDeviceId(authSubjectId ?? "anonymous");
    return restartMatrixSession(preferredSelection, true, latestAuthToken, freshMatrixDeviceId);
  }

  async function createEncryptionRecovery(reset = false): Promise<void> {
    if (
      reset &&
      !window.confirm(
        "Nouzově začít znovu s E2EE? Tuto volbu použijte jen při ztraceném nebo kompromitovaném klíči. Starší šifrovaná historie nemusí být dostupná."
      )
    ) {
      return;
    }
    setRecoveryWorking(true);
    setError(null);
    try {
      const preferredSelection = selectedConversationId ?? selectedGroupId ?? selectedRoomId;
      const session = reset
        ? await startFreshMatrixSessionForRecovery()
        : await ensureMatrixSession(preferredSelection);
      const recoveryKey = await session.createEncryptionRecovery(reset);
      setGeneratedRecoveryKey(recoveryKey);
      setRecoveryKeyInput("");
      setRecoveryManualRestore(false);
      await refreshEncryptionRecoveryStatus(session);
      setNotice(
        reset
          ? "Nový nouzový E2EE obnovovací klíč je aktivní. Použijte ho i na iOS; starší šifrovaná historie nemusí být dostupná."
          : "E2EE obnova je nastavena pro web i iPhone/iPad. Tento prohlížeč si klíč lokálně uloží i pro další start; kopii uložte mimo aplikaci."
      );
    } catch (caught) {
      setError(userFacingError(caught instanceof Error ? caught.message : "Obnovovací klíč se nepodařilo vytvořit."));
    } finally {
      setRecoveryWorking(false);
    }
  }

  async function prepareEncryptionRecoveryForMobile(): Promise<void> {
    if (
      !window.confirm(
        "Připravit iPhone/iPad čistým E2EE resetem? Starší šifrovaná historie nemusí být dostupná, ale web a iOS dostanou nový kompatibilní obnovovací klíč."
      )
    ) {
      return;
    }
    setRecoveryWorking(true);
    setError(null);
    try {
      const preferredSelection = selectedConversationId ?? selectedGroupId ?? selectedRoomId;
      const session = await ensureMatrixSession(preferredSelection);
      const recoveryKey = await session.prepareEncryptionRecoveryForMobile();
      setGeneratedRecoveryKey(recoveryKey);
      setRecoveryKeyInput("");
      await refreshEncryptionRecoveryStatus(session);
      setNotice(
        "Nový E2EE recovery cyklus pro web+iOS je připravený. Uložte nový klíč a použijte ho v mobilní aplikaci."
      );
    } catch (caught) {
      setError(
        userFacingError(caught instanceof Error ? caught.message : "Recovery pro iPhone/iPad se nepodařilo připravit.")
      );
    } finally {
      setRecoveryWorking(false);
    }
  }

  async function repairCurrentMatrixDevice(): Promise<void> {
    if (
      !window.confirm(
        "Opravit šifrování pouze v tomto webovém zařízení? Nejdříve zavřete ostatní karty COP chatu v tomto prohlížeči. Účet, telefon ani E2EE záloha se neresetují."
      )
    ) {
      return;
    }
    setRecoveryWorking(true);
    setError(null);
    try {
      const session = await startFreshMatrixSessionForRecovery();
      const nextStatus = await refreshEncryptionRecoveryStatus(session);
      setGeneratedRecoveryKey(null);
      if (nextStatus?.ready) {
        setRecoveryKeyInput("");
        setRecoveryManualRestore(false);
        setRecoveryDialogOpen(false);
        setNotice(
          "Toto webové zařízení má novou šifrovací identitu. E2EE záloha je odemčená a klíče se obnovují; ostatní zařízení zůstala beze změny."
        );
      } else if (nextStatus?.needsRecovery || nextStatus?.keyBackupExists) {
        setRecoveryManualRestore(true);
        setNotice("Nová šifrovací identita je připravená. Dokončete opravu zadáním uloženého obnovovacího klíče.");
      } else {
        setRecoveryKeyInput("");
        setRecoveryManualRestore(false);
        setNotice("Nová šifrovací identita je připravená. Dokončete nastavení vytvořením obnovovacího klíče.");
      }
    } catch (caught) {
      setError(
        userFacingError(caught instanceof Error ? caught.message : "Toto webové zařízení se nepodařilo opravit.")
      );
    } finally {
      setRecoveryWorking(false);
    }
  }

  async function restoreEncryptionRecovery(): Promise<void> {
    const session =
      matrixSessionRef.current ??
      (await startMatrixSession(selectedConversationId ?? selectedGroupId ?? selectedRoomId));
    if (!session) {
      return;
    }
    setRecoveryWorking(true);
    setError(null);
    try {
      await session.restoreEncryptionRecovery(recoveryKeyInput);
      setGeneratedRecoveryKey(null);
      setRecoveryKeyInput("");
      setRecoveryManualRestore(false);
      await refreshEncryptionRecoveryStatus(session);
      if (selectedRoomId) {
        setTimeline(rememberRoomTimeline(selectedRoomId, session.getTimeline(selectedRoomId)));
      }
      setRecoveryDialogOpen(false);
      setNotice(
        "Zařízení bylo obnoveno a E2EE key backup je aktivní. Při dalším spuštění se klíč použije automaticky."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Zařízení se nepodařilo obnovit.");
    } finally {
      setRecoveryWorking(false);
    }
  }

  function applyRouteSelection(selection: string | null): boolean {
    if (!selection) {
      clearChatSelection();
      return true;
    }
    const conversation = conversations.find(
      (item) => item.conversationId === selection || item.matrix?.roomId === selection
    );
    if (conversation) {
      selectConversation(conversation, false);
      return true;
    }
    const group = groups.find((item) => item.groupId === selection);
    if (group) {
      selectGroup(group, false);
      return true;
    }
    const room = rooms.find((item) => item.roomId === selection);
    if (room) {
      selectRoom(room, false);
      return true;
    }
    return false;
  }

  async function applyAndOpenRouteSelection(selection: string): Promise<boolean> {
    const applied = applyRouteSelection(selection);
    const item = findChatItemForSelection(selection, chatItems);
    if (!item || !authenticated || preparingChatId) {
      return applied;
    }
    if (item.roomId && selectedRoomId === item.roomId) {
      return true;
    }
    await openChat(item);
    return true;
  }

  function selectConversation(conversation: MessagingConversationSummary, updateRoute = true) {
    setSelectedConversationId(conversation.conversationId);
    setSelectedGroupId(conversationCommunityGroupId(conversation) ?? null);
    setSelectedRoomId(conversation.matrix?.roomId ?? null);
    if (updateRoute) {
      writeChatRoute(conversation.conversationId);
    }
  }

  function selectGroup(group: CommunityGroup, updateRoute = true) {
    const conversation =
      findConversationForGroup(group, conversations) ?? findConversationByTitle(group.name, conversations, "group");
    setSelectedGroupId(group.groupId);
    setSelectedConversationId(conversation?.conversationId ?? null);
    setSelectedRoomId(conversation?.matrix?.roomId ?? communityGroupMatrixRoomId(group) ?? null);
    if (updateRoute) {
      writeChatRoute(conversation?.conversationId ?? group.groupId);
    }
  }

  function selectRoom(room: MatrixRoomSummary, updateRoute = true) {
    const conversation = conversations.find((item) => item.matrix?.roomId === room.roomId) ?? null;
    const group = conversation
      ? groupForConversation(conversation, groups)
      : (findGroupByMatrixRoomId(room.roomId, groups) ?? findGroupByTitle(room.name, groups));
    setSelectedRoomId(room.roomId);
    setSelectedConversationId(conversation?.conversationId ?? null);
    setSelectedGroupId(group?.groupId ?? null);
    if (updateRoute) {
      writeChatRoute(conversation?.conversationId ?? group?.groupId ?? room.roomId);
    }
  }

  function clearMobileSelection() {
    clearChatSelection();
    writeChatRoute(null);
  }

  async function openChat(item: ChatListItem) {
    setError(null);
    setNotice(null);
    clearChatLocalState(item);
    setPreparingChatId(item.id);
    try {
      if (item.conversation) {
        selectConversation(item.conversation);
        if (!item.conversation.matrix?.roomId) {
          await createRoomForConversation(item.conversation);
        }
        return;
      }
      if (item.group) {
        selectGroup(item.group);
        if (chatReady) {
          const conversation = await createConversationForGroup(item.group);
          await createRoomForConversation(conversation);
          selectConversation(conversation);
        }
        return;
      }
      if (item.room) {
        selectRoom(item.room);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chat se nepodařilo otevřít.");
    } finally {
      setPreparingChatId(null);
    }
  }

  async function ensureRoomForChatItem(item: ChatListItem, session: MatrixMessagingSession): Promise<string> {
    if (item.conversation) {
      selectConversation(item.conversation);
      if (item.conversation.matrix?.roomId) {
        return item.conversation.matrix.roomId;
      }
      return createRoomForConversation(item.conversation);
    }
    if (item.group) {
      selectGroup(item.group);
      const conversation = await createConversationForGroup(item.group);
      return createRoomForConversation(conversation);
    }
    if (item.room) {
      selectRoom(item.room);
      return item.room.roomId;
    }
    throw new Error("Cílový chat zatím nemá připravenou místnost.");
  }

  async function createDirectChat(user: UserDirectoryEntry) {
    if (!authToken) {
      return;
    }
    setError(null);
    setPreparingChatId(`direct:${user.subjectId}`);
    try {
      const title = user.displayName?.trim() || user.username || user.subjectId;
      const existing = findExistingDirectConversation(user, conversations, title);
      const conversation = existing ?? (await createDirectConversation(user, title));
      const conversationWithMember = ensureConversationHasMember(conversation, user);
      setConversations((current) => upsertConversation(current, conversationWithMember));
      setComposeMode(null);
      setDirectQuery("");
      setDirectSuggestions([]);
      selectConversation(conversationWithMember);
      if (chatReady) {
        await createRoomForConversation(conversationWithMember);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Přímý chat se nepodařilo založit.");
    } finally {
      setPreparingChatId(null);
    }
  }

  async function createAiAgentChat() {
    if (!authToken) {
      return;
    }
    setMessageMenuOpen(false);
    setError(null);
    setPreparingChatId(`direct:${copAiAgentUser.subjectId}`);
    try {
      const title = copAiAgentUser.displayName || copAiAgentUser.username;
      const existing =
        findExistingAiAgentDirectConversation(conversations) ??
        findExistingDirectConversation(copAiAgentUser, conversations, title);
      const conversation = existing ?? (await createAiAgentDirectConversation());
      const conversationWithMember = ensureConversationHasMember(conversation, copAiAgentUser, "bot");
      setConversations((current) => upsertConversation(current, conversationWithMember));
      setComposeMode(null);
      setDirectQuery("");
      setDirectSuggestions([]);
      selectConversation(conversationWithMember);
      if (chatReady) {
        await createRoomForConversation(conversationWithMember);
      }
      setNotice("Chat s COP AI agentem je připravený.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chat s AI agentem se nepodařilo založit.");
    } finally {
      setPreparingChatId(null);
    }
  }

  async function createDirectConversation(
    user: UserDirectoryEntry,
    title: string
  ): Promise<MessagingConversationSummary> {
    if (!authToken) {
      throw new Error("Pro založení chatu je potřeba přihlášení.");
    }
    const response = await createMessagingConversation(apiBase, authToken, {
      conversationKind: "direct",
      members: [{ displayName: title, role: "member", userId: user.subjectId }],
      metadata: {
        externalId: user.subjectId,
        source: "cop.direct"
      },
      title,
      type: "direct"
    });
    if (!response.conversation) {
      throw new Error(response.warnings[0] ?? "Přímý chat se nepodařilo založit.");
    }
    return response.conversation;
  }

  async function createAiAgentDirectConversation(): Promise<MessagingConversationSummary> {
    if (!authToken) {
      throw new Error("Pro založení chatu je potřeba přihlášení.");
    }
    const response = await createMessagingConversation(apiBase, authToken, {
      conversationKind: "personal_ai",
      members: [{ displayName: copAiAgentUser.displayName, role: "bot", userId: copAiAgentUser.subjectId }],
      metadata: {
        externalId: copAiAgentUser.subjectId,
        source: "cop.ai.direct"
      },
      title: copAiAgentUser.displayName || copAiAgentUser.username,
      type: "direct"
    });
    if (!response.conversation) {
      throw new Error(response.warnings[0] ?? "Chat s AI agentem se nepodařilo založit.");
    }
    return response.conversation;
  }

  async function createConversationForGroup(group: CommunityGroup): Promise<MessagingConversationSummary> {
    if (!authToken) {
      throw new Error("Pro založení skupinového chatu je potřeba přihlášení.");
    }
    const existing =
      findConversationForGroup(group, conversations) ?? findConversationByTitle(group.name, conversations, "group");
    if (existing) {
      await persistGroupChatBindingIfAllowed(group, existing);
      return existing;
    }
    const conversationResponse = await createMessagingConversation(apiBase, authToken, {
      conversationKind: "group",
      members: communityGroupMembersToMessagingMembers(group),
      metadata: {
        externalId: group.groupId,
        source: "cop.community"
      },
      title: group.name,
      type: "group"
    });
    if (!conversationResponse.conversation) {
      throw new Error(conversationResponse.warnings[0] ?? "Skupinový chat se nepodařilo založit.");
    }
    const conversation = {
      ...conversationResponse.conversation,
      metadata: {
        ...(conversationResponse.conversation.metadata ?? {}),
        externalId: group.groupId,
        source: "cop.community"
      }
    };
    setConversations((current) => upsertConversation(current, conversation));
    await persistGroupChatBindingIfAllowed(group, conversation);
    return conversation;
  }

  async function createGroupChat() {
    if (!authToken || !newGroupName.trim()) {
      return;
    }
    const name = newGroupName.trim();
    setPreparingChatId(`group:new:${name}`);
    setError(null);
    try {
      const group = await createCommunityGroup(apiBase, authToken, {
        metadata: {
          createdFrom: "standalone-chat"
        },
        name,
        visibility: "public"
      });
      setGroups((current) => [group, ...current.filter((item) => item.groupId !== group.groupId)]);
      const conversation = await createConversationForGroup(group);
      setNewGroupName("");
      setComposeMode(null);
      selectConversation(conversation);
      if (chatReady) {
        await createRoomForConversation(conversation);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Skupinu se nepodařilo založit.");
    } finally {
      setPreparingChatId(null);
    }
  }

  async function addMemberToSelectedGroup(user: UserDirectoryEntry) {
    if (!authToken || !selectedGroup) {
      return;
    }
    if (memberAddPendingIdsRef.current.has(user.subjectId)) {
      return;
    }
    if (groupHasActiveMember(selectedGroup, user.subjectId)) {
      setNotice(`${user.displayName || user.username} už je členem skupiny.`);
      setMemberQuery("");
      setMemberSuggestions([]);
      return;
    }
    memberAddPendingIdsRef.current.add(user.subjectId);
    setMemberAddPendingIds((current) => new Set(current).add(user.subjectId));
    setError(null);
    setNotice(null);
    try {
      const group = await upsertCommunityGroupMember(apiBase, authToken, selectedGroup.groupId, {
        displayName: user.displayName,
        role: "member",
        status: "active",
        subjectId: user.subjectId,
        username: user.username
      });
      setGroups((current) => current.map((item) => (item.groupId === group.groupId ? group : item)));
      const conversation = findConversationForGroup(group, conversations);
      const warnings: string[] = [];
      if (conversation) {
        try {
          const sync = await syncMessagingConversationMembers(
            apiBase,
            authToken,
            conversation.conversationId,
            communityGroupMembersToMessagingMembers(group)
          );
          if (sync.conversation) {
            setConversations((current) =>
              upsertConversation(current, sync.conversation as MessagingConversationSummary)
            );
          } else {
            warnings.push(sync.warnings[0] ?? "Messaging synchronizace zatím nevrátila konverzaci.");
          }
        } catch (caught) {
          warnings.push(caught instanceof Error ? caught.message : "Messaging synchronizace selhala.");
        }
      }
      setMemberQuery("");
      setMemberSuggestions([]);
      setNotice(
        warnings.length > 0
          ? `${user.displayName || user.username} byl/a přidán/a do COP skupiny. Chat synchronizace doběhne později: ${userFacingError(warnings[0] ?? "")}`
          : `${user.displayName || user.username} byl/a přidán/a do skupiny.`
      );
    } catch (caught) {
      setError(userFacingError(caught instanceof Error ? caught.message : "Člena se nepodařilo přidat."));
    } finally {
      memberAddPendingIdsRef.current.delete(user.subjectId);
      setMemberAddPendingIds((current) => {
        const next = new Set(current);
        next.delete(user.subjectId);
        return next;
      });
    }
  }

  async function removeMemberFromGroup(candidate: MemberRemovalCandidate): Promise<void> {
    if (!authToken) {
      setError("Pro odebrání člena je potřeba platné přihlášení do COP.");
      return;
    }
    setMemberRemovalWorking(true);
    setError(null);
    setNotice(null);
    try {
      const updatedGroup = await removeCommunityGroupMember(
        apiBase,
        authToken,
        candidate.groupId,
        candidate.memberSubjectId
      );
      setGroups((current) => current.map((group) => (group.groupId === updatedGroup.groupId ? updatedGroup : group)));
      const conversation = findConversationForGroup(updatedGroup, conversations);
      if (conversation) {
        const sync = await syncMessagingConversationMembers(
          apiBase,
          authToken,
          conversation.conversationId,
          communityGroupMembersToMessagingMembers(updatedGroup)
        );
        if (sync.conversation) {
          setConversations((current) => upsertConversation(current, sync.conversation as MessagingConversationSummary));
        }
      }
      setMemberRemovalCandidate(null);
      setNotice(`${candidate.memberName} byl/a odebrán/a ze skupiny ${candidate.groupName}.`);
    } catch (caught) {
      setError(userFacingError(caught instanceof Error ? caught.message : String(caught)));
    } finally {
      setMemberRemovalWorking(false);
    }
  }

  function openAiSituationSummary() {
    setMessageMenuOpen(false);
    setAiSituationDialogOpen(true);
    if (!aiSituationResponse && !aiSituationWorking) {
      void refreshAiSituationSummary();
    }
  }

  async function refreshAiSituationSummary(): Promise<void> {
    if (!authToken) {
      setError("Pro AI situační souhrn je potřeba platné přihlášení do COP.");
      return;
    }
    setAiSituationWorking(true);
    setAiSituationError(null);
    setError(null);
    try {
      const response = await createAiSituationSummary(apiBase, authToken, {
        ...buildAiRequestContextOptions(timelineMessages, aiContextLocation ?? undefined),
        includeAlerts: true,
        language: "cs",
        maxObjects: 40
      });
      setAiSituationResponse(response);
      if (response.status === "NEEDS_HUMAN_REVIEW") {
        setNotice("AI souhrn vyžaduje lidskou kontrolu před dalším sdílením.");
      }
    } catch (caught) {
      const message = userFacingError(
        caught instanceof Error ? caught.message : "AI situační souhrn se nepodařilo vytvořit."
      );
      setAiSituationError(message);
      setError(message);
    } finally {
      setAiSituationWorking(false);
    }
  }

  async function sendAiSituationSummaryToChat(text: string): Promise<void> {
    if (!composerEnabled || !matrixSession || !selectedRoomId) {
      setError("Nejdřív otevřete chatovou místnost, do které chcete AI souhrn poslat.");
      return;
    }
    const sent = await sendMessage(formatAiSituationShareBody(text), {
      cop: buildAiSituationMessageMetadata(aiSituationResponse),
      skipAiMention: true
    });
    if (sent) {
      setAiSituationDialogOpen(false);
      setNotice("AI souhrn byl odeslán do chatu.");
    }
  }

  function openAiAgentDialog(modelPreference: AiModelPreference = "auto") {
    if (selectedGroup && !selectedGroupAiAssistantEnabled) {
      setNotice("AI agent zatím není pro tuto skupinu zapnutý.");
      return;
    }
    setMessageMenuOpen(false);
    setAiAgentModelPreference(modelPreference);
    setAiAgentDialogOpen(true);
  }

  function buildAiChatAgentQueryOptions(
    question: string,
    modelPreference: AiModelPreference,
    currentUserMessage?: string,
    geoLocation?: MatrixLocationShare
  ): AiChatAgentQueryOptions {
    return {
      ...buildAiRequestContextOptions(timelineMessages, geoLocation ?? aiContextLocation ?? undefined),
      chatContext: buildAiChatContextSnapshot(timelineMessages, {
        ...(currentUserMessage ? { currentUserMessage } : {}),
        encrypted: selectedRoom?.encrypted,
        roomId: selectedRoomId
      }),
      conversationId: selectedConversation?.conversationId,
      groupId: selectedGroup?.groupId,
      language: "cs",
      maxObjects: 40,
      modelPreference,
      question
    };
  }

  async function queryAiChatAgentWithJob(
    options: AiChatAgentQueryOptions,
    onJobUpdate?: (job: AiChatAgentJobResponse) => void
  ): Promise<AiCopResponse> {
    if (!authToken) {
      throw new Error("Pro dotaz na AI agenta je potřeba platné přihlášení do COP.");
    }
    const started = await startAiChatAgentJob(apiBase, authToken, options);
    onJobUpdate?.(started);
    for (let attempt = 0; attempt < aiChatAgentJobPollLimit; attempt += 1) {
      if (attempt > 0) {
        await sleep(aiChatAgentJobPollIntervalMs);
      }
      const job = await fetchAiChatAgentJob(apiBase, authToken, started.jobId);
      onJobUpdate?.(job);
      if (job.status === "completed" && job.response) {
        return job.response;
      }
      if (job.status === "failed") {
        throw new Error(job.error?.message ?? "AI agent dotaz selhal.");
      }
    }
    throw new Error("AI agent stále zpracovává dotaz. Zkuste výsledek znovu za chvíli nebo dotaz zkraťte.");
  }

  async function askAiAgent(): Promise<void> {
    const question = aiAgentQuestion.trim();
    if (!authToken || !question) {
      return;
    }
    setAiAgentWorking(true);
    setAiAgentJobStatus("AI job se zakládá...");
    setAiAgentError(null);
    setError(null);
    try {
      const response = await queryAiChatAgentWithJob(
        buildAiChatAgentQueryOptions(question, aiAgentModelPreference),
        (job) => setAiAgentJobStatus(aiChatAgentJobStatusLabel(job))
      );
      setAiAgentResponse(response);
      if (response.status === "NEEDS_HUMAN_REVIEW") {
        setNotice("Odpověď AI agenta vyžaduje lidskou kontrolu před dalším sdílením.");
      }
    } catch (caught) {
      const message = userFacingError(caught instanceof Error ? caught.message : "AI agent teď nedokáže odpovědět.");
      setAiAgentError(message);
      setError(message);
    } finally {
      setAiAgentWorking(false);
      setAiAgentJobStatus(null);
    }
  }

  async function sendAiAgentResponseToChat(text: string): Promise<void> {
    if (!composerEnabled || !matrixSession || !selectedRoomId) {
      setError("Nejdřív otevřete chatovou místnost, do které chcete odpověď AI agenta poslat.");
      return;
    }
    const question = aiAgentQuestion.trim();
    const sent = await sendMessage(formatAiAgentShareBody(text, question), {
      cop: buildAiAgentMessageMetadata(aiAgentResponse, question),
      skipAiMention: true
    });
    if (sent) {
      setAiAgentDialogOpen(false);
      setNotice("Odpověď AI agenta byla odeslána do chatu.");
    }
  }

  async function toggleAiAgentForSelectedGroup(enabled: boolean): Promise<void> {
    if (!authToken || !selectedGroup) {
      return;
    }
    if (!canManageCommunityGroupMembers(selectedGroup, authSubjectId)) {
      setError("AI agenta může spravovat jen správce skupiny.");
      return;
    }
    const updateTime = new Date().toISOString();
    if (
      enabled &&
      !window.confirm(
        "Zapnout COP AI agenta jako viditelného Matrix člena této E2EE místnosti? Agent bude mít vlastní Matrix účet a device, uvidí nové zprávy sdílené po připojení a jeho odpovědi budou auditované."
      )
    ) {
      return;
    }
    setAiAgentGroupUpdating(true);
    setError(null);
    try {
      const currentChat = communityGroupChatMetadata(selectedGroup);
      const updatedGroup = await updateCommunityGroupMetadata(apiBase, authToken, selectedGroup.groupId, {
        chat: {
          ...currentChat,
          aiAssistant: {
            ...(currentChat.aiAssistant ?? {}),
            enabled,
            label: currentChat.aiAssistant?.label ?? "COP AI Assistant",
            mode: "cop-context",
            consent: enabled
              ? {
                  granted: true,
                  grantedAt: updateTime,
                  grantedBy: authSubjectId ?? authSession.profile?.username ?? "unknown",
                  scope: "matrix-room-member",
                  termsVersion: "cop-ai-room-agent-consent-v1"
                }
              : {
                  granted: false,
                  revokedAt: updateTime,
                  revokedBy: authSubjectId ?? authSession.profile?.username ?? "unknown",
                  scope: "matrix-room-member",
                  termsVersion: "cop-ai-room-agent-consent-v1"
                },
            updatedAt: updateTime,
            updatedBy: authSubjectId ?? authSession.profile?.username ?? "unknown"
          }
        }
      });
      let finalGroup = updatedGroup;
      let nextAi = communityGroupAiAssistantMetadata(finalGroup);
      let matrixInviteWarning: string | null = null;
      if (enabled) {
        const inviteResult = await inviteAiMatrixBotIfNeeded(finalGroup, nextAi);
        finalGroup = inviteResult.group;
        nextAi = communityGroupAiAssistantMetadata(finalGroup);
        matrixInviteWarning = inviteResult.warning ?? null;
      }
      setGroups((current) => current.map((group) => (group.groupId === finalGroup.groupId ? finalGroup : group)));
      setNotice(
        enabled
          ? `AI agent je zapnutý. ${aiAssistantStatusLabel(nextAi)}.${matrixInviteWarning ? ` ${matrixInviteWarning}` : ""}`
          : "AI agent je pro skupinu vypnutý."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nastavení AI agenta se nepodařilo uložit.");
    } finally {
      setAiAgentGroupUpdating(false);
    }
  }

  async function inviteAiMatrixBotIfNeeded(
    group: CommunityGroup,
    aiAssistant: CommunityGroupAiAssistantMetadata
  ): Promise<{ group: CommunityGroup; warning?: string }> {
    if (!authToken) {
      return { group };
    }
    const chat = communityGroupChatMetadata(group);
    const plan = aiMatrixBotInvitePlan(aiAssistant, selectedRoomId ?? chat.matrixRoomId);
    if (!plan) {
      return { group };
    }
    const session = matrixSessionRef.current;
    if (!session) {
      return {
        group,
        warning: "Matrix pozvánka pro AI bota se odešle po obnovení chatové session."
      };
    }
    try {
      await session.inviteUsersToRoom(plan.roomId, [plan.matrixUserId]);
    } catch (caught) {
      return {
        group,
        warning: `Matrix pozvánka pro AI bota zatím neprošla: ${userFacingError(caught instanceof Error ? caught.message : String(caught))}`
      };
    }

    try {
      const refreshed = await updateCommunityGroupMetadata(apiBase, authToken, group.groupId, {
        chat: {
          ...chat,
          matrixRoomId: chat.matrixRoomId ?? plan.roomId,
          aiAssistant
        }
      });
      return { group: refreshed };
    } catch (caught) {
      return {
        group,
        warning: `Matrix pozvánka pro AI bota byla odeslána, ale potvrzení členství se nepodařilo obnovit: ${userFacingError(caught instanceof Error ? caught.message : String(caught))}`
      };
    }
  }

  async function createRoomForConversation(conversation: MessagingConversationSummary): Promise<string> {
    if (conversation.matrix?.roomId) {
      setSelectedRoomId(conversation.matrix.roomId);
      return conversation.matrix.roomId;
    }
    if (!authToken) {
      throw new Error("Pro založení místnosti je potřeba přihlášení.");
    }
    const binding = await ensureMessagingConversationMatrixRoom(apiBase, authToken, conversation.conversationId);
    const roomId = assertMatrixRoomReady(binding);
    const nextConversation = binding.conversation!;
    setConversations((current) => upsertConversation(current, nextConversation));
    const linkedGroup = selectedGroupId
      ? (groups.find((group) => group.groupId === selectedGroupId) ?? groupForConversation(nextConversation, groups))
      : groupForConversation(nextConversation, groups);
    if (linkedGroup) {
      await persistGroupChatBindingIfAllowed(linkedGroup, nextConversation, roomId);
    }
    setRooms((current) =>
      ensureRoomSummary(current, {
        encrypted: true,
        name: conversation.title,
        roomId,
        unreadCount: 0
      })
    );
    setSelectedConversationId(nextConversation.conversationId);
    setSelectedGroupId(conversationCommunityGroupId(nextConversation) ?? selectedGroupId);
    setSelectedRoomId(roomId);
    writeChatRoute(nextConversation.conversationId);
    return roomId;
  }

  async function persistGroupChatBindingIfAllowed(
    group: CommunityGroup,
    conversation: MessagingConversationSummary,
    roomId = conversation.matrix?.roomId
  ): Promise<CommunityGroup | null> {
    if (!canUpdateCommunityGroupMetadata(group, authSubjectId)) {
      return null;
    }
    return persistGroupChatBinding(group, conversation, roomId);
  }

  async function persistGroupChatBinding(
    group: CommunityGroup,
    conversation: MessagingConversationSummary,
    roomId = conversation.matrix?.roomId
  ): Promise<CommunityGroup> {
    if (!authToken) {
      throw new Error("Pro uložení vazby skupiny na chat je potřeba přihlášení.");
    }
    const currentChat = communityGroupChatMetadata(group);
    const updated = await updateCommunityGroupMetadata(apiBase, authToken, group.groupId, {
      chat: {
        ...currentChat,
        conversationId: conversation.conversationId,
        encrypted: roomId ? true : (currentChat.encrypted ?? true),
        linkedAt: new Date().toISOString(),
        ...(roomId ? { matrixRoomId: roomId } : {}),
        source: "cop-chat"
      }
    });
    setGroups((current) => current.map((item) => (item.groupId === updated.groupId ? updated : item)));
    return updated;
  }

  async function loadOlderMessages(roomId = selectedRoomId, limit = 120, silent = false): Promise<void> {
    const session = matrixSessionRef.current;
    if (!roomId || !session) {
      return;
    }
    if (historyLoadingRoomsRef.current.has(roomId) || historyExhaustedByRoom[roomId]) {
      return;
    }
    historyLoadingRoomsRef.current.add(roomId);
    setHistoryLoading(true);
    if (!silent) {
      setError(null);
    }
    try {
      const result = await session.loadMoreTimeline(roomId, limit);
      const nextTimeline = rememberRoomTimeline(roomId, result.messages);
      if (selectedRoomIdRef.current === roomId) {
        setTimeline(nextTimeline);
      }
      setHistoryExhaustedByRoom((current) => ({
        ...current,
        [roomId]: result.exhausted
      }));
    } catch (caught) {
      if (!silent) {
        setError(caught instanceof Error ? caught.message : "Starší zprávy se nepodařilo načíst.");
      }
    } finally {
      historyLoadingRoomsRef.current.delete(roomId);
      setHistoryLoading(historyLoadingRoomsRef.current.size > 0);
      setHistoryBackfillRevision((value) => value + 1);
    }
  }

  function queueVoiceCallCommand(command: ChatVoiceCallCommandMessage): void {
    if (command.actionId) {
      const completed = completedVoiceCallCommandAcksRef.current.get(command.actionId);
      if (completed) {
        postVoiceCallCommandAcknowledgement(completed);
        return;
      }
    }

    const commandKey = command.actionId ?? `legacy:${crypto.randomUUID()}`;
    if (pendingVoiceCallCommandsRef.current.has(commandKey)) {
      void drainPendingVoiceCallCommands();
      return;
    }
    if (pendingVoiceCallCommandsRef.current.size >= 32) {
      const oldestKey = pendingVoiceCallCommandsRef.current.keys().next().value as string | undefined;
      if (oldestKey) {
        expirePendingVoiceCallCommand(oldestKey);
      }
    }
    const timeoutId = window.setTimeout(() => expirePendingVoiceCallCommand(commandKey), 9_000);
    pendingVoiceCallCommandsRef.current.set(commandKey, { command, timeoutId });
    void drainPendingVoiceCallCommands();
  }

  function expirePendingVoiceCallCommand(commandKey: string): void {
    const pending = pendingVoiceCallCommandsRef.current.get(commandKey);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timeoutId);
    pendingVoiceCallCommandsRef.current.delete(commandKey);
    executingVoiceCallCommandIdsRef.current.delete(commandKey);
    if (pending.command.actionId) {
      completeVoiceCallCommand(pending.command, "failed");
    }
  }

  async function drainPendingVoiceCallCommands(): Promise<void> {
    const session = matrixSessionRef.current;
    for (const [commandKey, pending] of pendingVoiceCallCommandsRef.current) {
      if (executingVoiceCallCommandIdsRef.current.has(commandKey)) {
        continue;
      }
      const currentCall =
        voiceCallRef.current?.callId === pending.command.callId &&
        voiceCallRef.current.roomId === pending.command.roomId
          ? voiceCallRef.current
          : session?.getVoiceCall();
      const matchingCall =
        currentCall?.callId === pending.command.callId && currentCall.roomId === pending.command.roomId
          ? currentCall
          : null;
      if (pending.command.action !== "open" && pending.command.action !== "start" && (!session || !matchingCall)) {
        continue;
      }
      if (pending.command.action === "start" && !session) {
        continue;
      }

      executingVoiceCallCommandIdsRef.current.add(commandKey);
      void executePendingVoiceCallCommand(commandKey, pending.command, session, matchingCall);
    }
  }

  async function executePendingVoiceCallCommand(
    commandKey: string,
    command: ChatVoiceCallCommandMessage,
    session: MatrixMessagingSession | null,
    call: MatrixVoiceCallSnapshot | null
  ): Promise<void> {
    try {
      if (command.action === "open") {
        resetRouteOpenAttempt();
        await applyAndOpenRouteSelection(command.roomId);
      } else if (command.action === "start") {
        if (!session) return;
        resetRouteOpenAttempt();
        await applyAndOpenRouteSelection(command.roomId);
        await session.startVoiceCall(command.roomId, { group: command.kind === "group" });
      } else {
        if (!session || !call) {
          return;
        }
        switch (command.action) {
          case "answer": {
            await session.answerVoiceCall(call.callId);
            const roomId = voiceCallRoomToFocusAfterAnswer(call.roomId, selectedRoomIdRef.current);
            if (roomId) {
              resetRouteOpenAttempt();
              await applyAndOpenRouteSelection(roomId);
            }
            break;
          }
          case "reject":
            await session.rejectVoiceCall(call.callId);
            break;
          case "hangup":
            await session.hangupVoiceCall(call.callId);
            break;
          case "mute":
            await session.setVoiceCallMuted(call.callId, command.muted === true);
            break;
          case "addParticipants":
            await session.inviteVoiceCallParticipants(call.callId, command.participantUserIds ?? []);
            break;
        }
      }
      if (pendingVoiceCallCommandsRef.current.has(commandKey)) {
        completeVoiceCallCommand(command, "succeeded", commandKey);
      }
    } catch (caught) {
      setError(userFacingVoiceCallError(caught, "Nativní povel hovoru se nepodařilo provést."));
      if (pendingVoiceCallCommandsRef.current.has(commandKey)) {
        completeVoiceCallCommand(command, "failed", commandKey);
      }
    } finally {
      executingVoiceCallCommandIdsRef.current.delete(commandKey);
    }
  }

  function completeVoiceCallCommand(
    command: ChatVoiceCallCommandMessage,
    status: "failed" | "succeeded",
    commandKey = command.actionId
  ): void {
    if (commandKey) {
      const pending = pendingVoiceCallCommandsRef.current.get(commandKey);
      if (pending) {
        window.clearTimeout(pending.timeoutId);
        pendingVoiceCallCommandsRef.current.delete(commandKey);
      }
    }
    if (!command.actionId) {
      return;
    }
    const acknowledgement = encodeChatVoiceCallCommandAcknowledgement({
      actionId: command.actionId,
      callId: command.callId,
      roomId: command.roomId,
      status
    });
    completedVoiceCallCommandAcksRef.current.set(command.actionId, acknowledgement);
    if (completedVoiceCallCommandAcksRef.current.size > 64) {
      const oldest = completedVoiceCallCommandAcksRef.current.keys().next().value as string | undefined;
      if (oldest) {
        completedVoiceCallCommandAcksRef.current.delete(oldest);
      }
    }
    postVoiceCallCommandAcknowledgement(acknowledgement);
  }

  function postVoiceCallCommandAcknowledgement(acknowledgement: ChatVoiceCallCommandAcknowledgementMessage): void {
    if (embedded && window.parent !== window) {
      window.parent.postMessage(acknowledgement, window.location.origin);
    }
  }

  async function startVoiceCall(): Promise<void> {
    const roomId = activeChat?.roomId;
    if (!canStartVoiceCall || !matrixSession || !roomId) {
      setNotice(chatText("calls.audioUnavailable"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await matrixSession.startVoiceCall(roomId, { group: activeChat?.type === "group" });
    } catch (caught) {
      setError(userFacingVoiceCallError(caught, "Hovor se nepodařilo zahájit."));
    }
  }

  async function answerVoiceCall(call: MatrixVoiceCallSnapshot): Promise<void> {
    const session = matrixSessionRef.current;
    if (!session) {
      setError("Chatové spojení pro přijetí hovoru není připravené.");
      return;
    }
    setError(null);
    try {
      await session.answerVoiceCall(call.callId);
    } catch (caught) {
      setError(userFacingVoiceCallError(caught, "Hovor se nepodařilo přijmout."));
      return;
    }

    const roomId = voiceCallRoomToFocusAfterAnswer(call.roomId, selectedRoomIdRef.current);
    if (roomId) {
      resetRouteOpenAttempt();
      await applyAndOpenRouteSelection(roomId);
    }
  }

  async function rejectVoiceCall(call: MatrixVoiceCallSnapshot): Promise<void> {
    const session = matrixSessionRef.current;
    if (!session) {
      setVoiceCall(null);
      return;
    }
    try {
      await session.rejectVoiceCall(call.callId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hovor se nepodařilo odmítnout.");
    }
  }

  async function hangupVoiceCall(call: MatrixVoiceCallSnapshot): Promise<void> {
    const session = matrixSessionRef.current;
    if (!session) {
      setVoiceCall(null);
      return;
    }
    try {
      await session.hangupVoiceCall(call.callId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hovor se nepodařilo ukončit.");
    }
  }

  async function toggleVoiceCallMute(call: MatrixVoiceCallSnapshot): Promise<void> {
    await setVoiceCallMute(call, !call.microphoneMuted);
  }

  async function setVoiceCallMute(call: MatrixVoiceCallSnapshot, muted: boolean): Promise<void> {
    const session = matrixSessionRef.current;
    if (!session) {
      return;
    }
    try {
      await session.setVoiceCallMuted(call.callId, muted);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mikrofon se nepodařilo přepnout.");
    }
  }

  async function sendMessage(draft: string, options: ChatSendOptions = {}): Promise<boolean> {
    const text = draft.trim();
    if (!options.skipAiMention && !pendingAttachment && !replyDraft && isTomatoSlashCommand(text)) {
      setTomatoGameOpen(true);
      setReplyDraft(null);
      clearPendingAttachment();
      return true;
    }
    if (!matrixSession || !selectedRoomId || !(text || pendingAttachment)) {
      return false;
    }
    const attachment = pendingAttachment;
    const aiInvocation =
      !options.skipAiMention && !attachment && !replyDraft
        ? parseAiAgentInvocation(text, {
            aiDirectChat: selectedAiAgentDirectChat,
            groupAiAssistantEnabled: selectedGroupAiAssistantEnabled
          })
        : null;
    setSending(true);
    setError(null);
    try {
      if (aiInvocation) {
        await sendAiAgentMentionQuestion(text, aiInvocation);
        setReplyDraft(null);
        clearPendingAttachment();
        setTimeline(rememberRoomTimeline(selectedRoomId, matrixSession.getTimeline(selectedRoomId)));
        return true;
      }
      if (attachment) {
        const payload: MatrixAttachmentUpload = {
          caption: text || undefined,
          file: attachment.file,
          kind: attachment.kind
        };
        await matrixSession.sendAttachment(selectedRoomId, payload);
      } else {
        await matrixSession.sendMessage(selectedRoomId, text, {
          ...(options.cop ? { cop: options.cop } : {}),
          ...(replyDraft ? { replyTo: matrixReplyTarget(replyDraft, authSession) } : {})
        });
      }
      setReplyDraft(null);
      clearPendingAttachment();
      setTimeline(rememberRoomTimeline(selectedRoomId, matrixSession.getTimeline(selectedRoomId)));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Zprávu se nepodařilo odeslat.");
      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendAiAgentMentionQuestion(userMessage: string, invocation: AiAgentInvocation): Promise<void> {
    const question = invocation.question.trim();
    if (!authToken) {
      throw new Error("Pro dotaz na AI agenta je potřeba platné přihlášení do COP.");
    }
    if (!question) {
      throw new Error(
        invocation.trigger === "slash"
          ? "Za příkaz doplňte konkrétní dotaz pro AI agenta."
          : "Za @COP AI doplňte konkrétní dotaz."
      );
    }
    if (!matrixSession || !selectedRoomId) {
      throw new Error("Nejdřív otevřete chatovou místnost.");
    }
    const roomId = selectedRoomId;
    const session = matrixSession;
    let geoLocation = aiContextLocation;
    if (!geoLocation && !embedded && aiQuestionNeedsCurrentLocation(question)) {
      geoLocation = await requestStandaloneAiLocation({ reportNotice: false });
    }

    setAiAgentInlineStatus("COP AI agent připravuje dotaz a vybírá COP zdroje...");
    await session.sendMessage(roomId, userMessage);
    setNotice("COP AI agent zpracovává dotaz...");
    void finishAiAgentMentionQuestion({
      invocation,
      question,
      roomId,
      session,
      geoLocation,
      userMessage
    });
  }

  async function finishAiAgentMentionQuestion(input: {
    invocation: AiAgentInvocation;
    question: string;
    roomId: string;
    session: MatrixMessagingSession;
    geoLocation?: MatrixLocationShare | null;
    userMessage: string;
  }): Promise<void> {
    try {
      let response: AiCopResponse;
      response = await queryAiChatAgentWithJob(
        buildAiChatAgentQueryOptions(
          input.question,
          input.invocation.modelPreference,
          input.userMessage,
          input.geoLocation ?? undefined
        ),
        (job) => {
          const label = aiChatAgentJobStatusLabel(job);
          setNotice(label);
          setAiAgentInlineStatus(label);
        }
      );
      setAiAgentQuestion(input.question);
      setAiAgentResponse(response);

      const answer = aiResponseSummary(response);
      if (response.status !== "COMPLETED") {
        setAiAgentDialogOpen(true);
        setNotice(
          response.status === "NEEDS_HUMAN_REVIEW"
            ? "AI odpověď vyžaduje lidskou kontrolu, proto není automaticky odeslaná."
            : "AI odpověď nebyla automaticky odeslaná."
        );
        return;
      }
      if (!answer.trim()) {
        setNotice("AI agent nevrátil odpověď k odeslání.");
        return;
      }
      setAiAgentInlineStatus("AI odpověď je připravená, odesílám ji do chatu...");
      await input.session.sendMessage(input.roomId, formatAiAgentShareBody(answer, input.question), {
        cop: buildAiAgentMessageMetadata(response, input.question)
      });
      if (selectedRoomIdRef.current === input.roomId) {
        setTimeline(rememberRoomTimeline(input.roomId, input.session.getTimeline(input.roomId)));
      }
      setNotice("COP AI agent odpověděl do chatu.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI agent teď nedokáže odpovědět.");
      return;
    } finally {
      setAiAgentInlineStatus(null);
    }
  }

  async function requestStandaloneAiLocation(
    options: { reportNotice: boolean } = { reportNotice: true }
  ): Promise<MatrixLocationShare> {
    setStandaloneAiLocationBusy(true);
    setError(null);
    try {
      const location = await getDeviceLocation();
      setStandaloneAiLocation(location);
      if (options.reportNotice) {
        setNotice(`Poloha je připravená pro AI dotazy: ${formatCoordinates(location)}.`);
      }
      return location;
    } catch (caught) {
      const message = geolocationErrorMessage(caught);
      setError(message);
      throw new Error(message);
    } finally {
      setStandaloneAiLocationBusy(false);
    }
  }

  React.useEffect(() => {
    liveLocationSessionRef.current = liveLocationSession;
  }, [liveLocationSession]);

  React.useEffect(
    () => () => {
      clearLiveLocationWatch();
      clearLiveLocationExpiryTimer();
    },
    []
  );

  async function sendLiveLocationUpdate(
    session: ActiveLiveLocationSession,
    location: MatrixLocationShare,
    status: "ended" | "live",
    sessionApi: MatrixMessagingSession
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    await sessionApi.sendLocation(session.roomId, {
      ...location,
      label: status === "ended" ? "Sdílení polohy ukončeno" : liveLocationShareLabel(authSession),
      live: {
        durationSeconds: session.durationSeconds,
        expiresAt: session.expiresAt,
        shareId: session.shareId,
        startedAt: session.startedAt,
        status,
        updatedAt
      },
      source: "device",
      updatedAt
    });
    if (selectedRoomIdRef.current === session.roomId) {
      setTimeline(rememberRoomTimeline(session.roomId, sessionApi.getTimeline(session.roomId)));
    }
  }

  function scheduleLiveLocationExpiry(session: ActiveLiveLocationSession): void {
    clearLiveLocationExpiryTimer();
    const delayMs = Math.max(0, Date.parse(session.expiresAt) - Date.now());
    liveLocationExpiryTimerRef.current = window.setTimeout(() => {
      void stopLiveLocationShare({ reason: "expired" });
    }, delayMs);
  }

  function clearLiveLocationExpiryTimer(): void {
    if (liveLocationExpiryTimerRef.current !== null) {
      window.clearTimeout(liveLocationExpiryTimerRef.current);
      liveLocationExpiryTimerRef.current = null;
    }
  }

  function clearLiveLocationWatch(): void {
    const watchId = liveLocationWatchIdRef.current;
    if (watchId !== null && navigator.geolocation?.clearWatch) {
      navigator.geolocation.clearWatch(watchId);
    }
    liveLocationWatchIdRef.current = null;
  }

  function startLiveLocationWatch(session: ActiveLiveLocationSession): void {
    clearLiveLocationWatch();
    if (!navigator.geolocation?.watchPosition) {
      return;
    }
    liveLocationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const activeSession = liveLocationSessionRef.current;
        if (!activeSession || activeSession.shareId !== session.shareId) {
          return;
        }
        const now = Date.now();
        if (now >= Date.parse(activeSession.expiresAt)) {
          void stopLiveLocationShare({ reason: "expired" });
          return;
        }
        const location = matrixLocationFromGeolocationPosition(position);
        liveLocationLastPositionRef.current = location;
        if (now - liveLocationLastSentAtRef.current < liveLocationUpdateMinIntervalMs) {
          return;
        }
        liveLocationLastSentAtRef.current = now;
        if (liveLocationSendInFlightRef.current) {
          return;
        }
        const currentSessionApi = matrixSessionRef.current;
        if (!currentSessionApi) {
          return;
        }
        liveLocationSendInFlightRef.current = true;
        void sendLiveLocationUpdate(activeSession, location, "live", currentSessionApi)
          .catch((caught) =>
            setError(caught instanceof Error ? caught.message : "Živou polohu se nepodařilo aktualizovat.")
          )
          .finally(() => {
            liveLocationSendInFlightRef.current = false;
          });
      },
      (caught) => {
        setError(geolocationErrorMessage(caught));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 20_000
      }
    );
  }

  async function startLiveLocationShare(durationSeconds: number): Promise<void> {
    if (!matrixSession || !selectedRoomId) {
      setError("Nejdřív otevřete chat, do kterého chcete polohu sdílet.");
      return;
    }
    if (!navigator.geolocation) {
      setError("Prohlížeč nepodporuje sdílení polohy.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      if (liveLocationSessionRef.current) {
        await stopLiveLocationShare({ notify: false });
      }
      const startedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
      const session: ActiveLiveLocationSession = {
        durationSeconds,
        expiresAt,
        roomId: selectedRoomId,
        shareId: createLiveLocationShareId(),
        startedAt
      };
      const location = await getDeviceLocation();
      liveLocationLastPositionRef.current = location;
      liveLocationLastSentAtRef.current = Date.now();
      liveLocationSessionRef.current = session;
      setLiveLocationSession(session);
      await sendLiveLocationUpdate(session, location, "live", matrixSession);
      startLiveLocationWatch(session);
      scheduleLiveLocationExpiry(session);
      setNotice(`Živá poloha se sdílí ${formatLiveLocationDuration(durationSeconds)}.`);
    } catch (caught) {
      liveLocationSessionRef.current = null;
      setLiveLocationSession(null);
      clearLiveLocationWatch();
      clearLiveLocationExpiryTimer();
      setError(caught instanceof Error ? caught.message : "Živou polohu se nepodařilo spustit.");
    } finally {
      setSending(false);
    }
  }

  async function stopLiveLocationShare({
    notify = true,
    reason = "manual"
  }: {
    notify?: boolean;
    reason?: "expired" | "manual";
  } = {}): Promise<void> {
    const session = liveLocationSessionRef.current;
    clearLiveLocationWatch();
    clearLiveLocationExpiryTimer();
    liveLocationSessionRef.current = null;
    setLiveLocationSession(null);
    const currentSessionApi = matrixSessionRef.current;
    if (session && currentSessionApi && liveLocationLastPositionRef.current) {
      try {
        await sendLiveLocationUpdate(session, liveLocationLastPositionRef.current, "ended", currentSessionApi);
      } catch (caught) {
        if (notify) {
          setError(caught instanceof Error ? caught.message : "Ukončení sdílení polohy se nepodařilo odeslat.");
        }
      }
    }
    if (notify) {
      setNotice(reason === "expired" ? "Živé sdílení polohy vypršelo." : "Živé sdílení polohy bylo ukončeno.");
    }
  }

  async function shareLocation(durationSeconds?: number) {
    if (typeof durationSeconds === "number" && durationSeconds > 0) {
      await startLiveLocationShare(durationSeconds);
      return;
    }
    if (!matrixSession || !selectedRoomId) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const location = await getDeviceLocation();
      await matrixSession.sendLocation(selectedRoomId, location);
      setTimeline(rememberRoomTimeline(selectedRoomId, matrixSession.getTimeline(selectedRoomId)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Polohu se nepodařilo sdílet.");
    } finally {
      setSending(false);
    }
  }

  async function shareTransitFromHost(transit: MatrixTransitShare) {
    if (!matrixSession || !selectedRoomId) {
      setError("Nejdřív otevřete chat, do kterého chcete spoj poslat.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await matrixSession.sendTransitShare(selectedRoomId, transit);
      setTimeline(rememberRoomTimeline(selectedRoomId, matrixSession.getTimeline(selectedRoomId)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Informaci o spoji se nepodařilo odeslat.");
    } finally {
      setSending(false);
    }
  }

  async function downloadAttachment(message: MatrixTimelineMessage) {
    if (!matrixSession || !message.attachment) {
      return;
    }
    setError(null);
    try {
      const blob = await matrixSession.downloadAttachment(message);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = message.attachment.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 10_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Přílohu se nepodařilo stáhnout.");
    }
  }

  function pickAttachment(kind: MatrixAttachmentKind) {
    const input = attachmentInputRef.current;
    if (!input) {
      return;
    }
    input.value = "";
    input.accept = attachmentAcceptForKind(kind);
    input.dataset.kind = kind;
    input.click();
  }

  function handleAttachmentSelected(files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      return;
    }
    const requestedKind = attachmentInputRef.current?.dataset.kind as MatrixAttachmentKind | undefined;
    clearPendingAttachment();
    const kind = normalizeAttachmentKind(file, requestedKind);
    const previewUrl = kind === "image" || kind === "video" ? window.URL.createObjectURL(file) : undefined;
    setPendingAttachment({
      file,
      kind,
      ...(previewUrl ? { previewUrl } : {})
    });
  }

  function clearPendingAttachment() {
    setPendingAttachment((current) => {
      if (current?.previewUrl) {
        window.URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
  }

  // Stable handler identities so memoized ChatRow/MessageRow only re-render when
  // their own data props change, not on every parent state update.
  const handleOpenChat = useEventCallback((item: ChatListItem) => {
    void openChat(item);
  });
  const handleToggleMutedChat = useEventCallback((item: ChatListItem) => toggleMutedChat(item));
  const handleTogglePinnedChat = useEventCallback((item: ChatListItem) => togglePinnedChat(item));
  const handleToggleUnreadChat = useEventCallback((item: ChatListItem) => toggleUnreadChat(item));
  const handleDownloadAttachment = useEventCallback((message: MatrixTimelineMessage) => {
    void downloadAttachment(message);
  });
  const handleAskAiFollowUp = useEventCallback((question: string) => {
    if (!selectedAiAgentDirectChat && !selectedGroupAiAssistantEnabled) {
      setNotice("COP AI agent už pro tuto konverzaci není dostupný.");
      return;
    }
    const message = selectedAiAgentDirectChat ? question : `@COP AI ${question}`;
    void sendMessage(message);
  });
  const handleOpenMessageActions = useEventCallback(
    (
      message: MatrixTimelineMessage,
      rect: DOMRect,
      stickerTrayOpen?: boolean,
      mode?: MessageActionPopoverState["mode"]
    ) => openMessageActions(message, rect, stickerTrayOpen, mode)
  );
  const handleReactToMessage = useEventCallback((message: MatrixTimelineMessage, key: string) => {
    void reactToMessage(message, key);
  });
  const handleToggleSelectedMessage = useEventCallback((messageId: string) => toggleSelectedMessage(messageId));

  const connectionLocked = authenticated && !chatReady && !showingDemoTimeline;

  return (
    <main className={clsx("wa-shell", embedded && "embedded", routeChatSelected && "chat-selected")}>
      <input
        ref={attachmentInputRef}
        aria-hidden="true"
        className="visually-hidden"
        tabIndex={-1}
        type="file"
        onChange={(event) => handleAttachmentSelected(event.target.files)}
      />

      {!embedded ? (
        <nav className="app-rail" aria-label="COP Chat">
          <a className="rail-logo" href="/" aria-label="Zpět na mapu">
            COP
          </a>
          <button className="rail-button active" type="button" aria-label="Chaty">
            <MessageCircle size={22} />
          </button>
          <button className="rail-button" onClick={() => setComposeMode("group")} type="button" aria-label="Skupiny">
            <Users size={22} />
          </button>
          <span className="rail-spacer" />
          <button
            className="rail-button"
            onClick={() => setRefreshNonce((value) => value + 1)}
            type="button"
            aria-label="Obnovit"
          >
            <RefreshCcw size={21} />
          </button>
          {authenticated ? (
            <button
              className="rail-button"
              onClick={() => endSession(authConfig, authSession)}
              type="button"
              aria-label="Odhlásit"
            >
              <LogOut size={21} />
            </button>
          ) : (
            <button
              className="rail-button"
              onClick={() => void beginLogin(authConfig)}
              type="button"
              aria-label="Přihlásit"
            >
              <LogIn size={21} />
            </button>
          )}
        </nav>
      ) : null}

      <aside className="chat-list-pane" aria-label="Chaty">
        <header className="list-header">
          <div>
            <h1>Chaty</h1>
            <span className={clsx("chat-connection-status", statusLabel === "online" && "online")}>{statusLabel}</span>
          </div>
          <div className="list-actions">
            {!embedded ? (
              <a className="round-icon mobile-map-action" href="/" aria-label="Otevřít mapu" title="Mapa">
                <MapIcon size={21} />
              </a>
            ) : null}
            {authenticated ? (
              <NotificationToggleButton
                busy={webPushBusy}
                state={webPushState}
                onEnable={() => void enableBrowserNotifications()}
              />
            ) : null}
            <button
              className="round-icon"
              onClick={() => setComposeMode("direct")}
              type="button"
              aria-label="Nový chat"
            >
              <MessageSquarePlus size={22} />
            </button>
          </div>
        </header>

        <div className="identity-strip">
          <Avatar label={chatIdentity.displayName} src={chatIdentity.avatarUrl} />
          <span>
            <strong>{chatIdentity.displayName}</strong>
            <small>{chatIdentity.subtitle}</small>
          </span>
        </div>

        <label className="list-search">
          <Search size={18} />
          <input
            aria-label="Hledat"
            placeholder="Hledat"
            value={conversationQuery}
            onChange={(event) => setConversationQuery(event.target.value)}
          />
        </label>

        <div className="filter-tabs" role="tablist" aria-label="Filtr chatů">
          <button
            className={chatFilter === "all" ? "active" : ""}
            aria-selected={chatFilter === "all"}
            onClick={() => setChatFilter("all")}
            role="tab"
            type="button"
          >
            Vše
          </button>
          <button
            className={chatFilter === "direct" ? "active" : ""}
            aria-selected={chatFilter === "direct"}
            onClick={() => setChatFilter("direct")}
            role="tab"
            type="button"
          >
            Přímé
          </button>
          <button
            className={chatFilter === "group" ? "active" : ""}
            aria-selected={chatFilter === "group"}
            onClick={() => setChatFilter("group")}
            role="tab"
            type="button"
          >
            Skupiny
          </button>
        </div>

        {pinnedChatItems.length > 0 ? (
          <PinnedChats
            items={pinnedChatItems}
            mediaAccessToken={matrixMediaAccessToken}
            connectionStateForItem={(item) =>
              chatConnectionStateFor(item, chatReady, matrixSession, syncState, preparingChatId === item.id, status)
            }
            onOpen={(nextItem) => void openChat(nextItem)}
            onTogglePinned={togglePinnedChat}
          />
        ) : null}

        <div className="chat-list" role="list">
          {!authenticated ? (
            <ListPrompt
              actionLabel={isOidcEnabled(authConfig) ? "Přihlásit" : undefined}
              secondaryAction={{ href: "/", label: "Otevřít mapu" }}
              text="Chaty jsou navázané na ověřenou identitu a synchronizují se mezi vašimi zařízeními."
              title={authConfig.mode === "lab" ? "Lab režim nemá chatovou identitu" : "Přihlaste se do chatu"}
              onAction={isOidcEnabled(authConfig) ? () => void beginLogin(authConfig) : undefined}
            />
          ) : loading && regularChatItems.length === 0 && pinnedChatItems.length === 0 ? (
            <ChatSkeleton />
          ) : regularChatItems.length === 0 && pinnedChatItems.length === 0 ? (
            <ListPrompt
              actionLabel="Napsat zprávu"
              secondaryAction={{ label: "Založit skupinu", onClick: () => setComposeMode("group") }}
              text="Najděte člověka nebo vytvořte skupinu pro rodinu, sousedy či komunitu."
              title="Začněte konverzaci"
              onAction={() => setComposeMode("direct")}
            />
          ) : (
            regularChatItems.map((item) => (
              <ChatRowMemo
                item={item}
                key={item.id}
                mediaAccessToken={matrixMediaAccessToken}
                connectionState={chatConnectionStateFor(
                  item,
                  chatReady,
                  matrixSession,
                  syncState,
                  preparingChatId === item.id,
                  status
                )}
                onDeleteRequest={setDeleteChatCandidate}
                onToggleMute={handleToggleMutedChat}
                onTogglePinned={handleTogglePinnedChat}
                onToggleUnread={handleToggleUnreadChat}
                preparing={preparingChatId === item.id}
                onOpen={handleOpenChat}
              />
            ))
          )}
        </div>
      </aside>

      <section className="conversation-pane" aria-label="Konverzace">
        {activeChat ? (
          <>
            <header className="conversation-header">
              <button className="round-icon mobile-back" onClick={clearMobileSelection} type="button" aria-label="Zpět">
                <ArrowLeft size={21} />
              </button>
              <span className="chat-avatar-wrap header-avatar">
                <Avatar
                  label={activeChat.title}
                  mediaAccessToken={matrixMediaAccessToken}
                  src={activeChat.avatarUrl}
                  variant={activeChat.avatarVariant}
                />
                <ConnectionDot
                  state={chatConnectionStateFor(
                    activeChat,
                    chatReady,
                    matrixSession,
                    syncState,
                    preparingChatId === activeChat.id,
                    status
                  )}
                />
              </span>
              <div className="conversation-title">
                <strong>{activeChat.title}</strong>
                <span>{conversationSubtitle(activeChat, selectedRoom, status)}</span>
              </div>
              <div className="conversation-actions">
                {selectedRoom?.encrypted ? (
                  <span className="e2ee-chip" title="Soukromá konverzace je šifrovaná mezi zařízeními">
                    <ShieldCheck size={14} /> E2EE
                  </span>
                ) : null}
                <button
                  className="report-chat-action"
                  onClick={openActiveChatReport}
                  title="Vytvořit situační hlášení z tohoto chatu"
                  type="button"
                >
                  <AlertTriangle size={18} />
                  <span>Nahlásit</span>
                </button>
                <button
                  className="round-icon video-call-action"
                  onClick={() => setNotice(chatText("calls.videoComingSoon"))}
                  title={chatText("calls.videoTitle")}
                  type="button"
                  aria-label={chatText("calls.videoTitle")}
                >
                  <Video size={21} />
                </button>
                <button
                  className={clsx("round-icon voice-call-action", activeVoiceCall && "active")}
                  disabled={!canStartVoiceCall && !activeVoiceCall}
                  onClick={() => void startVoiceCall()}
                  title={chatText("calls.audioTitle")}
                  type="button"
                  aria-label={chatText("calls.audioTitle")}
                >
                  <Phone size={21} />
                </button>
                <div className="chat-menu-anchor" ref={messageMenuRef}>
                  <button
                    className="round-icon"
                    onClick={() => setMessageMenuOpen((open) => !open)}
                    type="button"
                    aria-expanded={messageMenuOpen}
                    aria-label="Další"
                  >
                    <MoreVertical size={21} />
                  </button>
                  {messageMenuOpen ? (
                    <ChatActionMenu
                      activeChat={activeChat}
                      aiAgentAvailable={selectedAiAgentDirectChat || selectedGroupAiAssistantEnabled}
                      aiAgentChatActive={selectedAiAgentDirectChat}
                      aiAgentEnabled={selectedGroupAiAssistantEnabled}
                      canAddMember={canManageSelectedGroupMembers}
                      canToggleAiAgent={Boolean(selectedGroup && canManageSelectedGroupMembers)}
                      muted={activeChat.muted}
                      onAddMember={openAddMemberDialog}
                      onAskAiAgent={openAiAgentDialog}
                      onInfo={openChatInfo}
                      onManage={() => {
                        setMessageMenuOpen(false);
                        setDeleteChatCandidate(activeChat);
                      }}
                      onMute={() => {
                        setMessageMenuOpen(false);
                        setMuteDialogOpen(true);
                      }}
                      onReport={openActiveChatReport}
                      onRecovery={() => {
                        setMessageMenuOpen(false);
                        setGeneratedRecoveryKey(null);
                        setRecoveryManualRestore(true);
                        setRecoveryDialogOpen(true);
                      }}
                      onSearch={startMessageSearch}
                      onSelect={startSelectionMode}
                      onSituationSummary={openAiSituationSummary}
                      onStartAiAgentChat={() => void createAiAgentChat()}
                      onToggleAiAgent={() => {
                        setMessageMenuOpen(false);
                        void toggleAiAgentForSelectedGroup(!selectedGroupAiAssistantEnabled);
                      }}
                      onToggleMute={clearActiveMute}
                      onTogglePinned={() => {
                        setMessageMenuOpen(false);
                        togglePinnedChat(activeChat);
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </header>

            {messageSearchOpen ? (
              <MessageSearchBar
                activeIndex={activeSearchIndex}
                matchCount={searchMatches.length}
                query={messageSearchQuery}
                onClose={() => {
                  setMessageSearchOpen(false);
                  setMessageSearchQuery("");
                }}
                onMove={moveSearch}
                onQueryChange={setMessageSearchQuery}
              />
            ) : null}

            {error ? (
              <StatusBanner kind="error" text={userFacingError(error)} onClose={() => setError(null)} />
            ) : recoveryBanner ? (
              <StatusBanner
                actionLabel={
                  encryptionRecoveryStatus?.needsRecovery
                    ? "Obnovit"
                    : encryptionRecoveryStatus?.keyBackupEnabled
                      ? "Připravit pro iOS"
                      : "Nastavit"
                }
                text={recoveryBanner}
                onAction={() => {
                  setGeneratedRecoveryKey(null);
                  setRecoveryManualRestore(false);
                  setRecoveryDialogOpen(true);
                }}
              />
            ) : notice ? (
              <StatusBanner text={notice} onClose={() => setNotice(null)} />
            ) : matrixWarmupBanner ? (
              <StatusBanner text={matrixWarmupBanner} />
            ) : null}

            {activeVoiceCall ? (
              <VoiceCallBar
                call={activeVoiceCall}
                differentChat={voiceCallDifferentChat}
                title={
                  voiceCallChat?.title ??
                  voiceCallTitle ??
                  (activeVoiceCall.roomId === activeChat.roomId ? activeChat.title : "Neznámý volající")
                }
                onAnswer={() => void answerVoiceCall(activeVoiceCall)}
                onHangup={() => void hangupVoiceCall(activeVoiceCall)}
                onReject={() => void rejectVoiceCall(activeVoiceCall)}
                onToggleMute={() => void toggleVoiceCallMute(activeVoiceCall)}
              />
            ) : null}

            {connectionLocked ? (
              <ChatLockedState
                actionLabel="Obnovit"
                icon={<Lock size={27} />}
                title="Chat není dostupný"
                text={status?.detail ?? status?.warnings[0] ?? "Služba zpráv zatím není připravená."}
                onAction={() => setRefreshNonce((value) => value + 1)}
              />
            ) : preparingChatId ? (
              <ChatLockedState icon={<Loader2 className="spin" size={30} />} title="Připravuji chat" />
            ) : !selectedRoomId && !showingDemoTimeline ? (
              <ChatLockedState
                actionLabel="Otevřít chat"
                icon={<MessageCircle size={28} />}
                title={activeChat.title}
                onAction={() => void openChat(activeChat)}
              />
            ) : selectedRoomId && !encryptionRecoveryReady && !showingDemoTimeline ? (
              <ChatLockedState
                actionLabel={
                  encryptionRecoveryStatus?.needsRecovery
                    ? "Obnovit zařízení"
                    : encryptionRecoveryStatus?.keyBackupEnabled
                      ? "Připravit pro iOS"
                      : "Nastavit obnovu"
                }
                icon={<KeyRound size={30} />}
                title="Dokončete zabezpečení E2EE"
                text={
                  encryptionRecoveryStatus?.needsRecovery
                    ? "Zadejte obnovovací klíč, aby toto zařízení získalo přístup k vaší E2EE záloze."
                    : encryptionRecoveryStatus?.keyBackupEnabled
                      ? "Tento web umí šifrované zprávy číst, ale účet ještě nemá kompletní recovery metadata pro iPhone/iPad."
                      : "Před psaním zpráv nastavte obnovovací klíč. Nové zprávy pak půjde bezpečně číst i na dalších zařízeních."
                }
                onAction={() => {
                  setRecoveryManualRestore(false);
                  setRecoveryDialogOpen(true);
                }}
              />
            ) : (
              <>
                <div
                  ref={messageCanvasRef}
                  className={clsx("message-canvas", messageActionPopover && "action-focus-active")}
                  onScroll={(event) => updateJumpToLatestVisibility(event.currentTarget)}
                >
                  <HistoryLoader
                    exhausted={historyExhausted}
                    loading={historyLoading}
                    onLoad={() => void loadOlderMessages()}
                  />
                  {timelineRows.length === 0 ? <div className="day-pill">Dnes</div> : null}
                  {virtualTimeline.enabled && virtualTimeline.paddingTop > 0 ? (
                    <div
                      className="timeline-spacer"
                      style={{ height: virtualTimeline.paddingTop }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {virtualTimeline.rows.map((row) =>
                    row.kind === "date" ? (
                      <div className="day-pill" key={row.id}>
                        {row.label}
                      </div>
                    ) : (
                      <MessageRowMemo
                        grouped={row.grouped}
                        activeSearchMatch={activeSearchMessageId === row.message.eventId}
                        key={row.message.eventId}
                        matrixSession={matrixSession}
                        message={row.message}
                        focused={messageActionPopover?.messageId === row.message.eventId}
                        replyToMessage={
                          row.message.replyToEventId ? (messageById.get(row.message.replyToEventId) ?? null) : null
                        }
                        searchQuery={messageSearchQuery}
                        selectable={selectionMode}
                        selected={selectedMessageIds.has(row.message.eventId)}
                        senderLabel={messageSenderLabel(row.message, selectedConversation, authSession)}
                        onAskAiFollowUp={handleAskAiFollowUp}
                        onDownloadAttachment={handleDownloadAttachment}
                        onOpenActions={handleOpenMessageActions}
                        onOpenPreview={setPreviewItem}
                        onReact={handleReactToMessage}
                        onToggleSelected={handleToggleSelectedMessage}
                      />
                    )
                  )}
                  {virtualTimeline.enabled && virtualTimeline.paddingBottom > 0 ? (
                    <div
                      className="timeline-spacer"
                      style={{ height: virtualTimeline.paddingBottom }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <div ref={timelineEndRef} aria-hidden="true" />
                </div>
                {aiAgentInlineStatus ? (
                  <div className="ai-inline-status" role="status" aria-live="polite">
                    <span className="ai-inline-status-icon">
                      <Sparkles size={18} />
                    </span>
                    <span>
                      <strong>COP AI agent pracuje</strong>
                      <small>{aiAgentInlineStatus}</small>
                    </span>
                  </div>
                ) : null}
                {selectionMode ? (
                  <SelectionToolbar
                    count={selectedMessageIds.size}
                    onCancel={cancelSelectionMode}
                    onCopy={() => void copySelectedMessages()}
                    onForward={forwardSelectedMessages}
                    onShare={() => void shareSelectedMessages()}
                  />
                ) : (
                  <Composer
                    aiAgentAvailable={selectedAiAgentDirectChat || selectedGroupAiAssistantEnabled}
                    aiLocationActive={Boolean(aiContextLocation)}
                    aiLocationBusy={standaloneAiLocationBusy}
                    disabled={!composerEnabled}
                    embedded={embedded}
                    liveLocationActive={Boolean(liveLocationSession)}
                    pendingAttachment={pendingAttachment}
                    replyTo={replyDraft}
                    sending={sending}
                    showJumpToLatest={showJumpToLatest}
                    onAttachmentClear={clearPendingAttachment}
                    onAttachmentPick={pickAttachment}
                    onReplyClear={() => setReplyDraft(null)}
                    onSend={sendMessage}
                    onJumpToLatest={() =>
                      timelineEndRef.current?.scrollIntoView({
                        block: "end",
                        behavior: preferredChatScrollBehavior()
                      })
                    }
                    onUseAiLocation={() =>
                      void requestStandaloneAiLocation({ reportNotice: true }).catch(() => undefined)
                    }
                    onShareLocation={() => void shareLocation()}
                    onStartLiveLocation={(durationSeconds) => void shareLocation(durationSeconds)}
                    onStopLiveLocation={() => void stopLiveLocationShare()}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <WelcomePane
            authenticated={authenticated}
            authConfig={authConfig}
            onLogin={() => void beginLogin(authConfig)}
            onNewChat={() => setComposeMode("direct")}
            onNewGroup={() => setComposeMode("group")}
            onOpenMap={() => window.open("/", "_self", "noopener,noreferrer")}
          />
        )}
      </section>

      {composeMode ? (
        <React.Suspense
          fallback={
            <DialogLoadingFallback
              label={
                composeMode === "direct" ? "Nový chat" : composeMode === "member" ? "Přidat člena" : "Nová skupina"
              }
            />
          }
        >
          <NewChatDialog
            canChat={chatReady}
            directQuery={directQuery}
            directSuggestions={directSuggestions}
            memberQuery={memberQuery}
            memberSuggestions={memberSuggestions}
            memberAddingSubjectIds={Array.from(memberAddPendingIds)}
            existingMemberSubjectIds={
              selectedGroup?.members.filter((member) => member.status === "active").map((member) => member.subjectId) ??
              []
            }
            mode={composeMode}
            newGroupName={newGroupName}
            searchLoading={searchLoading}
            onAddMember={(user) => void addMemberToSelectedGroup(user)}
            onClose={() => setComposeMode(null)}
            onCreateAiAgentChat={() => void createAiAgentChat()}
            onCreateDirect={(user) => void createDirectChat(user)}
            onCreateGroup={() => void createGroupChat()}
            onDirectQueryChange={setDirectQuery}
            onGroupNameChange={setNewGroupName}
            onMemberQueryChange={setMemberQuery}
            onModeChange={setComposeMode}
          />
        </React.Suspense>
      ) : null}

      {aiSituationDialogOpen ? (
        <React.Suspense fallback={<DialogLoadingFallback label="AI situační souhrn" />}>
          <AiSituationDialog
            error={aiSituationError}
            response={aiSituationResponse}
            sending={sending}
            working={aiSituationWorking}
            onClose={() => setAiSituationDialogOpen(false)}
            onRefresh={() => void refreshAiSituationSummary()}
            onSendToChat={(text) => void sendAiSituationSummaryToChat(text)}
          />
        </React.Suspense>
      ) : null}

      {aiAgentDialogOpen ? (
        <React.Suspense fallback={<DialogLoadingFallback label="AI agent" />}>
          <AiAgentDialog
            error={aiAgentError}
            jobStatus={aiAgentJobStatus}
            modelPreference={aiAgentModelPreference}
            question={aiAgentQuestion}
            response={aiAgentResponse}
            sending={sending}
            working={aiAgentWorking}
            onAsk={() => void askAiAgent()}
            onClose={() => setAiAgentDialogOpen(false)}
            onModelPreferenceChange={(value) => {
              setAiAgentModelPreference(value);
              setAiAgentResponse(null);
              setAiAgentError(null);
            }}
            onQuestionChange={(value) => {
              setAiAgentQuestion(value);
              setAiAgentResponse(null);
              setAiAgentError(null);
            }}
            onSendToChat={(text) => void sendAiAgentResponseToChat(text)}
          />
        </React.Suspense>
      ) : null}

      {actionMessage && messageActionPopover ? (
        <MessageActionPopover
          anchor={messageActionPopover}
          message={actionMessage}
          onClose={() => setMessageActionPopover(null)}
          onCopy={(message) => void copyMessage(message)}
          onDelete={(message) => void deleteOwnMessage(message)}
          onForward={(message) => startForwardMessages([message])}
          onReact={(message, key) => void reactToMessage(message, key)}
          onReply={replyToMessage}
          onSelect={(message) => {
            setMessageActionPopover(null);
            setSelectionMode(true);
            setSelectedMessageIds(new Set([message.eventId]));
          }}
          onStickerTrayChange={(open) =>
            setMessageActionPopover((current) => (current ? { ...current, stickerTrayOpen: open } : current))
          }
        />
      ) : null}

      {forwardDraftMessages.length > 0 ? (
        <React.Suspense fallback={<DialogLoadingFallback label="Přeposlat" />}>
          <ForwardDialog
            draftCount={forwardDraftMessages.length}
            query={forwardQuery}
            searchLoading={forwardSearchLoading}
            selectedCount={selectedForwardTargets.length}
            selectedKeys={forwardSelectedTargetKeys}
            targets={forwardTargets}
            workingId={forwardWorkingId}
            onClose={() => {
              setForwardDraftMessages([]);
              setForwardQuery("");
              setForwardSelectedTargetKeys(new Set());
              setForwardSelectedTargetsByKey({});
              setForwardUserSuggestions([]);
            }}
            onSend={() => void forwardMessagesToSelectedTargets()}
            onToggleTarget={toggleForwardTarget}
            onQueryChange={setForwardQuery}
          />
        </React.Suspense>
      ) : null}

      {previewItem ? (
        <React.Suspense fallback={<DialogLoadingFallback label="Náhled" />}>
          <MediaPreviewDialog item={previewItem} onClose={() => setPreviewItem(null)} />
        </React.Suspense>
      ) : null}
      {infoPanelOpen && activeChat ? (
        <ChatInfoPanel
          activeChat={activeChat}
          authSession={authSession}
          ownAvatarUrl={chatIdentity.avatarUrl}
          aiAgentUpdating={aiAgentGroupUpdating}
          canAddMember={canManageSelectedGroupMembers}
          conversation={selectedConversation}
          deviceDiagnostics={deviceDiagnostics}
          group={selectedGroup}
          mediaAccessToken={matrixMediaAccessToken}
          mediaTab={mediaPanelTab}
          messages={timelineMessages}
          messageRetentionSeconds={activeMessageRetentionSeconds}
          muted={activeChat.muted}
          pinned={activeChat.pinned}
          tab={infoPanelTab}
          onClose={() => setInfoPanelOpen(false)}
          onAddMember={openAddMemberDialog}
          onAskAiAgent={openAiAgentDialog}
          onMediaTabChange={setMediaPanelTab}
          onManageChat={() => {
            setInfoPanelOpen(false);
            setDeleteChatCandidate(activeChat);
          }}
          onTabChange={setInfoPanelTab}
          onTogglePinned={() => togglePinnedChat(activeChat)}
          onToggleMute={activeChat.muted ? clearActiveMute : () => setMuteDialogOpen(true)}
          onToggleAiAgent={(enabled) => void toggleAiAgentForSelectedGroup(enabled)}
          onOpenRetentionSettings={() => setRetentionDialogOpen(true)}
          onOpenPreview={setPreviewItem}
          onRemoveMember={openRemoveMemberDialog}
        />
      ) : null}
      {memberRemovalCandidate ? (
        <React.Suspense fallback={<DialogLoadingFallback label="Odebrat člena" />}>
          <RemoveMemberDialog
            groupName={memberRemovalCandidate.groupName}
            memberName={memberRemovalCandidate.memberName}
            working={memberRemovalWorking}
            onClose={() => setMemberRemovalCandidate(null)}
            onRemove={() => void removeMemberFromGroup(memberRemovalCandidate)}
          />
        </React.Suspense>
      ) : null}
      {muteDialogOpen && activeChat ? (
        <React.Suspense fallback={<DialogLoadingFallback label="Ztlumit upozornění" />}>
          <MuteDialog title={activeChat.title} onClose={() => setMuteDialogOpen(false)} onMute={applyMuteChoice} />
        </React.Suspense>
      ) : null}
      {deleteChatCandidate ? (
        <React.Suspense fallback={<DialogLoadingFallback label="Smazat chat" />}>
          <DeleteChatDialog
            canDeleteGroup={Boolean(
              deleteChatCandidate.group?.groupId &&
              canManageCommunityGroupMembers(deleteChatCandidate.group, authSubjectId)
            )}
            canLeaveGroup={Boolean(deleteChatCandidate.group?.groupId && deleteChatCandidate.type !== "direct")}
            chatKind={deleteChatCandidate.type === "direct" ? "direct" : "group"}
            working={chatRemovalWorking}
            title={deleteChatCandidate.title}
            onClose={() => setDeleteChatCandidate(null)}
            onDeleteGroup={() => void deleteGroupChat(deleteChatCandidate)}
            onHide={() => hideChatFromList(deleteChatCandidate)}
            onLeaveGroup={() => void leaveGroupChat(deleteChatCandidate)}
          />
        </React.Suspense>
      ) : null}
      {retentionDialogOpen && activeChat ? (
        <React.Suspense fallback={<DialogLoadingFallback label="Odstraňování zpráv" />}>
          <MessageRetentionDialog
            currentSeconds={activeMessageRetentionSeconds}
            saving={retentionSaving}
            title={activeChat.title}
            onClose={() => setRetentionDialogOpen(false)}
            onSelect={(seconds) => void applyMessageRetention(seconds)}
          />
        </React.Suspense>
      ) : null}
      {recoveryDialogOpen ? (
        <React.Suspense fallback={<DialogLoadingFallback label="Obnova E2EE" />}>
          <EncryptionRecoveryDialog
            generatedRecoveryKey={generatedRecoveryKey}
            manualRestore={recoveryManualRestore}
            recoveryKeyInput={recoveryKeyInput}
            saving={recoveryWorking}
            status={encryptionRecoveryStatus}
            onClose={() => {
              setRecoveryDialogOpen(false);
              setGeneratedRecoveryKey(null);
              setRecoveryManualRestore(false);
            }}
            onCreate={() => void createEncryptionRecovery(false)}
            onManualRestore={() => {
              setGeneratedRecoveryKey(null);
              setRecoveryManualRestore(true);
            }}
            onPrepareMobile={() => void prepareEncryptionRecoveryForMobile()}
            onRepairDevice={() => void repairCurrentMatrixDevice()}
            onRecoveryKeyInputChange={setRecoveryKeyInput}
            onReset={() => void createEncryptionRecovery(true)}
            onRestore={() => void restoreEncryptionRecovery()}
          />
        </React.Suspense>
      ) : null}
      {tomatoGameOpen ? <TomatoGameDialog onClose={() => setTomatoGameOpen(false)} /> : null}
    </main>
  );
}

function TomatoGameDialog({ onClose }: { onClose: () => void }) {
  const modal = useModalFocus<HTMLElement>(onClose);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        aria-label="Rajčatová sklizeň"
        aria-modal="true"
        className="tomato-game-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <span>
            <Sparkles size={19} />
            <strong>Rajčatová sklizeň</strong>
          </span>
          <div className="tomato-game-actions">
            <a
              className="round-icon small"
              href={tomatoGameUrl}
              rel="noreferrer"
              target="_blank"
              title="Otevřít hru samostatně"
            >
              <ExternalLink size={17} />
            </a>
            <button className="round-icon small" onClick={onClose} title="Zavřít" type="button">
              <X size={18} />
            </button>
          </div>
        </header>
        <iframe
          allow="autoplay; fullscreen; gamepad"
          className="tomato-game-frame"
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-same-origin allow-scripts allow-pointer-lock"
          src={tomatoGameUrl}
          title="Rajčatová sklizeň"
        />
      </section>
    </div>
  );
}

function DialogLoadingFallback({ label }: { label: string }) {
  return (
    <div className="mute-backdrop" role="presentation">
      <section className="mute-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <h2>{label}</h2>
        <p>{chatText("dialog.loading")}</p>
      </section>
    </div>
  );
}

function PinnedChats({
  items,
  mediaAccessToken,
  connectionStateForItem,
  onOpen,
  onTogglePinned
}: {
  items: ChatListItem[];
  mediaAccessToken?: string;
  connectionStateForItem: (item: ChatListItem) => ChatConnectionState;
  onOpen: (item: ChatListItem) => void;
  onTogglePinned: (item: ChatListItem) => void;
}) {
  return (
    <section className="pinned-chats" aria-label="Připnuté chaty">
      {items.map((item) => (
        <div className={clsx("pinned-chat", item.active && "active")} key={item.id}>
          <button className="pinned-chat-open" onClick={() => onOpen(item)} type="button">
            <span className="pinned-avatar-wrap">
              <Avatar
                label={item.title}
                mediaAccessToken={mediaAccessToken}
                src={item.avatarUrl}
                variant={item.avatarVariant}
              />
              <ConnectionDot state={connectionStateForItem(item)} />
              {item.unreadCount > 0 && !item.muted ? <span className="pinned-unread">{item.unreadCount}</span> : null}
              {item.muted ? (
                <span className="pinned-muted">
                  <BellOff size={13} />
                </span>
              ) : null}
            </span>
            <span className="pinned-title">{item.title}</span>
            <span className="visually-hidden">Otevřít připnutý chat</span>
          </button>
          <button
            className="pinned-unpin"
            onClick={() => onTogglePinned(item)}
            type="button"
            aria-label={`Odepnout ${item.title}`}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </section>
  );
}

export function ChatRow({
  connectionState,
  item,
  mediaAccessToken,
  onDeleteRequest,
  onToggleMute,
  onTogglePinned,
  onToggleUnread,
  preparing,
  onOpen
}: {
  connectionState: ChatConnectionState;
  item: ChatListItem;
  mediaAccessToken?: string;
  onDeleteRequest: (item: ChatListItem) => void;
  onToggleMute: (item: ChatListItem) => void;
  onTogglePinned: (item: ChatListItem) => void;
  onToggleUnread: (item: ChatListItem) => void;
  preparing: boolean;
  onOpen: (item: ChatListItem) => void;
}) {
  const [openActions, setOpenActions] = React.useState<"leading" | "trailing" | null>(null);
  const [dragOffset, setDragOffset] = React.useState(0);
  const dragOffsetRef = React.useRef(0);
  const dragFrameRef = React.useRef<number | null>(null);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const swipedRef = React.useRef(false);
  const leadingPinActionRef = React.useRef<HTMLButtonElement>(null);
  const rowActionsToggleRef = React.useRef<HTMLButtonElement>(null);
  const focusLeadingActionRef = React.useRef(false);
  const returnFocusToToggleRef = React.useRef(false);
  const leadingActionsId = React.useId();
  const swipeOffset = openActions === "leading" ? 136 : openActions === "trailing" ? -136 : 0;
  const rowOffset = dragOffset || swipeOffset;
  const unreadActionLabel = item.unreadCount > 0 || item.manuallyUnread ? "Přečtené" : "Nepřečtené";

  React.useEffect(() => {
    if (openActions === "leading" && focusLeadingActionRef.current) {
      focusLeadingActionRef.current = false;
      leadingPinActionRef.current?.focus();
    } else if (openActions === null && returnFocusToToggleRef.current) {
      returnFocusToToggleRef.current = false;
      rowActionsToggleRef.current?.focus();
    }
  }, [openActions]);

  React.useEffect(
    () => () => {
      if (dragFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
      dragFrameRef.current = null;
    },
    []
  );

  function scheduleDragOffset(nextOffset: number) {
    dragOffsetRef.current = nextOffset;
    if (dragFrameRef.current !== null) {
      return;
    }
    if (typeof window.requestAnimationFrame !== "function") {
      setDragOffset(nextOffset);
      return;
    }
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      setDragOffset(dragOffsetRef.current);
    });
  }

  function resetDragOffset() {
    if (dragFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(dragFrameRef.current);
    }
    dragFrameRef.current = null;
    dragOffsetRef.current = 0;
    setDragOffset(0);
  }

  function closeSwipeActions() {
    setOpenActions(null);
    resetDragOffset();
  }

  function handleOpen(event: React.MouseEvent<HTMLButtonElement>) {
    if (swipedRef.current) {
      event.preventDefault();
      swipedRef.current = false;
      return;
    }
    closeSwipeActions();
    onOpen(item);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse") {
      return;
    }
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    swipedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;
    if (!start || event.pointerType === "mouse") {
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) {
      return;
    }
    swipedRef.current = true;
    const baseOffset = openActions === "leading" ? 136 : openActions === "trailing" ? -136 : 0;
    const nextOffset = Math.max(-148, Math.min(148, baseOffset + dx));
    scheduleDragOffset(nextOffset);
    event.preventDefault();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse") {
      return;
    }
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) {
      resetDragOffset();
      return;
    }
    const totalOffset = dragOffsetRef.current || event.clientX - start.x;
    if (totalOffset > 56) {
      setOpenActions("leading");
    } else if (totalOffset < -56) {
      setOpenActions("trailing");
    } else {
      setOpenActions(null);
    }
    resetDragOffset();
    window.setTimeout(() => {
      swipedRef.current = false;
    }, 250);
  }

  function runSwipeAction(action: () => void) {
    returnFocusToToggleRef.current = true;
    action();
    closeSwipeActions();
  }

  function openLeadingActionsFromButton() {
    focusLeadingActionRef.current = true;
    resetDragOffset();
    setOpenActions("leading");
  }

  function handleSwipeActionsKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    returnFocusToToggleRef.current = true;
    closeSwipeActions();
  }

  return (
    <article
      aria-current={item.active ? "true" : undefined}
      className={clsx(
        "chat-row-shell",
        item.active && "active",
        item.unreadCount > 0 && "unread",
        dragOffset !== 0 && "swiping",
        openActions && "swipe-open"
      )}
      role="listitem"
    >
      <div
        className="chat-swipe-actions chat-swipe-leading"
        id={leadingActionsId}
        aria-hidden={openActions !== "leading"}
        aria-label={`Akce chatu ${item.title}`}
        onKeyDown={handleSwipeActionsKeyDown}
      >
        <button
          ref={leadingPinActionRef}
          onClick={() => runSwipeAction(() => onTogglePinned(item))}
          tabIndex={openActions === "leading" ? 0 : -1}
          type="button"
        >
          {item.pinned ? <PinOff size={19} /> : <Pin size={19} />}
          <span>{item.pinned ? "Odepnout" : "Připnout"}</span>
        </button>
        <button
          onClick={() => runSwipeAction(() => onToggleUnread(item))}
          tabIndex={openActions === "leading" ? 0 : -1}
          type="button"
        >
          {item.unreadCount > 0 || item.manuallyUnread ? <CheckCheck size={19} /> : <MessageCircle size={19} />}
          <span>{unreadActionLabel}</span>
        </button>
      </div>
      <div className="chat-swipe-actions chat-swipe-trailing" aria-hidden={openActions !== "trailing"}>
        <button
          onClick={() => runSwipeAction(() => onToggleMute(item))}
          tabIndex={openActions === "trailing" ? 0 : -1}
          type="button"
        >
          {item.muted ? <Bell size={19} /> : <BellOff size={19} />}
          <span>{item.muted ? "Zapnout" : "Ztlumit"}</span>
        </button>
        <button
          className="danger"
          onClick={() => runSwipeAction(() => onDeleteRequest(item))}
          tabIndex={openActions === "trailing" ? 0 : -1}
          type="button"
        >
          <Trash2 size={19} />
          <span>{item.type === "direct" ? "Skrýt" : "Správa"}</span>
        </button>
      </div>
      <div
        className={clsx("chat-row", item.active && "active", item.unreadCount > 0 && "unread")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={closeSwipeActions}
        style={{ transform: rowOffset ? `translateX(${rowOffset}px)` : undefined }}
      >
        <button className="chat-row-open" onClick={handleOpen} type="button">
          <span className="chat-avatar-wrap">
            <Avatar
              label={item.title}
              mediaAccessToken={mediaAccessToken}
              src={item.avatarUrl}
              variant={item.avatarVariant}
            />
            <ConnectionDot state={connectionState} />
          </span>
          <span className="chat-row-main">
            <span className="chat-row-top">
              <strong>{item.title}</strong>
              <span className="chat-row-flags">
                {item.muted ? <BellOff size={14} aria-label="Ztlumeno" /> : null}
                {item.timestamp ? <time>{item.timestamp}</time> : null}
              </span>
            </span>
            <span className="chat-row-preview">
              {preparing ? (
                <Loader2 className="spin" size={15} />
              ) : item.latest ? (
                attachmentIndicator(item.latest)
              ) : null}
              {preparing ? "Připravuji..." : item.preview}
            </span>
          </span>
        </button>
        <button
          className={clsx("row-pin", item.pinned && "active")}
          onClick={() => onTogglePinned(item)}
          type="button"
          aria-label={item.pinned ? `Odepnout ${item.title}` : `Připnout ${item.title}`}
        >
          {item.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
        <button
          ref={rowActionsToggleRef}
          className="row-actions-toggle"
          aria-controls={leadingActionsId}
          aria-expanded={openActions === "leading"}
          aria-label={`Akce chatu ${item.title}`}
          onClick={openLeadingActionsFromButton}
          type="button"
        >
          <MoreVertical size={18} />
        </button>
        {item.unreadCount > 0 && !item.muted ? <span className="unread-badge">{item.unreadCount}</span> : null}
      </div>
    </article>
  );
}

function MessageActionPopover({
  anchor,
  message,
  onClose,
  onCopy,
  onDelete,
  onForward,
  onReact,
  onReply,
  onSelect,
  onStickerTrayChange
}: {
  anchor: MessageActionPopoverState;
  message: MatrixTimelineMessage;
  onClose: () => void;
  onCopy: (message: MatrixTimelineMessage) => void;
  onDelete: (message: MatrixTimelineMessage) => void;
  onForward: (message: MatrixTimelineMessage) => void;
  onReact: (message: MatrixTimelineMessage, key: string) => void;
  onReply: (message: MatrixTimelineMessage) => void;
  onSelect: (message: MatrixTimelineMessage) => void;
  onStickerTrayChange: (open: boolean) => void;
}) {
  const ownReaction = message.reactions?.find((reaction) => reaction.own) ?? null;
  return (
    <>
      <button className="message-action-backdrop" onClick={onClose} type="button" aria-label="Zavřít akce zprávy" />
      <div
        className={clsx("message-action-popover", anchor.mode === "reactions" && "reactions-only")}
        role={anchor.mode === "actions" ? "menu" : "dialog"}
        style={{ left: anchor.left, top: anchor.top }}
      >
        <div className="reaction-strip" aria-label="Rychlé reakce">
          {quickReactionKeys.map((key) => (
            <button
              className={ownReaction?.key === key ? "selected" : ""}
              key={key}
              onClick={() => onReact(message, key)}
              type="button"
              aria-label={ownReaction?.key === key ? `Odebrat reakci ${key}` : `Reagovat ${key}`}
            >
              {key}
            </button>
          ))}
          <button
            className="reaction-more"
            onClick={() => onStickerTrayChange(!anchor.stickerTrayOpen)}
            type="button"
            aria-label="Další nálepky"
          >
            <Plus size={22} />
          </button>
        </div>
        {anchor.stickerTrayOpen ? (
          <div className="sticker-tray" aria-label="Nálepky">
            {stickerReactionKeys.map((key) => (
              <button
                className={ownReaction?.key === key ? "selected" : ""}
                key={key}
                onClick={() => onReact(message, key)}
                type="button"
                aria-label={ownReaction?.key === key ? `Odebrat nálepku ${key}` : `Přidat nálepku ${key}`}
              >
                {key}
              </button>
            ))}
          </div>
        ) : null}
        {anchor.mode === "actions" ? (
          <div className="message-action-list">
            <button onClick={() => onReply(message)} role="menuitem" type="button">
              <Reply size={22} />
              Odpovědět
            </button>
            <button onClick={() => onForward(message)} role="menuitem" type="button">
              <Forward size={22} />
              Přeposlat
            </button>
            <button onClick={() => onStickerTrayChange(true)} role="menuitem" type="button">
              <Sticker size={22} />
              Přidat nálepku
            </button>
            {ownReaction ? (
              <button onClick={() => onReact(message, ownReaction.key)} role="menuitem" type="button">
                <X size={22} />
                Odebrat reakci
              </button>
            ) : null}
            <button onClick={() => void onCopy(message)} role="menuitem" type="button">
              <Copy size={22} />
              Zkopírovat
            </button>
            <button onClick={() => onSelect(message)} role="menuitem" type="button">
              <CheckCheck size={22} />
              Vybrat
            </button>
            {message.own ? (
              <button className="danger" onClick={() => void onDelete(message)} role="menuitem" type="button">
                <Trash2 size={22} />
                Odstranit
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function NotificationToggleButton({
  busy,
  state,
  onEnable
}: {
  busy: boolean;
  state: WebPushUiState;
  onEnable: () => void;
}) {
  if (state.permission === "unsupported") {
    return null;
  }
  const enabled = state.registered;
  const blocked = state.permission === "denied";
  const label = notificationButtonLabel(state);
  return (
    <button
      className={clsx("round-icon", enabled && "active")}
      disabled={busy}
      onClick={onEnable}
      title={label}
      type="button"
      aria-label={label}
    >
      {busy ? <Loader2 className="spin" size={21} /> : blocked ? <BellOff size={21} /> : <Bell size={21} />}
    </button>
  );
}

function HistoryLoader({ exhausted, loading, onLoad }: { exhausted: boolean; loading: boolean; onLoad: () => void }) {
  if (exhausted) {
    return <div className="history-loader done">Začátek historie</div>;
  }
  return (
    <div className="history-loader">
      <button disabled={loading} onClick={onLoad} type="button">
        {loading ? <Loader2 className="spin" size={15} /> : <ChevronUp size={15} />}
        {loading ? "Načítám historii" : "Načíst starší zprávy"}
      </button>
    </div>
  );
}

export function Composer({
  aiAgentAvailable,
  aiLocationActive,
  aiLocationBusy,
  disabled,
  embedded,
  liveLocationActive,
  pendingAttachment,
  replyTo,
  sending,
  showJumpToLatest,
  onAttachmentClear,
  onAttachmentPick,
  onReplyClear,
  onSend,
  onJumpToLatest,
  onUseAiLocation,
  onShareLocation,
  onStartLiveLocation,
  onStopLiveLocation
}: {
  aiAgentAvailable: boolean;
  aiLocationActive: boolean;
  aiLocationBusy: boolean;
  disabled: boolean;
  embedded: boolean;
  liveLocationActive: boolean;
  pendingAttachment: PendingChatAttachment | null;
  replyTo: MatrixTimelineMessage | null;
  sending: boolean;
  showJumpToLatest: boolean;
  onAttachmentClear: () => void;
  onAttachmentPick: (kind: MatrixAttachmentKind) => void;
  onReplyClear: () => void;
  onSend: (text: string) => Promise<boolean> | void;
  onJumpToLatest: () => void;
  onUseAiLocation: () => void;
  onShareLocation: () => void;
  onStartLiveLocation: (durationSeconds: number) => void;
  onStopLiveLocation: () => void;
}) {
  // The draft text lives locally so typing re-renders only the Composer, not the
  // whole ChatApp tree (timeline, chat list, panels). The draft intentionally
  // persists across chat switches, matching the previous shared-state behavior.
  const [text, setText] = React.useState("");
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [suggestionsDismissedFor, setSuggestionsDismissedFor] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const canSend = Boolean(text.trim() || pendingAttachment) && !disabled;
  const canSubmit = canSend && !sending;
  const suggestions = composerSuggestions(text, aiAgentAvailable);
  const visibleSuggestions = suggestionsDismissedFor === text ? [] : suggestions;
  const quickActions = composerQuickActions(aiAgentAvailable);
  const submitDraft = async () => {
    if (!canSubmit) {
      return;
    }
    const submittedText = text;
    const result = await onSend(submittedText);
    if (result !== false) {
      setText((current) => (current === submittedText ? "" : current));
      setSuggestionsDismissedFor(null);
    }
  };
  const focusTextarea = React.useCallback(() => {
    textareaRef.current?.focus();
  }, []);
  const syncTextareaHeight = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 22;
    const maxHeight = Math.ceil(lineHeight * 6);
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  React.useLayoutEffect(() => {
    syncTextareaHeight();
  }, [syncTextareaHeight, text, pendingAttachment, replyTo]);

  React.useEffect(() => {
    if (disabled) {
      setToolsOpen(false);
    }
  }, [disabled]);

  const runComposerTool = (action: () => void) => {
    setToolsOpen(false);
    action();
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submitDraft();
      }}
    >
      {replyTo ? (
        <div className="reply-composer">
          <span>
            <strong>Odpověď na {replyTo.own ? "vás" : (replyTo.senderDisplayName ?? "člena")}</strong>
            <small>{messagePreviewText(replyTo)}</small>
          </span>
          <button className="round-icon small" onClick={onReplyClear} type="button" aria-label="Zrušit odpověď">
            <X size={15} />
          </button>
        </div>
      ) : null}
      {pendingAttachment ? (
        <div className="pending-attachment">
          {pendingAttachment.previewUrl && pendingAttachment.kind === "image" ? (
            <img alt="" src={pendingAttachment.previewUrl} />
          ) : null}
          {pendingAttachment.previewUrl && pendingAttachment.kind === "video" ? (
            <video muted src={pendingAttachment.previewUrl} />
          ) : null}
          {!pendingAttachment.previewUrl ? (
            <span className="file-thumb">{attachmentIcon(pendingAttachment.kind)}</span>
          ) : null}
          <span>
            <strong>{pendingAttachment.file.name || attachmentKindLabel(pendingAttachment.kind)}</strong>
            <small>{formatBytes(pendingAttachment.file.size)}</small>
          </span>
          <button className="round-icon small" onClick={onAttachmentClear} type="button" aria-label="Odebrat přílohu">
            <X size={15} />
          </button>
        </div>
      ) : null}
      {visibleSuggestions.length > 0 ? (
        <div className="composer-suggestions" role="listbox" aria-label="Nápověda příkazů">
          {visibleSuggestions.map((suggestion) => (
            <button
              key={suggestion.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setText(suggestion.value);
                setSuggestionsDismissedFor(null);
                focusTextarea();
              }}
              role="option"
              type="button"
            >
              <span>{suggestion.label}</span>
              <small>{suggestion.description}</small>
            </button>
          ))}
        </div>
      ) : null}
      {quickActions.length > 0 && visibleSuggestions.length === 0 ? (
        <div className="composer-ai-quickbar" aria-label="Rychlé AI akce">
          <span className="composer-ai-ready">
            <Sparkles size={15} />
            COP AI
          </span>
          {quickActions.map((action) => (
            <button
              aria-label={action.description}
              disabled={disabled}
              key={action.value}
              onClick={() => {
                setText(action.value);
                setSuggestionsDismissedFor(null);
                focusTextarea();
              }}
              title={action.description}
              type="button"
            >
              {action.kind === "fast" ? (
                <Send size={14} />
              ) : action.kind === "reasoning" ? (
                <Search size={14} />
              ) : action.kind === "situation" ? (
                <ShieldCheck size={14} />
              ) : (
                <Sparkles size={14} />
              )}
              <span>{action.label}</span>
            </button>
          ))}
          {!embedded ? (
            <button
              aria-label={aiLocationActive ? "Aktualizovat polohu pro AI dotazy" : "Použít moji polohu pro AI dotazy"}
              aria-pressed={aiLocationActive}
              className={clsx("ai-location-chip", aiLocationActive && "active")}
              disabled={disabled || aiLocationBusy}
              onClick={onUseAiLocation}
              title={
                aiLocationActive
                  ? "AI používá tuto polohu jen jako dočasný kontext dotazu."
                  : "Zaměří polohu pro dotazy typu nejbližší policie."
              }
              type="button"
            >
              {aiLocationBusy ? <Loader2 className="spin" size={14} /> : <MapPin size={14} />}
              <span>{aiLocationActive ? "AI poloha" : "Moje poloha"}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="composer-row">
        <div className="composer-tools">
          <button
            aria-expanded={toolsOpen}
            aria-haspopup="menu"
            aria-label="Přílohy a poloha"
            className={clsx("round-icon", toolsOpen && "active")}
            disabled={disabled}
            onClick={() => setToolsOpen((current) => !current)}
            type="button"
          >
            <Plus size={24} />
          </button>
          {toolsOpen ? (
            <div className="composer-tools-popover" role="menu" aria-label="Přílohy a poloha">
              <button onClick={() => runComposerTool(() => onAttachmentPick("image"))} role="menuitem" type="button">
                <ImageIcon size={18} />
                Fotografie
              </button>
              <button onClick={() => runComposerTool(() => onAttachmentPick("video"))} role="menuitem" type="button">
                <Video size={18} />
                Video
              </button>
              <button onClick={() => runComposerTool(() => onAttachmentPick("file"))} role="menuitem" type="button">
                <FileText size={18} />
                Dokument nebo soubor
              </button>
              <button onClick={() => runComposerTool(onShareLocation)} role="menuitem" type="button">
                <MapPin size={18} />
                Odeslat aktuální polohu
              </button>
              {liveLocationDurationOptions.map((option) => (
                <button
                  disabled={liveLocationActive}
                  key={option.seconds}
                  onClick={() => runComposerTool(() => onStartLiveLocation(option.seconds))}
                  role="menuitem"
                  type="button"
                >
                  <Navigation size={18} />
                  Sdílet živou polohu · {option.label}
                </button>
              ))}
              {liveLocationActive ? (
                <button
                  className="danger"
                  onClick={() => runComposerTool(onStopLiveLocation)}
                  role="menuitem"
                  type="button"
                >
                  <X size={18} />
                  Ukončit sdílení polohy
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          className="round-icon desktop-tool"
          disabled={disabled}
          onClick={() => onAttachmentPick("image")}
          type="button"
          aria-label="Fotka"
        >
          <ImageIcon size={21} />
        </button>
        <button
          className="round-icon desktop-tool"
          disabled={disabled}
          onClick={() => onShareLocation()}
          type="button"
          aria-label="Poloha"
        >
          <MapPin size={21} />
        </button>
        <div
          className="message-input"
          onClick={() => {
            setToolsOpen(false);
            focusTextarea();
          }}
        >
          <Smile size={21} />
          <textarea
            ref={textareaRef}
            aria-label="Zpráva"
            autoCapitalize="sentences"
            autoComplete="off"
            disabled={disabled}
            enterKeyHint="send"
            inputMode="text"
            onChange={(event) => {
              setText(event.target.value);
              setSuggestionsDismissedFor(null);
              syncTextareaHeight();
            }}
            onBlur={() => {
              setSuggestionsDismissedFor(text);
            }}
            onFocus={() => {
              setSuggestionsDismissedFor(null);
              syncTextareaHeight();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && visibleSuggestions.length > 0) {
                event.preventDefault();
                setSuggestionsDismissedFor(text);
                return;
              }
              if ((event.key === "Tab" || event.key === "Enter") && visibleSuggestions.length > 0) {
                event.preventDefault();
                setText(visibleSuggestions[0]?.value ?? text);
                setSuggestionsDismissedFor(null);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitDraft();
              }
            }}
            placeholder={disabled ? "Chat není připravený" : "Zpráva"}
            rows={1}
            spellCheck
            value={text}
          />
          {showJumpToLatest ? (
            <button
              aria-label="Přejít na konec chatu"
              className="composer-jump-latest"
              onClick={(event) => {
                event.stopPropagation();
                onJumpToLatest();
              }}
              type="button"
            >
              <ArrowDown size={18} />
            </button>
          ) : null}
        </div>
        <button
          className="send-button"
          disabled={!canSubmit}
          type="submit"
          aria-label={canSend ? "Odeslat" : "Hlasová zpráva"}
        >
          {sending ? <Clock3 size={21} /> : canSend ? <Send size={21} /> : <Mic size={22} />}
        </button>
      </div>
    </form>
  );
}

interface ComposerSuggestion {
  description: string;
  label: string;
  value: string;
}

interface ComposerQuickAction extends ComposerSuggestion {
  kind: "ai" | "fast" | "reasoning" | "situation";
}

export function composerSuggestions(text: string, aiAgentAvailable: boolean): ComposerSuggestion[] {
  return sharedChatComposerSuggestions(text, { aiAgentAvailable });
}

export function composerQuickActions(aiAgentAvailable: boolean): ComposerQuickAction[] {
  if (!aiAgentAvailable) {
    return [];
  }
  return [
    {
      description: "Zeptat se COP AI agenta s automatickou volbou modelu",
      kind: "ai",
      label: "AI dotaz",
      value: "/ai "
    },
    {
      description: "Shrnout důležité body, rozhodnutí a nejasnosti",
      kind: "fast",
      label: "Shrnout",
      value: "/souhrn "
    },
    {
      description: "Vyhodnotit rizika, nejistoty a chybějící informace",
      kind: "reasoning",
      label: "Rizika",
      value: "/rizika "
    },
    {
      description: "Najít místo nebo objekt v COP mapě",
      kind: "situation",
      label: "Najít v mapě",
      value: "/mapa "
    }
  ];
}

function aiChatAgentJobStatusLabel(job: AiChatAgentJobResponse): string {
  switch (job.status) {
    case "queued":
      return "AI dotaz je ve frontě...";
    case "running":
      return "AI agent zpracovává COP kontext...";
    case "completed":
      return "AI odpověď je připravená.";
    case "failed":
      return job.error?.message ? `AI dotaz selhal: ${job.error.message}` : "AI dotaz selhal.";
  }
  return "AI agent zpracovává dotaz...";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function MessageRow({
  activeSearchMatch,
  focused,
  grouped,
  matrixSession,
  message,
  replyToMessage,
  searchQuery,
  selectable,
  selected,
  senderLabel,
  onDownloadAttachment,
  onAskAiFollowUp,
  onOpenActions,
  onOpenPreview,
  onReact,
  onToggleSelected
}: {
  activeSearchMatch: boolean;
  focused: boolean;
  grouped: boolean;
  matrixSession: MatrixMessagingSession | null;
  message: MatrixTimelineMessage;
  replyToMessage: MatrixTimelineMessage | null;
  searchQuery: string;
  selectable: boolean;
  selected: boolean;
  senderLabel: string;
  onDownloadAttachment: (message: MatrixTimelineMessage) => void;
  onAskAiFollowUp: (question: string) => void;
  onOpenActions: (
    message: MatrixTimelineMessage,
    rect: DOMRect,
    stickerTrayOpen?: boolean,
    mode?: MessageActionPopoverState["mode"]
  ) => void;
  onOpenPreview: (item: MediaPreviewItem) => void;
  onReact: (message: MatrixTimelineMessage, key: string) => void;
  onToggleSelected: (messageId: string) => void;
}) {
  const rowRef = React.useRef<HTMLElement | null>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const longPressHandledRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const hasReactions = Boolean(message.reactions?.length);
  const hasAiMetadata = Boolean(message.cop?.kind) || isAiAgentFallbackMessage(message);
  const presentedAsOwn = message.own && !isAiAgentFallbackMessage(message);

  const clearLongPressTimer = React.useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, []);

  React.useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  function openActions(stickerTrayOpen = false, mode: MessageActionPopoverState["mode"] = "actions") {
    const rect =
      rowRef.current?.querySelector(".message-bubble")?.getBoundingClientRect() ??
      rowRef.current?.getBoundingClientRect();
    if (rect) {
      onOpenActions(message, rect, stickerTrayOpen, mode);
    }
  }

  return (
    <article
      ref={rowRef}
      className={clsx(
        "message-row",
        presentedAsOwn && "own",
        grouped && "grouped",
        selectable && "selectable",
        selected && "selected",
        focused && "action-focused",
        activeSearchMatch && "search-active",
        hasReactions && "has-reactions",
        hasAiMetadata && "ai-message"
      )}
      data-message-id={message.eventId}
      onClick={(event) => {
        if (longPressHandledRef.current) {
          longPressHandledRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (selectable) {
          onToggleSelected(message.eventId);
          return;
        }
        if (isInteractiveMessageTarget(event.target)) {
          return;
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (selectable || isInteractiveMessageTarget(event.target)) {
          return;
        }
        openActions(false);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" || selectable || isInteractiveMessageTarget(event.target)) {
          return;
        }
        clearLongPressTimer();
        longPressHandledRef.current = false;
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
          longPressHandledRef.current = true;
          openActions(false);
        }, 460);
      }}
      onPointerLeave={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") {
          return;
        }
        const start = pointerStartRef.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
          clearLongPressTimer();
        }
      }}
      onPointerUp={clearLongPressTimer}
    >
      {selectable ? (
        <button
          className="message-select"
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected(message.eventId);
          }}
          type="button"
          aria-label={selected ? "Zrušit výběr zprávy" : "Vybrat zprávu"}
        >
          {selected ? <CheckCheck size={17} /> : null}
        </button>
      ) : null}
      <div className="message-bubble">
        {!presentedAsOwn && !grouped ? <span className="sender-name">{senderLabel}</span> : null}
        {hasAiMetadata ? <MessageAiMetadata message={message} /> : null}
        {replyToMessage ? <ReplyPreview message={replyToMessage} /> : null}
        {message.kind === "location" && message.location ? (
          <LocationMessage message={message} onOpenPreview={onOpenPreview} />
        ) : message.kind === "transit" && message.transit ? (
          <TransitMessage message={message} />
        ) : message.attachment ? (
          <AttachmentMessage
            matrixSession={matrixSession}
            message={message}
            onDownloadAttachment={onDownloadAttachment}
            onOpenPreview={onOpenPreview}
          />
        ) : hasAiMetadata ? (
          <>
            <AiMarkdownOutput query={searchQuery} text={aiMessageDisplayBody(message)} />
            <MessageAiMapActions
              actions={aiMapActionsForMessage(message)}
              responsePlaybook={message.cop?.ai?.responsePlaybook}
            />
            <MessageAiFollowUps conversation={message.cop?.ai?.conversation} onAsk={onAskAiFollowUp} />
          </>
        ) : (
          <HighlightedMessageText query={searchQuery} text={messageDisplayBody(message)} />
        )}
        <span className="message-time">
          {formatTime(message.timestamp)}
          {presentedAsOwn ? <CheckCheck size={15} /> : null}
        </span>
        {message.reactions?.length ? (
          <MessageReactions
            message={message}
            reactions={message.reactions}
            onOpenActions={onOpenActions}
            onReact={onReact}
          />
        ) : null}
        {!selectable ? (
          <span className="message-hover-actions" aria-label="Akce zprávy">
            <button
              onClick={(event) => {
                event.stopPropagation();
                openActions(false, "reactions");
              }}
              type="button"
              aria-label="Reagovat na zprávu"
            >
              <Smile size={16} />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                openActions(false);
              }}
              type="button"
              aria-label="Otevřít menu zprávy"
            >
              <ChevronDown size={16} />
            </button>
          </span>
        ) : null}
      </div>
    </article>
  );
}

function MessageAiFollowUps({
  conversation,
  onAsk
}: {
  conversation?: MatrixCopAiConversationMetadata;
  onAsk: (question: string) => void;
}) {
  const suggestions = conversation?.followUpSuggestions?.slice(0, 2) ?? [];
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <div className="message-ai-followups" aria-label="Možné navazující dotazy">
      {suggestions.map((suggestion) => (
        <button
          className="message-ai-followup"
          key={suggestion.id}
          onClick={(event) => {
            event.stopPropagation();
            onAsk(suggestion.question);
          }}
          type="button"
        >
          <Sparkles size={13} />
          <span>{suggestion.label}</span>
        </button>
      ))}
    </div>
  );
}

function aiMessageDisplayBody(message: MatrixTimelineMessage): string {
  const body = messageDisplayBody(message);
  if (!message.cop?.ai?.conversation?.followUpSuggestions?.length) {
    return body;
  }
  return body.replace(/\n\nMůžete navázat:\s*.+$/isu, "").trimEnd();
}

function MessageAiMapActions({
  actions,
  responsePlaybook
}: {
  actions?: MatrixCopMapAction[];
  responsePlaybook?: MatrixCopAiResponsePlaybookMetadata;
}) {
  const visibleActions = aiMapActionsAllowedByPlaybook(actions ?? [], responsePlaybook);
  if (visibleActions.length === 0) {
    return null;
  }
  return (
    <div className="message-ai-actions" aria-label="Mapové akce AI odpovědi">
      {visibleActions.flatMap((action, index) => {
        const key = `${action.entityId ?? action.title ?? "map"}-${index}`;
        const routeEnabled = shouldOfferRouteForAiMapAction(action, responsePlaybook);
        const baseOptions = {
          category: action.category,
          featureId: action.entityId,
          featureKind: chatCenterFeatureKindFromAiAction(action),
          label: action.title ?? action.label,
          layerId: action.layerId,
          sourceName: action.sourceName,
          sourceSystemIds: action.sourceSystemIds,
          zoom: action.zoom
        };
        return [
          <button
            key={`${key}:focus`}
            className="message-ai-map-action"
            onClick={(event) => {
              event.stopPropagation();
              openCopMapFocus(encodeChatCenterLocation(action.lat, action.lon, baseOptions));
            }}
            type="button"
          >
            <MapPin size={14} />
            <span>{action.label || "Zobrazit na mapě"}</span>
          </button>,
          routeEnabled ? (
            <button
              key={`${key}:route`}
              className="message-ai-map-action"
              onClick={(event) => {
                event.stopPropagation();
                openCopMapFocus(encodeChatCenterLocation(action.lat, action.lon, { ...baseOptions, action: "route" }));
              }}
              type="button"
            >
              <Navigation size={14} />
              <span>Trasa: {action.title ?? stripMapActionPrefix(action.label)}</span>
            </button>
          ) : null
        ].filter(Boolean);
      })}
    </div>
  );
}

function openCopMapFocus(focus: ReturnType<typeof encodeChatCenterLocation>): void {
  if (window.parent !== window && new URLSearchParams(window.location.search).get("embedded") === "1") {
    window.parent.postMessage(focus, window.location.origin);
    return;
  }
  window.open(encodeCopMapFocusUrl(new URL("/", window.location.origin), focus), "_self", "noopener,noreferrer");
}

function stripMapActionPrefix(label: string): string {
  return label.replace(/^Zobrazit na mapě:\s*/iu, "").trim() || "cíl";
}

export function aiMapActionsAllowedByPlaybook(
  actions: MatrixCopMapAction[],
  responsePlaybook?: MatrixCopAiResponsePlaybookMetadata
): MatrixCopMapAction[] {
  const allowedActions = normalizedPlaybookActions(responsePlaybook?.allowedActions);
  if (allowedActions && !allowedActions.has("focus-map")) {
    return [];
  }
  const forbiddenActions = normalizedPlaybookActions(responsePlaybook?.forbiddenActions);
  if (forbiddenActions?.has("focus-map")) {
    return [];
  }
  const limit = aiResponsePlaybookIsWeather(responsePlaybook) ? 1 : 3;
  return actions.filter((action) => Number.isFinite(action.lat) && Number.isFinite(action.lon)).slice(0, limit);
}

export function shouldOfferRouteForAiMapAction(
  action: MatrixCopMapAction,
  responsePlaybook?: MatrixCopAiResponsePlaybookMetadata
): boolean {
  const forbiddenActions = normalizedPlaybookActions(responsePlaybook?.forbiddenActions);
  if (forbiddenActions?.has("route")) {
    return false;
  }
  const allowedActions = normalizedPlaybookActions(responsePlaybook?.allowedActions);
  if (allowedActions) {
    return allowedActions.has("route");
  }
  const haystack = normalizeAiMapActionText(
    [
      action.category,
      action.entityType,
      action.label,
      action.layerId,
      action.sourceName,
      action.sourceSystemIds?.join(" "),
      action.title
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (!haystack) {
    return true;
  }
  return !/\b(?:air_quality|boundary|coverage|forecast|meteogram|pocasi|precipitation|radar|rain|srazk|teplot|temperature|weather|wind)\b/u.test(
    haystack
  );
}

function normalizedPlaybookActions(actions: string[] | undefined): Set<string> | undefined {
  if (!actions || actions.length === 0) {
    return undefined;
  }
  const normalized = actions.map((action) => action.trim().toLocaleLowerCase("cs-CZ")).filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : undefined;
}

function aiResponsePlaybookIsWeather(responsePlaybook: MatrixCopAiResponsePlaybookMetadata | undefined): boolean {
  const domain = responsePlaybook?.domain?.trim().toLocaleLowerCase("cs-CZ");
  const intentId = responsePlaybook?.intentId?.trim().toLocaleLowerCase("cs-CZ");
  return domain === "weather" || Boolean(intentId?.startsWith("weather."));
}

function normalizeAiMapActionText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ");
}

export function aiMapActionsForMessage(message: MatrixTimelineMessage): MatrixCopMapAction[] | undefined {
  const metadataActions = (message.cop?.ai?.mapActions ?? [])
    .filter((action) => Number.isFinite(action.lat) && Number.isFinite(action.lon))
    .slice(0, 3);
  if (metadataActions.length > 0) {
    return metadataActions;
  }
  if (!message.cop?.kind && !isAiAgentFallbackMessage(message)) {
    return undefined;
  }
  return aiMapActionsFromMessageBody(messageDisplayBody(message));
}

function aiMapActionsFromMessageBody(body: string): MatrixCopMapAction[] | undefined {
  const coordinates = body.match(
    /(?:souřadnice|souradnice|coordinates)\s*:\s*(-?\d{1,2}(?:[.,]\d+)?)\s*,\s*(-?\d{1,3}(?:[.,]\d+)?)/iu
  );
  if (!coordinates) {
    return undefined;
  }
  const lat = finiteCoordinate(coordinates[1]?.replace(",", "."), -90, 90);
  const lon = finiteCoordinate(coordinates[2]?.replace(",", "."), -180, 180);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  const title =
    optionalAiText(body.match(/Našel jsem[\s\S]*?:\s*(?<title>[\s\S]*?)\.\s+Kategorie:/iu)?.groups?.title) ??
    optionalAiText(body.match(/^\s*(?<title>[^\n.]{8,180})/u)?.groups?.title) ??
    "Mapový výsledek";
  const distanceText = optionalAiText(
    body.match(/Vzdálenost[^:]*:\s*(?<distance>[0-9]+(?:[,.][0-9]+)?\s*(?:km|m))/iu)?.groups?.distance
  );
  return [
    {
      action: "focus-map",
      ...(distanceText ? { distanceText } : {}),
      label: distanceText ? `Zobrazit na mapě: ${title} (${distanceText})` : `Zobrazit na mapě: ${title}`,
      lat,
      lon,
      title,
      zoom: 16
    }
  ];
}

function chatCenterFeatureKindFromAiAction(action: MatrixCopMapAction): "feature" | "place" | "track" | undefined {
  if (action.entityType === "mapFeature") {
    return "feature";
  }
  if (action.entityType === "place") {
    return "place";
  }
  if (action.entityType === "track") {
    return "track";
  }
  return undefined;
}

function MessageAiMetadata({ message }: { message: MatrixTimelineMessage }) {
  const ai = message.cop?.ai;
  const title = message.cop?.kind === "ai-situation-summary" ? "AI situační souhrn" : "COP AI agent";
  const status = ai?.status ? aiStatusLabel(ai.status) : null;
  const provider = [ai?.provider, ai?.model].filter(Boolean).join(" / ");
  return (
    <div className="message-ai-metadata">
      <span className="message-ai-title">
        <Sparkles size={14} />
        <strong>{title}</strong>
        {status ? <em>{status}</em> : null}
      </span>
      {ai?.question ? (
        <span className="message-ai-question">
          <small>Dotaz</small>
          {ai.question}
        </span>
      ) : null}
      {aiEvidenceMetadataLabel(ai) ? <span className="message-ai-sources">{aiEvidenceMetadataLabel(ai)}</span> : null}
      {ai?.auditId || ai?.policyReason || provider ? (
        <details className="message-ai-audit">
          <summary>Technické podrobnosti</summary>
          <span>
            {ai?.auditId ? <span>Audit {shortAuditId(ai.auditId)}</span> : null}
            {provider ? <span>{provider}</span> : null}
            {ai?.policyReason ? <span>{ai.policyReason}</span> : null}
          </span>
        </details>
      ) : null}
    </div>
  );
}

function shortAuditId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function ReplyPreview({ message }: { message: MatrixTimelineMessage }) {
  return (
    <span className="message-reply-preview">
      <strong>{message.own ? "Vy" : (message.senderDisplayName ?? "Člen")}</strong>
      <small>{messagePreviewText(message)}</small>
    </span>
  );
}

function MessageReactions({
  message,
  reactions,
  onOpenActions,
  onReact
}: {
  message: MatrixTimelineMessage;
  reactions: NonNullable<MatrixTimelineMessage["reactions"]>;
  onOpenActions: (
    message: MatrixTimelineMessage,
    rect: DOMRect,
    stickerTrayOpen?: boolean,
    mode?: MessageActionPopoverState["mode"]
  ) => void;
  onReact: (message: MatrixTimelineMessage, key: string) => void;
}) {
  return (
    <span className="message-reactions" aria-label="Reakce">
      {reactions.map((reaction) => (
        <button
          className={reaction.own ? "own" : ""}
          key={reaction.key}
          onClick={(event) => {
            event.stopPropagation();
            if (reaction.own) {
              onOpenActions(message, event.currentTarget.getBoundingClientRect(), true, "reactions");
              return;
            }
            onReact(message, reaction.key);
          }}
          title={reaction.senders.join(", ")}
          type="button"
        >
          <span>{reaction.key}</span>
          <small>{reaction.count}</small>
        </button>
      ))}
    </span>
  );
}

function HighlightedMessageText({ query, text }: { query: string; text: string }) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return <span className="message-text">{text}</span>;
  }
  const parts = splitTextByQuery(text, normalizedQuery);
  return (
    <span className="message-text">
      {parts.map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <React.Fragment key={index}>{part.text}</React.Fragment>
      )}
    </span>
  );
}

function AttachmentMessage({
  matrixSession,
  message,
  onDownloadAttachment,
  onOpenPreview
}: {
  matrixSession: MatrixMessagingSession | null;
  message: MatrixTimelineMessage;
  onDownloadAttachment: (message: MatrixTimelineMessage) => void;
  onOpenPreview: (item: MediaPreviewItem) => void;
}) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(() => directBrowserMediaUrl(message));
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const attachment = message.attachment;
  const canRenderMedia = message.kind === "image" || message.kind === "video";
  const thumbnailUrl = directBrowserThumbnailUrl(message);
  const showCaption = Boolean(attachment && message.body && message.body !== attachment.fileName);

  React.useEffect(() => {
    if (!attachment || !matrixSession || !canRenderMedia || objectUrl || thumbnailUrl) {
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    matrixSession
      .downloadAttachment(message)
      .then((blob) => {
        if (!cancelled) {
          setObjectUrl(window.URL.createObjectURL(blob));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, canRenderMedia, matrixSession, message, objectUrl, thumbnailUrl]);

  React.useEffect(
    () => () => {
      if (objectUrl?.startsWith("blob:")) {
        window.URL.revokeObjectURL(objectUrl);
      }
    },
    [objectUrl]
  );

  if (!attachment) {
    return null;
  }

  const preview = matrixMessagePreviewItem(
    message,
    objectUrl ?? undefined,
    thumbnailUrl ?? undefined,
    matrixSession && attachment ? () => matrixSession.downloadAttachment(message) : undefined
  );
  return (
    <>
      {showCaption ? <span className="message-text">{message.body}</span> : null}
      <div className={clsx("attachment-card", message.kind)}>
        <button
          className="attachment-preview"
          onClick={() => onOpenPreview(preview)}
          type="button"
          aria-label={`Otevřít ${attachment.fileName}`}
        >
          {message.kind === "image" && (objectUrl || thumbnailUrl) ? (
            <img alt="" decoding="async" loading="lazy" src={objectUrl ?? thumbnailUrl ?? ""} />
          ) : null}
          {message.kind === "video" && objectUrl ? <video muted playsInline src={objectUrl} /> : null}
          {message.kind === "video" && !objectUrl && thumbnailUrl ? (
            <span className="attachment-video-poster">
              <img alt="" decoding="async" loading="lazy" src={thumbnailUrl} />
              <span>
                <Video size={18} /> Video
              </span>
            </span>
          ) : null}
          {message.kind === "image" && !objectUrl && !thumbnailUrl ? (
            <PreviewPlaceholder loading={loading} failed={failed} icon={<ImageIcon size={22} />} />
          ) : null}
          {message.kind === "video" && !objectUrl && !thumbnailUrl ? (
            <PreviewPlaceholder loading={loading} failed={failed} icon={<Video size={22} />} />
          ) : null}
          {message.kind === "file" ? (
            <DocumentThumb contentType={attachment.contentType} fileName={attachment.fileName} />
          ) : null}
        </button>
        <span className="attachment-copy">
          <strong>{attachment.fileName}</strong>
          <small>{attachmentMeta(message)}</small>
        </span>
        <button
          className="round-icon small"
          onClick={() => onDownloadAttachment(message)}
          type="button"
          aria-label="Stáhnout"
        >
          <Download size={16} />
        </button>
      </div>
    </>
  );
}

function PreviewPlaceholder({ failed, icon, loading }: { failed: boolean; icon: React.ReactNode; loading: boolean }) {
  return (
    <span className={clsx("preview-placeholder", loading && "loading", failed && "failed")}>
      {icon}
      <small>{failed ? "Náhled nelze načíst" : loading ? "Načítám" : "Náhled"}</small>
    </span>
  );
}

function LocationMessage({
  message,
  onOpenPreview
}: {
  message: MatrixTimelineMessage;
  onOpenPreview: (item: MediaPreviewItem) => void;
}) {
  const location = message.location;
  const live = location?.live;
  const now = useVisibleNow(Boolean(live?.expiresAt && live.status === "live"), 30_000);
  if (!location) {
    return null;
  }
  const remaining = live?.status === "live" ? formatLiveLocationRemaining(live.expiresAt, now) : null;
  const subtitle = live
    ? live.status === "ended"
      ? "Sdílení ukončeno"
      : `Živě · ${formatCoordinates(location)}`
    : formatCoordinates(location);
  return (
    <button
      className={clsx("location-card", live?.status === "live" && "live", live?.status === "ended" && "ended")}
      onClick={() => onOpenPreview(matrixMessagePreviewItem(message))}
      type="button"
    >
      <StaticLocationMap location={location} />
      <span>
        <strong>{location.label ?? "Sdílená poloha"}</strong>
        <small>{subtitle}</small>
        {remaining ? <em className="location-live-countdown">Zbývá {remaining}</em> : null}
      </span>
    </button>
  );
}

function TransitMessage({ message }: { message: MatrixTimelineMessage }) {
  const transit = message.transit;
  if (!transit) {
    return null;
  }
  const title = [transit.transportMode ? formatTransitModeLabel(transit.transportMode) : "Spoj", transit.routeShortName]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="transit-card">
      <span className="transit-card-icon">
        <Bus size={22} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{transit.destination ? `směr ${transit.destination}` : (transit.label ?? "Sdílený spoj")}</small>
        {transit.nextStopName ? <small>Příští zastávka: {transit.nextStopName}</small> : null}
        {transit.status ? <em>{formatTransitStatusLabel(transit.status)}</em> : null}
      </span>
    </div>
  );
}

function WelcomePane({
  authenticated,
  authConfig,
  onLogin,
  onNewChat,
  onNewGroup,
  onOpenMap
}: {
  authenticated: boolean;
  authConfig: AuthConfig;
  onLogin: () => void;
  onNewChat: () => void;
  onNewGroup: () => void;
  onOpenMap: () => void;
}) {
  return (
    <div className="welcome-pane">
      <span className="welcome-icon">
        <MessageCircle size={34} />
      </span>
      <h2>Vyberte chat</h2>
      <p>Soukromé konverzace jsou šifrované. Důležitou událost můžete kdykoli převést do situačního hlášení.</p>
      <div className="welcome-actions">
        {authenticated ? (
          <>
            <button className="primary-dialog-action" onClick={onNewChat} type="button">
              Napsat zprávu
            </button>
            <button className="secondary-dialog-action" onClick={onNewGroup} type="button">
              Založit skupinu
            </button>
          </>
        ) : isOidcEnabled(authConfig) ? (
          <button className="primary-dialog-action" onClick={onLogin} type="button">
            Přihlásit
          </button>
        ) : null}
        <button className="secondary-dialog-action" onClick={onOpenMap} type="button">
          Otevřít mapu
        </button>
      </div>
    </div>
  );
}

function ChatLockedState({
  actionLabel,
  icon,
  text,
  title,
  onAction
}: {
  actionLabel?: string;
  icon: React.ReactNode;
  text?: string;
  title: string;
  onAction?: () => void;
}) {
  return (
    <div className="chat-locked-state">
      <span>{icon}</span>
      <strong>{title}</strong>
      {text ? <p>{text}</p> : null}
      {actionLabel && onAction ? (
        <button className="primary-dialog-action" onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function VoiceCallBar({
  call,
  differentChat,
  title,
  onAnswer,
  onHangup,
  onReject,
  onToggleMute
}: {
  call: MatrixVoiceCallSnapshot;
  differentChat: boolean;
  title: string;
  onAnswer: () => void;
  onHangup: () => void;
  onReject: () => void;
  onToggleMute: () => void;
}) {
  const now = useVisibleNow(call.phase === "connected", 1_000);
  const remoteStreams = call.remoteStreams?.length ? call.remoteStreams : call.remoteStream ? [call.remoteStream] : [];

  const incomingRinging = call.direction === "incoming" && call.phase === "ringing";
  const status = voiceCallStatusText(call, now);

  return (
    <div
      className={clsx("voice-call-bar", call.phase, differentChat && "different-chat")}
      role="status"
      aria-live="polite"
    >
      {remoteStreams.map((stream) => (
        <VoiceCallRemoteAudio key={stream.id} stream={stream} />
      ))}
      <span className="voice-call-icon">
        <Phone size={18} />
      </span>
      <div className="voice-call-copy">
        <strong>{incomingRinging ? `Volá ${title}` : title}</strong>
        <span>{incomingRinging && differentChat ? "Jiný chat · po přijetí se otevře správná konverzace" : status}</span>
      </div>
      <div className="voice-call-controls">
        {incomingRinging ? (
          <>
            <button className="voice-call-control accept" onClick={onAnswer} type="button">
              Přijmout
            </button>
            <button className="voice-call-control hangup" onClick={onReject} type="button">
              Odmítnout
            </button>
          </>
        ) : (
          <>
            <button className="voice-call-control" onClick={onToggleMute} type="button">
              {call.microphoneMuted ? <MicOff size={17} /> : <Mic size={17} />}
              {call.microphoneMuted ? "Zapnout" : "Ztlumit"}
            </button>
            <button
              className="voice-call-control hangup icon-only"
              onClick={onHangup}
              type="button"
              aria-label="Ukončit hovor"
            >
              <PhoneOff size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function VoiceCallRemoteAudio({ stream }: { stream: MediaStream }) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    return () => {
      audio.srcObject = null;
    };
  }, [stream]);
  return <audio ref={audioRef} autoPlay playsInline />;
}

export function voiceCallRoomToFocusAfterAnswer(callRoomId: string, selectedRoomId: string | null): string | null {
  return callRoomId !== selectedRoomId ? callRoomId : null;
}

function voiceCallStatusText(call: MatrixVoiceCallSnapshot, now: number): string {
  if (call.error || call.phase === "failed") {
    return call.error ?? "Hovor se nepodařilo spojit.";
  }
  if (call.phase === "ringing") {
    return call.direction === "incoming" ? "Příchozí hlasový hovor" : "Vyzváním...";
  }
  if (call.phase === "connected" && call.startedAt) {
    const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(call.startedAt)) / 1_000));
    return `Spojeno ${formatVoiceCallDuration(elapsedSeconds)}`;
  }
  if (call.phase === "ended") {
    return "Hovor ukončen.";
  }
  return call.direction === "incoming" ? "Připravuji hovor..." : "Spojuji hovor...";
}

function userFacingVoiceCallError(error: unknown, fallback: string): string {
  if (isVoiceCallMicrophoneAccessError(error)) {
    return voiceCallMicrophoneAccessErrorMessage(error);
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function isVoiceCallMicrophoneAccessError(error: unknown): boolean {
  const isDomException = typeof DOMException !== "undefined" && error instanceof DOMException;
  const name = isDomException ? error.name : error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  return (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "AbortError" ||
    /denied|permission|not allowed|no_user_media|user media|microphone|mikrofon/iu.test(message)
  );
}

function voiceCallMicrophoneAccessErrorMessage(error: unknown): string {
  const isDomException = typeof DOMException !== "undefined" && error instanceof DOMException;
  const name = isDomException ? error.name : error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "iPhone nehlásí dostupný mikrofon. Zkontrolujte, že mikrofon není omezený systémem nebo profilem zařízení.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Mikrofon se nepodařilo otevřít. Zkontrolujte, že ho právě nepoužívá jiná aplikace, a zkuste hovor znovu.";
  }
  if (name === "AbortError") {
    return "Žádost o mikrofon byla přerušena. Klepněte na Přijmout nebo Volat znovu.";
  }
  if (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    /denied|permission|not allowed|no_user_media|user media|microphone|mikrofon/iu.test(message)
  ) {
    return "Mikrofon je pro COP zakázaný. V iOS povolte mikrofon pro Safari nebo pro web cop.zeleznalady.cz, potom PWA úplně zavřete a otevřete znovu.";
  }
  return "Mikrofon není dostupný nebo nemá povolený přístup.";
}

function formatVoiceCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function StatusBanner({
  actionLabel,
  kind,
  text,
  onAction,
  onClose
}: {
  actionLabel?: string;
  kind?: "error";
  text: string;
  onAction?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className={clsx("status-banner", kind === "error" && "error")} role={kind === "error" ? "alert" : "status"}>
      {kind === "error" ? <AlertCircle size={17} /> : <ShieldCheck size={17} />}
      <span>{text}</span>
      {actionLabel && onAction ? (
        <button className="status-banner-action" onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
      {onClose ? (
        <button className="round-icon small" onClick={onClose} type="button" aria-label="Zavřít">
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}

function ListPrompt({
  actionLabel,
  secondaryAction,
  text,
  title,
  onAction
}: {
  actionLabel?: string;
  secondaryAction?: { href?: string; label: string; onClick?: () => void };
  text?: string;
  title: string;
  onAction?: () => void;
}) {
  return (
    <div className="list-prompt">
      <MessageCircle size={24} />
      <strong>{title}</strong>
      {text ? <p>{text}</p> : null}
      <div className="list-prompt-actions">
        {actionLabel && onAction ? (
          <button onClick={onAction} type="button">
            {actionLabel}
          </button>
        ) : null}
        {secondaryAction?.href ? (
          <a href={secondaryAction.href}>{secondaryAction.label}</a>
        ) : secondaryAction?.onClick ? (
          <button className="secondary" onClick={secondaryAction.onClick} type="button">
            {secondaryAction.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => (
        <div className="chat-skeleton" key={index}>
          <span />
          <div>
            <b />
            <small />
          </div>
        </div>
      ))}
    </>
  );
}

function ChatInfoPanel({
  activeChat,
  authSession,
  ownAvatarUrl,
  aiAgentUpdating,
  canAddMember,
  conversation,
  deviceDiagnostics,
  group,
  mediaAccessToken,
  mediaTab,
  messages,
  messageRetentionSeconds,
  muted,
  pinned,
  tab,
  onClose,
  onAddMember,
  onAskAiAgent,
  onMediaTabChange,
  onManageChat,
  onOpenRetentionSettings,
  onOpenPreview,
  onRemoveMember,
  onTabChange,
  onToggleAiAgent,
  onToggleMute,
  onTogglePinned
}: {
  activeChat: ChatListItem;
  authSession: AuthSession;
  ownAvatarUrl?: string;
  aiAgentUpdating: boolean;
  canAddMember: boolean;
  conversation: MessagingConversationSummary | null;
  deviceDiagnostics: ChatDeviceDiagnostics;
  group: CommunityGroup | null;
  mediaAccessToken?: string;
  mediaTab: MediaPanelTab;
  messages: MatrixTimelineMessage[];
  messageRetentionSeconds: MessageRetentionSeconds;
  muted: boolean;
  pinned: boolean;
  tab: InfoPanelTab;
  onClose: () => void;
  onAddMember: () => void;
  onAskAiAgent: () => void;
  onMediaTabChange: (tab: MediaPanelTab) => void;
  onManageChat: () => void;
  onOpenRetentionSettings: () => void;
  onOpenPreview: (item: MediaPreviewItem) => void;
  onRemoveMember: (member: ChatInfoMember) => void;
  onTabChange: (tab: InfoPanelTab) => void;
  onToggleAiAgent: (enabled: boolean) => void;
  onToggleMute: () => void;
  onTogglePinned: () => void;
}) {
  const isDirect = activeChat.type === "direct";
  const aiAssistant = group ? communityGroupAiAssistantMetadata(group) : null;
  const members = infoMembersForChat(activeChat, conversation, group, authSession, ownAvatarUrl);
  const mediaMessages = messages.filter(
    (message) => message.attachment && (message.kind === "image" || message.kind === "video")
  );
  const documentMessages = messages.filter((message) => message.attachment && message.kind === "file");
  const locationMessages = messages.filter((message) => message.kind === "location" && message.location);
  const activeMediaMessages =
    mediaTab === "media" ? mediaMessages : mediaTab === "documents" ? documentMessages : locationMessages;
  const title = isDirect ? "O kontaktu" : "O skupině";
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="info-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="info-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <aside className="info-nav" aria-label="Kategorie detailu">
          <header>
            <strong>{title}</strong>
            <button className="round-icon small" onClick={onClose} type="button" aria-label="Zavřít">
              <X size={18} />
            </button>
          </header>
          <button className={tab === "info" ? "active" : ""} onClick={() => onTabChange("info")} type="button">
            <Info size={20} />
            Informace
          </button>
          <button className={tab === "media" ? "active" : ""} onClick={() => onTabChange("media")} type="button">
            <ImageIcon size={20} />
            Média a dokumenty
          </button>
          <button className={tab === "members" ? "active" : ""} onClick={() => onTabChange("members")} type="button">
            <Users size={20} />
            {isDirect ? "Kontakt" : "Členové"}
          </button>
        </aside>
        <div className="info-content">
          <header className="info-hero">
            <Avatar
              label={activeChat.title}
              mediaAccessToken={mediaAccessToken}
              src={activeChat.avatarUrl}
              variant={activeChat.avatarVariant}
            />
            <div>
              <h2>{activeChat.title}</h2>
              <p>
                {isDirect
                  ? "Přímý chat"
                  : `${activeChat.memberCount} ${activeChat.memberCount === 1 ? "člen" : activeChat.memberCount < 5 ? "členové" : "členů"}`}
              </p>
            </div>
          </header>

          {tab === "info" ? (
            <div className={clsx("info-section", isDirect && "contact-info-section")}>
              <InfoMetric label="Typ" value={isDirect ? "Soukromý chat" : "Veřejná skupina"} />
              <InfoMetric
                label="Šifrování"
                value={activeChat.room?.encrypted ? "Zapnuto pro tuto místnost" : "Připraveno při otevření místnosti"}
              />
              <InfoMetric label="Upozornění" value={muted ? "Ztlumeno" : "Zapnuto"} />
              <InfoMetric label="Připnutí" value={pinned ? "Chat je připnutý" : "Chat není připnutý"} />
              {!isDirect ? (
                <>
                  <InfoMetric label="Aplikace" value={deviceDiagnostics.pwaStandalone ? "PWA režim" : "Prohlížeč"} />
                  <InfoMetric label="Web Push" value={webPushDiagnosticsLabel(deviceDiagnostics)} />
                  <InfoMetric label="Matrix sync" value={matrixSyncDiagnosticsLabel(deviceDiagnostics)} />
                  <InfoMetric
                    label="E2EE zařízení"
                    value={deviceDiagnostics.e2eeReady ? "Připravené" : "Vyžaduje obnovu"}
                  />
                </>
              ) : null}
              <button className="info-setting-row" onClick={onOpenRetentionSettings} type="button">
                <span>
                  <Clock3 size={20} />
                  Automatické odstraňování zpráv
                </span>
                <strong>
                  {messageRetentionShortLabel(messageRetentionSeconds)}
                  <ChevronRight size={18} />
                </strong>
              </button>
              {!isDirect ? (
                <button
                  className="info-setting-row"
                  disabled={aiAgentUpdating || !canAddMember}
                  onClick={() => onToggleAiAgent(!aiAssistant?.enabled)}
                  type="button"
                >
                  <span>
                    <Sparkles size={20} />
                    AI agent ve skupině
                  </span>
                  <strong>
                    {aiAssistant?.enabled ? "Zapnutý" : canAddMember ? "Vypnutý" : "Pouze správce"}
                    <ChevronRight size={18} />
                  </strong>
                </button>
              ) : null}
              {!isDirect && aiAssistant?.enabled ? (
                <>
                  <InfoMetric label="AI Matrix bot" value={aiAssistantStatusLabel(aiAssistant)} />
                  <InfoMetric label="AI E2EE model" value={aiAssistantE2eeLabel(aiAssistant)} />
                </>
              ) : null}
              <div className="info-actions-row">
                <button onClick={onTogglePinned} type="button">
                  {pinned ? <PinOff size={18} /> : <Pin size={18} />}
                  {pinned ? "Odepnout" : "Připnout"}
                </button>
                <button onClick={onToggleMute} type="button">
                  <BellOff size={18} />
                  {muted ? "Zrušit ztlumení" : "Ztlumit"}
                </button>
                {!isDirect && canAddMember ? (
                  <button onClick={onAddMember} type="button">
                    <UserPlus size={18} />
                    Přidat člena
                  </button>
                ) : null}
                {!isDirect && aiAssistant?.enabled ? (
                  <button onClick={onAskAiAgent} type="button">
                    <Sparkles size={18} />
                    Zeptat se AI
                  </button>
                ) : null}
                <button onClick={onManageChat} type="button">
                  <Trash2 size={18} />
                  {isDirect ? "Skrýt chat" : "Správa skupiny"}
                </button>
              </div>
            </div>
          ) : null}

          {tab === "media" ? (
            <div className="info-section media-section">
              <div className="media-tabs" role="tablist" aria-label="Typ příloh">
                <button
                  className={mediaTab === "media" ? "active" : ""}
                  onClick={() => onMediaTabChange("media")}
                  type="button"
                >
                  Média
                </button>
                <button
                  className={mediaTab === "documents" ? "active" : ""}
                  onClick={() => onMediaTabChange("documents")}
                  type="button"
                >
                  Dokumenty
                </button>
                <button
                  className={mediaTab === "locations" ? "active" : ""}
                  onClick={() => onMediaTabChange("locations")}
                  type="button"
                >
                  Polohy
                </button>
              </div>
              {activeMediaMessages.length === 0 ? (
                <div className="media-empty">Zatím žádné položky.</div>
              ) : (
                <div className="media-grid">
                  {activeMediaMessages.map((message) => {
                    const mediaUrl = directBrowserMediaUrl(message);
                    const thumbnailUrl = directBrowserThumbnailUrl(message);
                    const gridImageUrl = mediaUrl ?? thumbnailUrl;
                    return (
                      <button
                        key={message.eventId}
                        onClick={() =>
                          onOpenPreview(
                            matrixMessagePreviewItem(message, mediaUrl ?? undefined, thumbnailUrl ?? undefined)
                          )
                        }
                        type="button"
                      >
                        {gridImageUrl && (message.kind === "image" || message.kind === "video") ? (
                          <img alt="" decoding="async" loading="lazy" src={gridImageUrl} />
                        ) : message.kind === "location" ? (
                          <MapPin size={24} />
                        ) : message.kind === "file" ? (
                          <FileText size={24} />
                        ) : (
                          <ImageIcon size={24} />
                        )}
                        {message.kind === "video" && gridImageUrl ? (
                          <strong className="media-grid-video-badge">
                            <Video size={14} /> Video
                          </strong>
                        ) : null}
                        <span>{mediaGridLabel(message)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {tab === "members" ? (
            <div className="info-section members-section">
              {!isDirect && canAddMember ? (
                <button className="info-setting-row" onClick={onAddMember} type="button">
                  <span>
                    <UserPlus size={20} />
                    Přidat člena
                  </span>
                  <ChevronRight size={18} />
                </button>
              ) : null}
              {members.map((member) => (
                <div className="member-row" key={member.id}>
                  <Avatar label={member.name} mediaAccessToken={mediaAccessToken} small src={member.avatarUrl} />
                  <span className="member-row-copy">
                    <strong>{member.name}</strong>
                    <small>{member.subtitle}</small>
                  </span>
                  {!isDirect &&
                  canAddMember &&
                  member.subjectId &&
                  member.subjectId !== authSession.profile?.subjectId &&
                  member.status !== "left" ? (
                    <button className="member-row-action" onClick={() => onRemoveMember(member)} type="button">
                      <UserMinus size={16} />
                      Odebrat
                    </button>
                  ) : null}
                </div>
              ))}
              {!isDirect && aiAssistant?.enabled ? (
                <div className="member-row ai-agent-member">
                  <Avatar label={aiAssistant.label} small variant="ai" />
                  <span className="member-row-copy">
                    <strong>{aiAssistant.label}</strong>
                    <small>
                      {aiAssistantStatusLabel(aiAssistant)} • {aiAssistantE2eeLabel(aiAssistant)}
                    </small>
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function InfoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function webPushDiagnosticsLabel(diagnostics: ChatDeviceDiagnostics): string {
  if (diagnostics.notificationPermission === "unsupported") {
    return "Nepodporováno";
  }
  if (diagnostics.notificationPermission === "denied") {
    return "Blokováno prohlížečem";
  }
  if (diagnostics.webPushRegistered) {
    return diagnostics.webPushSubscriptionActive === false ? "Registrováno, subscription chybí" : "Registrováno";
  }
  if (diagnostics.webPushStatus === "disabled") {
    return "Vypnuto na serveru";
  }
  if (diagnostics.webPushStatus === "degraded") {
    return "Vyžaduje kontrolu";
  }
  return diagnostics.notificationPermission === "granted" ? "Povolení uděleno, čeká registrace" : "Vypnuto";
}

function matrixSyncDiagnosticsLabel(diagnostics: ChatDeviceDiagnostics): string {
  const state =
    diagnostics.matrixSyncState && diagnostics.matrixSyncState !== "idle"
      ? diagnostics.matrixSyncState
      : diagnostics.matrixLifecycle;
  if (!diagnostics.matrixLastSyncAt) {
    return state;
  }
  return `${state} · ${new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(diagnostics.matrixLastSyncAt)}`;
}

function ConnectionDot({ state }: { state: ChatConnectionState }) {
  const label =
    state === "online"
      ? "Kontakt nebo skupina je online"
      : state === "syncing"
        ? "Stav spojení se zjišťuje"
        : "Kontakt nebo skupina není online";
  return <span className={clsx("connection-dot", state)} aria-label={label} role="img" title={label} />;
}

export function buildChatItems({
  authSubjectId,
  conversations,
  filter,
  groups,
  ownIdentityIds,
  query,
  rooms,
  selectedConversationId,
  selectedGroupId,
  selectedRoomId
}: {
  authSubjectId?: string;
  conversations: MessagingConversationSummary[];
  filter: ChatFilter;
  groups: CommunityGroup[];
  ownIdentityIds: Set<string>;
  query: string;
  rooms: MatrixRoomSummary[];
  selectedConversationId: string | null;
  selectedGroupId: string | null;
  selectedRoomId: string | null;
}): ChatListItem[] {
  const items = new Map<string, ChatListItem>();
  const byGroupId = new Map<string, string>();
  const byTitleAndType = new Map<string, string>();
  const activeGroups = groups.filter((group) => groupHasActiveMember(group, authSubjectId));

  const remember = (item: ChatListItem) => {
    items.set(item.id, item);
    if (item.group?.groupId) {
      byGroupId.set(item.group.groupId, item.id);
    }
    const groupId = item.conversation ? conversationCommunityGroupId(item.conversation) : undefined;
    if (groupId) {
      byGroupId.set(groupId, item.id);
    }
    byTitleAndType.set(titleTypeKey(item.title, item.type === "direct" ? "direct" : "group"), item.id);
  };

  conversations.forEach((conversation) => {
    const group = groupForConversation(conversation, groups);
    if (group && !groupHasActiveMember(group, authSubjectId)) {
      return;
    }
    const groupId = conversationCommunityGroupId(conversation) ?? group?.groupId;
    const roomId = conversation.matrix?.roomId ?? (group ? communityGroupMatrixRoomId(group) : undefined);
    const room = roomId ? rooms.find((item) => item.roomId === roomId) : undefined;
    const directPeer = conversationDirectPeer(conversation, authSubjectId, ownIdentityIds);
    const title = chatTitleForConversation(conversation, room, authSubjectId, ownIdentityIds);
    const roomLatest = room?.latestMessage;
    const latest = roomLatest ?? (group ? demoLatestMessageForGroup(group) : undefined);
    const id = roomId ? `room:${roomId}` : groupId ? `group:${groupId}` : `conversation:${conversation.conversationId}`;
    remember({
      active:
        selectedConversationId === conversation.conversationId ||
        selectedRoomId === conversation.matrix?.roomId ||
        selectedGroupId === group?.groupId,
      ...(conversation.type === "direct" && isAiAgentDirectConversation(conversation)
        ? { avatarVariant: "ai" as const }
        : {}),
      avatarUrl:
        room?.avatarUrl ??
        room?.directPeer?.avatarUrl ??
        conversation.avatarUrl ??
        conversation.directPeer?.avatarUrl ??
        directPeer?.avatarUrl,
      conversation,
      ...(group ? { group } : {}),
      id,
      latest,
      memberCount: group
        ? activeCommunityGroupMemberCount(group)
        : (conversation.memberCount ?? conversation.members?.length ?? 2),
      muted: false,
      pinned: false,
      preferenceKey: chatPreferenceKeyForConversation(conversation, group ?? undefined),
      preview: latest
        ? chatListMessagePreview(latest, conversation.type)
        : roomId
          ? "Nový chat"
          : "Klepnutím otevřít chat",
      ...(room ? { room } : {}),
      roomId,
      searchable: `${title} ${conversation.title} ${group?.name ?? ""} ${conversation.members?.map((member) => member.displayName ?? member.userId).join(" ") ?? ""}`,
      sortAt: timestampMillis(latest?.timestamp ?? conversation.updatedAt ?? group?.updatedAt),
      timestamp: latest
        ? formatShortTimestamp(latest.timestamp)
        : formatShortTimestamp(conversation.updatedAt ?? group?.updatedAt),
      title,
      type: conversation.type,
      unreadCount: room?.unreadCount ?? 0
    });
  });

  activeGroups.forEach((group) => {
    const groupKey = byGroupId.get(group.groupId);
    if (groupKey) {
      const current = items.get(groupKey);
      if (current && !current.group) {
        items.set(groupKey, {
          ...current,
          group,
          memberCount: activeCommunityGroupMemberCount(group) || current.memberCount,
          searchable: `${current.searchable} ${group.name} ${group.members.map((member) => member.displayName || member.username).join(" ")}`
        });
      }
      return;
    }
    const titleKey = byTitleAndType.get(titleTypeKey(group.name, "group"));
    if (titleKey) {
      const current = items.get(titleKey);
      if (current) {
        items.delete(current.id);
        const merged = {
          ...current,
          active: current.active || selectedGroupId === group.groupId,
          group,
          id: current.roomId ? `room:${current.roomId}` : `group:${group.groupId}`,
          memberCount: activeCommunityGroupMemberCount(group) || current.memberCount,
          searchable: `${current.searchable} ${group.name} ${group.members.map((member) => member.displayName || member.username).join(" ")}`
        };
        remember(merged);
      }
      return;
    }
    const metadataRoomId = communityGroupMatrixRoomId(group);
    const metadataRoom = metadataRoomId ? rooms.find((room) => room.roomId === metadataRoomId) : undefined;
    const metadataRoomLatest = metadataRoom?.latestMessage;
    const metadataLatest = metadataRoomLatest ?? demoLatestMessageForGroup(group);
    remember({
      active: selectedGroupId === group.groupId || selectedRoomId === metadataRoomId,
      avatarUrl: metadataRoom?.avatarUrl,
      group,
      id: metadataRoomId ? `room:${metadataRoomId}` : `group:${group.groupId}`,
      latest: metadataLatest,
      memberCount: activeCommunityGroupMemberCount(group),
      muted: false,
      pinned: false,
      preferenceKey: chatPreferenceKeyForGroup(group),
      preview: metadataLatest
        ? chatListMessagePreview(metadataLatest, "group")
        : metadataRoomId
          ? "Nový chat"
          : "Klepnutím otevřít chat",
      ...(metadataRoom ? { room: metadataRoom } : {}),
      roomId: metadataRoomId,
      searchable: `${group.name} ${group.members.map((member) => member.displayName || member.username).join(" ")}`,
      sortAt: timestampMillis(metadataLatest?.timestamp ?? group.updatedAt),
      timestamp: metadataLatest
        ? formatShortTimestamp(metadataLatest.timestamp)
        : formatShortTimestamp(group.updatedAt),
      title: group.name,
      type: "group",
      unreadCount: metadataRoom?.unreadCount ?? 0
    });
  });

  // Provider metadata is the authoritative conversation directory. Matrix rooms
  // without a provider conversation are deliberately hidden instead of being
  // guessed by title or rendered as raw room IDs. A pre-production reset may
  // safely discard such orphan rooms.

  const normalizedQuery = query.trim().toLocaleLowerCase("cs-CZ");
  return dedupeChatItems(Array.from(items.values()))
    .filter((item) => filter === "all" || (filter === "direct" ? item.type === "direct" : item.type !== "direct"))
    .filter((item) =>
      normalizedQuery
        ? `${item.title} ${item.preview} ${item.searchable}`.toLocaleLowerCase("cs-CZ").includes(normalizedQuery)
        : true
    )
    .sort((left, right) => right.sortAt - left.sortAt || left.title.localeCompare(right.title, "cs-CZ"));
}

export function dedupeChatItems(items: ChatListItem[]): ChatListItem[] {
  const deduped = new Map<string, ChatListItem>();
  items.forEach((item) => {
    const key = chatDedupeKey(item);
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, item);
      return;
    }
    const preferred = preferChatListItem(current, item);
    const conversation = preferred.conversation ?? current.conversation ?? item.conversation;
    const group = preferred.group ?? current.group ?? item.group;
    const room = preferred.room ?? current.room ?? item.room;
    deduped.set(key, {
      ...preferred,
      active: current.active || item.active,
      avatarVariant: preferred.avatarVariant ?? current.avatarVariant ?? item.avatarVariant,
      avatarUrl: preferred.avatarUrl ?? current.avatarUrl ?? item.avatarUrl,
      ...(conversation ? { conversation } : {}),
      ...(group ? { group } : {}),
      ...(room ? { room } : {}),
      unreadCount: Math.max(current.unreadCount, item.unreadCount)
    });
  });
  return Array.from(deduped.values());
}

function chatDedupeKey(item: ChatListItem): string {
  const memberIds = item.conversation?.members
    ?.map((member) => member.userId)
    .filter(Boolean)
    .sort()
    .join("|");
  if (item.type === "direct" && memberIds) {
    return `direct:${normalizeDirectIdentityKey(memberIds)}`;
  }
  const directPeerId = item.type === "direct" ? item.room?.directPeer?.userId : undefined;
  if (directPeerId) {
    return `direct:${normalizeDirectIdentityKey(directPeerId)}`;
  }
  return `${item.type === "direct" ? "direct" : "group"}:${normalizeTitle(item.title)}`;
}

function normalizeDirectIdentityKey(value: string): string {
  const localpart = matrixUserIdLocalpart(value);
  return normalizeIdentityId(localpart ?? value);
}

function preferChatListItem(left: ChatListItem, right: ChatListItem): ChatListItem {
  if (Boolean(left.roomId) !== Boolean(right.roomId)) {
    return left.roomId ? left : right;
  }
  if (Boolean(left.latest) !== Boolean(right.latest)) {
    return left.latest ? left : right;
  }
  return left.sortAt >= right.sortAt ? left : right;
}

export function applyChatPreferences(items: ChatListItem[], preferences: ChatPreferences): ChatListItem[] {
  const pinnedOrder = new Map(preferences.pinnedKeys.map((key, index) => [key, index]));
  return items
    .map((item) => {
      const snapshot = chatPreferenceSnapshot(item);
      const manuallyUnread = preferences.manualUnreadKeys.includes(item.preferenceKey);
      const readOverride = preferences.readOverrideByKey[item.preferenceKey] === snapshot;
      const unreadCount = readOverride ? 0 : Math.max(item.unreadCount, manuallyUnread ? 1 : 0);
      return {
        ...item,
        manuallyUnread,
        muted: isChatMuted(preferences.mutedUntilByKey[item.preferenceKey]),
        pinned: pinnedOrder.has(item.preferenceKey),
        unreadCount
      };
    })
    .filter((item) => {
      const hiddenSnapshot = preferences.hiddenByKey[item.preferenceKey];
      if (!hiddenSnapshot || item.active || item.unreadCount > 0 || item.manuallyUnread) {
        return true;
      }
      return hiddenSnapshot !== chatPreferenceSnapshot(item);
    })
    .sort((left, right) => {
      const leftPinned = pinnedOrder.get(left.preferenceKey);
      const rightPinned = pinnedOrder.get(right.preferenceKey);
      if (leftPinned !== undefined || rightPinned !== undefined) {
        if (leftPinned === undefined) {
          return 1;
        }
        if (rightPinned === undefined) {
          return -1;
        }
        return leftPinned - rightPinned;
      }
      return right.sortAt - left.sortAt || left.title.localeCompare(right.title, "cs-CZ");
    });
}

export function chatPreferenceSnapshot(item: ChatListItem): string {
  return item.latest?.eventId ?? "__no_latest__";
}

function chatTitleForConversation(
  conversation: MessagingConversationSummary,
  room: MatrixRoomSummary | undefined,
  authSubjectId: string | undefined,
  ownIdentityIds: Set<string>
): string {
  if (conversation.type !== "direct") {
    return conversation.title;
  }
  const conversationPeer = conversationDirectPeer(conversation, authSubjectId, ownIdentityIds);
  const candidates = [room?.directPeer?.displayName, conversationPeer?.displayName, conversation.title]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const identityIds = [room?.directPeer?.userId, conversationPeer?.userId].filter((value): value is string =>
    Boolean(value)
  );
  return (
    candidates.find((value) => !isOpaqueChatIdentityLabel(value, identityIds)) ?? candidates[0] ?? conversation.title
  );
}

function isOpaqueChatIdentityLabel(value: string, identityIds: string[]): boolean {
  const normalizedValue = value.trim().toLocaleLowerCase("cs-CZ");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalizedValue)) {
    return true;
  }
  return identityIds.some((identityId) => {
    const normalizedIdentityId = identityId.trim().toLocaleLowerCase("cs-CZ");
    const matrixLocalpart = /^@([^:]+):/u.exec(normalizedIdentityId)?.[1];
    return normalizedValue === normalizedIdentityId || normalizedValue === matrixLocalpart;
  });
}

function conversationDirectPeer(
  conversation: MessagingConversationSummary,
  authSubjectId: string | undefined,
  ownIdentityIds: Set<string>
): { avatarUrl?: string; displayName: string; userId: string } | undefined {
  const members = conversation.members ?? [];
  const fallbackOwnIds = authSubjectId ? new Set([normalizeIdentityId(authSubjectId)]) : new Set<string>();
  const ownIds = ownIdentityIds.size > 0 ? ownIdentityIds : fallbackOwnIds;
  const peer =
    members.find((member) => !ownIds.has(normalizeIdentityId(member.userId))) ??
    (members.length === 1 ? members[0] : undefined);
  if (!peer) {
    return undefined;
  }
  return {
    ...(peer.avatarUrl ? { avatarUrl: peer.avatarUrl } : {}),
    displayName: peer.displayName?.trim() || peer.userId,
    userId: peer.userId
  };
}

function ownChatIdentityIds(session: AuthSession, matrixUserId: string | undefined): Set<string> {
  const values = [
    session.profile?.subjectId,
    session.profile?.username,
    session.profile?.email,
    matrixUserId,
    matrixUserId ? matrixUserIdLocalpart(matrixUserId) : undefined
  ];
  return new Set(values.map((value) => (value ? normalizeIdentityId(value) : "")).filter(Boolean));
}

export function sameAuthSessionIdentity(left: AuthSession, right: AuthSession): boolean {
  const leftIdentity = left.profile?.subjectId ?? left.profile?.username ?? left.profile?.email;
  const rightIdentity = right.profile?.subjectId ?? right.profile?.username ?? right.profile?.email;
  return Boolean(
    leftIdentity && rightIdentity && normalizeIdentityId(leftIdentity) === normalizeIdentityId(rightIdentity)
  );
}

function normalizeIdentityId(value: string): string {
  return value.trim().toLocaleLowerCase("cs-CZ");
}

function matrixUserIdLocalpart(userId: string): string | undefined {
  return /^@([^:]+):/u.exec(userId.trim())?.[1];
}

function buildForwardTargets(chatItems: ChatListItem[], users: UserDirectoryEntry[], query: string): ForwardTarget[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("cs-CZ");
  const targets = new Map<string, ForwardTarget>();
  for (const item of chatItems) {
    if (
      normalizedQuery &&
      !`${item.title} ${item.preview} ${item.searchable}`.toLocaleLowerCase("cs-CZ").includes(normalizedQuery)
    ) {
      continue;
    }
    targets.set(`chat:${item.id}`, {
      ...(item.avatarVariant ? { avatarVariant: item.avatarVariant } : {}),
      avatarUrl: item.avatarUrl,
      chat: item,
      key: `chat:${item.id}`,
      subtitle: item.type === "direct" ? "přímý chat" : "skupina",
      title: item.title,
      type: "chat"
    });
  }
  for (const user of users) {
    const title = user.displayName?.trim() || user.username || user.subjectId;
    const directKey = `user:${user.subjectId}`;
    const alreadyVisible = Array.from(targets.values()).some((target) =>
      target.chat?.conversation?.members?.some((member) => member.userId === user.subjectId)
    );
    if (alreadyVisible) {
      continue;
    }
    targets.set(directKey, {
      key: directKey,
      subtitle: user.email || user.username || "osoba",
      title,
      type: "user",
      user
    });
  }
  return Array.from(targets.values())
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "chat" ? -1 : 1;
      }
      return left.title.localeCompare(right.title, "cs-CZ");
    })
    .slice(0, 36);
}

function chatPreferenceKeyForConversation(conversation: MessagingConversationSummary, group?: CommunityGroup): string {
  const groupId = conversationCommunityGroupId(conversation) ?? group?.groupId;
  if (groupId) {
    return chatPreferenceKeyForGroupId(groupId);
  }
  return `conversation:${conversation.conversationId}`;
}

function chatPreferenceKeyForGroup(group: CommunityGroup): string {
  return chatPreferenceKeyForGroupId(group.groupId);
}

function chatPreferenceKeyForGroupId(groupId: string): string {
  return `group:${groupId}`;
}

function groupForConversation(
  conversation: MessagingConversationSummary,
  groups: CommunityGroup[]
): CommunityGroup | null {
  const groupId = conversationCommunityGroupId(conversation);
  if (groupId) {
    return groups.find((group) => group.groupId === groupId) ?? null;
  }
  return conversation.type === "group"
    ? (groups.find((group) => communityGroupConversationId(group) === conversation.conversationId) ??
        findGroupByTitle(conversation.title, groups) ??
        null)
    : null;
}

function findConversationForGroup(
  group: CommunityGroup,
  conversations: MessagingConversationSummary[]
): MessagingConversationSummary | undefined {
  const conversationId = communityGroupConversationId(group);
  if (conversationId) {
    const conversation = conversations.find((item) => item.conversationId === conversationId);
    if (conversation) {
      return conversation;
    }
  }
  return conversations.find((conversation) => conversationCommunityGroupId(conversation) === group.groupId);
}

function findGroupByMatrixRoomId(roomId: string, groups: CommunityGroup[]): CommunityGroup | undefined {
  return groups.find((group) => communityGroupMatrixRoomId(group) === roomId);
}

function findConversationByTitle(
  title: string,
  conversations: MessagingConversationSummary[],
  type?: "direct" | "group"
): MessagingConversationSummary | undefined {
  const normalized = normalizeTitle(title);
  return conversations.find(
    (conversation) => normalizeTitle(conversation.title) === normalized && (!type || conversation.type === type)
  );
}

function canUpdateCommunityGroupMetadata(group: CommunityGroup, subjectId: string | null | undefined): boolean {
  return Boolean(
    subjectId && group.members.some((member) => member.subjectId === subjectId && member.status === "active")
  );
}

function groupHasActiveMember(group: CommunityGroup, subjectId: string | null | undefined): boolean {
  return Boolean(
    subjectId && group.members.some((member) => member.subjectId === subjectId && member.status === "active")
  );
}

function canManageCommunityGroupMembers(group: CommunityGroup, subjectId: string | null | undefined): boolean {
  return Boolean(
    subjectId &&
    group.members.some(
      (member) =>
        member.subjectId === subjectId &&
        member.status === "active" &&
        (member.role === "owner" || member.role === "admin")
    )
  );
}

function findGroupByTitle(title: string, groups: CommunityGroup[]): CommunityGroup | undefined {
  const normalized = normalizeTitle(title);
  return groups.find((group) => normalizeTitle(group.name) === normalized);
}

function conversationCommunityGroupId(conversation: MessagingConversationSummary): string | undefined {
  const externalId = conversation.metadata?.externalId;
  return typeof externalId === "string" && conversation.metadata?.source === "cop.community" ? externalId : undefined;
}

interface CommunityGroupChatMetadata {
  aiAssistant?: CommunityGroupAiAssistantMetadata;
  conversationId?: string;
  disappearingMessages?: {
    enabled: boolean;
    seconds: MessageRetentionSeconds;
    updatedAt?: string;
  };
  encrypted?: boolean;
  linkedAt?: string;
  matrixRoomId?: string;
  source?: string;
}

export interface CommunityGroupAiAssistantMetadata {
  consent?: {
    granted: boolean;
    grantedAt?: string;
    grantedBy?: string;
    revokedAt?: string;
    revokedBy?: string;
    scope?: string;
    termsVersion?: string;
  };
  e2ee?: {
    keyModel?: string;
    plaintextProxy?: boolean;
    roomKeyPolicy?: string;
    serverReadsHistory?: boolean;
    status?: string;
    updatedAt?: string;
  };
  enabled: boolean;
  label: string;
  matrixBot?: {
    deviceId?: string;
    displayName?: string;
    joinedAt?: string;
    matrixUserId?: string;
    membership?: string;
    roomId?: string;
    status?: string;
    updatedAt?: string;
    userId?: string;
    warnings?: string[];
  };
  mode: "cop-context";
  updatedAt?: string;
  updatedBy?: string;
}

export function aiMatrixBotInvitePlan(
  aiAssistant: CommunityGroupAiAssistantMetadata,
  fallbackRoomId?: string | null
): { matrixUserId: string; roomId: string } | null {
  if (!aiAssistant.enabled || aiAssistant.matrixBot?.status === "joined") {
    return null;
  }
  const matrixUserId = aiAssistant.matrixBot?.matrixUserId?.trim();
  const roomId = aiAssistant.matrixBot?.roomId?.trim() || fallbackRoomId?.trim();
  if (!matrixUserId || !roomId) {
    return null;
  }
  if (aiAssistant.matrixBot?.status === "bot_token_unavailable" || aiAssistant.matrixBot?.status === "bot_disabled") {
    return null;
  }
  return { matrixUserId, roomId };
}

function communityGroupChatMetadata(group: CommunityGroup): CommunityGroupChatMetadata {
  const chat = asRecord(group.metadata?.chat);
  if (!chat) {
    return {};
  }
  const disappearingMessages = asRecord(chat.disappearingMessages);
  const aiAssistant = asRecord(chat.aiAssistant);
  const retentionSeconds = normalizeMessageRetentionSeconds(disappearingMessages?.seconds);
  const retentionEnabled = disappearingMessages?.enabled === true && retentionSeconds !== null;
  return {
    ...(aiAssistant ? { aiAssistant: communityGroupAiAssistantMetadata(group) } : {}),
    conversationId: typeof chat.conversationId === "string" ? chat.conversationId : undefined,
    ...(disappearingMessages
      ? {
          disappearingMessages: {
            enabled: retentionEnabled,
            seconds: retentionEnabled ? retentionSeconds : null,
            updatedAt: typeof disappearingMessages.updatedAt === "string" ? disappearingMessages.updatedAt : undefined
          }
        }
      : {}),
    encrypted: typeof chat.encrypted === "boolean" ? chat.encrypted : undefined,
    linkedAt: typeof chat.linkedAt === "string" ? chat.linkedAt : undefined,
    matrixRoomId: typeof chat.matrixRoomId === "string" ? chat.matrixRoomId : undefined,
    source: typeof chat.source === "string" ? chat.source : undefined
  };
}

function communityGroupAiAssistantMetadata(group: CommunityGroup): CommunityGroupAiAssistantMetadata {
  const chat = asRecord(group.metadata?.chat);
  const aiAssistant = asRecord(chat?.aiAssistant);
  const consent = asRecord(aiAssistant?.consent);
  const e2ee = asRecord(aiAssistant?.e2ee);
  const matrixBot = asRecord(aiAssistant?.matrixBot);
  return {
    ...(consent
      ? {
          consent: {
            granted: consent.granted === true,
            grantedAt: typeof consent.grantedAt === "string" ? consent.grantedAt : undefined,
            grantedBy: typeof consent.grantedBy === "string" ? consent.grantedBy : undefined,
            revokedAt: typeof consent.revokedAt === "string" ? consent.revokedAt : undefined,
            revokedBy: typeof consent.revokedBy === "string" ? consent.revokedBy : undefined,
            scope: typeof consent.scope === "string" ? consent.scope : undefined,
            termsVersion: typeof consent.termsVersion === "string" ? consent.termsVersion : undefined
          }
        }
      : {}),
    ...(e2ee
      ? {
          e2ee: {
            keyModel: typeof e2ee.keyModel === "string" ? e2ee.keyModel : undefined,
            plaintextProxy: e2ee.plaintextProxy === true,
            roomKeyPolicy: typeof e2ee.roomKeyPolicy === "string" ? e2ee.roomKeyPolicy : undefined,
            serverReadsHistory: e2ee.serverReadsHistory === true,
            status: typeof e2ee.status === "string" ? e2ee.status : undefined,
            updatedAt: typeof e2ee.updatedAt === "string" ? e2ee.updatedAt : undefined
          }
        }
      : {}),
    enabled: aiAssistant?.enabled === true,
    label:
      typeof aiAssistant?.label === "string" && aiAssistant.label.trim()
        ? aiAssistant.label.trim()
        : "COP AI Assistant",
    ...(matrixBot
      ? {
          matrixBot: {
            deviceId: typeof matrixBot.deviceId === "string" ? matrixBot.deviceId : undefined,
            displayName: typeof matrixBot.displayName === "string" ? matrixBot.displayName : undefined,
            joinedAt: typeof matrixBot.joinedAt === "string" ? matrixBot.joinedAt : undefined,
            matrixUserId: typeof matrixBot.matrixUserId === "string" ? matrixBot.matrixUserId : undefined,
            membership: typeof matrixBot.membership === "string" ? matrixBot.membership : undefined,
            roomId: typeof matrixBot.roomId === "string" ? matrixBot.roomId : undefined,
            status: typeof matrixBot.status === "string" ? matrixBot.status : undefined,
            updatedAt: typeof matrixBot.updatedAt === "string" ? matrixBot.updatedAt : undefined,
            userId: typeof matrixBot.userId === "string" ? matrixBot.userId : undefined,
            warnings: Array.isArray(matrixBot.warnings)
              ? matrixBot.warnings.filter((item): item is string => typeof item === "string").slice(0, 6)
              : undefined
          }
        }
      : {}),
    mode: "cop-context",
    updatedAt: typeof aiAssistant?.updatedAt === "string" ? aiAssistant.updatedAt : undefined,
    updatedBy: typeof aiAssistant?.updatedBy === "string" ? aiAssistant.updatedBy : undefined
  };
}

function aiAssistantStatusLabel(aiAssistant: CommunityGroupAiAssistantMetadata): string {
  switch (aiAssistant.matrixBot?.status) {
    case "joined":
      return "Matrix bot je členem místnosti";
    case "pending_room_binding":
      return "Matrix bot čeká na vytvoření místnosti";
    case "pending_conversation":
      return "Matrix bot čeká na propojení konverzace";
    case "bot_token_unavailable":
      return "Matrix bot nemá připravený token";
    case "bot_join_failed":
      return "Matrix bot pozvánku zatím nepřijal";
    case "member_sync_failed":
      return "Synchronizace Matrix bot člena selhala";
    case "bot_disabled":
      return "Matrix bot účet je vypnutý konfigurací";
    default:
      return aiAssistant.enabled ? "Matrix bot se připravuje" : "AI agent je vypnutý";
  }
}

function aiAssistantE2eeLabel(aiAssistant: CommunityGroupAiAssistantMetadata): string {
  if (aiAssistant.e2ee?.status === "ready_for_future_messages") {
    return "Vlastní device, klíče pro nové zprávy";
  }
  if (aiAssistant.e2ee?.keyModel === "dedicated_matrix_account_device") {
    return "Vlastní device, čeká na Matrix členství";
  }
  return "Čeká na zapnutí Matrix bot účtu";
}

function demoConversationMetadata(group: CommunityGroup): DemoConversationMetadata | null {
  const raw = asRecord(group.metadata?.demoConversation);
  if (!raw) {
    return null;
  }
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map(parseDemoConversationMessage)
        .filter((message): message is DemoConversationMessage => Boolean(message))
    : [];
  const media = Array.isArray(raw.media)
    ? raw.media.map(parseDemoConversationMedia).filter((item): item is DemoConversationMedia => Boolean(item))
    : [];
  const metadata: DemoConversationMetadata = {
    media,
    messages,
    ...(typeof raw.pinnedContext === "string" && raw.pinnedContext.trim()
      ? { pinnedContext: raw.pinnedContext.trim() }
      : {}),
    ...(typeof raw.summary === "string" && raw.summary.trim() ? { summary: raw.summary.trim() } : {}),
    ...(typeof raw.title === "string" && raw.title.trim() ? { title: raw.title.trim() } : {})
  };
  return metadata.messages.length > 0 || metadata.media.length > 0 || metadata.summary || metadata.pinnedContext
    ? metadata
    : null;
}

function demoTimelineMessagesForGroup(group: CommunityGroup, authSession?: AuthSession): MatrixTimelineMessage[] {
  const demo = demoConversationMetadata(group);
  if (!demo) {
    return [];
  }
  const messages: MatrixTimelineMessage[] = [];
  const firstMessageMillis = Math.min(
    ...demo.messages.map((message) => timestampMillis(message.sentAt)).filter((timestamp) => timestamp > 0)
  );
  const baseMillis =
    Number.isFinite(firstMessageMillis) && firstMessageMillis > 0
      ? firstMessageMillis
      : timestampMillis(group.updatedAt) || Date.now();
  if (demo.summary || demo.pinnedContext) {
    messages.push({
      body: [demo.summary, demo.pinnedContext].filter(Boolean).join("\n"),
      eventId: `demo:${group.groupId}:summary`,
      kind: "text",
      own: false,
      sender: `demo:${group.groupId}:system`,
      senderDisplayName: demo.title ?? group.name,
      timestamp: new Date(baseMillis - 60_000).toISOString()
    });
  }
  demo.messages.forEach((message, index) => {
    const own = message.direction === "outgoing";
    messages.push({
      body: [message.body, message.link?.label].filter(Boolean).join("\n"),
      eventId: `demo:${group.groupId}:${message.id || index}`,
      kind: "text",
      own,
      sender: own ? (authSession?.profile?.subjectId ?? "demo:self") : `demo:${group.groupId}:member:${index}`,
      senderDisplayName: own ? (authSession?.profile?.name ?? message.authorName ?? "Vy") : demoSenderLabel(message),
      timestamp: safeIsoTimestamp(message.sentAt, baseMillis + index * 60_000)
    });
  });
  const mediaBaseMillis = Math.max(baseMillis, ...messages.map((message) => timestampMillis(message.timestamp)));
  demo.media.forEach((item, index) => {
    messages.push(demoMediaTimelineMessage(group, item, mediaBaseMillis + (index + 1) * 60_000, index));
  });
  return messages;
}

function demoLatestMessageForGroup(group: CommunityGroup): MatrixTimelineMessage | undefined {
  return demoTimelineMessagesForGroup(group).at(-1);
}

function parseDemoConversationMessage(value: unknown): DemoConversationMessage | null {
  const raw = asRecord(value);
  const body = typeof raw?.body === "string" ? raw.body.trim() : "";
  const id = typeof raw?.id === "string" ? raw.id.trim() : "";
  if (!raw || !body || !id) {
    return null;
  }
  const direction = raw.direction === "outgoing" ? "outgoing" : "incoming";
  const link = asRecord(raw.link);
  return {
    body,
    direction,
    id,
    ...(typeof raw.authorName === "string" && raw.authorName.trim() ? { authorName: raw.authorName.trim() } : {}),
    ...(link && typeof link.label === "string" && link.label.trim() ? { link: { label: link.label.trim() } } : {}),
    ...(typeof raw.role === "string" && raw.role.trim() ? { role: raw.role.trim() } : {}),
    sentAt: typeof raw.sentAt === "string" && raw.sentAt.trim() ? raw.sentAt.trim() : new Date().toISOString()
  };
}

function parseDemoConversationMedia(value: unknown): DemoConversationMedia | null {
  const raw = asRecord(value);
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  const kind = raw?.kind;
  if (!raw || !title || (kind !== "document" && kind !== "location" && kind !== "photo" && kind !== "video")) {
    return null;
  }
  return {
    kind,
    title,
    ...(typeof raw.byteSizeLabel === "string" && raw.byteSizeLabel.trim()
      ? { byteSizeLabel: raw.byteSizeLabel.trim() }
      : {}),
    ...(typeof raw.caption === "string" && raw.caption.trim() ? { caption: raw.caption.trim() } : {}),
    ...(typeof raw.previewUrl === "string" && raw.previewUrl.trim() ? { previewUrl: raw.previewUrl.trim() } : {})
  };
}

function demoSenderLabel(message: DemoConversationMessage): string {
  return [message.authorName, message.role].filter(Boolean).join(" · ") || "Člen skupiny";
}

function demoMediaTimelineMessage(
  group: CommunityGroup,
  item: DemoConversationMedia,
  timestampMillisValue: number,
  index: number
): MatrixTimelineMessage {
  const timestamp = new Date(timestampMillisValue).toISOString();
  const eventId = `demo:${group.groupId}:media:${index}`;
  if (item.kind === "location") {
    return {
      body: item.caption ?? item.title,
      eventId,
      kind: "location",
      location: parseDemoLocation(item),
      own: false,
      sender: `demo:${group.groupId}:system`,
      senderDisplayName: "Sdílený kontext",
      timestamp
    };
  }
  const kind = item.kind === "photo" ? "image" : item.kind === "video" ? "video" : "file";
  const previewUrl = item.previewUrl ?? demoMediaPreviewUrl(item);
  return {
    attachment: {
      contentType: demoMediaContentType(item),
      fileName: item.title,
      ...(item.kind === "photo" && previewUrl ? { mediaUrl: previewUrl } : {}),
      ...(previewUrl ? { thumbnailUrl: previewUrl } : {}),
      ...(parseDemoByteSize(item.byteSizeLabel) ? { size: parseDemoByteSize(item.byteSizeLabel) } : {})
    },
    body: item.caption ?? item.title,
    eventId,
    kind,
    own: false,
    sender: `demo:${group.groupId}:system`,
    senderDisplayName: "Sdílená média",
    timestamp
  };
}

function demoMediaPreviewUrl(item: DemoConversationMedia): string | undefined {
  if (item.kind === "location") {
    return undefined;
  }
  const kindLabel = item.kind === "photo" ? "FOTO" : item.kind === "video" ? "VIDEO" : "PDF";
  const accent = item.kind === "photo" ? "#7dd3fc" : item.kind === "video" ? "#fbbf24" : "#f87171";
  const title = escapeSvgText(item.title);
  const caption = escapeSvgText(item.caption ?? "Demo náhled");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540" viewBox="0 0 900 540"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#111827"/></linearGradient><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0v48" fill="none" stroke="#ffffff" stroke-opacity=".07"/></pattern></defs><rect width="900" height="540" fill="url(#bg)"/><rect width="900" height="540" fill="url(#grid)"/><rect x="56" y="56" width="788" height="428" rx="28" fill="#020617" fill-opacity=".58" stroke="${accent}" stroke-opacity=".8" stroke-width="2"/><text x="92" y="132" fill="${accent}" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="800">${kindLabel}</text><text x="92" y="242" fill="#f8fafc" font-family="Inter,Arial,sans-serif" font-size="46" font-weight="800">${title}</text><text x="92" y="320" fill="#cbd5e1" font-family="Inter,Arial,sans-serif" font-size="26" font-weight="600">${caption}</text><text x="92" y="410" fill="#94a3b8" font-family="Inter,Arial,sans-serif" font-size="20" font-weight="700">COP / CSM demo kontext</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvgText(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function parseDemoLocation(item: DemoConversationMedia): MatrixLocationShare {
  const source = item.caption ?? item.title;
  const match = /(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)/u.exec(source);
  const lat = match ? Number.parseFloat(match[1]?.replace(",", ".") ?? "") : 50.0755;
  const lon = match ? Number.parseFloat(match[2]?.replace(",", ".") ?? "") : 14.4378;
  return {
    label: item.title,
    lat: Number.isFinite(lat) ? lat : 50.0755,
    lon: Number.isFinite(lon) ? lon : 14.4378,
    source: "map"
  };
}

function safeIsoTimestamp(value: string, fallbackMillis: number): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(fallbackMillis).toISOString();
}

function demoMediaContentType(item: DemoConversationMedia): string {
  if (item.kind === "photo") {
    return "image/jpeg";
  }
  if (item.kind === "video") {
    return "video/mp4";
  }
  return item.title.toLocaleLowerCase("cs-CZ").endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
}

function parseDemoByteSize(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = /(\d+(?:[.,]\d+)?)\s*(kb|kib|mb|mib|gb|gib|b)?/iu.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const amount = Number.parseFloat(match[1]?.replace(",", ".") ?? "");
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const unit = (match[2] ?? "b").toLocaleLowerCase("cs-CZ");
  const multiplier = unit.startsWith("g")
    ? 1_000_000_000
    : unit.startsWith("m")
      ? 1_000_000
      : unit.startsWith("k")
        ? 1_000
        : 1;
  return Math.round(amount * multiplier);
}

function communityGroupConversationId(group: CommunityGroup): string | undefined {
  return communityGroupChatMetadata(group).conversationId;
}

function communityGroupMatrixRoomId(group: CommunityGroup): string | undefined {
  return communityGroupChatMetadata(group).matrixRoomId;
}

function messageRetentionSecondsForActiveChat(
  room: MatrixRoomSummary | null,
  group: CommunityGroup | null
): MessageRetentionSeconds {
  return normalizeMessageRetentionSeconds(
    room?.messageRetentionSeconds ?? (group ? communityGroupChatMetadata(group).disappearingMessages?.seconds : null)
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function communityGroupMembersToMessagingMembers(
  group: CommunityGroup
): Array<{ displayName?: string; role?: string; userId: string }> {
  return group.members
    .filter((member) => member.status === "active")
    .map((member) => ({
      displayName: member.displayName || member.username,
      role: member.role,
      userId: member.subjectId
    }));
}

function activeCommunityGroupMemberCount(group: CommunityGroup): number {
  return group.members.filter((member) => member.status === "active").length;
}

function findExistingDirectConversation(
  user: UserDirectoryEntry,
  conversations: MessagingConversationSummary[],
  title: string
): MessagingConversationSummary | undefined {
  const normalizedTitle = normalizeTitle(title);
  const candidates = conversations.filter((conversation) => {
    if (conversation.type !== "direct") {
      return false;
    }
    if (conversation.metadata?.source === "cop.direct" && conversation.metadata.externalId === user.subjectId) {
      return true;
    }
    if (conversation.members?.some((member) => member.userId === user.subjectId)) {
      return true;
    }
    return Boolean(normalizedTitle && normalizeTitle(conversation.title) === normalizedTitle);
  });
  return candidates.find((conversation) => Boolean(conversation.matrix?.roomId)) ?? candidates[0];
}

function ensureConversationHasMember(
  conversation: MessagingConversationSummary,
  user: UserDirectoryEntry,
  role: "bot" | "member" = "member"
): MessagingConversationSummary {
  if (conversation.members?.some((member) => member.userId === user.subjectId)) {
    return conversation;
  }
  return {
    ...conversation,
    members: [
      ...(conversation.members ?? []),
      { displayName: user.displayName || user.username, role, userId: user.subjectId }
    ]
  };
}

function findExistingAiAgentDirectConversation(
  conversations: MessagingConversationSummary[]
): MessagingConversationSummary | undefined {
  const candidates = conversations.filter(isAiAgentDirectConversation);
  return candidates.find((conversation) => Boolean(conversation.matrix?.roomId)) ?? candidates[0];
}

export function isAiAgentChatItem(item: ChatListItem): boolean {
  return item.conversation?.conversationKind === "personal_ai";
}

function isAiAgentDirectConversation(
  conversation: MessagingConversationSummary | null | undefined
): conversation is MessagingConversationSummary {
  if (!conversation || conversation.type !== "direct") {
    return false;
  }
  return conversation.conversationKind === "personal_ai";
}

function assertMatrixRoomReady(binding: MessagingMatrixRoomBindingResponse): string {
  const roomId = binding.conversation?.matrix?.roomId;
  if (binding.status === "online" && roomId) {
    return roomId;
  }
  throw new Error(binding.warnings[0] ?? "Služba zpráv zatím nepřipravila zabezpečenou konverzaci.");
}

function upsertConversation(
  current: MessagingConversationSummary[],
  conversation: MessagingConversationSummary
): MessagingConversationSummary[] {
  return [conversation, ...current.filter((item) => item.conversationId !== conversation.conversationId)];
}

function ensureRoomSummary(rooms: MatrixRoomSummary[], room: MatrixRoomSummary): MatrixRoomSummary[] {
  if (rooms.some((item) => item.roomId === room.roomId)) {
    return rooms;
  }
  return [room, ...rooms];
}

function selectRoomIdFromKey(
  selection: string | null | undefined,
  conversations: MessagingConversationSummary[],
  rooms: MatrixRoomSummary[]
): string | null {
  if (!selection) {
    return null;
  }
  const conversation = conversations.find(
    (item) => item.conversationId === selection || item.matrix?.roomId === selection
  );
  if (conversation?.matrix?.roomId) {
    return conversation.matrix.roomId;
  }
  return rooms.some((room) => room.roomId === selection) ? selection : null;
}

function messageSenderLabel(
  message: MatrixTimelineMessage,
  conversation: MessagingConversationSummary | null,
  session: AuthSession
): string {
  if (isAiAgentFallbackMessage(message)) {
    return "COP AI agent";
  }
  if (message.own) {
    return "Vy";
  }
  if (message.senderDisplayName?.trim()) {
    return message.senderDisplayName.trim();
  }
  const sender = message.sender.toLocaleLowerCase("cs-CZ");
  const match = conversation?.members?.find((member) => {
    const userId = member.userId.toLocaleLowerCase("cs-CZ");
    return (
      sender.includes(userId) ||
      (member.displayName ? sender.includes(member.displayName.toLocaleLowerCase("cs-CZ")) : false)
    );
  });
  if (match?.displayName) {
    return match.displayName;
  }
  if (message.sender === session.profile?.subjectId || message.sender === session.profile?.username) {
    return "Vy";
  }
  return "Člen";
}

export function parseAiAgentMention(text: string): string | null {
  return parseSharedChatAiMention(text);
}

export function parseAiAgentInvocation(
  text: string,
  options: {
    aiDirectChat?: boolean;
    groupAiAssistantEnabled?: boolean;
  } = {}
): AiAgentInvocation | null {
  const invocation = parseSharedChatAiInvocation(text, options);
  return invocation
    ? {
        ...(invocation.commandId ? { commandId: invocation.commandId } : {}),
        modelPreference: invocation.modelPreference,
        question: invocation.question,
        trigger: invocation.trigger
      }
    : null;
}

function isTomatoSlashCommand(text: string): boolean {
  return /^\/(?:tomato|rajce|rajcata|rajcatova-sklizen)\s*$/iu.test(text.trim());
}

export function formatAiAgentShareBody(answer: string, question: string): string {
  const normalizedQuestion = question.trim();
  const normalizedAnswer = answer.trim();
  return `COP AI agent${normalizedQuestion ? `\nDotaz: ${normalizedQuestion}` : ""}\n\n${normalizedAnswer}`.trim();
}

export function formatAiSituationShareBody(summary: string): string {
  return `AI situační souhrn:\n\n${summary.trim()}`.trim();
}

export function buildAiRequestContextOptions(
  messages: MatrixTimelineMessage[],
  hostLocation?: MatrixLocationShare
): {
  geoContext?: AiContextGeoContext;
  timeWindow: AiContextTimeWindow;
} {
  const latestLocation =
    hostLocation && validMatrixLocation(hostLocation) ? hostLocation : latestTimelineLocation(messages);
  return {
    ...(latestLocation
      ? {
          geoContext: {
            currentLocation: {
              ...(latestLocation.label ? { label: latestLocation.label } : {}),
              lat: latestLocation.lat,
              lon: latestLocation.lon,
              radiusKm: 30
            },
            label: latestLocation.label ?? "Sdílená poloha v chatu"
          }
        }
      : {}),
    timeWindow: {
      maxAgeSeconds: 7 * 24 * 3600
    }
  };
}

function initialEmbeddedHostLocation(): MatrixLocationShare | null {
  if (typeof window === "undefined" || window.parent === window) {
    return null;
  }
  try {
    const focus = decodeCopMapFocusSearch(window.parent.location.search);
    if (!focus) {
      return null;
    }
    return {
      label: focus.label ?? "Střed mapy",
      lat: focus.lat,
      lon: focus.lon,
      source: "map"
    };
  } catch {
    return null;
  }
}

function latestTimelineLocation(messages: MatrixTimelineMessage[]): MatrixLocationShare | undefined {
  return [...messages]
    .reverse()
    .find((message) => message.kind === "location" && message.location && validMatrixLocation(message.location))
    ?.location;
}

export function collapseLiveLocationTimeline(messages: MatrixTimelineMessage[]): MatrixTimelineMessage[] {
  const latestLiveEventIdByShare = new Map<string, string>();
  const latestDeviceLocationEventIdBySender = new Map<string, string>();
  messages.forEach((message) => {
    const shareId = message.location?.live?.shareId;
    if (shareId) {
      latestLiveEventIdByShare.set(shareId, message.eventId);
      return;
    }
    if (isCollapsibleDeviceLocationMessage(message)) {
      latestDeviceLocationEventIdBySender.set(message.sender, message.eventId);
    }
  });
  if (latestLiveEventIdByShare.size === 0 && latestDeviceLocationEventIdBySender.size === 0) {
    return messages;
  }
  return messages.filter((message) => {
    const shareId = message.location?.live?.shareId;
    if (shareId) {
      return latestLiveEventIdByShare.get(shareId) === message.eventId;
    }
    if (isCollapsibleDeviceLocationMessage(message)) {
      return latestDeviceLocationEventIdBySender.get(message.sender) === message.eventId;
    }
    return true;
  });
}

function isCollapsibleDeviceLocationMessage(message: MatrixTimelineMessage): boolean {
  const location = message.location;
  if (message.kind !== "location" || !location || location.live || location.source !== "device") {
    return false;
  }
  return validMatrixLocation(location);
}

export function collectActiveLiveLocations(messages: MatrixTimelineMessage[], roomId: string | null) {
  const latestByShare = new Map<string, MatrixTimelineMessage>();
  messages.forEach((message) => {
    const location = message.location;
    const shareId = location?.live?.shareId;
    if (!location || !shareId || !validMatrixLocation(location)) {
      return;
    }
    const current = latestByShare.get(shareId);
    if (!current || Date.parse(message.timestamp) >= Date.parse(current.timestamp)) {
      latestByShare.set(shareId, message);
    }
  });
  const now = Date.now();
  return Array.from(latestByShare.values()).flatMap((message) => {
    const location = message.location;
    const live = location?.live;
    if (!location || !live || live.status !== "live") {
      return [];
    }
    if (live.expiresAt && Date.parse(live.expiresAt) <= now) {
      return [];
    }
    return [
      {
        ...(typeof location.accuracyM === "number" ? { accuracyM: location.accuracyM } : {}),
        ...(live.expiresAt ? { expiresAt: live.expiresAt } : {}),
        label: location.label ?? message.senderDisplayName ?? message.sender,
        lat: location.lat,
        lon: location.lon,
        ...(roomId ? { roomId } : {}),
        sender: message.sender,
        ...(message.senderDisplayName ? { senderDisplayName: message.senderDisplayName } : {}),
        shareId: live.shareId,
        status: live.status,
        updatedAt: live.updatedAt ?? location.updatedAt ?? message.timestamp
      }
    ];
  });
}

function validMatrixLocation(location: MatrixLocationShare): boolean {
  return (
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lon) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lon >= -180 &&
    location.lon <= 180
  );
}

export function buildAiChatContextSnapshot(
  messages: MatrixTimelineMessage[],
  options: {
    currentUserMessage?: string;
    encrypted?: boolean;
    roomId?: string | null;
  } = {}
): AiChatAgentContextSnapshot {
  const sourceMessages = messages
    .map((message) => {
      const body = messageDisplayBody(message).trim();
      if (!body) {
        return null;
      }
      return {
        ...(message.cop?.ai
          ? {
              ai: {
                ...(message.cop.ai.auditId ? { auditId: message.cop.ai.auditId } : {}),
                ...(message.cop.ai.provider ? { provider: message.cop.ai.provider } : {}),
                ...(message.cop.ai.question ? { question: message.cop.ai.question } : {}),
                ...(message.cop.ai.responsePlaybook
                  ? {
                      responsePlaybook: {
                        ...(message.cop.ai.responsePlaybook.domain
                          ? { domain: message.cop.ai.responsePlaybook.domain }
                          : {}),
                        ...(message.cop.ai.responsePlaybook.intentId
                          ? { intentId: message.cop.ai.responsePlaybook.intentId }
                          : {})
                      }
                    }
                  : {}),
                ...(message.cop.ai.status ? { status: message.cop.ai.status } : {}),
                ...(message.cop.ai.type ? { type: message.cop.ai.type } : {})
              }
            }
          : {}),
        body: body.slice(0, 1200),
        eventId: message.eventId,
        kind: message.kind,
        own: message.own,
        sender: message.sender,
        ...(message.senderDisplayName ? { senderDisplayName: message.senderDisplayName } : {}),
        timestamp: message.timestamp
      };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));
  const currentUserMessage = options.currentUserMessage?.trim();
  const allMessages = currentUserMessage
    ? [
        ...sourceMessages,
        {
          body: currentUserMessage.slice(0, 1200),
          eventId: "local:current-ai-question",
          kind: "text",
          own: true,
          timestamp: new Date().toISOString()
        }
      ]
    : sourceMessages;
  const includedMessages = allMessages.slice(-30);
  return {
    encrypted: options.encrypted === true,
    includedMessageCount: includedMessages.length,
    messages: includedMessages,
    ...(options.roomId ? { roomId: options.roomId } : {}),
    source: "browser-visible-decrypted-timeline",
    visibleMessageCount: allMessages.length
  };
}

export function messageDisplayBody(message: MatrixTimelineMessage): string {
  if (message.cop?.kind === "ai-agent-response" || isAiAgentFallbackMessage(message)) {
    return stripAiAgentFallbackBody(message.body, message.cop?.ai?.question);
  }
  if (message.cop?.kind === "ai-situation-summary") {
    return stripAiSituationFallbackBody(message.body);
  }
  return message.body;
}

function stripAiAgentFallbackBody(body: string, question?: string): string {
  const withoutTitle = body.replace(/^\s*COP AI agent\s*/iu, "");
  const expectedQuestion = question?.trim();
  if (expectedQuestion) {
    const escapedQuestion = escapeRegExp(expectedQuestion);
    const pattern = new RegExp(`^Dotaz:\\s*${escapedQuestion}\\s*`, "iu");
    return withoutTitle.replace(pattern, "").trimStart();
  }
  return withoutTitle.replace(/^Dotaz:\s*[\s\S]*?\n\s*\n/iu, "").trimStart();
}

export function isAiAgentFallbackMessage(message: MatrixTimelineMessage): boolean {
  return !message.cop?.kind && /^\s*COP AI agent(?:\s|$)/iu.test(message.body);
}

function stripAiSituationFallbackBody(body: string): string {
  return body.replace(/^\s*AI situační souhrn:\s*/iu, "").trimStart();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildAiAgentMessageMetadata(response: AiCopResponse | null, question: string): MatrixCopMessageMetadata {
  return buildAiMessageMetadata(response, {
    kind: "ai-agent-response",
    question,
    type: "chat-agent"
  });
}

function buildAiSituationMessageMetadata(response: AiCopResponse | null): MatrixCopMessageMetadata {
  return buildAiMessageMetadata(response, {
    kind: "ai-situation-summary",
    type: "situation-summary"
  });
}

function buildAiMessageMetadata(
  response: AiCopResponse | null,
  options: {
    kind: NonNullable<MatrixCopMessageMetadata["kind"]>;
    question?: string;
    type: NonNullable<NonNullable<MatrixCopMessageMetadata["ai"]>["type"]>;
  }
): MatrixCopMessageMetadata {
  const question = options.question?.trim();
  const evidence = aiResponseEvidenceMetadata(response);
  const mapActions = aiMapActionsFromResponse(response);
  const responsePlaybook = aiResponsePlaybookMetadata(response);
  const conversation = aiConversationMetadata(response);
  return {
    ai: {
      ...(response?.auditId ? { auditId: response.auditId } : {}),
      ...(conversation ? { conversation } : {}),
      ...(evidence.indexedDocumentCount !== undefined ? { indexedDocumentCount: evidence.indexedDocumentCount } : {}),
      ...(evidence.indexedStatus ? { indexedStatus: evidence.indexedStatus } : {}),
      ...(mapActions.length > 0 ? { mapActions } : {}),
      ...(response?.model ? { model: response.model } : {}),
      ...(response?.policy.reason ? { policyReason: response.policy.reason } : {}),
      ...(response?.provider ? { provider: response.provider } : {}),
      ...(question ? { question } : {}),
      ...(response?.requestId ? { requestId: response.requestId } : {}),
      ...(responsePlaybook ? { responsePlaybook } : {}),
      ...(evidence.semanticDocumentCount !== undefined
        ? { semanticDocumentCount: evidence.semanticDocumentCount }
        : {}),
      ...(evidence.semanticStatus ? { semanticStatus: evidence.semanticStatus } : {}),
      ...(response?.status ? { status: response.status } : {}),
      type: options.type
    },
    kind: options.kind,
    source: "cop-chat"
  };
}

export function aiConversationMetadata(response: AiCopResponse | null): MatrixCopAiConversationMetadata | undefined {
  const structured = asRecord(response?.result.structured);
  const conversation = asRecord(structured?.conversation);
  if (!conversation) {
    return undefined;
  }
  const confidenceRecord = asRecord(conversation.confidence);
  const level = optionalAiText(confidenceRecord?.level);
  const confidenceLevel: "high" | "low" | "medium" | undefined =
    level === "high" || level === "medium" || level === "low" ? level : undefined;
  const confidence: MatrixCopAiConversationMetadata["confidence"] = confidenceRecord
    ? {
        ...(optionalAiText(confidenceRecord.label) ? { label: optionalAiText(confidenceRecord.label) } : {}),
        ...(confidenceLevel ? { level: confidenceLevel } : {})
      }
    : undefined;
  const followUpSuggestions = Array.isArray(conversation.followUpSuggestions)
    ? conversation.followUpSuggestions
        .map(normalizeAiFollowUpSuggestion)
        .filter((item): item is MatrixCopAiFollowUpSuggestion => Boolean(item))
        .slice(0, 3)
    : [];
  const metadata: MatrixCopAiConversationMetadata = {
    ...(confidence && Object.keys(confidence).length > 0 ? { confidence } : {}),
    ...(typeof conversation.followUp === "boolean" ? { followUp: conversation.followUp } : {}),
    ...(optionalAiText(conversation.followUpKind) ? { followUpKind: optionalAiText(conversation.followUpKind) } : {}),
    ...(followUpSuggestions.length > 0 ? { followUpSuggestions } : {}),
    ...(typeof conversation.needsClarification === "boolean"
      ? { needsClarification: conversation.needsClarification }
      : {})
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function normalizeAiFollowUpSuggestion(value: unknown): MatrixCopAiFollowUpSuggestion | undefined {
  const record = asRecord(value);
  const id = optionalAiText(record?.id);
  const label = optionalAiText(record?.label);
  const question = optionalAiText(record?.question);
  return id && label && question ? { id, label, question } : undefined;
}

function aiResponsePlaybookMetadata(response: AiCopResponse | null): MatrixCopAiResponsePlaybookMetadata | undefined {
  const structured = asRecord(response?.result.structured);
  const evidence = asRecord(structured?.evidence);
  const responsePlaybook = asRecord(evidence?.responsePlaybook);
  if (!responsePlaybook) {
    return undefined;
  }
  const allowedActions = optionalAiTextList(responsePlaybook.allowedActions);
  const forbiddenActions = optionalAiTextList(responsePlaybook.forbiddenActions);
  const requiredSources = optionalAiTextList(responsePlaybook.requiredSources);
  const confidence = finiteCoordinate(responsePlaybook.confidence, 0, 1);
  const domain = optionalAiText(responsePlaybook.domain);
  const intentId = optionalAiText(responsePlaybook.intentId);
  const metadata: MatrixCopAiResponsePlaybookMetadata = {
    ...(allowedActions.length > 0 ? { allowedActions } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(domain ? { domain } : {}),
    ...(forbiddenActions.length > 0 ? { forbiddenActions } : {}),
    ...(intentId ? { intentId } : {}),
    ...(requiredSources.length > 0 ? { requiredSources } : {})
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function aiMapActionsFromResponse(response: AiCopResponse | null): MatrixCopMapAction[] {
  const structured = asRecord(response?.result.structured);
  const explicitActions = Array.isArray(structured?.mapActions)
    ? structured.mapActions
        .map(normalizeAiMapAction)
        .filter((action): action is MatrixCopMapAction => action !== undefined)
    : [];
  if (explicitActions.length > 0) {
    return explicitActions.slice(0, 3);
  }

  const mapSearch = asRecord(structured?.mapSearch);
  const fallback = asRecord(structured?.mapSearchFallback);
  const fallbackResult = asRecord(fallback?.result);
  const mapSearchResults = Array.isArray(mapSearch?.results)
    ? mapSearch.results.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : [];
  const results = [...(fallbackResult ? [fallbackResult] : []), ...mapSearchResults];
  return results
    .map(aiMapActionFromResult)
    .filter((action): action is MatrixCopMapAction => action !== undefined)
    .slice(0, 3);
}

function normalizeAiMapAction(value: unknown): MatrixCopMapAction | undefined {
  const raw = asRecord(value);
  if (!raw) {
    return undefined;
  }
  const lat = finiteCoordinate(raw.lat, -90, 90);
  const lon = finiteCoordinate(raw.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  const category = optionalAiText(raw.category);
  const distanceText = optionalAiText(raw.distanceText);
  const entityId = optionalAiText(raw.entityId);
  const entityType = optionalAiText(raw.entityType);
  const layerId = optionalAiText(raw.layerId);
  const sourceName = optionalAiText(raw.sourceName);
  const sourceSystemIds = optionalAiTextList(raw.sourceSystemIds);
  const title = optionalAiText(raw.title);
  const zoom = finiteCoordinate(raw.zoom, 3, 20);
  return {
    action: "focus-map",
    ...(category ? { category } : {}),
    ...(distanceText ? { distanceText } : {}),
    ...(entityId ? { entityId } : {}),
    ...(entityType ? { entityType } : {}),
    label: optionalAiText(raw.label) ?? title ?? "Zobrazit na mapě",
    ...(layerId ? { layerId } : {}),
    lat,
    lon,
    ...(sourceName ? { sourceName } : {}),
    ...(sourceSystemIds.length > 0 ? { sourceSystemIds } : {}),
    ...(title ? { title } : {}),
    ...(zoom ? { zoom } : {})
  };
}

function aiMapActionFromResult(result: Record<string, unknown>): MatrixCopMapAction | undefined {
  const location = asRecord(result.location);
  const lat = finiteCoordinate(location?.lat, -90, 90);
  const lon = finiteCoordinate(location?.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  const title = optionalAiText(result.title);
  const category = optionalAiText(result.category);
  const distanceText = optionalAiText(result.distanceText);
  const entityId = optionalAiText(result.mapFeatureId);
  const entityType = optionalAiText(result.type);
  const layerId = optionalAiText(result.layerId);
  const sourceName = optionalAiText(result.sourceName);
  const sourceSystemIds = optionalAiTextList(result.sourceSystemIds);
  const labelBase = title ?? category ?? "mapový výsledek";
  return {
    action: "focus-map",
    ...(category ? { category } : {}),
    ...(distanceText ? { distanceText } : {}),
    ...(entityId ? { entityId } : {}),
    ...(entityType ? { entityType } : {}),
    label: distanceText ? `Zobrazit na mapě: ${labelBase} (${distanceText})` : `Zobrazit na mapě: ${labelBase}`,
    ...(layerId ? { layerId } : {}),
    lat,
    lon,
    ...(sourceName ? { sourceName } : {}),
    ...(sourceSystemIds.length > 0 ? { sourceSystemIds } : {}),
    ...(title ? { title } : {}),
    zoom: 16
  };
}

function finiteCoordinate(value: unknown, min: number, max: number): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, parsed));
}

function optionalAiText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 160) : undefined;
}

function optionalAiTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value.flatMap((item) => {
        const normalized = optionalAiText(item);
        return normalized ? [normalized] : [];
      })
    )
  ).slice(0, 16);
}

function aiResponseEvidenceMetadata(response: AiCopResponse | null): {
  indexedDocumentCount?: number;
  indexedStatus?: "degraded" | "disabled" | "ok";
  semanticDocumentCount?: number;
  semanticStatus?: "degraded" | "disabled" | "ok";
} {
  const structured = asRecord(response?.result.structured);
  const evidence = asRecord(structured?.evidence);
  const indexed = asRecord(evidence?.indexed);
  const semantic = asRecord(evidence?.semantic);
  return {
    indexedDocumentCount: boundedAiDocumentCount(indexed?.documentCount),
    indexedStatus: aiRetrievalStatus(indexed?.status),
    semanticDocumentCount: boundedAiDocumentCount(semantic?.documentCount),
    semanticStatus: aiRetrievalStatus(semantic?.status)
  };
}

function aiEvidenceMetadataLabel(ai: MatrixCopMessageMetadata["ai"]): string | undefined {
  const count = (ai?.semanticDocumentCount ?? 0) + (ai?.indexedDocumentCount ?? 0);
  if (count <= 0) {
    return undefined;
  }
  return `Ověřené zdroje: ${count}`;
}

function aiRetrievalStatus(value: unknown): "degraded" | "disabled" | "ok" | undefined {
  return value === "ok" || value === "degraded" || value === "disabled" ? value : undefined;
}

function boundedAiDocumentCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1000, Math.trunc(value)))
    : undefined;
}

function latestMessagePreview(message: MatrixTimelineMessage): string {
  const body = messageDisplayBody(message);
  if (message.cop?.kind === "ai-agent-response" || isAiAgentFallbackMessage(message)) {
    return `COP AI agent: ${body}`;
  }
  if (message.cop?.kind === "ai-situation-summary") {
    return `${message.own ? "Vy: " : ""}AI souhrn: ${body}`;
  }
  if (message.kind === "transit") {
    return transitMessageLabel(message.transit);
  }
  if (message.kind === "location") {
    return message.location?.label ?? "Sdílená poloha";
  }
  if (message.attachment) {
    return body && body !== message.attachment.fileName ? body : message.attachment.fileName;
  }
  return message.own ? `Vy: ${body}` : body;
}

export function chatListMessagePreview(message: MatrixTimelineMessage, chatType: ChatListItem["type"]): string {
  const preview = latestMessagePreview(message);
  if (message.own || chatType === "direct") {
    return preview;
  }
  const sender = message.senderDisplayName?.trim();
  if (!sender || preview.startsWith(`${sender}:`)) {
    return preview;
  }
  return `${sender}: ${preview}`;
}

function attachmentIndicator(message: MatrixTimelineMessage): React.ReactNode {
  if (message.kind === "image") {
    return <ImageIcon size={15} />;
  }
  if (message.kind === "video") {
    return <Video size={15} />;
  }
  if (message.kind === "file") {
    return <FileText size={15} />;
  }
  if (message.kind === "location") {
    return <MapPin size={15} />;
  }
  if (message.kind === "transit") {
    return <Bus size={15} />;
  }
  if (message.own) {
    return <CheckCheck size={15} />;
  }
  return null;
}

function matrixMessagePreviewItem(
  message: MatrixTimelineMessage,
  url?: string,
  posterUrl?: string,
  loadBlob?: () => Promise<Blob>
): MediaPreviewItem {
  if (message.kind === "location" && message.location) {
    return {
      caption: message.location.source === "device" ? "Poloha ze zařízení" : "Poloha z mapy",
      kind: "location",
      location: message.location,
      title: message.location.label ?? "Sdílená poloha"
    };
  }
  const attachment = message.attachment;
  if (!attachment) {
    return {
      caption: message.body,
      kind: "file",
      title: "Zpráva"
    };
  }
  const kind: MediaPreviewItem["kind"] =
    message.kind === "image"
      ? "image"
      : message.kind === "video"
        ? "video"
        : attachment.contentType?.includes("pdf") || /\.pdf$/iu.test(attachment.fileName)
          ? "document"
          : "file";
  const previewUrl = url ?? (kind === "image" ? posterUrl : undefined);
  return {
    contentType: attachment.encrypted ? "chráněná příloha" : (attachment.contentType ?? "soubor"),
    downloadName: attachment.fileName,
    kind,
    ...(loadBlob ? { loadBlob } : {}),
    title: attachment.fileName,
    ...(attachment.size ? { byteSizeLabel: formatBytes(attachment.size) } : {}),
    ...(message.body && message.body !== attachment.fileName ? { caption: message.body } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(previewUrl ? { url: previewUrl } : {})
  };
}

function directBrowserMediaUrl(message: MatrixTimelineMessage): string | null {
  const url = message.attachment?.mediaUrl;
  return url && directBrowserSafeUrl(url) && !message.attachment?.encrypted ? url : null;
}

function directBrowserThumbnailUrl(message: MatrixTimelineMessage): string | null {
  const url = message.attachment?.thumbnailUrl;
  return url && directBrowserSafeUrl(url) && !message.attachment?.encrypted ? url : null;
}

function directBrowserSafeUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("data:image/");
}

function attachmentMeta(message: MatrixTimelineMessage): string {
  const attachment = message.attachment;
  if (!attachment) {
    return "";
  }
  const size = attachment.size ? formatBytes(attachment.size) : "velikost neznámá";
  const type = attachment.encrypted ? "chráněno" : (attachment.contentType ?? message.kind);
  return `${type} · ${size}`;
}

function attachmentIcon(kind: MatrixAttachmentKind | MatrixTimelineMessage["kind"]): React.ReactNode {
  if (kind === "image") {
    return <ImageIcon size={17} />;
  }
  if (kind === "video") {
    return <Video size={17} />;
  }
  return <FileText size={17} />;
}

function attachmentKindLabel(kind: MatrixAttachmentKind): string {
  if (kind === "image") {
    return "Fotka";
  }
  if (kind === "video") {
    return "Video";
  }
  return "Soubor";
}

function attachmentAcceptForKind(kind: MatrixAttachmentKind): string {
  if (kind === "image") {
    return "image/*";
  }
  if (kind === "video") {
    return "video/*";
  }
  return "";
}

function normalizeAttachmentKind(file: File, requestedKind: MatrixAttachmentKind | undefined): MatrixAttachmentKind {
  if (requestedKind === "image" && file.type.startsWith("image/")) {
    return "image";
  }
  if (requestedKind === "video" && file.type.startsWith("video/")) {
    return "video";
  }
  if (file.type.startsWith("image/")) {
    return "image";
  }
  if (file.type.startsWith("video/")) {
    return "video";
  }
  return "file";
}

function conversationSubtitle(
  item: ChatListItem,
  room: MatrixRoomSummary | null,
  status?: MessagingStatusResponse | null
): string {
  if (isAiAgentChatItem(item)) {
    if (status?.chatAvailable && status.status === "online") {
      return "AI asistent online";
    }
    if (status?.chatAvailable) {
      return "AI asistent dostupný";
    }
    return "AI backend nedostupný";
  }
  if (item.type === "direct") {
    return roomPresenceLabel(room) ?? (room ? "stav se zjišťuje" : "přímý chat");
  }
  const memberLabel = `${item.memberCount} ${item.memberCount === 1 ? "člen" : item.memberCount < 5 ? "členové" : "členů"}`;
  if (!room?.presence) {
    return memberLabel;
  }
  if (room.presence.onlineMemberCount > 0) {
    return `${memberLabel} · ${room.presence.onlineMemberCount} online`;
  }
  if (room.presence.state === "offline") {
    return `${memberLabel} · nikdo online`;
  }
  return `${memberLabel} · stav se zjišťuje`;
}

function authDisplayName(session: AuthSession, config: AuthConfig): string {
  if (session.status === "authenticated") {
    return session.profile?.name ?? session.profile?.username ?? "Přihlášen";
  }
  if (session.status === "authenticating") {
    return "Ověřuji";
  }
  return config.mode === "lab" ? "Lab operator" : "Nepřihlášen";
}

function chatIdentityFor(
  session: AuthSession,
  config: AuthConfig,
  serverProfile: ServerUserProfile | null,
  localPreferences: LocalUserPreferences
): ChatIdentityProfile {
  const serverOperatorProfile = operatorProfileFromServer(serverProfile);
  const localOperatorProfile = operatorProfileFromPreferences(localPreferences);
  const displayName =
    serverOperatorProfile.displayName ?? localOperatorProfile.displayName ?? authDisplayName(session, config);
  const avatarUrl =
    serverOperatorProfile.avatarDataUrl ??
    localOperatorProfile.avatarDataUrl ??
    (session.status === "authenticated" ? trimmedString(session.profile?.picture) : undefined);
  const matrixProfile =
    session.status === "authenticated" && (displayName || avatarUrl)
      ? {
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(displayName ? { displayName } : {})
        }
      : undefined;

  return {
    ...(avatarUrl ? { avatarUrl } : {}),
    displayName,
    matrixProfile,
    subtitle: authSubtitle(session, config)
  };
}

function operatorProfileFromServer(serverProfile: ServerUserProfile | null): {
  avatarDataUrl?: string;
  displayName?: string;
} {
  const operatorProfile = asRecord(serverProfile?.preferences.operatorProfile);
  return {
    avatarDataUrl: trimmedString(operatorProfile?.avatarDataUrl),
    displayName: trimmedString(operatorProfile?.displayName) ?? trimmedString(serverProfile?.actor.displayName)
  };
}

function operatorProfileFromPreferences(preferences: LocalUserPreferences): {
  avatarDataUrl?: string;
  displayName?: string;
} {
  const operatorProfile = asRecord(preferences.operatorProfile);
  return {
    avatarDataUrl: trimmedString(operatorProfile?.avatarDataUrl),
    displayName: trimmedString(operatorProfile?.displayName)
  };
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function authSubtitle(session: AuthSession, config: AuthConfig): string {
  if (session.status === "authenticated") {
    return session.profile?.username ?? "ověřená identita";
  }
  if (session.status === "error") {
    return session.error ?? "chyba přihlášení";
  }
  if (config.mode === "lab") {
    return "bez Matrix identity";
  }
  return "OIDC účet";
}

function statusLabelFor(
  status: MessagingStatusResponse | null,
  matrixSession: MatrixMessagingSession | null,
  syncState: string,
  loading: boolean
): string {
  if (loading) {
    return "připojuji";
  }
  if (matrixSession) {
    const normalized = syncState.toLowerCase();
    if (normalized.includes("sync")) {
      return "synchronizuji";
    }
    return "online";
  }
  if (status?.chatAvailable) {
    return "připraveno";
  }
  if (status?.status === "disabled") {
    return "vypnuto";
  }
  return "čeká";
}

function installChatHapticFeedback(): () => void {
  if (typeof window === "undefined" || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return () => undefined;
  }
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => undefined;
  }
  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        'button:not(:disabled), a[href], [role="button"], input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled), summary'
      )
    ) {
      navigator.vibrate(8);
    }
  };
  window.addEventListener("pointerdown", handlePointerDown, { passive: true });
  return () => window.removeEventListener("pointerdown", handlePointerDown);
}

function chatConnectionStateFor(
  item: ChatListItem,
  chatReady: boolean,
  matrixSession: MatrixMessagingSession | null,
  syncState: string,
  preparing: boolean,
  status?: MessagingStatusResponse | null
): ChatConnectionState {
  if (!chatReady || isMatrixSyncOffline(syncState)) {
    return "offline";
  }
  if (isAiAgentChatItem(item)) {
    if (preparing) {
      return "syncing";
    }
    return status?.chatAvailable ? "online" : "offline";
  }
  if (preparing || !matrixSession) {
    return "syncing";
  }
  if (!item.roomId && !item.room) {
    return "offline";
  }
  const presenceState = item.room?.presence?.state;
  if (presenceState === "online") {
    return "online";
  }
  if (presenceState === "offline") {
    return "offline";
  }
  if (isMatrixSyncWarming(syncState)) {
    return "syncing";
  }
  return "syncing";
}

function roomPresenceLabel(room: MatrixRoomSummary | null): string | null {
  const presence = room?.presence;
  if (!presence) {
    return null;
  }
  if (presence.onlineMemberCount > 0) {
    return "online";
  }
  if (presence.state === "offline") {
    return "offline";
  }
  return "stav se zjišťuje";
}

function isMatrixSyncWarming(syncState: string): boolean {
  const normalized = syncState.toLowerCase();
  return (
    normalized.includes("catch") ||
    normalized.includes("prep") ||
    normalized.includes("reconnect") ||
    normalized.includes("start")
  );
}

function isMatrixSyncOffline(syncState: string): boolean {
  const normalized = syncState.toLowerCase();
  return (
    normalized.includes("error") ||
    normalized.includes("stop") ||
    normalized.includes("offline") ||
    normalized.includes("fail")
  );
}

export function userFacingError(message: string): string {
  const normalized = message.trim();
  if (isMatrixInteractiveAuthError(normalized)) {
    return "Matrix vyžaduje dodatečné ověření pro reset E2EE a serverové ověření se nepodařilo dokončit. Klíč nebyl nahrazen. Obnovte stránku jednou; pokud se chyba opakuje, požádejte správce o kontrolu CSM Messaging.";
  }
  if (isMatrixSessionExpiredError(normalized)) {
    return "Platnost Matrix relace vypršela. Obnovte stránku nebo znovu otevřete chat a akci opakujte.";
  }
  if (isMatrixDuplicateOneTimeKeyUploadError(normalized)) {
    return "Matrix už pro původní webové zařízení evidoval část šifrovacích klíčů. Chat teď používá nové bezpečné webové zařízení; otevřete dialog znovu a vytvořte nový obnovovací klíč.";
  }
  if (isSensitiveMatrixKeyMaterialError(normalized)) {
    return "Matrix odmítl obnovu E2EE kvůli nekonzistentnímu stavu šifrovacích klíčů. Použijte nouzový reset a vytvořte nový obnovovací klíč.";
  }
  if (/\b(401|403)\b/u.test(normalized) || /unauthori[sz]ed|forbidden|přihlášen/i.test(normalized)) {
    return "Pro tuto akci je potřeba platné přihlášení.";
  }
  if (
    /\b(500|502|503|504)\b/u.test(normalized) ||
    /service unavailable|gateway timeout|bad gateway/i.test(normalized)
  ) {
    return "Služba zpráv je dočasně nedostupná.";
  }
  if (/\b(429)\b/u.test(normalized) || /too many|rate.?limit|M_LIMIT_EXCEEDED/i.test(normalized)) {
    return "Akce už probíhá nebo ji služba dočasně omezila. Chvíli počkejte a neopakujte kliknutí.";
  }
  if (/fetch failed|load failed|failed to fetch|network/i.test(normalized)) {
    return "Služba zpráv není z tohoto zařízení dostupná.";
  }
  return normalized || "Akci se nepodařilo dokončit.";
}

function isMatrixInteractiveAuthError(message: string): boolean {
  return (
    /device_signing\/upload|cross[- ]signing|secret storage|SecretStorage|interactive auth|UIA|m\.login|M_FORBIDDEN|getSecretStorageKey callback returned falsey/i.test(
      message
    ) &&
    /\b(401|403)\b|M_FORBIDDEN|M_UNAUTHORIZED|unauthori[sz]ed|forbidden|getSecretStorageKey callback returned falsey/i.test(
      message
    )
  );
}

function isMatrixSessionExpiredError(message: string): boolean {
  return (
    /MatrixError|_matrix|M_UNKNOWN_TOKEN|unknown token|access token/i.test(message) &&
    /\b401\b|M_UNKNOWN_TOKEN|unknown token|expired/i.test(message)
  );
}

function isMatrixDuplicateOneTimeKeyUploadError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("one time key") &&
    normalized.includes("already exists") &&
    (normalized.includes("signed_curve25519") ||
      normalized.includes("keys/upload") ||
      normalized.includes("/keys/upload"))
  );
}

function isSensitiveMatrixKeyMaterialError(message: string): boolean {
  return /signed_curve25519|ed25519|curve25519|old key|new key|signatures|\/keys\/upload|_matrix\/client\/v3\/keys/iu.test(
    message
  );
}

function readLocalUserPreferences(ownerId: string): LocalUserPreferences {
  try {
    const storageKey = scopedCopUserPreferencesKey(ownerId);
    const raw =
      window.localStorage.getItem(storageKey) ??
      (storageKey === copUserPreferencesStorageKey ? null : window.localStorage.getItem(copUserPreferencesStorageKey));
    if (!raw) {
      return {};
    }
    const parsed = asRecord(JSON.parse(raw));
    const operatorProfile = asRecord(parsed?.operatorProfile);
    const avatarDataUrl = trimmedString(operatorProfile?.avatarDataUrl);
    const displayName = trimmedString(operatorProfile?.displayName);
    return {
      ...(avatarDataUrl || displayName
        ? {
            operatorProfile: {
              ...(avatarDataUrl ? { avatarDataUrl } : {}),
              ...(displayName ? { displayName } : {})
            }
          }
        : {})
    };
  } catch {
    return {};
  }
}

function readChatPreferences(ownerId: string): ChatPreferences {
  const storageKey = `${chatPreferencesStoragePrefix}.${stableStorageKey(ownerId)}`;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return emptyChatPreferences;
    }
    return normalizeChatPreferences(JSON.parse(raw) as Partial<ChatPreferences>);
  } catch {
    return emptyChatPreferences;
  }
}

function writeChatPreferences(ownerId: string, preferences: ChatPreferences): void {
  const storageKey = `${chatPreferencesStoragePrefix}.${stableStorageKey(ownerId)}`;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizeChatPreferences(preferences)));
  } catch {
    // localStorage can be unavailable in privacy modes; preferences then stay in memory.
  }
}

function persistentTimelineFingerprint(messages: MatrixTimelineMessage[]): string {
  return JSON.stringify(messages);
}

function muteChoiceToStorageValue(choice: MuteChoice): string {
  if (choice === "forever") {
    return "forever";
  }
  const durationMs = choice === "8h" ? 8 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + durationMs).toISOString();
}

function messageSearchText(message: MatrixTimelineMessage): string {
  return [
    messageDisplayBody(message),
    message.attachment?.fileName,
    message.location ? formatCoordinates(message.location) : "",
    message.location?.label ?? "",
    message.transit ? transitMessageLabel(message.transit) : "",
    message.transit?.destination ?? "",
    message.transit?.nextStopName ?? ""
  ]
    .filter(Boolean)
    .join(" ");
}

function messagePreviewText(message: MatrixTimelineMessage): string {
  const text = messageSearchText(message) || latestMessagePreview(message);
  return text.length > 120 ? `${text.slice(0, 117).trimEnd()}...` : text;
}

function matrixReplyTarget(message: MatrixTimelineMessage, session: AuthSession) {
  return {
    body: messagePreviewText(message),
    eventId: message.eventId,
    sender: message.own ? "Vy" : (message.senderDisplayName ?? message.sender ?? session.profile?.username ?? "Člen")
  };
}

function isDemoTimelineMessage(message: MatrixTimelineMessage): boolean {
  return message.eventId.startsWith("demo:");
}

function formatMessageForClipboard(message: MatrixTimelineMessage): string {
  const time = new Date(message.timestamp).toLocaleString("cs-CZ");
  return `[${time}] ${message.own ? "Vy" : (message.senderDisplayName ?? "Člen")}: ${messageSearchText(message) || message.body}`;
}

function formatMessageForForward(message: MatrixTimelineMessage): string {
  const prefix = message.own ? "Přeposláno od vás" : `Přeposláno od ${message.senderDisplayName ?? "člena"}`;
  return `${prefix}:\n${messageSearchText(message) || message.body}`;
}

function transitMessageLabel(transit: MatrixTransitShare | undefined): string {
  if (!transit) {
    return "Sdílený spoj";
  }
  const route = transit.routeShortName ? ` ${transit.routeShortName}` : "";
  const destination = transit.destination ? ` → ${transit.destination}` : "";
  return `Jsem ve spoji${route}${destination}`;
}

function formatTransitModeLabel(mode: string): string {
  const normalized = mode.toLocaleLowerCase("cs-CZ");
  if (normalized.includes("tram")) return "Tramvaj";
  if (normalized.includes("metro") || normalized.includes("subway")) return "Metro";
  if (normalized.includes("train") || normalized.includes("rail")) return "Vlak";
  if (normalized.includes("trolley")) return "Trolejbus";
  if (normalized.includes("bus")) return "Autobus";
  return "Spoj";
}

function formatTransitStatusLabel(status: string): string {
  const normalized = status.toLocaleLowerCase("cs-CZ");
  if (normalized === "on_time" || normalized === "ok") return "jede včas";
  if (normalized === "delayed" || normalized.includes("delay")) return "zpoždění";
  if (normalized.includes("cancel")) return "zrušeno";
  return status.replaceAll("_", " ");
}

function applyLocalReaction(
  messages: MatrixTimelineMessage[],
  messageId: string,
  key: string,
  senderLabel: string
): MatrixTimelineMessage[] {
  return messages.map((message) => {
    if (message.eventId !== messageId) {
      return message;
    }
    const ownReaction = message.reactions?.find((reaction) => reaction.own) ?? null;
    const reactions = (message.reactions ?? [])
      .map((reaction) => {
        if (!reaction.own) {
          return reaction;
        }
        const count = Math.max(0, reaction.count - 1);
        const senders = reaction.senders.filter((sender) => sender !== senderLabel).slice(0, count);
        return {
          ...reaction,
          count,
          own: false,
          senders
        };
      })
      .filter((reaction) => reaction.count > 0);
    if (ownReaction?.key === key) {
      const sortedReactions = reactions.sort(
        (left, right) => right.count - left.count || left.key.localeCompare(right.key, "cs-CZ")
      );
      if (sortedReactions.length === 0) {
        const messageWithoutReactions = { ...message };
        delete messageWithoutReactions.reactions;
        return messageWithoutReactions;
      }
      return {
        ...message,
        reactions: sortedReactions
      };
    }
    const index = reactions.findIndex((reaction) => reaction.key === key);
    if (index === -1) {
      reactions.push({
        count: 1,
        key,
        own: true,
        senders: [senderLabel]
      });
    } else {
      const current = reactions[index];
      if (!current) {
        return message;
      }
      const senders = current.senders.includes(senderLabel) ? current.senders : [...current.senders, senderLabel];
      reactions[index] = {
        ...current,
        count: Math.max(current.count + (current.own ? 0 : 1), senders.length),
        own: true,
        senders
      };
    }
    return {
      ...message,
      reactions: reactions.sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "cs-CZ"))
    };
  });
}

function isInteractiveMessageTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, [role='button']"));
}

function splitTextByQuery(text: string, query: string): Array<{ match: boolean; text: string }> {
  const normalizedText = text.toLocaleLowerCase("cs-CZ");
  const normalizedQuery = query.toLocaleLowerCase("cs-CZ");
  const parts: Array<{ match: boolean; text: string }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = normalizedText.indexOf(normalizedQuery, cursor);
    if (index === -1) {
      parts.push({ match: false, text: text.slice(cursor) });
      break;
    }
    if (index > cursor) {
      parts.push({ match: false, text: text.slice(cursor, index) });
    }
    parts.push({ match: true, text: text.slice(index, index + query.length) });
    cursor = index + query.length;
  }
  return parts.length > 0 ? parts : [{ match: false, text }];
}

function cssEscape(value: string): string {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/gu, "\\$&");
}

export function infoMembersForChat(
  activeChat: ChatListItem,
  conversation: MessagingConversationSummary | null,
  group: CommunityGroup | null,
  session: AuthSession,
  ownAvatarUrl?: string
): ChatInfoMember[] {
  if (group) {
    const ownIds = ownChatIdentityIds(session, undefined);
    return group.members.map((member) => {
      const conversationMember = conversation?.members?.find((candidate) =>
        identityMatches(candidate.userId, [member.subjectId, member.username])
      );
      const isOwnMember = [member.subjectId, member.username].some((candidate) =>
        ownIds.has(normalizeIdentityId(candidate))
      );
      const avatarUrl = isOwnMember ? (ownAvatarUrl ?? conversationMember?.avatarUrl) : conversationMember?.avatarUrl;
      return {
        ...(avatarUrl ? { avatarUrl } : {}),
        id: member.subjectId,
        name: member.displayName || member.username || member.subjectId,
        role: member.role,
        status: member.status,
        subjectId: member.subjectId,
        subtitle: communityGroupMemberSubtitle(member)
      };
    });
  }
  const ownId = session.profile?.subjectId ?? session.profile?.username ?? "";
  const members = conversation?.members ?? [];
  const contact = members.find((member) => member.userId !== ownId) ?? members[0];
  if (contact) {
    return [
      {
        ...(contact.avatarUrl ? { avatarUrl: contact.avatarUrl } : {}),
        id: contact.userId,
        name: contact.displayName || activeChat.title,
        subtitle: contact.userId
      }
    ];
  }
  return [
    {
      id: activeChat.preferenceKey,
      name: activeChat.title,
      subtitle: activeChat.type === "direct" ? "kontakt" : "chat"
    }
  ];
}

function identityMatches(value: string, candidates: string[]): boolean {
  const aliases = new Set(
    [value, matrixUserIdLocalpart(value)]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map(normalizeIdentityId)
  );
  return candidates.some((candidate) => {
    const normalized = normalizeIdentityId(candidate);
    const localpart = matrixUserIdLocalpart(candidate);
    return aliases.has(normalized) || Boolean(localpart && aliases.has(normalizeIdentityId(localpart)));
  });
}

function communityGroupMemberSubtitle(member: CommunityGroup["members"][number]): string {
  if (member.status === "left") {
    return "odešel/a";
  }
  if (member.status === "pending") {
    return "čeká na schválení";
  }
  if (member.role === "owner") {
    return "vlastník";
  }
  if (member.role === "admin") {
    return "správce";
  }
  return "člen";
}

function mediaGridLabel(message: MatrixTimelineMessage): string {
  if (message.location) {
    return message.location.label ?? formatCoordinates(message.location);
  }
  return message.attachment?.fileName ?? (message.body || "Zpráva");
}

function readBrowserNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !window.isSecureContext || !("Notification" in window)) {
    return "unsupported";
  }
  return window.Notification.permission;
}

function notificationButtonLabel(state: WebPushUiState): string {
  if (state.registered) {
    return "Webové notifikace zapnuté";
  }
  if (state.permission === "granted") {
    return "Dokončit registraci webových notifikací";
  }
  if (state.permission === "denied") {
    return "Upozornění blokovaná";
  }
  return state.enabled ? "Zapnout webové notifikace" : "Webové notifikace nejsou připravené";
}

function isActiveFocusedRoom(roomId: string, selectedRoomId: string | null): boolean {
  if (roomId !== selectedRoomId) {
    return false;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

export function collectIncomingChatNotifications(
  snapshots: ChatNotificationRoomSnapshot[],
  tracker: ChatNotificationTracker,
  observedAt = Date.now()
): IncomingChatNotification[] {
  const pendingNotifications: IncomingChatNotification[] = [];
  for (const snapshot of snapshots) {
    const roomId = snapshot.room.roomId;
    const latestTimestamp = latestNotificationTimestamp(snapshot.messages);
    if (!tracker.primedRoomIds.has(roomId)) {
      const latestMessage = snapshot.messages.at(-1);
      if (latestMessage) {
        tracker.notifiedEventIds.add(latestMessage.eventId);
      }
      tracker.primedRoomIds.add(roomId);
      tracker.roomWatermarks.set(roomId, Math.max(latestTimestamp ?? observedAt, observedAt));
      continue;
    }

    const currentWatermark = tracker.roomWatermarks.get(roomId) ?? observedAt;
    let nextWatermark = Math.max(currentWatermark, latestTimestamp ?? currentWatermark);
    for (const message of notificationMessagesAfterWatermark(snapshot.messages, currentWatermark)) {
      const messageTimestamp = notificationTimestampMillis(message);
      if (Number.isFinite(messageTimestamp)) {
        nextWatermark = Math.max(nextWatermark, messageTimestamp);
      }
      if (tracker.notifiedEventIds.has(message.eventId)) {
        continue;
      }
      tracker.notifiedEventIds.add(message.eventId);
      if (!Number.isFinite(messageTimestamp) || messageTimestamp <= currentWatermark) {
        continue;
      }
      if (message.own || snapshot.muted || snapshot.activeFocused) {
        continue;
      }
      pendingNotifications.push({ chat: snapshot.chat, message, room: snapshot.room });
    }
    tracker.roomWatermarks.set(roomId, nextWatermark);
  }
  return pendingNotifications;
}

function chatItemForRoom(chatItems: ChatListItem[], roomId: string): ChatListItem | null {
  return (
    chatItems.find(
      (item) => item.roomId === roomId || item.room?.roomId === roomId || item.conversation?.matrix?.roomId === roomId
    ) ?? null
  );
}

function showIncomingChatNotification(candidate: IncomingChatNotification, onOpen: () => void): void {
  if (readBrowserNotificationPermission() !== "granted") {
    return;
  }
  const title = candidate.chat?.title || candidate.room.name || "Nová zpráva";
  const body = incomingNotificationBody(candidate.message);
  const notification = new window.Notification(title, {
    body,
    icon: "/icons/cop-icon.svg",
    tag: chatNotificationTag(candidate.room.roomId, candidate.message.eventId)
  });
  notification.onclick = () => {
    notification.close();
    onOpen();
  };
}

export function shouldShowInAppChatNotification(
  state: Pick<WebPushUiState, "permission" | "registered" | "subscriptionActive">
): boolean {
  return state.permission === "granted" && !(state.registered && state.subscriptionActive !== false);
}

export function chatNotificationTag(roomId: string, eventId: string): string {
  return `cop-chat-${roomId}-${eventId}`;
}

function latestNotificationTimestamp(messages: MatrixTimelineMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const timestamp = notificationTimestampMillis(message);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return undefined;
}

function notificationMessagesAfterWatermark(
  messages: MatrixTimelineMessage[],
  watermark: number
): MatrixTimelineMessage[] {
  // Matrix and the local merge cache both expose timelines chronologically.
  // Walk backwards and stop at the first acknowledged event so a notification
  // tick costs O(new messages), not O(all retained history).
  const recent: MatrixTimelineMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const timestamp = notificationTimestampMillis(message);
    if (Number.isFinite(timestamp) && timestamp <= watermark) {
      break;
    }
    recent.push(message);
  }
  recent.reverse();
  return recent;
}

function notificationTimestampMillis(message: MatrixTimelineMessage): number {
  return Date.parse(message.timestamp);
}

function updateApplicationBadge(count: number): void {
  if (typeof navigator === "undefined") {
    return;
  }
  const badgeNavigator = navigator as Navigator & {
    clearAppBadge?: () => Promise<void>;
    setAppBadge?: (contents?: number) => Promise<void>;
  };
  const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  postServiceWorkerBadgeUpdate(normalizedCount);
  if (normalizedCount > 0 && typeof badgeNavigator.setAppBadge === "function") {
    void badgeNavigator.setAppBadge(Math.min(normalizedCount, 99)).catch(() => undefined);
    return;
  }
  if (normalizedCount === 0 && typeof badgeNavigator.clearAppBadge === "function") {
    void badgeNavigator.clearAppBadge().catch(() => undefined);
  }
}

function postServiceWorkerBadgeUpdate(count: number): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const message = { count, type: "cop:pwa:set-badge" };
  const controller = navigator.serviceWorker.controller;
  if (controller) {
    controller.postMessage(message);
    return;
  }
  void navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage(message))
    .catch(() => undefined);
}

function incomingNotificationBody(message: MatrixTimelineMessage): string {
  const preview = latestMessagePreview(message);
  const sender = message.senderDisplayName?.trim();
  return sender ? `${sender}: ${preview}` : preview;
}

function findChatItemForSelection(selection: string, chatItems: ChatListItem[]): ChatListItem | null {
  return (
    chatItems.find(
      (item) =>
        item.id === selection ||
        item.conversation?.conversationId === selection ||
        item.conversation?.matrix?.roomId === selection ||
        item.group?.groupId === selection ||
        item.room?.roomId === selection
    ) ?? null
  );
}

function stableStorageKey(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._=-]+/gu, "_")
      .slice(0, 96) || "anonymous"
  );
}

function scopedCopUserPreferencesKey(ownerId: string): string {
  const normalizedOwner = ownerId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  return normalizedOwner ? `${copUserPreferencesStorageKey}.${normalizedOwner}` : copUserPreferencesStorageKey;
}

async function getDeviceLocation(): Promise<MatrixLocationShare> {
  if (!navigator.geolocation) {
    throw new Error("Prohlížeč nepodporuje sdílení polohy.");
  }
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 12_000
    });
  });
  return matrixLocationFromGeolocationPosition(position);
}

function matrixLocationFromGeolocationPosition(position: GeolocationPosition): MatrixLocationShare {
  return {
    accuracyM: position.coords.accuracy,
    label: "Moje poloha",
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    source: "device",
    updatedAt: new Date().toISOString()
  };
}

function createLiveLocationShareId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `live:${crypto.randomUUID()}`;
  }
  return `live:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function liveLocationShareLabel(authSession: AuthSession): string {
  const profileName = authSession.profile?.name || authSession.profile?.username;
  return profileName ? `${profileName} živě` : "Živá poloha";
}

function formatLiveLocationDuration(seconds: number): string {
  if (seconds >= 60 * 60) {
    const hours = Math.round(seconds / 3600);
    return hours === 1 ? "1 hodinu" : `${hours} hodin`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minut`;
}

function formatLiveLocationRemaining(expiresAt: string | undefined, now = Date.now()): string | null {
  if (!expiresAt) {
    return null;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }
  const remainingSeconds = Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
  if (remainingSeconds <= 0) {
    return "vypršelo";
  }
  if (remainingSeconds < 60) {
    return "méně než min";
  }
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  if (remainingMinutes < 60) {
    return `${remainingMinutes} min`;
  }
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function aiQuestionNeedsCurrentLocation(question: string): boolean {
  const normalized = question
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("cs-CZ");
  return (
    /\b(nejbliz|nejblizsi|closest|nearest|near me)\b/u.test(normalized) ||
    /\b(u me|ode me|moje poloha|moji polohy|me polohy|blizko me polohy|blizko moji polohy|aktualni poloha|current location)\b/u.test(
      normalized
    ) ||
    /\b(v okoli|okoli me|okoli moji polohy|pobliz me|pobliz moji polohy|kolem me|around me|nearby)\b/u.test(normalized)
  );
}

function geolocationErrorMessage(error: unknown): string {
  if (typeof GeolocationPositionError !== "undefined" && error instanceof GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED) {
      return "Poloha pro AI nebyla povolena. Pro dotazy typu nejbližší objekt povolte polohu v prohlížeči nebo zadejte konkrétní místo.";
    }
    if (error.code === error.TIMEOUT) {
      return "Polohu pro AI se nepodařilo zaměřit v časovém limitu. Zkuste to znovu nebo zadejte konkrétní místo.";
    }
  }
  return error instanceof Error ? error.message : "Polohu pro AI se nepodařilo zaměřit.";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatShortTimestamp(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return formatTime(value);
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit"
  }).format(date);
}

function timestampMillis(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase("cs-CZ").replace(/\s+/gu, " ");
}

function titleTypeKey(title: string, type: "direct" | "group"): string {
  return `${type}:${normalizeTitle(title)}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
