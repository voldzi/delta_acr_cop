import React from "react";
import clsx from "clsx";
import {
  AlertCircle,
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
  Forward,
  Image as ImageIcon,
  Info,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  MoreVertical,
  Phone,
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
  isOidcEnabled,
  plannedAuthRefreshDelayMs,
  readAuthConfig,
  refreshAuthSession,
  shouldExpireAuthSessionAfterRefreshFailure
} from "@cop/core/auth";
import type { AuthConfig, AuthSession } from "@cop/core/auth";
import {
  bindMessagingConversationMatrixRoom,
  createAiSituationSummary,
  createCommunityGroup,
  createMessagingConversation,
  deleteCommunityGroup,
  fetchCommunityGroups,
  fetchAiChatAgentJob,
  fetchMessagingConversations,
  fetchMessagingStatus,
  fetchUserProfile,
  leaveCommunityGroup,
  removeCommunityGroupMember,
  resolveMessagingMatrixIdentities,
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
  MessagingMatrixIdentityResolutionResponse,
  MessagingMatrixRoomBindingResponse,
  MessagingStatusResponse,
  ServerUserProfile,
  UserDirectoryEntry
} from "@cop/core/cop-data";
import {
  publishChatUnreadCount,
  rotateMatrixDeviceId
} from "@cop/messaging/runtime";
import type {
  MatrixAttachmentKind,
  MatrixAttachmentUpload,
  MatrixCopMessageMetadata,
  MatrixLocationShare,
  MatrixMessagingSession,
  MatrixRoomSummary,
  MatrixTimelineMessage,
  MatrixTransitShare
} from "@cop/messaging/types";
import { decodeChatShareTransit } from "@cop/messaging/bridge";
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
import { useVirtualTimelineRows, type TimelineRow } from "./hooks/useVirtualTimelineRows";
import {
  buildTimelineRows,
  filterTimelineByRetention,
  isChatMuted,
  mergeTimelineMessages,
  messageMatchesQuery,
  normalizeChatPreferences,
  type ChatPreferences
} from "./chat-model";
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

export { embeddedChatSelectionFromMessage, readRouteSelection, writeChatRoute } from "./hooks/useChatRouting";
export { centerLocationInCop } from "./components/LocationPreview";
export {
  buildTimelineRows,
  filterTimelineByRetention,
  isChatMuted,
  mergeTimelineMessages,
  messageMatchesQuery,
  normalizeChatPreferences
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
type BrowserNotificationPermission = NotificationPermission | "unsupported";

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

interface ChatInfoMember {
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

interface IncomingChatNotification {
  chat: ChatListItem | null;
  message: MatrixTimelineMessage;
  room: MatrixRoomSummary;
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

const apiBase = trimTrailingSlash(import.meta.env.VITE_COP_API_BASE_URL ?? "");
const labToken = import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ?? "dev-lab-token";
const copUserPreferencesStorageKey = "cop.user.preferences.v1";
const chatPreferencesStoragePrefix = "cop.chat.preferences.v1";
const initialHistoryLoadRetryLimit = 8;
const aiChatAgentJobPollIntervalMs = 1500;
const aiChatAgentJobPollLimit = 90;
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
  const [notificationPermission, setNotificationPermission] = React.useState<BrowserNotificationPermission>(() => readBrowserNotificationPermission());
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
  const [forwardSelectedTargetsByKey, setForwardSelectedTargetsByKey] = React.useState<Record<string, ForwardTarget>>({});
  const [forwardUserSuggestions, setForwardUserSuggestions] = React.useState<UserDirectoryEntry[]>([]);
  const [forwardWorkingId, setForwardWorkingId] = React.useState<string | null>(null);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = React.useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = React.useState("");
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = React.useState<string | null>(null);
  const [recoveryWorking, setRecoveryWorking] = React.useState(false);
  const [chatRemovalWorking, setChatRemovalWorking] = React.useState(false);
  const [memberRemovalCandidate, setMemberRemovalCandidate] = React.useState<MemberRemovalCandidate | null>(null);
  const [memberRemovalWorking, setMemberRemovalWorking] = React.useState(false);
  const [aiSituationDialogOpen, setAiSituationDialogOpen] = React.useState(false);
  const [aiSituationResponse, setAiSituationResponse] = React.useState<AiCopResponse | null>(null);
  const [aiSituationError, setAiSituationError] = React.useState<string | null>(null);
  const [aiSituationWorking, setAiSituationWorking] = React.useState(false);
  const [aiAgentDialogOpen, setAiAgentDialogOpen] = React.useState(false);
  const [aiAgentQuestion, setAiAgentQuestion] = React.useState("");
  const [aiAgentModelPreference, setAiAgentModelPreference] = React.useState<AiModelPreference>("fast");
  const [aiAgentResponse, setAiAgentResponse] = React.useState<AiCopResponse | null>(null);
  const [aiAgentError, setAiAgentError] = React.useState<string | null>(null);
  const [aiAgentJobStatus, setAiAgentJobStatus] = React.useState<string | null>(null);
  const [aiAgentWorking, setAiAgentWorking] = React.useState(false);
  const [aiAgentGroupUpdating, setAiAgentGroupUpdating] = React.useState(false);
  const [muteDialogOpen, setMuteDialogOpen] = React.useState(false);
  const [deleteChatCandidate, setDeleteChatCandidate] = React.useState<ChatListItem | null>(null);
  const [retentionDialogOpen, setRetentionDialogOpen] = React.useState(false);
  const [retentionSaving, setRetentionSaving] = React.useState(false);
  const [retentionOverrideByRoom, setRetentionOverrideByRoom] = React.useState<Record<string, MessageRetentionSeconds>>({});
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
  const matrixAttemptKeyRef = React.useRef<string | null>(null);
  const initialHistoryLoadAttemptsRef = React.useRef<Map<string, number>>(new Map());
  const historyLoadingRoomsRef = React.useRef<Set<string>>(new Set());
  const notifiedEventIdsRef = React.useRef<Set<string>>(new Set());
  const notificationsPrimedRef = React.useRef(false);
  const selectedRoomIdRef = React.useRef<string | null>(null);
  const timelineCacheRef = React.useRef<Map<string, MatrixTimelineMessage[]>>(new Map());
  const conversationsRef = React.useRef<MessagingConversationSummary[]>(conversations);
  const memberAddPendingIdsRef = React.useRef<Set<string>>(new Set());

  const authToken = getAuthorizationToken(authSession, labToken);
  const authenticated = Boolean(authToken);
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
  const handleMatrixRoomsChanged = React.useCallback((nextRooms: MatrixRoomSummary[], preferredSelection?: string | null) => {
    setRooms(nextRooms);
    setSelectedRoomId((current) => current ?? selectRoomIdFromKey(preferredSelection, conversationsRef.current, nextRooms));
  }, [setSelectedRoomId]);
  const handleMatrixTimelineChanged = React.useCallback(() => setTimelineRevision((value) => value + 1), []);
  const {
    encryptionRecoveryStatus,
    ensureMatrixSession,
    matrixLoading,
    matrixSessionLifecycle,
    matrixSession,
    matrixSessionRef,
    refreshEncryptionRecoveryStatus,
    resetMatrixSession,
    startMatrixSession,
    syncState
  } = useMatrixSession({
    apiBase,
    authSubjectId,
    authToken,
    conversationsRef,
    matrixProfile: chatIdentity.matrixProfile,
    onError: setError,
    onNotice: setNotice,
    onRoomsChanged: handleMatrixRoomsChanged,
    onTimelineChanged: handleMatrixTimelineChanged
  });
  const ownIdentityIds = React.useMemo(
    () => ownChatIdentityIds(authSession, matrixSession?.bootstrap.userId),
    [authSession, matrixSession?.bootstrap.userId]
  );

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
          setAuthRefreshRetry(0);
          setAuthSession(nextSession);
          matrixAttemptKeyRef.current = null;
          resetMatrixSession();
          setRefreshNonce((value) => value + 1);
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
  const selectedConversation = selectedConversationId
    ? conversations.find((conversation) => conversation.conversationId === selectedConversationId) ?? null
    : selectedRoomId
      ? conversations.find((conversation) => conversation.matrix?.roomId === selectedRoomId) ?? null
      : null;
  const selectedGroup = selectedGroupId
    ? groups.find((group) => group.groupId === selectedGroupId) ?? null
    : selectedConversation
      ? groupForConversation(selectedConversation, groups)
      : null;
  const canManageSelectedGroupMembers = selectedGroup
    ? canManageCommunityGroupMembers(selectedGroup, authSubjectId)
    : false;
  const selectedGroupAiAssistant = selectedGroup ? communityGroupAiAssistantMetadata(selectedGroup) : null;
  const selectedGroupAiAssistantEnabled = Boolean(selectedGroupAiAssistant?.enabled);
  const selectedRoom = selectedRoomId
    ? rooms.find((room) => room.roomId === selectedRoomId) ?? null
    : selectedConversation?.matrix?.roomId
      ? rooms.find((room) => room.roomId === selectedConversation.matrix?.roomId) ?? null
      : null;
  const rawChatItems = React.useMemo(
    () => buildChatItems({
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
    [authSubjectId, chatFilter, conversationQuery, conversations, groups, ownIdentityIds, rooms, selectedConversationId, selectedGroupId, selectedRoomId]
  );
  const chatItems = React.useMemo(
    () => applyChatPreferences(rawChatItems, chatPreferences),
    [chatPreferences, rawChatItems]
  );
  const pinnedChatItems = React.useMemo(
    () => chatItems.filter((item) => item.pinned),
    [chatItems]
  );
  const regularChatItems = React.useMemo(
    () => chatItems.filter((item) => !item.pinned),
    [chatItems]
  );
  const activeChat = chatItems.find((item) => item.active) ?? null;
  const selectedAiAgentDirectChat = activeChat ? isAiAgentChatItem(activeChat) : false;
  const routeChatSelected = Boolean(activeChat && readRouteSelection());
  const totalUnreadCount = React.useMemo(
    () => chatItems.reduce((count, item) => count + (!item.muted ? item.unreadCount : 0), 0),
    [chatItems]
  );
  const activeMessageRetentionSeconds = selectedRoomId && Object.prototype.hasOwnProperty.call(retentionOverrideByRoom, selectedRoomId)
    ? retentionOverrideByRoom[selectedRoomId] ?? null
    : messageRetentionSecondsForActiveChat(selectedRoom, selectedGroup);
  const retainedTimeline = React.useMemo(
    () => filterTimelineByRetention(timeline, activeMessageRetentionSeconds),
    [activeMessageRetentionSeconds, timeline]
  );
  const demoTimeline = React.useMemo(
    () => selectedGroup ? demoTimelineMessagesForGroup(selectedGroup, authSession) : [],
    [authSession, selectedGroup]
  );
  const showingDemoTimeline = retainedTimeline.length === 0 && demoTimeline.length > 0;
  const visibleTimeline = showingDemoTimeline ? demoTimeline : retainedTimeline;
  const timelineRows = React.useMemo(() => buildTimelineRows(visibleTimeline), [visibleTimeline]);
  const virtualTimeline = useVirtualTimelineRows(timelineRows, messageCanvasRef);
  const timelineMessages = React.useMemo(() => timelineRows.filter((row) => row.kind === "message").map((row) => row.message), [timelineRows]);
  const messageById = React.useMemo(
    () => new Map(timelineMessages.map((message) => [message.eventId, message])),
    [timelineMessages]
  );
  const historyExhausted = showingDemoTimeline || (selectedRoomId ? historyExhaustedByRoom[selectedRoomId] === true : true);
  const searchMatches = React.useMemo(
    () => messageSearchOpen && messageSearchQuery.trim()
      ? timelineMessages.filter((message) => messageMatchesQuery(message, messageSearchQuery))
      : [],
    [messageSearchOpen, messageSearchQuery, timelineMessages]
  );
  const activeSearchMessageId = searchMatches[activeSearchIndex]?.eventId ?? null;
  const selectedMessages = React.useMemo(
    () => timelineMessages.filter((message) => selectedMessageIds.has(message.eventId)),
    [selectedMessageIds, timelineMessages]
  );
  const forwardTargets = React.useMemo(
    () => buildForwardTargets(chatItems, forwardUserSuggestions, forwardQuery),
    [chatItems, forwardQuery, forwardUserSuggestions]
  );
  const selectedForwardTargets = React.useMemo(() => Object.values(forwardSelectedTargetsByKey), [forwardSelectedTargetsByKey]);
  const workflowState = React.useMemo(() => deriveChatWorkflowState({
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
  }), [
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
  ]);
  const composerEnabled = workflowState.composerEnabled;
  const actionMessage = messageActionPopover ? messageById.get(messageActionPopover.messageId) ?? null : null;
  const statusLabel = statusLabelFor(status, matrixSession, syncState, matrixLoading);
  const matrixMediaAccessToken = matrixSession?.bootstrap.accessToken;
  const recoveryBanner = matrixSession && encryptionRecoveryStatus && !encryptionRecoveryStatus.ready
    ? encryptionRecoveryStatus.needsSetup
      ? encryptionRecoveryStatus.keyBackupEnabled
        ? "E2EE je aktivní, ale pro iPhone/iPad je potřeba doplnit kompletní obnovu."
        : "E2EE je aktivní. Pro bezpečné použití na více zařízeních nastavte obnovovací klíč."
      : "Toto zařízení zatím nemá odemčenou E2EE zálohu. Zadejte obnovovací klíč."
    : null;

  React.useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

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

  React.useEffect(() => {
    const refreshPermission = () => setNotificationPermission(readBrowserNotificationPermission());
    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);
    return () => {
      window.removeEventListener("focus", refreshPermission);
      document.removeEventListener("visibilitychange", refreshPermission);
    };
  }, []);

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
      existingNode.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const rowIndex = timelineRows.findIndex((row) => row.kind === "message" && row.message.eventId === activeSearchMessageId);
    if (rowIndex >= 0) {
      virtualTimeline.scrollToRow(rowIndex, "center");
    }
  }, [activeSearchMessageId, timelineRows, virtualTimeline.scrollToRow]);

  React.useEffect(() => {
    let cancelled = false;
    setAuthSession((current) => current.status === "anonymous" ? { status: "authenticating" } : current);
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
          if (shouldExpireAuthSessionAfterRefreshFailure(authSession.expiresAt)) {
            setAuthSession({ status: "anonymous" });
            return;
          }
          setAuthRefreshRetry((current) => current + 1);
        })
        .catch(() => {
          setAuthRefreshRetry((current) => current + 1);
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [authConfig, authRefreshRetry, authSession]);

  React.useEffect(() => {
    const stopMatrixSession = () => {
      matrixSessionRef.current?.stop();
    };
    window.addEventListener("pagehide", stopMatrixSession);
    window.addEventListener("beforeunload", stopMatrixSession);
    return () => {
      window.removeEventListener("pagehide", stopMatrixSession);
      window.removeEventListener("beforeunload", stopMatrixSession);
    };
  }, []);

  React.useEffect(() => () => {
    if (pendingAttachment?.previewUrl) {
      window.URL.revokeObjectURL(pendingAttachment.previewUrl);
    }
  }, [pendingAttachment?.previewUrl]);

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
      setTimelineCacheRevision((value) => value + 1);
      notifiedEventIdsRef.current.clear();
      notificationsPrimedRef.current = false;
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
    const timer = window.setTimeout(() => {
      void startMatrixSession(selectedRoomId);
    }, Math.max(30_000, expiresAt - Date.now() - 60_000));
    return () => window.clearTimeout(timer);
  }, [authToken, matrixSession?.bootstrap.expiresAt, selectedRoomId]);

  React.useEffect(() => {
    if (!matrixSession || !selectedRoomId) {
      return;
    }
    const liveTimeline = matrixSession.getTimeline(selectedRoomId);
    setTimeline(rememberRoomTimeline(selectedRoomId, liveTimeline));
  }, [matrixSession, rooms, selectedRoomId, timelineRevision]);

  React.useEffect(() => {
    if (!matrixSession || !selectedRoomId) {
      return;
    }
    const loadKey = `${matrixSession.bootstrap.userId}:${matrixSession.bootstrap.deviceId}:${selectedRoomId}`;
    const attempts = initialHistoryLoadAttemptsRef.current.get(loadKey) ?? 0;
    if (attempts >= initialHistoryLoadRetryLimit || historyExhausted || historyLoadingRoomsRef.current.has(selectedRoomId)) {
      return;
    }
    const currentTimeline = matrixSession.getTimeline(selectedRoomId);
    if (attempts > 0 && currentTimeline.length > 0) {
      return;
    }
    initialHistoryLoadAttemptsRef.current.set(loadKey, attempts + 1);
    const delayMs = attempts === 0 ? 0 : Math.min(2_000, attempts * 350);
    const timer = window.setTimeout(() => {
      if (selectedRoomIdRef.current !== selectedRoomId || historyLoadingRoomsRef.current.has(selectedRoomId)) {
        return;
      }
      void loadOlderMessages(selectedRoomId, 120, true);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [historyExhausted, historyLoading, matrixSession, selectedRoomId, syncState, timelineRevision]);

  React.useEffect(() => {
    if (!matrixSession) {
      notifiedEventIdsRef.current.clear();
      notificationsPrimedRef.current = false;
      return;
    }

    const pendingNotifications: IncomingChatNotification[] = [];
    for (const room of rooms) {
      const chat = chatItemForRoom(chatItems, room.roomId);
      const messages = matrixSession.getTimeline(room.roomId);
      for (const message of messages) {
        if (notifiedEventIdsRef.current.has(message.eventId)) {
          continue;
        }
        notifiedEventIdsRef.current.add(message.eventId);
        if (!notificationsPrimedRef.current) {
          continue;
        }
        if (message.own || chat?.muted) {
          continue;
        }
        if (isActiveFocusedRoom(room.roomId, selectedRoomId)) {
          continue;
        }
        pendingNotifications.push({ chat, message, room });
      }
    }

    notificationsPrimedRef.current = true;
    if (notificationPermission !== "granted") {
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
  }, [chatItems, matrixSession, notificationPermission, rooms, selectedRoomId, timelineRevision]);

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
      const selection = embeddedChatSelectionFromMessage(event.data);
      if (!selection) {
        return;
      }
      resetRouteOpenAttempt();
      void applyAndOpenRouteSelection(selection);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [authenticated, chatItems, chatReady, matrixSession, preparingChatId, selectedRoomId]);

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
    markChatRead(activeChat);
    void matrixSession.markRoomRead(selectedRoomId);
  }, [activeChat?.latest?.eventId, activeChat?.manuallyUnread, activeChat?.preferenceKey, activeChat?.unreadCount, matrixSession, selectedRoomId]);

  React.useEffect(() => {
    publishChatUnreadCount(totalUnreadCount);
  }, [totalUnreadCount]);

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

  function rememberRoomTimeline(roomId: string, messages: MatrixTimelineMessage[], allowEmpty = false): MatrixTimelineMessage[] {
    const cached = timelineCacheRef.current.get(roomId) ?? [];
    if (messages.length === 0 && cached.length > 0 && !allowEmpty) {
      return cached;
    }
    if (messages.length === 0 && cached.length === 0 && !allowEmpty) {
      return cached;
    }
    const nextMessages = messages.length > 0 && cached.length > 0 ? mergeTimelineMessages(cached, messages) : messages;
    timelineCacheRef.current.set(roomId, nextMessages);
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
        manualUnreadKeys: [item.preferenceKey, ...current.manualUnreadKeys.filter((key) => key !== item.preferenceKey)].slice(0, 200),
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
    setNotice(`${selectedMessages.length} ${selectedMessages.length === 1 ? "zpráva zkopírována" : "zprávy zkopírovány"}.`);
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

  async function ensureRoomForForwardTarget(target: ForwardTarget, session: MatrixMessagingSession): Promise<{ roomId: string; title: string }> {
    if (target.chat) {
      const roomId = await ensureRoomForChatItem(target.chat, session);
      return { roomId, title: target.title };
    }
    if (!target.user) {
      throw new Error("Příjemce chatu není dostupný.");
    }
    const title = target.user.displayName?.trim() || target.user.username || target.user.subjectId;
    const existing = findExistingDirectConversation(target.user, conversations, title);
    const conversation = ensureConversationHasMember(existing ?? await createDirectConversation(target.user, title), target.user);
    setConversations((current) => upsertConversation(current, conversation));
    const roomId = conversation.matrix?.roomId ?? await createRoomForConversation(conversation, session);
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
      setNotice(`${forwardDraftMessages.length === 1 ? "Zpráva přeposlána" : "Zprávy přeposlány"} do ${recipientLabel}.`);
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
    const nextPermission = await requestBrowserNotificationPermission();
    setNotificationPermission(nextPermission);
    if (nextPermission === "granted") {
      setNotice("Upozornění na nové zprávy jsou zapnutá.");
      return;
    }
    if (nextPermission === "denied") {
      setNotice("Safari blokuje upozornění pro tento web. Povolte je v nastavení webu a zkuste to znovu.");
      return;
    }
    if (nextPermission === "unsupported") {
      setNotice("Tento prohlížeč nepodporuje webová upozornění.");
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
        setGroups((current) => current.map((group) => group.groupId === updatedGroup.groupId ? updatedGroup : group));
      }
      setNotice(seconds === null ? "Automatické mazání zpráv je vypnuté." : `Nové zprávy se budou automaticky odstraňovat po ${messageRetentionLabel(seconds)}.`);
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
      setRecoveryDialogOpen(true);
      throw new Error(nextStatus.needsSetup
        ? "Nejdřív nastavte obnovovací klíč E2EE. Potom půjde chat bezpečně používat na více zařízeních."
        : "Nejdřív obnovte toto zařízení pomocí obnovovacího klíče E2EE.");
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
      return authToken;
    }
  }

  async function startFreshMatrixSessionForRecovery(): Promise<MatrixMessagingSession> {
    const preferredSelection = selectedConversationId ?? selectedGroupId ?? selectedRoomId;
    const latestAuthToken = await refreshAuthTokenForSensitiveMatrixAction();
    if (!latestAuthToken) {
      throw new Error("Pro tuto akci je potřeba platné přihlášení do COP.");
    }
    matrixAttemptKeyRef.current = null;
    resetMatrixSession();
    const freshMatrixDeviceId = rotateMatrixDeviceId(authSubjectId ?? "anonymous");
    const session = await startMatrixSession(preferredSelection, true, latestAuthToken, freshMatrixDeviceId);
    if (!session) {
      throw new Error("Chatové spojení se nepodařilo znovu připravit. Zkuste stránku obnovit a akci opakovat.");
    }
    return session;
  }

  async function createEncryptionRecovery(reset = false): Promise<void> {
    if (reset && !window.confirm("Nouzově začít znovu s E2EE? Tuto volbu použijte jen při ztraceném nebo kompromitovaném klíči. Starší šifrovaná historie nemusí být dostupná.")) {
      return;
    }
    setRecoveryWorking(true);
    setError(null);
    try {
      const session = reset
        ? await startFreshMatrixSessionForRecovery()
        : matrixSessionRef.current ?? await startFreshMatrixSessionForRecovery();
      const recoveryKey = await session.createEncryptionRecovery(reset);
      setGeneratedRecoveryKey(recoveryKey);
      setRecoveryKeyInput("");
      await refreshEncryptionRecoveryStatus(session);
      setNotice(reset
        ? "Nový nouzový E2EE obnovovací klíč je aktivní. Použijte ho i na iOS; starší šifrovaná historie nemusí být dostupná."
        : "E2EE obnova je nastavena pro web i iPhone/iPad. Uložte obnovovací klíč mimo tento prohlížeč.");
    } catch (caught) {
      setError(userFacingError(caught instanceof Error ? caught.message : "Obnovovací klíč se nepodařilo vytvořit."));
    } finally {
      setRecoveryWorking(false);
    }
  }

  async function prepareEncryptionRecoveryForMobile(): Promise<void> {
    if (!window.confirm("Připravit iPhone/iPad čistým E2EE resetem? Starší šifrovaná historie nemusí být dostupná, ale web a iOS dostanou nový kompatibilní obnovovací klíč.")) {
      return;
    }
    setRecoveryWorking(true);
    setError(null);
    try {
      const session = await startFreshMatrixSessionForRecovery();
      const recoveryKey = await session.prepareEncryptionRecoveryForMobile();
      setGeneratedRecoveryKey(recoveryKey);
      setRecoveryKeyInput("");
      await refreshEncryptionRecoveryStatus(session);
      setNotice("Nový E2EE recovery cyklus pro web+iOS je připravený. Uložte nový klíč a použijte ho v mobilní aplikaci.");
    } catch (caught) {
      setError(userFacingError(caught instanceof Error ? caught.message : "Recovery pro iPhone/iPad se nepodařilo připravit."));
    } finally {
      setRecoveryWorking(false);
    }
  }

  async function restoreEncryptionRecovery(): Promise<void> {
    const session = matrixSessionRef.current ?? await startMatrixSession(selectedConversationId ?? selectedGroupId ?? selectedRoomId);
    if (!session) {
      return;
    }
    setRecoveryWorking(true);
    setError(null);
    try {
      await session.restoreEncryptionRecovery(recoveryKeyInput);
      setGeneratedRecoveryKey(null);
      setRecoveryKeyInput("");
      await refreshEncryptionRecoveryStatus(session);
      if (selectedRoomId) {
        setTimeline(rememberRoomTimeline(selectedRoomId, session.getTimeline(selectedRoomId)));
      }
      setRecoveryDialogOpen(false);
      setNotice("Zařízení bylo obnoveno a E2EE key backup je aktivní.");
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
    const conversation = conversations.find((item) => item.conversationId === selection || item.matrix?.roomId === selection);
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
    const conversation = findConversationForGroup(group, conversations) ?? findConversationByTitle(group.name, conversations, "group");
    setSelectedGroupId(group.groupId);
    setSelectedConversationId(conversation?.conversationId ?? null);
    setSelectedRoomId(conversation?.matrix?.roomId ?? communityGroupMatrixRoomId(group) ?? null);
    if (updateRoute) {
      writeChatRoute(conversation?.conversationId ?? group.groupId);
    }
  }

  function selectRoom(room: MatrixRoomSummary, updateRoute = true) {
    const conversation = conversations.find((item) => item.matrix?.roomId === room.roomId) ?? null;
    const group = conversation ? groupForConversation(conversation, groups) : findGroupByMatrixRoomId(room.roomId, groups) ?? findGroupByTitle(room.name, groups);
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
        if (!item.conversation.matrix?.roomId && item.room && chatReady) {
          await bindExistingRoomToConversation(item.conversation, item.room.roomId, item.group);
        } else if (!item.conversation.matrix?.roomId && chatReady) {
          const session = await ensureMatrixSession(item.conversation.conversationId);
          await createRoomForConversation(item.conversation, session);
        }
        return;
      }
      if (item.group) {
        selectGroup(item.group);
        if (chatReady) {
          const conversation = await createConversationForGroup(item.group);
          if (item.room) {
            await bindExistingRoomToConversation(conversation, item.room.roomId, item.group);
          } else {
            const session = await ensureMatrixSession(conversation.conversationId);
            await createRoomForConversation(conversation, session);
            selectConversation(conversation);
          }
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
      if (item.room) {
        await bindExistingRoomToConversation(item.conversation, item.room.roomId, item.group);
        return item.room.roomId;
      }
      return createRoomForConversation(item.conversation, session);
    }
    if (item.group) {
      selectGroup(item.group);
      const conversation = await createConversationForGroup(item.group);
      if (item.room) {
        await bindExistingRoomToConversation(conversation, item.room.roomId, item.group);
        return item.room.roomId;
      }
      return createRoomForConversation(conversation, session);
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
      const conversation = existing ?? await createDirectConversation(user, title);
      const conversationWithMember = ensureConversationHasMember(conversation, user);
      setConversations((current) => upsertConversation(current, conversationWithMember));
      setComposeMode(null);
      setDirectQuery("");
      setDirectSuggestions([]);
      selectConversation(conversationWithMember);
      if (chatReady) {
        const session = await ensureMatrixSession(conversationWithMember.conversationId);
        await createRoomForConversation(conversationWithMember, session);
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
      const existing = findExistingAiAgentDirectConversation(conversations)
        ?? findExistingDirectConversation(copAiAgentUser, conversations, title);
      const conversation = existing ?? await createAiAgentDirectConversation();
      const conversationWithMember = ensureConversationHasMember(conversation, copAiAgentUser, "bot");
      setConversations((current) => upsertConversation(current, conversationWithMember));
      setComposeMode(null);
      setDirectQuery("");
      setDirectSuggestions([]);
      selectConversation(conversationWithMember);
      if (chatReady) {
        const session = await ensureMatrixSession(conversationWithMember.conversationId);
        await createRoomForConversation(conversationWithMember, session);
      }
      setNotice("Chat s COP AI agentem je připravený.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chat s AI agentem se nepodařilo založit.");
    } finally {
      setPreparingChatId(null);
    }
  }

  async function createDirectConversation(user: UserDirectoryEntry, title: string): Promise<MessagingConversationSummary> {
    if (!authToken) {
      throw new Error("Pro založení chatu je potřeba přihlášení.");
    }
    const response = await createMessagingConversation(apiBase, authToken, {
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
    const existing = findConversationForGroup(group, conversations) ?? findConversationByTitle(group.name, conversations, "group");
    if (existing) {
      await persistGroupChatBindingIfAllowed(group, existing);
      return existing;
    }
    const conversationResponse = await createMessagingConversation(apiBase, authToken, {
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
        const session = await ensureMatrixSession(conversation.conversationId);
        await createRoomForConversation(conversation, session);
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
      setGroups((current) => current.map((item) => item.groupId === group.groupId ? group : item));
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
            setConversations((current) => upsertConversation(current, sync.conversation as MessagingConversationSummary));
          } else {
            warnings.push(sync.warnings[0] ?? "Messaging synchronizace zatím nevrátila konverzaci.");
          }
        } catch (caught) {
          warnings.push(caught instanceof Error ? caught.message : "Messaging synchronizace selhala.");
        }
      }
      if (selectedRoomId && matrixSession) {
        try {
          const resolution = await resolveMessagingMatrixIdentities(apiBase, authToken, [user.subjectId]);
          const matrixUserIds = matrixUserIdsFromResolution(resolution, [user.subjectId]);
          if (matrixUserIds.length > 0) {
            await matrixSession.inviteUsersToRoom(selectedRoomId, matrixUserIds);
          } else {
            warnings.push("Matrix identita člena zatím není dostupná.");
          }
        } catch (caught) {
          warnings.push(caught instanceof Error ? caught.message : "Matrix pozvánku se nepodařilo odeslat.");
        }
      }
      setMemberQuery("");
      setMemberSuggestions([]);
      setNotice(warnings.length > 0
        ? `${user.displayName || user.username} byl/a přidán/a do COP skupiny. Chat synchronizace doběhne později: ${userFacingError(warnings[0] ?? "")}`
        : `${user.displayName || user.username} byl/a přidán/a do skupiny.`);
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
      const updatedGroup = await removeCommunityGroupMember(apiBase, authToken, candidate.groupId, candidate.memberSubjectId);
      setGroups((current) => current.map((group) => group.groupId === updatedGroup.groupId ? updatedGroup : group));
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
        ...buildAiRequestContextOptions(timelineMessages),
        includeAlerts: true,
        language: "cs",
        maxObjects: 40
      });
      setAiSituationResponse(response);
      if (response.status === "NEEDS_HUMAN_REVIEW") {
        setNotice("AI souhrn vyžaduje lidskou kontrolu před dalším sdílením.");
      }
    } catch (caught) {
      const message = userFacingError(caught instanceof Error ? caught.message : "AI situační souhrn se nepodařilo vytvořit.");
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

  function openAiAgentDialog(modelPreference: AiModelPreference = "fast") {
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
    currentUserMessage?: string
  ): AiChatAgentQueryOptions {
    return {
      ...buildAiRequestContextOptions(timelineMessages),
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
    if (enabled && !window.confirm("Zapnout COP AI agenta jako viditelného Matrix člena této E2EE místnosti? Agent bude mít vlastní Matrix účet a device, uvidí nové zprávy sdílené po připojení a jeho odpovědi budou auditované.")) {
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
            consent: enabled ? {
              granted: true,
              grantedAt: updateTime,
              grantedBy: authSubjectId ?? authSession.profile?.username ?? "unknown",
              scope: "matrix-room-member",
              termsVersion: "cop-ai-room-agent-consent-v1"
            } : {
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
      setGroups((current) => current.map((group) => group.groupId === finalGroup.groupId ? finalGroup : group));
      setNotice(enabled
        ? `AI agent je zapnutý. ${aiAssistantStatusLabel(nextAi)}.${matrixInviteWarning ? ` ${matrixInviteWarning}` : ""}`
        : "AI agent je pro skupinu vypnutý.");
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

  async function createRoomForConversation(conversation: MessagingConversationSummary, session = matrixSessionRef.current): Promise<string> {
    if (conversation.matrix?.roomId) {
      setSelectedRoomId(conversation.matrix.roomId);
      return conversation.matrix.roomId;
    }
    if (!authToken) {
      throw new Error("Pro založení místnosti je potřeba přihlášení.");
    }
    if (!session) {
      throw new Error("Chatové spojení ještě není připravené.");
    }
    await ensureEncryptionRecoveryReady(session);
    const inviteUserIds = await resolveConversationMatrixUsers(conversation);
    const roomId = await session.createGroupRoom(conversation.title, inviteUserIds);
    const binding = await bindMessagingConversationMatrixRoom(apiBase, authToken, conversation.conversationId, {
      encrypted: true,
      roomId
    });
    assertMatrixRoomBindingConfirmed(binding, roomId);
    const nextConversation = binding.conversation ?? {
      ...conversation,
      matrix: {
        ...(conversation.matrix ?? {}),
        roomId
      }
    };
    setConversations((current) => upsertConversation(current, nextConversation));
    const linkedGroup = selectedGroupId
      ? groups.find((group) => group.groupId === selectedGroupId) ?? groupForConversation(nextConversation, groups)
      : groupForConversation(nextConversation, groups);
    if (linkedGroup) {
      await persistGroupChatBindingIfAllowed(linkedGroup, nextConversation, roomId);
    }
    setRooms((current) => ensureRoomSummary(current, {
      encrypted: true,
      name: conversation.title,
      roomId,
      unreadCount: 0
    }));
    setSelectedConversationId(nextConversation.conversationId);
    setSelectedGroupId(conversationCommunityGroupId(nextConversation) ?? selectedGroupId);
    setSelectedRoomId(roomId);
    writeChatRoute(nextConversation.conversationId);
    return roomId;
  }

  async function bindExistingRoomToConversation(
    conversation: MessagingConversationSummary,
    roomId: string,
    group = groupForConversation(conversation, groups) ?? undefined
  ): Promise<MessagingConversationSummary> {
    if (!authToken) {
      throw new Error("Pro uložení místnosti je potřeba přihlášení.");
    }
    const binding = await bindMessagingConversationMatrixRoom(apiBase, authToken, conversation.conversationId, {
      encrypted: true,
      roomId
    });
    assertMatrixRoomBindingConfirmed(binding, roomId);
    const nextConversation = binding.conversation ?? {
      ...conversation,
      matrix: {
        ...(conversation.matrix ?? {}),
        roomId
      }
    };
    setConversations((current) => upsertConversation(current, nextConversation));
    if (group) {
      await persistGroupChatBindingIfAllowed(group, nextConversation, roomId);
    }
    setSelectedConversationId(nextConversation.conversationId);
    setSelectedGroupId(group?.groupId ?? conversationCommunityGroupId(nextConversation) ?? selectedGroupId);
    setSelectedRoomId(roomId);
    writeChatRoute(nextConversation.conversationId);
    return nextConversation;
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
        encrypted: roomId ? true : currentChat.encrypted ?? true,
        linkedAt: new Date().toISOString(),
        ...(roomId ? { matrixRoomId: roomId } : {}),
        source: "cop-chat"
      }
    });
    setGroups((current) => current.map((item) => item.groupId === updated.groupId ? updated : item));
    return updated;
  }

  async function resolveConversationMatrixUsers(conversation: MessagingConversationSummary): Promise<string[]> {
    if (!authToken) {
      return [];
    }
    const userIds = (conversation.members ?? [])
      .map((member) => member.userId)
      .filter((userId) => userId && userId !== authSubjectId);
    if (userIds.length === 0) {
      return [];
    }
    const result = await resolveMessagingMatrixIdentities(apiBase, authToken, userIds);
    return matrixUserIdsFromResolution(result, userIds);
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
    }
  }

  async function sendMessage(draft: string, options: ChatSendOptions = {}): Promise<boolean> {
    const text = draft.trim();
    if (!matrixSession || !selectedRoomId || !(text || pendingAttachment)) {
      return false;
    }
    const attachment = pendingAttachment;
    const aiInvocation = !options.skipAiMention && !attachment && !replyDraft
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
      throw new Error(invocation.trigger === "slash"
        ? "Za příkaz doplňte konkrétní dotaz pro AI agenta."
        : "Za @COP AI doplňte konkrétní dotaz.");
    }
    if (!matrixSession || !selectedRoomId) {
      throw new Error("Nejdřív otevřete chatovou místnost.");
    }

    await matrixSession.sendMessage(selectedRoomId, userMessage);
    setNotice("COP AI agent zpracovává dotaz...");
    let response: AiCopResponse;
    try {
      response = await queryAiChatAgentWithJob(
        buildAiChatAgentQueryOptions(question, invocation.modelPreference, userMessage),
        (job) => setNotice(aiChatAgentJobStatusLabel(job))
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI agent teď nedokáže odpovědět.");
      return;
    }
    setAiAgentQuestion(question);
    setAiAgentResponse(response);

    const answer = aiResponseSummary(response);
    if (response.status !== "COMPLETED") {
      setAiAgentDialogOpen(true);
      setNotice(response.status === "NEEDS_HUMAN_REVIEW"
        ? "AI odpověď vyžaduje lidskou kontrolu, proto není automaticky odeslaná."
        : "AI odpověď nebyla automaticky odeslaná.");
      return;
    }
    if (!answer.trim()) {
      setNotice("AI agent nevrátil odpověď k odeslání.");
      return;
    }
    await matrixSession.sendMessage(selectedRoomId, formatAiAgentShareBody(answer, question), {
      cop: buildAiAgentMessageMetadata(response, question)
    });
    setNotice("COP AI agent odpověděl do chatu.");
  }

  async function shareLocation() {
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
  const handleOpenChat = useEventCallback((item: ChatListItem) => { void openChat(item); });
  const handleToggleMutedChat = useEventCallback((item: ChatListItem) => toggleMutedChat(item));
  const handleTogglePinnedChat = useEventCallback((item: ChatListItem) => togglePinnedChat(item));
  const handleToggleUnreadChat = useEventCallback((item: ChatListItem) => toggleUnreadChat(item));
  const handleDownloadAttachment = useEventCallback((message: MatrixTimelineMessage) => { void downloadAttachment(message); });
  const handleOpenMessageActions = useEventCallback((
    message: MatrixTimelineMessage,
    rect: DOMRect,
    stickerTrayOpen?: boolean,
    mode?: MessageActionPopoverState["mode"]
  ) => openMessageActions(message, rect, stickerTrayOpen, mode));
  const handleReactToMessage = useEventCallback((message: MatrixTimelineMessage, key: string) => { void reactToMessage(message, key); });
  const handleToggleSelectedMessage = useEventCallback((messageId: string) => toggleSelectedMessage(messageId));

  const connectionLocked = authenticated && !chatReady && !showingDemoTimeline;
  const embedded = React.useMemo(() => new URLSearchParams(window.location.search).get("embedded") === "1", []);

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

      {!embedded ? <nav className="app-rail" aria-label="COP Chat">
        <a className="rail-logo" href="/" aria-label="Zpět na mapu">COP</a>
        <button className="rail-button active" type="button" aria-label="Chaty">
          <MessageCircle size={22} />
        </button>
        <button className="rail-button" onClick={() => setComposeMode("group")} type="button" aria-label="Skupiny">
          <Users size={22} />
        </button>
        <span className="rail-spacer" />
        <button className="rail-button" onClick={() => setRefreshNonce((value) => value + 1)} type="button" aria-label="Obnovit">
          <RefreshCcw size={21} />
        </button>
        {authenticated ? (
          <button className="rail-button" onClick={() => endSession(authConfig, authSession)} type="button" aria-label="Odhlásit">
            <LogOut size={21} />
          </button>
        ) : (
          <button className="rail-button" onClick={() => void beginLogin(authConfig)} type="button" aria-label="Přihlásit">
            <LogIn size={21} />
          </button>
        )}
      </nav> : null}

      <aside className="chat-list-pane" aria-label="Chaty">
        <header className="list-header">
          <div>
            <h1>Chaty</h1>
            <span>{statusLabel}</span>
          </div>
          <div className="list-actions">
            {authenticated ? (
              <NotificationToggleButton
                permission={notificationPermission}
                onEnable={() => void enableBrowserNotifications()}
              />
            ) : null}
            <button className="round-icon" onClick={() => setComposeMode("direct")} type="button" aria-label="Nový chat">
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
          <button className={chatFilter === "all" ? "active" : ""} onClick={() => setChatFilter("all")} role="tab" type="button">Vše</button>
          <button className={chatFilter === "direct" ? "active" : ""} onClick={() => setChatFilter("direct")} role="tab" type="button">Přímé</button>
          <button className={chatFilter === "group" ? "active" : ""} onClick={() => setChatFilter("group")} role="tab" type="button">Skupiny</button>
        </div>

        {pinnedChatItems.length > 0 ? (
          <PinnedChats
            items={pinnedChatItems}
            mediaAccessToken={matrixMediaAccessToken}
            connectionStateForItem={(item) => chatConnectionStateFor(item, chatReady, matrixSession, syncState, preparingChatId === item.id, status)}
            onOpen={(nextItem) => void openChat(nextItem)}
            onTogglePinned={togglePinnedChat}
          />
        ) : null}

        <div className="chat-list" role="list">
          {!authenticated ? (
            <ListPrompt
              actionLabel={isOidcEnabled(authConfig) ? "Přihlásit" : undefined}
              title={authConfig.mode === "lab" ? "Lab režim nemá chatovou identitu." : "Přihlaste se."}
              onAction={isOidcEnabled(authConfig) ? () => void beginLogin(authConfig) : undefined}
            />
          ) : loading && regularChatItems.length === 0 && pinnedChatItems.length === 0 ? (
            <ChatSkeleton />
          ) : regularChatItems.length === 0 && pinnedChatItems.length === 0 ? (
            <ListPrompt actionLabel="Nový chat" title="Žádné chaty" onAction={() => setComposeMode("direct")} />
          ) : regularChatItems.map((item) => (
            <ChatRowMemo
              item={item}
              key={item.id}
              mediaAccessToken={matrixMediaAccessToken}
              connectionState={chatConnectionStateFor(item, chatReady, matrixSession, syncState, preparingChatId === item.id, status)}
              onDeleteRequest={setDeleteChatCandidate}
              onToggleMute={handleToggleMutedChat}
              onTogglePinned={handleTogglePinnedChat}
              onToggleUnread={handleToggleUnreadChat}
              preparing={preparingChatId === item.id}
              onOpen={handleOpenChat}
            />
          ))}
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
                <Avatar label={activeChat.title} mediaAccessToken={matrixMediaAccessToken} src={activeChat.avatarUrl} variant={activeChat.avatarVariant} />
                <ConnectionDot state={chatConnectionStateFor(activeChat, chatReady, matrixSession, syncState, preparingChatId === activeChat.id, status)} />
              </span>
              <div className="conversation-title">
                <strong>{activeChat.title}</strong>
                <span>{conversationSubtitle(activeChat, selectedRoom, status)}</span>
              </div>
              <div className="conversation-actions">
                {selectedRoom?.encrypted ? <span className="e2ee-chip"><ShieldCheck size={14} /> E2EE</span> : null}
                <button
                  className="round-icon"
                  onClick={() => setNotice(chatText("calls.videoComingSoon"))}
                  title={chatText("calls.videoTitle")}
                  type="button"
                  aria-label={chatText("calls.videoTitle")}
                >
                  <Video size={21} />
                </button>
                <button
                  className="round-icon"
                  onClick={() => setNotice(chatText("calls.audioComingSoon"))}
                  title={chatText("calls.audioTitle")}
                  type="button"
                  aria-label={chatText("calls.audioTitle")}
                >
                  <Phone size={21} />
                </button>
                <div className="chat-menu-anchor" ref={messageMenuRef}>
                  <button className="round-icon" onClick={() => setMessageMenuOpen((open) => !open)} type="button" aria-expanded={messageMenuOpen} aria-label="Další">
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
                      onRecovery={() => {
                        setMessageMenuOpen(false);
                        setGeneratedRecoveryKey(null);
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
                actionLabel={encryptionRecoveryStatus?.needsRecovery
                  ? "Obnovit"
                  : encryptionRecoveryStatus?.keyBackupEnabled
                    ? "Připravit pro iOS"
                    : "Nastavit"}
                text={recoveryBanner}
                onAction={() => {
                  setGeneratedRecoveryKey(null);
                  setRecoveryDialogOpen(true);
                }}
              />
            ) : notice ? (
              <StatusBanner text={notice} onClose={() => setNotice(null)} />
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
                actionLabel={encryptionRecoveryStatus?.needsRecovery
                  ? "Obnovit zařízení"
                  : encryptionRecoveryStatus?.keyBackupEnabled
                    ? "Připravit pro iOS"
                    : "Nastavit obnovu"}
                icon={<KeyRound size={30} />}
                title="Dokončete zabezpečení E2EE"
                text={encryptionRecoveryStatus?.needsRecovery
                  ? "Zadejte obnovovací klíč, aby toto zařízení získalo přístup k vaší E2EE záloze."
                  : encryptionRecoveryStatus?.keyBackupEnabled
                    ? "Tento web umí šifrované zprávy číst, ale účet ještě nemá kompletní recovery metadata pro iPhone/iPad."
                    : "Před psaním zpráv nastavte obnovovací klíč. Nové zprávy pak půjde bezpečně číst i na dalších zařízeních."}
                onAction={() => setRecoveryDialogOpen(true)}
              />
            ) : (
              <>
                <div
                  ref={messageCanvasRef}
                  className={clsx("message-canvas", messageActionPopover && "action-focus-active")}
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    // Keep the virtual timeline window synchronized with the real scroll position.
                    // State updates are cheap here because only the visible row slice changes.
                    setShowJumpToLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 180);
                  }}
                >
                  <HistoryLoader
                    exhausted={historyExhausted}
                    loading={historyLoading}
                    onLoad={() => void loadOlderMessages()}
                  />
                  {timelineRows.length === 0 ? <div className="day-pill">Dnes</div> : null}
                  {virtualTimeline.enabled && virtualTimeline.paddingTop > 0 ? (
                    <div className="timeline-spacer" style={{ height: virtualTimeline.paddingTop }} aria-hidden="true" />
                  ) : null}
                  {virtualTimeline.rows.map((row) => row.kind === "date" ? (
                    <div className="day-pill" key={row.id}>{row.label}</div>
                  ) : (
                    <MessageRowMemo
                      grouped={row.grouped}
                      activeSearchMatch={activeSearchMessageId === row.message.eventId}
                      key={row.message.eventId}
                      matrixSession={matrixSession}
                      message={row.message}
                      focused={messageActionPopover?.messageId === row.message.eventId}
                      replyToMessage={row.message.replyToEventId ? messageById.get(row.message.replyToEventId) ?? null : null}
                      searchQuery={messageSearchQuery}
                      selectable={selectionMode}
                      selected={selectedMessageIds.has(row.message.eventId)}
                      senderLabel={messageSenderLabel(row.message, selectedConversation, authSession)}
                      onDownloadAttachment={handleDownloadAttachment}
                      onOpenActions={handleOpenMessageActions}
                      onOpenPreview={setPreviewItem}
                      onReact={handleReactToMessage}
                      onToggleSelected={handleToggleSelectedMessage}
                    />
                  ))}
                  {virtualTimeline.enabled && virtualTimeline.paddingBottom > 0 ? (
                    <div className="timeline-spacer" style={{ height: virtualTimeline.paddingBottom }} aria-hidden="true" />
                  ) : null}
                  <div ref={timelineEndRef} aria-hidden="true" />
                </div>
                {showJumpToLatest ? (
                  <button className="jump-latest" onClick={() => timelineEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })} type="button">
                    <ArrowDown size={17} />
                  </button>
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
                    disabled={!composerEnabled || sending}
                    pendingAttachment={pendingAttachment}
                    replyTo={replyDraft}
                    sending={sending}
                    onAttachmentClear={clearPendingAttachment}
                    onAttachmentPick={pickAttachment}
                    onReplyClear={() => setReplyDraft(null)}
                    onSend={sendMessage}
                    onShareLocation={() => void shareLocation()}
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
          />
        )}
      </section>

      {composeMode ? (
        <React.Suspense fallback={<DialogLoadingFallback label={composeMode === "direct" ? "Nový chat" : composeMode === "member" ? "Přidat člena" : "Nová skupina"} />}>
          <NewChatDialog
            canChat={chatReady}
            directQuery={directQuery}
            directSuggestions={directSuggestions}
            memberQuery={memberQuery}
            memberSuggestions={memberSuggestions}
            memberAddingSubjectIds={Array.from(memberAddPendingIds)}
            existingMemberSubjectIds={selectedGroup?.members.filter((member) => member.status === "active").map((member) => member.subjectId) ?? []}
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
          onStickerTrayChange={(open) => setMessageActionPopover((current) => current ? { ...current, stickerTrayOpen: open } : current)}
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
          aiAgentUpdating={aiAgentGroupUpdating}
          canAddMember={canManageSelectedGroupMembers}
          conversation={selectedConversation}
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
          <MuteDialog
            title={activeChat.title}
            onClose={() => setMuteDialogOpen(false)}
            onMute={applyMuteChoice}
          />
        </React.Suspense>
      ) : null}
      {deleteChatCandidate ? (
        <React.Suspense fallback={<DialogLoadingFallback label="Smazat chat" />}>
          <DeleteChatDialog
            canDeleteGroup={Boolean(deleteChatCandidate.group?.groupId && canManageCommunityGroupMembers(deleteChatCandidate.group, authSubjectId))}
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
            recoveryKeyInput={recoveryKeyInput}
            saving={recoveryWorking}
            status={encryptionRecoveryStatus}
            onClose={() => {
              setRecoveryDialogOpen(false);
              setGeneratedRecoveryKey(null);
            }}
            onCreate={() => void createEncryptionRecovery(false)}
            onPrepareMobile={() => void prepareEncryptionRecoveryForMobile()}
            onRecoveryKeyInputChange={setRecoveryKeyInput}
            onReset={() => void createEncryptionRecovery(true)}
            onRestore={() => void restoreEncryptionRecovery()}
          />
        </React.Suspense>
      ) : null}
    </main>
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
              <Avatar label={item.title} mediaAccessToken={mediaAccessToken} src={item.avatarUrl} variant={item.avatarVariant} />
              <ConnectionDot state={connectionStateForItem(item)} />
              {item.unreadCount > 0 && !item.muted ? <span className="pinned-unread">{item.unreadCount}</span> : null}
              {item.muted ? <span className="pinned-muted"><BellOff size={13} /></span> : null}
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

function ChatRow({
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
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const swipedRef = React.useRef(false);
  const swipeOffset = openActions === "leading" ? 136 : openActions === "trailing" ? -136 : 0;
  const rowOffset = dragOffset || swipeOffset;
  const unreadActionLabel = item.unreadCount > 0 || item.manuallyUnread ? "Přečtené" : "Nepřečtené";

  function closeSwipeActions() {
    setOpenActions(null);
    setDragOffset(0);
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
    setDragOffset(nextOffset);
    event.preventDefault();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse") {
      return;
    }
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) {
      setDragOffset(0);
      return;
    }
    const totalOffset = dragOffset || event.clientX - start.x;
    if (totalOffset > 56) {
      setOpenActions("leading");
    } else if (totalOffset < -56) {
      setOpenActions("trailing");
    } else {
      setOpenActions(null);
    }
    setDragOffset(0);
    window.setTimeout(() => {
      swipedRef.current = false;
    }, 250);
  }

  function runSwipeAction(action: () => void) {
    action();
    closeSwipeActions();
  }

  return (
    <article
      aria-current={item.active ? "true" : undefined}
      className={clsx("chat-row-shell", item.active && "active", item.unreadCount > 0 && "unread", openActions && "swipe-open")}
      role="listitem"
    >
      <div className="chat-swipe-actions chat-swipe-leading" aria-hidden={openActions !== "leading"}>
        <button onClick={() => runSwipeAction(() => onTogglePinned(item))} tabIndex={openActions === "leading" ? 0 : -1} type="button">
          {item.pinned ? <PinOff size={19} /> : <Pin size={19} />}
          <span>{item.pinned ? "Odepnout" : "Připnout"}</span>
        </button>
        <button onClick={() => runSwipeAction(() => onToggleUnread(item))} tabIndex={openActions === "leading" ? 0 : -1} type="button">
          {item.unreadCount > 0 || item.manuallyUnread ? <CheckCheck size={19} /> : <MessageCircle size={19} />}
          <span>{unreadActionLabel}</span>
        </button>
      </div>
      <div className="chat-swipe-actions chat-swipe-trailing" aria-hidden={openActions !== "trailing"}>
        <button onClick={() => runSwipeAction(() => onToggleMute(item))} tabIndex={openActions === "trailing" ? 0 : -1} type="button">
          {item.muted ? <Bell size={19} /> : <BellOff size={19} />}
          <span>{item.muted ? "Zapnout" : "Ztlumit"}</span>
        </button>
        <button className="danger" onClick={() => runSwipeAction(() => onDeleteRequest(item))} tabIndex={openActions === "trailing" ? 0 : -1} type="button">
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
            <Avatar label={item.title} mediaAccessToken={mediaAccessToken} src={item.avatarUrl} variant={item.avatarVariant} />
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
              {preparing ? <Loader2 className="spin" size={15} /> : item.latest ? attachmentIndicator(item.latest) : null}
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
  permission,
  onEnable
}: {
  permission: BrowserNotificationPermission;
  onEnable: () => void;
}) {
  if (permission === "unsupported") {
    return null;
  }
  const enabled = permission === "granted";
  const blocked = permission === "denied";
  return (
    <button
      className={clsx("round-icon", enabled && "active")}
      onClick={onEnable}
      title={notificationButtonLabel(permission)}
      type="button"
      aria-label={notificationButtonLabel(permission)}
    >
      {blocked ? <BellOff size={21} /> : <Bell size={21} />}
    </button>
  );
}

function HistoryLoader({
  exhausted,
  loading,
  onLoad
}: {
  exhausted: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
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

function Composer({
  aiAgentAvailable,
  disabled,
  pendingAttachment,
  replyTo,
  sending,
  onAttachmentClear,
  onAttachmentPick,
  onReplyClear,
  onSend,
  onShareLocation
}: {
  aiAgentAvailable: boolean;
  disabled: boolean;
  pendingAttachment: PendingChatAttachment | null;
  replyTo: MatrixTimelineMessage | null;
  sending: boolean;
  onAttachmentClear: () => void;
  onAttachmentPick: (kind: MatrixAttachmentKind) => void;
  onReplyClear: () => void;
  onSend: (text: string) => Promise<boolean> | void;
  onShareLocation: () => void;
}) {
  // The draft text lives locally so typing re-renders only the Composer, not the
  // whole ChatApp tree (timeline, chat list, panels). The draft intentionally
  // persists across chat switches, matching the previous shared-state behavior.
  const [text, setText] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const canSend = Boolean(text.trim() || pendingAttachment) && !disabled;
  const suggestions = composerSuggestions(text, aiAgentAvailable);
  const submitDraft = async () => {
    if (!canSend) {
      return;
    }
    const result = await onSend(text);
    if (result !== false) {
      setText("");
    }
  };
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
            <strong>Odpověď na {replyTo.own ? "vás" : replyTo.senderDisplayName ?? "člena"}</strong>
            <small>{messagePreviewText(replyTo)}</small>
          </span>
          <button className="round-icon small" onClick={onReplyClear} type="button" aria-label="Zrušit odpověď">
            <X size={15} />
          </button>
        </div>
      ) : null}
      {pendingAttachment ? (
        <div className="pending-attachment">
          {pendingAttachment.previewUrl && pendingAttachment.kind === "image" ? <img alt="" src={pendingAttachment.previewUrl} /> : null}
          {pendingAttachment.previewUrl && pendingAttachment.kind === "video" ? <video muted src={pendingAttachment.previewUrl} /> : null}
          {!pendingAttachment.previewUrl ? <span className="file-thumb">{attachmentIcon(pendingAttachment.kind)}</span> : null}
          <span>
            <strong>{pendingAttachment.file.name || attachmentKindLabel(pendingAttachment.kind)}</strong>
            <small>{formatBytes(pendingAttachment.file.size)}</small>
          </span>
          <button className="round-icon small" onClick={onAttachmentClear} type="button" aria-label="Odebrat přílohu">
            <X size={15} />
          </button>
        </div>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="composer-suggestions" role="listbox" aria-label="Nápověda příkazů">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setText(suggestion.value);
                window.setTimeout(() => textareaRef.current?.focus(), 0);
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
      <div className="composer-row">
        <button className="round-icon" disabled={disabled} onClick={() => onAttachmentPick("file")} type="button" aria-label="Příloha">
          <Plus size={24} />
        </button>
        <button className="round-icon desktop-tool" disabled={disabled} onClick={() => onAttachmentPick("image")} type="button" aria-label="Fotka">
          <ImageIcon size={21} />
        </button>
        <button className="round-icon desktop-tool" disabled={disabled} onClick={() => onShareLocation()} type="button" aria-label="Poloha">
          <MapPin size={21} />
        </button>
        <div className="message-input">
          <Smile size={21} />
          <textarea
            ref={textareaRef}
            aria-label="Zpráva"
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              syncTextareaHeight();
            }}
            onFocus={syncTextareaHeight}
            onKeyDown={(event) => {
              if ((event.key === "Tab" || event.key === "Enter") && suggestions.length > 0) {
                event.preventDefault();
                setText(suggestions[0]?.value ?? text);
                window.setTimeout(() => textareaRef.current?.focus(), 0);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitDraft();
              }
            }}
            placeholder={disabled ? "Chat není připravený" : "Zpráva"}
            rows={1}
            value={text}
          />
        </div>
        <button className="send-button" disabled={!canSend || sending} type="submit" aria-label={canSend ? "Odeslat" : "Hlasová zpráva"}>
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

export function composerSuggestions(text: string, aiAgentAvailable: boolean): ComposerSuggestion[] {
  const draft = text.trimStart();
  if (!draft || draft.includes(" ")) {
    return [];
  }
  if (draft.startsWith("/")) {
    return [
      {
        description: "Dotaz na COP AI agenta s automatickou volbou modelu",
        label: "/ai",
        value: "/ai "
      },
      {
        description: "Rychlá odpověď přes fast model",
        label: "/fast",
        value: "/fast "
      },
      {
        description: "Složitější analýza přes reasoning model",
        label: "/reasoning",
        value: "/reasoning "
      }
    ].filter((suggestion) => suggestion.label.startsWith(draft.toLocaleLowerCase("cs-CZ")));
  }
  if (draft.startsWith("@") && aiAgentAvailable) {
    return [
      {
        description: "Oslovit viditelného COP AI agenta v chatu",
        label: "@COP AI",
        value: "@COP AI "
      },
      {
        description: "Krátký alias pro COP AI agenta",
        label: "@AI",
        value: "@AI "
      }
    ].filter((suggestion) => suggestion.label.toLocaleLowerCase("cs-CZ").startsWith(draft.toLocaleLowerCase("cs-CZ")));
  }
  return [];
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
  onOpenActions: (message: MatrixTimelineMessage, rect: DOMRect, stickerTrayOpen?: boolean, mode?: MessageActionPopoverState["mode"]) => void;
  onOpenPreview: (item: MediaPreviewItem) => void;
  onReact: (message: MatrixTimelineMessage, key: string) => void;
  onToggleSelected: (messageId: string) => void;
}) {
  const rowRef = React.useRef<HTMLElement | null>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const longPressHandledRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const hasReactions = Boolean(message.reactions?.length);
  const hasAiMetadata = Boolean(message.cop?.kind);

  const clearLongPressTimer = React.useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, []);

  React.useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  function openActions(stickerTrayOpen = false, mode: MessageActionPopoverState["mode"] = "actions") {
    const rect = rowRef.current?.querySelector(".message-bubble")?.getBoundingClientRect() ?? rowRef.current?.getBoundingClientRect();
    if (rect) {
      onOpenActions(message, rect, stickerTrayOpen, mode);
    }
  }

  return (
    <article
      ref={rowRef}
      className={clsx("message-row", message.own && "own", grouped && "grouped", selectable && "selectable", selected && "selected", focused && "action-focused", activeSearchMatch && "search-active", hasReactions && "has-reactions", hasAiMetadata && "ai-message")}
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
        if (selectable || isInteractiveMessageTarget(event.target)) {
          return;
        }
        event.preventDefault();
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
        {!message.own && !grouped ? <span className="sender-name">{senderLabel}</span> : null}
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
          <AiMarkdownOutput query={searchQuery} text={messageDisplayBody(message)} />
        ) : (
          <HighlightedMessageText query={searchQuery} text={messageDisplayBody(message)} />
        )}
        <span className="message-time">
          {formatTime(message.timestamp)}
          {message.own ? <CheckCheck size={15} /> : null}
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
      {ai?.auditId || ai?.policyReason || provider ? (
        <span className="message-ai-audit">
          {ai?.auditId ? <span>Audit {shortAuditId(ai.auditId)}</span> : null}
          {provider ? <span>{provider}</span> : null}
          {aiEvidenceMetadataLabel(ai) ? <span>{aiEvidenceMetadataLabel(ai)}</span> : null}
          {ai?.policyReason ? <span>{ai.policyReason}</span> : null}
        </span>
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
      <strong>{message.own ? "Vy" : message.senderDisplayName ?? "Člen"}</strong>
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
  onOpenActions: (message: MatrixTimelineMessage, rect: DOMRect, stickerTrayOpen?: boolean, mode?: MessageActionPopoverState["mode"]) => void;
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
      {parts.map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : <React.Fragment key={index}>{part.text}</React.Fragment>)}
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
    matrixSession.downloadAttachment(message)
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

  React.useEffect(() => () => {
    if (objectUrl?.startsWith("blob:")) {
      window.URL.revokeObjectURL(objectUrl);
    }
  }, [objectUrl]);

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
          {message.kind === "image" && (objectUrl || thumbnailUrl) ? <img alt="" src={objectUrl ?? thumbnailUrl ?? ""} /> : null}
          {message.kind === "video" && objectUrl ? <video muted playsInline src={objectUrl} /> : null}
          {message.kind === "video" && !objectUrl && thumbnailUrl ? (
            <span className="attachment-video-poster">
              <img alt="" src={thumbnailUrl} />
              <span><Video size={18} /> Video</span>
            </span>
          ) : null}
          {message.kind === "image" && !objectUrl && !thumbnailUrl ? <PreviewPlaceholder loading={loading} failed={failed} icon={<ImageIcon size={22} />} /> : null}
          {message.kind === "video" && !objectUrl && !thumbnailUrl ? <PreviewPlaceholder loading={loading} failed={failed} icon={<Video size={22} />} /> : null}
          {message.kind === "file" ? <DocumentThumb contentType={attachment.contentType} fileName={attachment.fileName} /> : null}
        </button>
        <span className="attachment-copy">
          <strong>{attachment.fileName}</strong>
          <small>{attachmentMeta(message)}</small>
        </span>
        <button className="round-icon small" onClick={() => onDownloadAttachment(message)} type="button" aria-label="Stáhnout">
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

function LocationMessage({ message, onOpenPreview }: { message: MatrixTimelineMessage; onOpenPreview: (item: MediaPreviewItem) => void }) {
  const location = message.location;
  if (!location) {
    return null;
  }
  return (
    <button className="location-card" onClick={() => onOpenPreview(matrixMessagePreviewItem(message))} type="button">
      <StaticLocationMap location={location} />
      <span>
        <strong>{location.label ?? "Sdílená poloha"}</strong>
        <small>{formatCoordinates(location)}</small>
      </span>
    </button>
  );
}

function TransitMessage({ message }: { message: MatrixTimelineMessage }) {
  const transit = message.transit;
  if (!transit) {
    return null;
  }
  const title = [transit.transportMode ? formatTransitModeLabel(transit.transportMode) : "Spoj", transit.routeShortName].filter(Boolean).join(" ");
  return (
    <div className="transit-card">
      <span className="transit-card-icon"><Bus size={22} /></span>
      <span>
        <strong>{title}</strong>
        <small>{transit.destination ? `směr ${transit.destination}` : transit.label ?? "Sdílený spoj"}</small>
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
  onNewChat
}: {
  authenticated: boolean;
  authConfig: AuthConfig;
  onLogin: () => void;
  onNewChat: () => void;
}) {
  return (
    <div className="welcome-pane">
      <span className="welcome-icon"><MessageCircle size={34} /></span>
      <h2>Vyberte chat</h2>
      <div className="welcome-actions">
        {authenticated ? (
          <button className="primary-dialog-action" onClick={onNewChat} type="button">Nový chat</button>
        ) : isOidcEnabled(authConfig) ? (
          <button className="primary-dialog-action" onClick={onLogin} type="button">Přihlásit</button>
        ) : null}
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
      {actionLabel && onAction ? <button className="primary-dialog-action" onClick={onAction} type="button">{actionLabel}</button> : null}
    </div>
  );
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
      {actionLabel && onAction ? <button className="status-banner-action" onClick={onAction} type="button">{actionLabel}</button> : null}
      {onClose ? (
        <button className="round-icon small" onClick={onClose} type="button" aria-label="Zavřít">
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}

function ListPrompt({ actionLabel, title, onAction }: { actionLabel?: string; title: string; onAction?: () => void }) {
  return (
    <div className="list-prompt">
      <MessageCircle size={24} />
      <strong>{title}</strong>
      {actionLabel && onAction ? <button onClick={onAction} type="button">{actionLabel}</button> : null}
    </div>
  );
}

function ChatSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => (
        <div className="chat-skeleton" key={index}>
          <span />
          <div><b /><small /></div>
        </div>
      ))}
    </>
  );
}

function ChatInfoPanel({
  activeChat,
  authSession,
  aiAgentUpdating,
  canAddMember,
  conversation,
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
  aiAgentUpdating: boolean;
  canAddMember: boolean;
  conversation: MessagingConversationSummary | null;
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
  const members = infoMembersForChat(activeChat, conversation, group, authSession);
  const mediaMessages = messages.filter((message) => message.attachment && (message.kind === "image" || message.kind === "video"));
  const documentMessages = messages.filter((message) => message.attachment && message.kind === "file");
  const locationMessages = messages.filter((message) => message.kind === "location" && message.location);
  const activeMediaMessages = mediaTab === "media" ? mediaMessages : mediaTab === "documents" ? documentMessages : locationMessages;
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
            <Avatar label={activeChat.title} mediaAccessToken={mediaAccessToken} src={activeChat.avatarUrl} variant={activeChat.avatarVariant} />
            <div>
              <h2>{activeChat.title}</h2>
              <p>{isDirect ? "Přímý chat" : `${activeChat.memberCount} ${activeChat.memberCount === 1 ? "člen" : activeChat.memberCount < 5 ? "členové" : "členů"}`}</p>
            </div>
          </header>

          {tab === "info" ? (
            <div className="info-section">
              <InfoMetric label="Typ" value={isDirect ? "Soukromý chat" : "Veřejná skupina"} />
              <InfoMetric label="Šifrování" value={activeChat.room?.encrypted ? "Zapnuto pro tuto místnost" : "Připraveno při otevření místnosti"} />
              <InfoMetric label="Upozornění" value={muted ? "Ztlumeno" : "Zapnuto"} />
              <InfoMetric label="Připnutí" value={pinned ? "Chat je připnutý" : "Chat není připnutý"} />
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
                <button className={mediaTab === "media" ? "active" : ""} onClick={() => onMediaTabChange("media")} type="button">Média</button>
                <button className={mediaTab === "documents" ? "active" : ""} onClick={() => onMediaTabChange("documents")} type="button">Dokumenty</button>
                <button className={mediaTab === "locations" ? "active" : ""} onClick={() => onMediaTabChange("locations")} type="button">Polohy</button>
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
                      <button key={message.eventId} onClick={() => onOpenPreview(matrixMessagePreviewItem(message, mediaUrl ?? undefined, thumbnailUrl ?? undefined))} type="button">
                        {gridImageUrl && (message.kind === "image" || message.kind === "video") ? (
                          <img alt="" src={gridImageUrl} />
                        ) : message.kind === "location" ? <MapPin size={24} /> : message.kind === "file" ? <FileText size={24} /> : <ImageIcon size={24} />}
                        {message.kind === "video" && gridImageUrl ? <strong className="media-grid-video-badge"><Video size={14} /> Video</strong> : null}
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
                  <Avatar label={member.name} small />
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.subtitle}</small>
                  </span>
                  {!isDirect && canAddMember && member.subjectId && member.subjectId !== authSession.profile?.subjectId && member.status !== "left" ? (
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
                  <span>
                    <strong>{aiAssistant.label}</strong>
                    <small>{aiAssistantStatusLabel(aiAssistant)} • {aiAssistantE2eeLabel(aiAssistant)}</small>
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

function ConnectionDot({ state }: { state: ChatConnectionState }) {
  const label = state === "online"
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
  const byRoomId = new Map<string, string>();
  const byGroupId = new Map<string, string>();
  const byTitleAndType = new Map<string, string>();

  const remember = (item: ChatListItem) => {
    items.set(item.id, item);
    if (item.roomId) {
      byRoomId.set(item.roomId, item.id);
    }
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
    const groupId = conversationCommunityGroupId(conversation) ?? group?.groupId;
    const roomId = conversation.matrix?.roomId ?? (group ? communityGroupMatrixRoomId(group) : undefined);
    const room = roomId ? rooms.find((item) => item.roomId === roomId) : undefined;
    const directPeer = conversationDirectPeer(conversation, authSubjectId, ownIdentityIds);
    const title = chatTitleForConversation(conversation, room, authSubjectId, ownIdentityIds);
    const roomLatest = room?.latestMessage;
    const latest = roomLatest ?? (group ? demoLatestMessageForGroup(group) : undefined);
    const id = roomId
      ? `room:${roomId}`
      : groupId
        ? `group:${groupId}`
        : `conversation:${conversation.conversationId}`;
    remember({
      active: selectedConversationId === conversation.conversationId || selectedRoomId === conversation.matrix?.roomId || selectedGroupId === group?.groupId,
      ...(conversation.type === "direct" && (isAiAgentDirectConversation(conversation) || isAiAgentRoomSummary(room) || isAiAgentDisplayName(title)) ? { avatarVariant: "ai" as const } : {}),
      avatarUrl: room?.avatarUrl ?? room?.directPeer?.avatarUrl ?? conversation.avatarUrl ?? conversation.directPeer?.avatarUrl ?? directPeer?.avatarUrl,
      conversation,
      ...(group ? { group } : {}),
      id,
      latest,
      memberCount: group ? activeCommunityGroupMemberCount(group) : conversation.memberCount ?? conversation.members?.length ?? 2,
      muted: false,
      pinned: false,
      preferenceKey: chatPreferenceKeyForConversation(conversation, group ?? undefined),
      preview: latest ? latestMessagePreview(latest) : roomId ? "Nový chat" : "Klepnutím otevřít chat",
      ...(room ? { room } : {}),
      roomId,
      searchable: `${title} ${conversation.title} ${group?.name ?? ""} ${conversation.members?.map((member) => member.displayName ?? member.userId).join(" ") ?? ""}`,
      sortAt: timestampMillis(latest?.timestamp ?? conversation.updatedAt ?? group?.updatedAt),
      timestamp: latest ? formatShortTimestamp(latest.timestamp) : formatShortTimestamp(conversation.updatedAt ?? group?.updatedAt),
      title,
      type: conversation.type,
      unreadCount: room?.unreadCount ?? 0
    });
  });

  groups.forEach((group) => {
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
      preview: metadataLatest ? latestMessagePreview(metadataLatest) : metadataRoomId ? "Nový chat" : "Klepnutím otevřít chat",
      ...(metadataRoom ? { room: metadataRoom } : {}),
      roomId: metadataRoomId,
      searchable: `${group.name} ${group.members.map((member) => member.displayName || member.username).join(" ")}`,
      sortAt: timestampMillis(metadataLatest?.timestamp ?? group.updatedAt),
      timestamp: metadataLatest ? formatShortTimestamp(metadataLatest.timestamp) : formatShortTimestamp(group.updatedAt),
      title: group.name,
      type: "group",
      unreadCount: metadataRoom?.unreadCount ?? 0
    });
  });

  rooms.forEach((room) => {
    const roomKey = byRoomId.get(room.roomId);
    if (roomKey) {
      return;
    }
    const latest = room.latestMessage;
    const roomTitle = room.directPeer?.displayName || room.name;
    const titleKey = byTitleAndType.get(titleTypeKey(room.name, "group"));
    if (titleKey) {
      const current = items.get(titleKey);
      if (current) {
        items.delete(current.id);
        const merged = {
          ...current,
          active: current.active || selectedRoomId === room.roomId,
          latest: current.latest ?? latest,
          preview: latest ? latestMessagePreview(latest) : current.preview,
          room,
          roomId: room.roomId,
          sortAt: Math.max(current.sortAt, timestampMillis(latest?.timestamp)),
          timestamp: latest ? formatShortTimestamp(latest.timestamp) : current.timestamp,
          unreadCount: room.unreadCount
        };
        merged.id = `room:${room.roomId}`;
        remember(merged);
      }
      return;
    }
    remember({
      active: selectedRoomId === room.roomId,
      ...(room.directPeer && (isAiAgentRoomSummary(room) || isAiAgentDisplayName(roomTitle)) ? { avatarVariant: "ai" as const } : {}),
      avatarUrl: room.avatarUrl ?? room.directPeer?.avatarUrl,
      id: `room:${room.roomId}`,
      latest,
      memberCount: 2,
      muted: false,
      pinned: false,
      preferenceKey: chatPreferenceKeyForRoom(room.roomId),
      preview: latest ? latestMessagePreview(latest) : "Nový chat",
      room,
      roomId: room.roomId,
      searchable: `${roomTitle} ${room.name}`,
      sortAt: timestampMillis(latest?.timestamp),
      timestamp: latest ? formatShortTimestamp(latest.timestamp) : undefined,
      title: roomTitle,
      type: room.directPeer ? "direct" : "room",
      unreadCount: room.unreadCount
    });
  });

  const normalizedQuery = query.trim().toLocaleLowerCase("cs-CZ");
  return dedupeChatItems(Array.from(items.values()))
    .filter((item) => filter === "all" || (filter === "direct" ? item.type === "direct" : item.type !== "direct"))
    .filter((item) => normalizedQuery ? `${item.title} ${item.preview} ${item.searchable}`.toLocaleLowerCase("cs-CZ").includes(normalizedQuery) : true)
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
  const memberIds = item.conversation?.members?.map((member) => member.userId).filter(Boolean).sort().join("|");
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
  return room?.directPeer?.displayName
    ?? conversationDirectPeer(conversation, authSubjectId, ownIdentityIds)?.displayName
    ?? conversation.title;
}

function conversationDirectPeer(
  conversation: MessagingConversationSummary,
  authSubjectId: string | undefined,
  ownIdentityIds: Set<string>
): { avatarUrl?: string; displayName: string; userId: string } | undefined {
  const members = conversation.members ?? [];
  const fallbackOwnIds = authSubjectId ? new Set([normalizeIdentityId(authSubjectId)]) : new Set<string>();
  const ownIds = ownIdentityIds.size > 0 ? ownIdentityIds : fallbackOwnIds;
  const peer = members.find((member) => !ownIds.has(normalizeIdentityId(member.userId))) ?? (members.length === 1 ? members[0] : undefined);
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
  return new Set(values
    .map((value) => value ? normalizeIdentityId(value) : "")
    .filter(Boolean));
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
    if (normalizedQuery && !`${item.title} ${item.preview} ${item.searchable}`.toLocaleLowerCase("cs-CZ").includes(normalizedQuery)) {
      continue;
    }
    targets.set(`chat:${item.id}`, {
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
    const alreadyVisible = Array.from(targets.values()).some((target) => target.chat?.conversation?.members?.some((member) => member.userId === user.subjectId));
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

function chatPreferenceKeyForRoom(roomId: string): string {
  return `room:${roomId}`;
}

function groupForConversation(conversation: MessagingConversationSummary, groups: CommunityGroup[]): CommunityGroup | null {
  const groupId = conversationCommunityGroupId(conversation);
  if (groupId) {
    return groups.find((group) => group.groupId === groupId) ?? null;
  }
  return conversation.type === "group"
    ? groups.find((group) => communityGroupConversationId(group) === conversation.conversationId)
      ?? findGroupByTitle(conversation.title, groups)
      ?? null
    : null;
}

function findConversationForGroup(group: CommunityGroup, conversations: MessagingConversationSummary[]): MessagingConversationSummary | undefined {
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

function findConversationByTitle(title: string, conversations: MessagingConversationSummary[], type?: "direct" | "group"): MessagingConversationSummary | undefined {
  const normalized = normalizeTitle(title);
  return conversations.find((conversation) => normalizeTitle(conversation.title) === normalized && (!type || conversation.type === type));
}

function canUpdateCommunityGroupMetadata(group: CommunityGroup, subjectId: string | null | undefined): boolean {
  return Boolean(subjectId && group.members.some((member) => member.subjectId === subjectId && member.status === "active"));
}

function groupHasActiveMember(group: CommunityGroup, subjectId: string | null | undefined): boolean {
  return Boolean(subjectId && group.members.some((member) => member.subjectId === subjectId && member.status === "active"));
}

function canManageCommunityGroupMembers(group: CommunityGroup, subjectId: string | null | undefined): boolean {
  return Boolean(subjectId && group.members.some((member) =>
    member.subjectId === subjectId &&
    member.status === "active" &&
    (member.role === "owner" || member.role === "admin")
  ));
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
    ...(disappearingMessages ? {
      disappearingMessages: {
        enabled: retentionEnabled,
        seconds: retentionEnabled ? retentionSeconds : null,
        updatedAt: typeof disappearingMessages.updatedAt === "string" ? disappearingMessages.updatedAt : undefined
      }
    } : {}),
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
    ...(consent ? {
      consent: {
        granted: consent.granted === true,
        grantedAt: typeof consent.grantedAt === "string" ? consent.grantedAt : undefined,
        grantedBy: typeof consent.grantedBy === "string" ? consent.grantedBy : undefined,
        revokedAt: typeof consent.revokedAt === "string" ? consent.revokedAt : undefined,
        revokedBy: typeof consent.revokedBy === "string" ? consent.revokedBy : undefined,
        scope: typeof consent.scope === "string" ? consent.scope : undefined,
        termsVersion: typeof consent.termsVersion === "string" ? consent.termsVersion : undefined
      }
    } : {}),
    ...(e2ee ? {
      e2ee: {
        keyModel: typeof e2ee.keyModel === "string" ? e2ee.keyModel : undefined,
        plaintextProxy: e2ee.plaintextProxy === true,
        roomKeyPolicy: typeof e2ee.roomKeyPolicy === "string" ? e2ee.roomKeyPolicy : undefined,
        serverReadsHistory: e2ee.serverReadsHistory === true,
        status: typeof e2ee.status === "string" ? e2ee.status : undefined,
        updatedAt: typeof e2ee.updatedAt === "string" ? e2ee.updatedAt : undefined
      }
    } : {}),
    enabled: aiAssistant?.enabled === true,
    label: typeof aiAssistant?.label === "string" && aiAssistant.label.trim() ? aiAssistant.label.trim() : "COP AI Assistant",
    ...(matrixBot ? {
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
        warnings: Array.isArray(matrixBot.warnings) ? matrixBot.warnings.filter((item): item is string => typeof item === "string").slice(0, 6) : undefined
      }
    } : {}),
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
    ? raw.messages.map(parseDemoConversationMessage).filter((message): message is DemoConversationMessage => Boolean(message))
    : [];
  const media = Array.isArray(raw.media)
    ? raw.media.map(parseDemoConversationMedia).filter((item): item is DemoConversationMedia => Boolean(item))
    : [];
  const metadata: DemoConversationMetadata = {
    media,
    messages,
    ...(typeof raw.pinnedContext === "string" && raw.pinnedContext.trim() ? { pinnedContext: raw.pinnedContext.trim() } : {}),
    ...(typeof raw.summary === "string" && raw.summary.trim() ? { summary: raw.summary.trim() } : {}),
    ...(typeof raw.title === "string" && raw.title.trim() ? { title: raw.title.trim() } : {})
  };
  return metadata.messages.length > 0 || metadata.media.length > 0 || metadata.summary || metadata.pinnedContext ? metadata : null;
}

function demoTimelineMessagesForGroup(group: CommunityGroup, authSession?: AuthSession): MatrixTimelineMessage[] {
  const demo = demoConversationMetadata(group);
  if (!demo) {
    return [];
  }
  const messages: MatrixTimelineMessage[] = [];
  const firstMessageMillis = Math.min(
    ...demo.messages
      .map((message) => timestampMillis(message.sentAt))
      .filter((timestamp) => timestamp > 0)
  );
  const baseMillis = Number.isFinite(firstMessageMillis) && firstMessageMillis > 0 ? firstMessageMillis : timestampMillis(group.updatedAt) || Date.now();
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
      sender: own ? authSession?.profile?.subjectId ?? "demo:self" : `demo:${group.groupId}:member:${index}`,
      senderDisplayName: own ? authSession?.profile?.name ?? message.authorName ?? "Vy" : demoSenderLabel(message),
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
    ...(typeof raw.byteSizeLabel === "string" && raw.byteSizeLabel.trim() ? { byteSizeLabel: raw.byteSizeLabel.trim() } : {}),
    ...(typeof raw.caption === "string" && raw.caption.trim() ? { caption: raw.caption.trim() } : {}),
    ...(typeof raw.previewUrl === "string" && raw.previewUrl.trim() ? { previewUrl: raw.previewUrl.trim() } : {})
  };
}

function demoSenderLabel(message: DemoConversationMessage): string {
  return [message.authorName, message.role].filter(Boolean).join(" · ") || "Člen skupiny";
}

function demoMediaTimelineMessage(group: CommunityGroup, item: DemoConversationMedia, timestampMillisValue: number, index: number): MatrixTimelineMessage {
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

function messageRetentionSecondsForActiveChat(room: MatrixRoomSummary | null, group: CommunityGroup | null): MessageRetentionSeconds {
  return normalizeMessageRetentionSeconds(room?.messageRetentionSeconds ?? (group ? communityGroupChatMetadata(group).disappearingMessages?.seconds : null));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function communityGroupMembersToMessagingMembers(group: CommunityGroup): Array<{ displayName?: string; role?: string; userId: string }> {
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

function ensureConversationHasMember(conversation: MessagingConversationSummary, user: UserDirectoryEntry, role: "bot" | "member" = "member"): MessagingConversationSummary {
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

function findExistingAiAgentDirectConversation(conversations: MessagingConversationSummary[]): MessagingConversationSummary | undefined {
  const candidates = conversations.filter(isAiAgentDirectConversation);
  return candidates.find((conversation) => Boolean(conversation.matrix?.roomId)) ?? candidates[0];
}

export function isAiAgentChatItem(item: ChatListItem): boolean {
  return item.type === "direct" && (
    isAiAgentDirectConversation(item.conversation)
    || isAiAgentRoomSummary(item.room)
    || isAiAgentDisplayName(item.title)
  );
}

function isAiAgentDirectConversation(conversation: MessagingConversationSummary | null | undefined): conversation is MessagingConversationSummary {
  if (!conversation || conversation.type !== "direct") {
    return false;
  }
  if (conversation.metadata?.source === "cop.ai.direct" || conversation.metadata?.externalId === copAiAgentUser.subjectId) {
    return true;
  }
  return Boolean(conversation.members?.some((member) => member.userId === copAiAgentUser.subjectId));
}

function isAiAgentRoomSummary(room: MatrixRoomSummary | null | undefined): boolean {
  if (!room?.directPeer) {
    return false;
  }
  return isAiAgentUserId(room.directPeer.userId) || isAiAgentDisplayName(room.directPeer.displayName);
}

function isAiAgentUserId(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = normalizeIdentityId(value);
  const localpart = matrixUserIdLocalpart(value);
  return normalized === normalizeIdentityId(copAiAgentUser.subjectId)
    || normalized === normalizeIdentityId(copAiAgentUser.username)
    || (localpart ? normalizeIdentityId(localpart) === normalizeIdentityId(copAiAgentUser.subjectId) : false);
}

function isAiAgentDisplayName(value: string | undefined): boolean {
  return Boolean(value && normalizeTitle(value) === normalizeTitle(copAiAgentUser.displayName));
}

function matrixUserIdsFromResolution(result: MessagingMatrixIdentityResolutionResponse, requestedUserIds: string[]): string[] {
  if (result.status !== "online") {
    throw new Error(result.warnings[0] ?? "Některé členy se nepodařilo pozvat do konverzace.");
  }
  const requested = Array.from(new Set(requestedUserIds));
  const resolvedByUserId = new Map(result.identities.map((identity) => [identity.userId, identity.matrixUserId]));
  const missing = requested.filter((userId) => !resolvedByUserId.get(userId));
  if (missing.length > 0) {
    throw new Error(`Některé členy zatím nelze pozvat: ${missing.slice(0, 5).join(", ")}.`);
  }
  return Array.from(new Set(requested.flatMap((userId) => resolvedByUserId.get(userId) ?? [])));
}

function assertMatrixRoomBindingConfirmed(binding: MessagingMatrixRoomBindingResponse, roomId: string): void {
  if (binding.status === "online" && binding.conversation?.matrix?.roomId === roomId) {
    return;
  }
  throw new Error(binding.warnings[0] ?? "Služba zpráv zatím nepotvrdila zabezpečenou konverzaci.");
}

function upsertConversation(current: MessagingConversationSummary[], conversation: MessagingConversationSummary): MessagingConversationSummary[] {
  return [conversation, ...current.filter((item) => item.conversationId !== conversation.conversationId)];
}

function ensureRoomSummary(rooms: MatrixRoomSummary[], room: MatrixRoomSummary): MatrixRoomSummary[] {
  if (rooms.some((item) => item.roomId === room.roomId)) {
    return rooms;
  }
  return [room, ...rooms];
}

function selectRoomIdFromKey(selection: string | null | undefined, conversations: MessagingConversationSummary[], rooms: MatrixRoomSummary[]): string | null {
  if (!selection) {
    return null;
  }
  const conversation = conversations.find((item) => item.conversationId === selection || item.matrix?.roomId === selection);
  if (conversation?.matrix?.roomId) {
    return conversation.matrix.roomId;
  }
  return rooms.some((room) => room.roomId === selection) ? selection : null;
}

function messageSenderLabel(message: MatrixTimelineMessage, conversation: MessagingConversationSummary | null, session: AuthSession): string {
  if (message.own) {
    return "Vy";
  }
  if (message.senderDisplayName?.trim()) {
    return message.senderDisplayName.trim();
  }
  const sender = message.sender.toLocaleLowerCase("cs-CZ");
  const match = conversation?.members?.find((member) => {
    const userId = member.userId.toLocaleLowerCase("cs-CZ");
    return sender.includes(userId) || (member.displayName ? sender.includes(member.displayName.toLocaleLowerCase("cs-CZ")) : false);
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
  const match = text.match(/^\s*@(?:cop[\s._-]*ai|ai)\b[\s:,-]*(?<question>[\s\S]*)$/iu);
  if (!match) {
    return null;
  }
  return (match.groups?.question ?? "").trim();
}

export function parseAiAgentInvocation(
  text: string,
  options: {
    aiDirectChat?: boolean;
    groupAiAssistantEnabled?: boolean;
  } = {}
): AiAgentInvocation | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const command = parseAiAgentSlashCommand(trimmed);
  if (command) {
    return command;
  }
  const mentionQuestion = options.groupAiAssistantEnabled ? parseAiAgentMention(trimmed) : null;
  if (mentionQuestion !== null) {
    const normalized = normalizeAiAgentQuestion(mentionQuestion, "fast");
    return {
      modelPreference: normalized.modelPreference,
      question: normalized.question,
      trigger: "mention"
    };
  }
  if (options.aiDirectChat) {
    const normalized = normalizeAiAgentQuestion(trimmed, "fast");
    return {
      modelPreference: normalized.modelPreference,
      question: normalized.question,
      trigger: "direct-ai-chat"
    };
  }
  return null;
}

function parseAiAgentSlashCommand(text: string): AiAgentInvocation | null {
  const match = text.match(/^\/(?<command>ai|cop-ai|copai|reasoning|reason|fast)\b[\s:,-]*(?<question>[\s\S]*)$/iu);
  if (!match?.groups) {
    return null;
  }
  const command = (match.groups.command ?? "").toLocaleLowerCase("cs-CZ");
  const fallbackPreference: AiModelPreference = command === "reasoning" || command === "reason"
    ? "reasoning"
    : command === "fast" || command === "ai" || command === "cop-ai" || command === "copai"
      ? "fast"
      : "auto";
  const normalized = normalizeAiAgentQuestion(match.groups.question ?? "", fallbackPreference);
  return {
    modelPreference: normalized.modelPreference,
    question: normalized.question,
    trigger: "slash"
  };
}

function normalizeAiAgentQuestion(question: string, fallbackPreference: AiModelPreference): { modelPreference: AiModelPreference; question: string } {
  const trimmed = question.trim();
  const modelMatch = trimmed.match(/^\/(?<model>reasoning|reason|fast|auto)\b[\s:,-]*(?<question>[\s\S]*)$/iu);
  if (!modelMatch?.groups) {
    return {
      modelPreference: fallbackPreference,
      question: trimmed
    };
  }
  const model = (modelMatch.groups.model ?? "").toLocaleLowerCase("cs-CZ");
  return {
    modelPreference: model === "reasoning" || model === "reason" ? "reasoning" : model === "fast" ? "fast" : "auto",
    question: (modelMatch.groups.question ?? "").trim()
  };
}

export function formatAiAgentShareBody(answer: string, question: string): string {
  const normalizedQuestion = question.trim();
  const normalizedAnswer = answer.trim();
  return `COP AI agent${normalizedQuestion ? `\nDotaz: ${normalizedQuestion}` : ""}\n\n${normalizedAnswer}`.trim();
}

export function formatAiSituationShareBody(summary: string): string {
  return `AI situační souhrn:\n\n${summary.trim()}`.trim();
}

export function buildAiRequestContextOptions(messages: MatrixTimelineMessage[]): {
  geoContext?: AiContextGeoContext;
  timeWindow: AiContextTimeWindow;
} {
  const latestLocation = latestTimelineLocation(messages);
  return {
    ...(latestLocation ? {
      geoContext: {
        currentLocation: {
          ...(latestLocation.label ? { label: latestLocation.label } : {}),
          lat: latestLocation.lat,
          lon: latestLocation.lon,
          radiusKm: 30
        },
        label: latestLocation.label ?? "Sdílená poloha v chatu"
      }
    } : {}),
    timeWindow: {
      maxAgeSeconds: 7 * 24 * 3600
    }
  };
}

function latestTimelineLocation(messages: MatrixTimelineMessage[]): MatrixLocationShare | undefined {
  return [...messages]
    .reverse()
    .find((message) => message.kind === "location" && message.location && validMatrixLocation(message.location))
    ?.location;
}

function validMatrixLocation(location: MatrixLocationShare): boolean {
  return Number.isFinite(location.lat)
    && Number.isFinite(location.lon)
    && location.lat >= -90
    && location.lat <= 90
    && location.lon >= -180
    && location.lon <= 180;
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
        ...(message.cop?.ai ? {
          ai: {
            ...(message.cop.ai.auditId ? { auditId: message.cop.ai.auditId } : {}),
            ...(message.cop.ai.provider ? { provider: message.cop.ai.provider } : {}),
            ...(message.cop.ai.status ? { status: message.cop.ai.status } : {}),
            ...(message.cop.ai.type ? { type: message.cop.ai.type } : {})
          }
        } : {}),
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

function messageDisplayBody(message: MatrixTimelineMessage): string {
  if (message.cop?.kind === "ai-agent-response") {
    return stripAiAgentFallbackBody(message.body, message.cop.ai?.question);
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
  return withoutTitle.trimStart();
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
  return {
    ai: {
      ...(response?.auditId ? { auditId: response.auditId } : {}),
      ...(evidence.indexedDocumentCount !== undefined ? { indexedDocumentCount: evidence.indexedDocumentCount } : {}),
      ...(evidence.indexedStatus ? { indexedStatus: evidence.indexedStatus } : {}),
      ...(response?.model ? { model: response.model } : {}),
      ...(response?.policy.reason ? { policyReason: response.policy.reason } : {}),
      ...(response?.provider ? { provider: response.provider } : {}),
      ...(question ? { question } : {}),
      ...(response?.requestId ? { requestId: response.requestId } : {}),
      ...(evidence.semanticDocumentCount !== undefined ? { semanticDocumentCount: evidence.semanticDocumentCount } : {}),
      ...(evidence.semanticStatus ? { semanticStatus: evidence.semanticStatus } : {}),
      ...(response?.status ? { status: response.status } : {}),
      type: options.type
    },
    kind: options.kind,
    source: "cop-chat"
  };
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
  const parts = [
    typeof ai?.semanticDocumentCount === "number" ? `S:${ai.semanticDocumentCount}` : undefined,
    typeof ai?.indexedDocumentCount === "number" ? `I:${ai.indexedDocumentCount}` : undefined
  ].filter(Boolean);
  return parts.length ? `zdroje ${parts.join(" ")}` : undefined;
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
  if (message.cop?.kind === "ai-agent-response") {
    return `${message.own ? "Vy: " : ""}COP AI agent: ${body}`;
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

function matrixMessagePreviewItem(message: MatrixTimelineMessage, url?: string, posterUrl?: string, loadBlob?: () => Promise<Blob>): MediaPreviewItem {
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
  const kind: MediaPreviewItem["kind"] = message.kind === "image"
    ? "image"
    : message.kind === "video"
      ? "video"
      : attachment.contentType?.includes("pdf") || /\.pdf$/iu.test(attachment.fileName)
        ? "document"
        : "file";
  const previewUrl = url ?? (kind === "image" ? posterUrl : undefined);
  return {
    contentType: attachment.encrypted ? "chráněná příloha" : attachment.contentType ?? "soubor",
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
  const type = attachment.encrypted ? "chráněno" : attachment.contentType ?? message.kind;
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

function conversationSubtitle(item: ChatListItem, room: MatrixRoomSummary | null, status?: MessagingStatusResponse | null): string {
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
  const displayName = serverOperatorProfile.displayName ?? localOperatorProfile.displayName ?? authDisplayName(session, config);
  const avatarUrl = serverOperatorProfile.avatarDataUrl
    ?? localOperatorProfile.avatarDataUrl
    ?? (session.status === "authenticated" ? trimmedString(session.profile?.picture) : undefined);
  const matrixProfile = session.status === "authenticated" && (displayName || avatarUrl)
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

function operatorProfileFromServer(serverProfile: ServerUserProfile | null): { avatarDataUrl?: string; displayName?: string } {
  const operatorProfile = asRecord(serverProfile?.preferences.operatorProfile);
  return {
    avatarDataUrl: trimmedString(operatorProfile?.avatarDataUrl),
    displayName: trimmedString(operatorProfile?.displayName) ?? trimmedString(serverProfile?.actor.displayName)
  };
}

function operatorProfileFromPreferences(preferences: LocalUserPreferences): { avatarDataUrl?: string; displayName?: string } {
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

function statusLabelFor(status: MessagingStatusResponse | null, matrixSession: MatrixMessagingSession | null, syncState: string, loading: boolean): string {
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
  return normalized.includes("catch")
    || normalized.includes("prep")
    || normalized.includes("reconnect")
    || normalized.includes("start");
}

function isMatrixSyncOffline(syncState: string): boolean {
  const normalized = syncState.toLowerCase();
  return normalized.includes("error")
    || normalized.includes("stop")
    || normalized.includes("offline")
    || normalized.includes("fail");
}

export function userFacingError(message: string): string {
  const normalized = message.trim();
  if (isMatrixInteractiveAuthError(normalized)) {
    return "Matrix vyžaduje dodatečné ověření pro reset E2EE, které web neumí bezpečně dokončit. Pokud už jste zadali platný recovery klíč, chat může dál fungovat; nový iPhone/iPad připravte resetem v iOS aplikaci nebo požádejte správce o vyčištění starých E2EE metadat.";
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
  if (/\b(500|502|503|504)\b/u.test(normalized) || /service unavailable|gateway timeout|bad gateway/i.test(normalized)) {
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
  return /device_signing\/upload|cross[- ]signing|secret storage|SecretStorage|interactive auth|UIA|m\.login|M_FORBIDDEN|getSecretStorageKey callback returned falsey/i.test(message)
    && /\b(401|403)\b|M_FORBIDDEN|M_UNAUTHORIZED|unauthori[sz]ed|forbidden|getSecretStorageKey callback returned falsey/i.test(message);
}

function isMatrixSessionExpiredError(message: string): boolean {
  return /MatrixError|_matrix|M_UNKNOWN_TOKEN|unknown token|access token/i.test(message)
    && /\b401\b|M_UNKNOWN_TOKEN|unknown token|expired/i.test(message);
}

function isMatrixDuplicateOneTimeKeyUploadError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("one time key")
    && normalized.includes("already exists")
    && (normalized.includes("signed_curve25519") || normalized.includes("keys/upload") || normalized.includes("/keys/upload"));
}

function isSensitiveMatrixKeyMaterialError(message: string): boolean {
  return /signed_curve25519|ed25519|curve25519|old key|new key|signatures|\/keys\/upload|_matrix\/client\/v3\/keys/iu.test(message);
}

function readLocalUserPreferences(ownerId: string): LocalUserPreferences {
  try {
    const storageKey = scopedCopUserPreferencesKey(ownerId);
    const raw = window.localStorage.getItem(storageKey)
      ?? (storageKey === copUserPreferencesStorageKey ? null : window.localStorage.getItem(copUserPreferencesStorageKey));
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
  ].filter(Boolean).join(" ");
}

function messagePreviewText(message: MatrixTimelineMessage): string {
  const text = messageSearchText(message) || latestMessagePreview(message);
  return text.length > 120 ? `${text.slice(0, 117).trimEnd()}...` : text;
}

function matrixReplyTarget(message: MatrixTimelineMessage, session: AuthSession) {
  return {
    body: messagePreviewText(message),
    eventId: message.eventId,
    sender: message.own ? "Vy" : message.senderDisplayName ?? message.sender ?? session.profile?.username ?? "Člen"
  };
}

function isDemoTimelineMessage(message: MatrixTimelineMessage): boolean {
  return message.eventId.startsWith("demo:");
}

function formatMessageForClipboard(message: MatrixTimelineMessage): string {
  const time = new Date(message.timestamp).toLocaleString("cs-CZ");
  return `[${time}] ${message.own ? "Vy" : message.senderDisplayName ?? "Člen"}: ${messageSearchText(message) || message.body}`;
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

function applyLocalReaction(messages: MatrixTimelineMessage[], messageId: string, key: string, senderLabel: string): MatrixTimelineMessage[] {
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
        const senders = reaction.senders
          .filter((sender) => sender !== senderLabel)
          .slice(0, count);
        return {
          ...reaction,
          count,
          own: false,
          senders
        };
      })
      .filter((reaction) => reaction.count > 0);
    if (ownReaction?.key === key) {
      const sortedReactions = reactions.sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "cs-CZ"));
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

function infoMembersForChat(
  activeChat: ChatListItem,
  conversation: MessagingConversationSummary | null,
  group: CommunityGroup | null,
  session: AuthSession
): ChatInfoMember[] {
  if (group) {
    return group.members.map((member) => ({
      id: member.subjectId,
      name: member.displayName || member.username || member.subjectId,
      role: member.role,
      status: member.status,
      subjectId: member.subjectId,
      subtitle: communityGroupMemberSubtitle(member)
    }));
  }
  const ownId = session.profile?.subjectId ?? session.profile?.username ?? "";
  const members = conversation?.members ?? [];
  const contact = members.find((member) => member.userId !== ownId) ?? members[0];
  if (contact) {
    return [{
      id: contact.userId,
      name: contact.displayName || activeChat.title,
      subtitle: contact.userId
    }];
  }
  return [{
    id: activeChat.preferenceKey,
    name: activeChat.title,
    subtitle: activeChat.type === "direct" ? "kontakt" : "chat"
  }];
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

function readBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === "undefined" || !window.isSecureContext || !("Notification" in window)) {
    return "unsupported";
  }
  return window.Notification.permission;
}

async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === "undefined" || !window.isSecureContext || !("Notification" in window)) {
    return "unsupported";
  }
  const NotificationCtor = window.Notification;
  if (NotificationCtor.permission === "granted" || NotificationCtor.permission === "denied") {
    return NotificationCtor.permission;
  }
  return new Promise<BrowserNotificationPermission>((resolve) => {
    let settled = false;
    const settle = (permission: NotificationPermission) => {
      if (!settled) {
        settled = true;
        resolve(permission);
      }
    };
    const result = NotificationCtor.requestPermission(settle);
    if (result && typeof result.then === "function") {
      result.then(settle).catch(() => resolve(readBrowserNotificationPermission()));
    }
  });
}

function notificationButtonLabel(permission: BrowserNotificationPermission): string {
  if (permission === "granted") {
    return "Upozornění zapnutá";
  }
  if (permission === "denied") {
    return "Upozornění blokovaná";
  }
  return "Zapnout upozornění";
}

function isActiveFocusedRoom(roomId: string, selectedRoomId: string | null): boolean {
  if (roomId !== selectedRoomId) {
    return false;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

function chatItemForRoom(chatItems: ChatListItem[], roomId: string): ChatListItem | null {
  return chatItems.find((item) => item.roomId === roomId || item.room?.roomId === roomId || item.conversation?.matrix?.roomId === roomId) ?? null;
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
    tag: `cop-chat-${candidate.room.roomId}`
  });
  notification.onclick = () => {
    notification.close();
    onOpen();
  };
}

function incomingNotificationBody(message: MatrixTimelineMessage): string {
  const preview = latestMessagePreview(message);
  const sender = message.senderDisplayName?.trim();
  return sender ? `${sender}: ${preview}` : preview;
}

function findChatItemForSelection(selection: string, chatItems: ChatListItem[]): ChatListItem | null {
  return chatItems.find((item) => item.id === selection
    || item.conversation?.conversationId === selection
    || item.conversation?.matrix?.roomId === selection
    || item.group?.groupId === selection
    || item.room?.roomId === selection) ?? null;
}

function stableStorageKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._=-]+/gu, "_")
    .slice(0, 96) || "anonymous";
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
  return {
    accuracyM: position.coords.accuracy,
    label: "Moje poloha",
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    source: "device"
  };
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
