import React from "react";
import clsx from "clsx";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  Bell,
  BellOff,
  Check,
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
  Sticker,
  Trash2,
  UserPlus,
  Users,
  Video,
  X
} from "lucide-react";
import {
  beginLogin,
  createInitialAuthSession,
  endSession,
  initializeAuth,
  isAuthSessionActive,
  isOidcEnabled,
  plannedAuthRefreshDelayMs,
  readAuthConfig,
  refreshAuthSession,
  shouldExpireAuthSessionAfterRefreshFailure
} from "../../cop-web/src/auth";
import type { AuthConfig, AuthSession } from "../../cop-web/src/auth";
import {
  bindMessagingConversationMatrixRoom,
  createCommunityGroup,
  createMessagingConversation,
  fetchCommunityGroups,
  fetchMessagingBootstrap,
  fetchMessagingConversations,
  fetchMessagingStatus,
  fetchUserProfile,
  resolveMessagingMatrixIdentities,
  searchUserDirectory,
  syncMessagingConversationMembers,
  updateCommunityGroupMetadata,
  upsertCommunityGroupMember
} from "../../cop-web/src/cop-data";
import type {
  CommunityGroup,
  MessagingConversationSummary,
  MessagingMatrixIdentityResolutionResponse,
  MessagingMatrixRoomBindingResponse,
  MessagingStatusResponse,
  ServerUserProfile,
  UserDirectoryEntry
} from "../../cop-web/src/cop-data";
import {
  clearMatrixMessagingCryptoStateForBootstrap,
  createMatrixMessagingSession,
  isMatrixAccountStoreMismatchError
} from "../../cop-web/src/messaging/matrixClient";
import type {
  MatrixAttachmentKind,
  MatrixAttachmentUpload,
  MatrixEncryptionRecoveryStatus,
  MatrixLocationShare,
  MatrixMessagingSession,
  MatrixRoomSummary,
  MatrixTimelineMessage
} from "../../cop-web/src/messaging/types";

type ChatFilter = "all" | "direct" | "group";
type ComposeMode = "direct" | "group" | null;
type ChatConnectionState = "offline" | "online" | "syncing";
type InfoPanelTab = "info" | "media" | "members";
type MediaPanelTab = "media" | "documents" | "locations";
type MuteChoice = "8h" | "1w" | "forever";
type MessageRetentionSeconds = 86_400 | 604_800 | 7_776_000 | null;
type BrowserNotificationPermission = NotificationPermission | "unsupported";

interface PendingChatAttachment {
  file: File;
  kind: MatrixAttachmentKind;
  previewUrl?: string;
}

interface ChatPreferences {
  hiddenByKey: Record<string, string>;
  manualUnreadKeys: string[];
  mutedUntilByKey: Record<string, string>;
  pinnedKeys: string[];
  readOverrideByKey: Record<string, string>;
}

interface MediaPreviewItem {
  byteSizeLabel?: string;
  caption?: string;
  contentType?: string;
  kind: "document" | "file" | "image" | "location" | "video";
  location?: MatrixLocationShare;
  title: string;
  url?: string;
}

interface ChatListItem {
  active: boolean;
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

interface MessageActionPopoverState {
  left: number;
  messageId: string;
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
const chatPreferencesStoragePrefix = "cop.chat.preferences.v1";
const matrixDeviceIdStoragePrefix = "cop.messaging.matrixDeviceId.v2";
const initialHistoryLoadRetryLimit = 8;
const messageRetentionOptions: Array<{ description: string; label: string; seconds: MessageRetentionSeconds }> = [
  { description: "Nové zprávy zmizí po jednom dni.", label: "24 hodin", seconds: 86_400 },
  { description: "Běžná pracovní doba uchování.", label: "7 dní", seconds: 604_800 },
  { description: "Dlouhodobější provozní historie.", label: "90 dní", seconds: 7_776_000 },
  { description: "Zprávy se nemažou automaticky.", label: "Vypnuto", seconds: null }
];
const quickReactionKeys = ["👍", "❤️", "😂", "😮", "😢", "🙏", "⭐"];
const stickerReactionKeys = ["✅", "🚨", "🔥", "💯", "👀", "🎉", "💪", "🫡", "👏", "🤝", "📍", "⚠️"];
const fallbackMatrixDeviceIds = new Map<string, string>();
const emptyChatPreferences: ChatPreferences = {
  hiddenByKey: {},
  manualUnreadKeys: [],
  mutedUntilByKey: {},
  pinnedKeys: [],
  readOverrideByKey: {}
};

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
  const [historyExhaustedByRoom, setHistoryExhaustedByRoom] = React.useState<Record<string, boolean>>({});
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [matrixSession, setMatrixSession] = React.useState<MatrixMessagingSession | null>(null);
  const [encryptionRecoveryStatus, setEncryptionRecoveryStatus] = React.useState<MatrixEncryptionRecoveryStatus | null>(null);
  const [selectedConversationId, setSelectedConversationId] = React.useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);
  const [composerText, setComposerText] = React.useState("");
  const [pendingAttachment, setPendingAttachment] = React.useState<PendingChatAttachment | null>(null);
  const [conversationQuery, setConversationQuery] = React.useState("");
  const [messageSearchQuery, setMessageSearchQuery] = React.useState("");
  const [chatFilter, setChatFilter] = React.useState<ChatFilter>("all");
  const [notificationPermission, setNotificationPermission] = React.useState<BrowserNotificationPermission>(() => readBrowserNotificationPermission());
  const [composeMode, setComposeMode] = React.useState<ComposeMode>(null);
  const [directQuery, setDirectQuery] = React.useState("");
  const [directSuggestions, setDirectSuggestions] = React.useState<UserDirectoryEntry[]>([]);
  const [newGroupName, setNewGroupName] = React.useState("");
  const [memberQuery, setMemberQuery] = React.useState("");
  const [memberSuggestions, setMemberSuggestions] = React.useState<UserDirectoryEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [matrixLoading, setMatrixLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [preparingChatId, setPreparingChatId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [syncState, setSyncState] = React.useState("idle");
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
  const [forwardWorkingId, setForwardWorkingId] = React.useState<string | null>(null);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = React.useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = React.useState("");
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = React.useState<string | null>(null);
  const [recoveryWorking, setRecoveryWorking] = React.useState(false);
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
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const messageMenuRef = React.useRef<HTMLDivElement | null>(null);
  const timelineEndRef = React.useRef<HTMLDivElement | null>(null);
  const routeAppliedRef = React.useRef(false);
  const matrixAttemptKeyRef = React.useRef<string | null>(null);
  const initialHistoryLoadAttemptsRef = React.useRef<Map<string, number>>(new Map());
  const historyLoadingRoomsRef = React.useRef<Set<string>>(new Set());
  const notifiedEventIdsRef = React.useRef<Set<string>>(new Set());
  const notificationsPrimedRef = React.useRef(false);
  const matrixSessionRef = React.useRef<MatrixMessagingSession | null>(null);
  const selectedRoomIdRef = React.useRef<string | null>(null);

  const authenticated = isAuthSessionActive(authSession);
  const authToken = authenticated ? authSession.accessToken : undefined;
  const authSubjectId = authSession.profile?.subjectId ?? authSession.profile?.username ?? authSession.profile?.email;
  const preferencesOwner = authSubjectId ?? authSession.profile?.username ?? "anonymous";
  const chatIdentity = React.useMemo(
    () => chatIdentityFor(authSession, authConfig, serverUserProfile),
    [authConfig, authSession, serverUserProfile]
  );
  const chatReady = Boolean(authToken && status?.chatAvailable);
  const encryptionRecoveryReady = Boolean(!matrixSession || encryptionRecoveryStatus?.ready);
  const composerEnabled = Boolean(selectedRoomId && matrixSession && chatReady && !preparingChatId && encryptionRecoveryReady);
  const hasDraft = Boolean(composerText.trim() || pendingAttachment);
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
  const selectedRoom = selectedRoomId
    ? rooms.find((room) => room.roomId === selectedRoomId) ?? null
    : selectedConversation?.matrix?.roomId
      ? rooms.find((room) => room.roomId === selectedConversation.matrix?.roomId) ?? null
      : null;
  const rawChatItems = React.useMemo(
    () => buildChatItems({
      conversations,
      filter: chatFilter,
      groups,
      query: conversationQuery,
      rooms,
      selectedConversationId,
      selectedGroupId,
      selectedRoomId,
      timelineForRoom: (roomId) => matrixSession?.getTimeline(roomId) ?? (roomId === selectedRoomId ? timeline : [])
    }),
    [chatFilter, conversationQuery, conversations, groups, matrixSession, rooms, selectedConversationId, selectedGroupId, selectedRoomId, timeline, timelineRevision]
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
  const routeChatSelected = Boolean(activeChat && readRouteSelection());
  const activeMessageRetentionSeconds = selectedRoomId && Object.prototype.hasOwnProperty.call(retentionOverrideByRoom, selectedRoomId)
    ? retentionOverrideByRoom[selectedRoomId] ?? null
    : messageRetentionSecondsForActiveChat(selectedRoom, selectedGroup);
  const visibleTimeline = React.useMemo(
    () => filterTimelineByRetention(timeline, activeMessageRetentionSeconds),
    [activeMessageRetentionSeconds, timeline]
  );
  const timelineRows = React.useMemo(() => buildTimelineRows(visibleTimeline), [visibleTimeline]);
  const timelineMessages = React.useMemo(() => timelineRows.filter((row) => row.kind === "message").map((row) => row.message), [timelineRows]);
  const messageById = React.useMemo(
    () => new Map(timelineMessages.map((message) => [message.eventId, message])),
    [timelineMessages]
  );
  const historyExhausted = selectedRoomId ? historyExhaustedByRoom[selectedRoomId] === true : true;
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
  const actionMessage = messageActionPopover ? messageById.get(messageActionPopover.messageId) ?? null : null;
  const statusLabel = statusLabelFor(status, matrixSession, syncState, matrixLoading);
  const recoveryBanner = matrixSession && encryptionRecoveryStatus && !encryptionRecoveryStatus.ready
    ? encryptionRecoveryStatus.needsSetup
      ? "E2EE je aktivní. Pro bezpečné použití na více zařízeních nastavte obnovovací klíč."
      : "Toto zařízení zatím nemá odemčenou E2EE zálohu. Zadejte obnovovací klíč."
    : null;

  React.useEffect(() => {
    matrixSessionRef.current = matrixSession;
  }, [matrixSession]);

  React.useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

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
    document.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSearchMessageId]);

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

  React.useEffect(() => () => {
    matrixSessionRef.current?.stop();
  }, []);

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
      matrixSessionRef.current?.stop();
      setMatrixSession(null);
      setEncryptionRecoveryStatus(null);
      setRecoveryDialogOpen(false);
      setGeneratedRecoveryKey(null);
      setRecoveryKeyInput("");
      setRooms([]);
      setTimeline([]);
      notifiedEventIdsRef.current.clear();
      notificationsPrimedRef.current = false;
      return;
    }
    void loadMetadata();
  }, [authToken, refreshNonce]);

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
      setTimeline([]);
      return;
    }
    setTimeline(matrixSession.getTimeline(selectedRoomId));
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
    routeAppliedRef.current = applyRouteSelection(readRouteSelection());
    const onPopState = () => {
      routeAppliedRef.current = applyRouteSelection(readRouteSelection());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [conversations, groups, rooms]);

  React.useEffect(() => {
    if (!selectedRoomId && !selectedConversationId && !selectedGroupId) {
      return;
    }
    if (!showJumpToLatest) {
      timelineEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [selectedConversationId, selectedGroupId, selectedRoomId, showJumpToLatest, timeline.length]);

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

  function updateChatPreferences(updater: (current: ChatPreferences) => ChatPreferences) {
    setChatPreferences((current) => {
      const next = normalizeChatPreferences(updater(current));
      writeChatPreferences(preferencesOwner, next);
      return next;
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

  function hideChatFromList(item: ChatListItem) {
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
    setNotice(`Chat ${item.title} byl skryt ze seznamu. Nová zpráva ho znovu zobrazí.`);
  }

  function openChatInfo() {
    setMessageMenuOpen(false);
    setInfoPanelTab("info");
    setMediaPanelTab("media");
    setInfoPanelOpen(true);
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

  function openMessageActions(message: MatrixTimelineMessage, rect: DOMRect, stickerTrayOpen = false) {
    const width = Math.min(330, window.innerWidth - 24);
    const leftCandidate = message.own ? rect.right - width : rect.left;
    const left = Math.max(12, Math.min(leftCandidate, window.innerWidth - width - 12));
    const top = Math.max(72, Math.min(rect.top - 58, window.innerHeight - 330));
    setMessageActionPopover({
      left,
      messageId: message.eventId,
      stickerTrayOpen,
      top
    });
  }

  async function reactToMessage(message: MatrixTimelineMessage, key: string) {
    if (!matrixSession || !selectedRoomId) {
      return;
    }
    setError(null);
    try {
      await matrixSession.setReaction(selectedRoomId, message.eventId, key);
      const senderLabel = chatIdentity.displayName;
      setTimeline((current) => applyLocalReaction(current, message.eventId, key, senderLabel));
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
  }

  async function forwardMessagesToChat(item: ChatListItem) {
    if (forwardDraftMessages.length === 0) {
      return;
    }
    setForwardWorkingId(item.id);
    setError(null);
    try {
      const session = await ensureMatrixSession(item.id);
      await ensureEncryptionRecoveryReady(session);
      const roomId = await ensureRoomForChatItem(item, session);
      const text = forwardDraftMessages.map(formatMessageForForward).join("\n\n");
      await session.sendMessage(roomId, text);
      setTimeline(session.getTimeline(roomId));
      setForwardDraftMessages([]);
      setForwardQuery("");
      setNotice(`${forwardDraftMessages.length === 1 ? "Zpráva přeposlána" : "Zprávy přeposlány"} do chatu ${item.title}.`);
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
      setTimeline((current) => current.filter((item) => item.eventId !== message.eventId));
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
      setTimeline(matrixSession.getTimeline(selectedRoomId));
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

  async function startMatrixSession(preferredSelection?: string | null, allowStoreRecovery = true): Promise<MatrixMessagingSession | null> {
    if (!authToken) {
      return null;
    }
    setMatrixLoading(true);
    setError(null);
    try {
      const bootstrap = await fetchMessagingBootstrap(apiBase, authToken, getOrCreateMatrixDeviceId(authSubjectId ?? "anonymous"));
      if (!bootstrap.chatAvailable || !bootstrap.tokenAvailable || !bootstrap.accessToken) {
        setError(bootstrap.detail ?? bootstrap.warnings[0] ?? "Zabezpečený chat není připravený.");
        return null;
      }
      matrixSessionRef.current?.stop();
      const nextSession = await createMatrixMessagingSession(bootstrap, {
        onRoomsChanged: (nextRooms) => {
          setRooms(nextRooms);
          setSelectedRoomId((current) => current ?? selectRoomIdFromKey(preferredSelection, conversations, nextRooms));
        },
        profile: chatIdentity.matrixProfile,
        onSyncState: setSyncState,
        onTimelineChanged: () => setTimelineRevision((value) => value + 1)
      });
      const nextRooms = nextSession.getRooms();
      const recoveryStatus = await nextSession.getEncryptionRecoveryStatus();
      setMatrixSession(nextSession);
      matrixSessionRef.current = nextSession;
      setEncryptionRecoveryStatus(recoveryStatus);
      setRooms(nextRooms);
      setTimelineRevision((value) => value + 1);
      setSelectedRoomId((current) => current ?? selectRoomIdFromKey(preferredSelection, conversations, nextRooms));
      setSyncState("starting");
      return nextSession;
    } catch (caught) {
      if (allowStoreRecovery && isMatrixAccountStoreMismatchError(caught)) {
        const bootstrap = await fetchMessagingBootstrap(apiBase, authToken, getOrCreateMatrixDeviceId(authSubjectId ?? "anonymous"));
        await clearMatrixMessagingCryptoStateForBootstrap(bootstrap);
        setNotice("Lokální šifrovací stav byl obnoven pro aktuální přihlášení.");
        return startMatrixSession(preferredSelection, false);
      }
      setError(caught instanceof Error ? caught.message : "Matrix spojení se nepodařilo spustit.");
      return null;
    } finally {
      setMatrixLoading(false);
    }
  }

  async function ensureMatrixSession(preferredSelection?: string | null): Promise<MatrixMessagingSession> {
    if (matrixSessionRef.current) {
      return matrixSessionRef.current;
    }
    const nextSession = await startMatrixSession(preferredSelection);
    if (!nextSession) {
      throw new Error("Chatové spojení se nepodařilo připravit.");
    }
    return nextSession;
  }

  async function refreshEncryptionRecoveryStatus(session = matrixSessionRef.current): Promise<MatrixEncryptionRecoveryStatus | null> {
    if (!session) {
      setEncryptionRecoveryStatus(null);
      return null;
    }
    const nextStatus = await session.getEncryptionRecoveryStatus();
    setEncryptionRecoveryStatus(nextStatus);
    return nextStatus;
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

  async function createEncryptionRecovery(reset = false): Promise<void> {
    if (reset && !window.confirm("Resetovat E2EE obnovu? Vytvoří se nový obnovovací klíč pro všechna zařízení a starší šifrovaná historie nemusí být dostupná.")) {
      return;
    }
    const session = matrixSessionRef.current ?? await startMatrixSession(selectedConversationId ?? selectedGroupId ?? selectedRoomId);
    if (!session) {
      return;
    }
    setRecoveryWorking(true);
    setError(null);
    try {
      const recoveryKey = await session.createEncryptionRecovery(reset);
      setGeneratedRecoveryKey(recoveryKey);
      setRecoveryKeyInput("");
      await refreshEncryptionRecoveryStatus(session);
      setNotice(reset
        ? "Nový E2EE obnovovací klíč je aktivní. Použijte ho i na iOS; starší šifrovaná historie nemusí být dostupná."
        : "E2EE obnova je nastavena. Uložte obnovovací klíč mimo tento prohlížeč.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Obnovovací klíč se nepodařilo vytvořit.");
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
        setTimeline(session.getTimeline(selectedRoomId));
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
      setSelectedConversationId(null);
      setSelectedGroupId(null);
      setSelectedRoomId(null);
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
    setSelectedConversationId(null);
    setSelectedGroupId(null);
    setSelectedRoomId(null);
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
    setError(null);
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
      if (conversation) {
        const sync = await syncMessagingConversationMembers(
          apiBase,
          authToken,
          conversation.conversationId,
          communityGroupMembersToMessagingMembers(group)
        );
        if (sync.conversation) {
          setConversations((current) => upsertConversation(current, sync.conversation as MessagingConversationSummary));
        }
      }
      if (selectedRoomId && matrixSession) {
        const resolution = await resolveMessagingMatrixIdentities(apiBase, authToken, [user.subjectId]);
        await matrixSession.inviteUsersToRoom(selectedRoomId, matrixUserIdsFromResolution(resolution, [user.subjectId]));
      }
      setMemberQuery("");
      setMemberSuggestions([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Člena se nepodařilo přidat.");
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
      if (selectedRoomIdRef.current === roomId) {
        setTimeline(result.messages);
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

  async function sendMessage() {
    if (!matrixSession || !selectedRoomId || !hasDraft) {
      return;
    }
    const text = composerText.trim();
    const attachment = pendingAttachment;
    setSending(true);
    setError(null);
    try {
      if (attachment) {
        const payload: MatrixAttachmentUpload = {
          caption: text || undefined,
          file: attachment.file,
          kind: attachment.kind
        };
        await matrixSession.sendAttachment(selectedRoomId, payload);
      } else {
        await matrixSession.sendMessage(selectedRoomId, text, replyDraft ? { replyTo: matrixReplyTarget(replyDraft, authSession) } : undefined);
      }
      setComposerText("");
      setReplyDraft(null);
      clearPendingAttachment();
      setTimeline(matrixSession.getTimeline(selectedRoomId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Zprávu se nepodařilo odeslat.");
    } finally {
      setSending(false);
    }
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
      setTimeline(matrixSession.getTimeline(selectedRoomId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Polohu se nepodařilo sdílet.");
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

  const connectionLocked = authenticated && !chatReady;
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
            connectionStateForItem={(item) => chatConnectionStateFor(item, chatReady, matrixSession, syncState, preparingChatId === item.id)}
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
            <ChatRow
              item={item}
              key={item.id}
              connectionState={chatConnectionStateFor(item, chatReady, matrixSession, syncState, preparingChatId === item.id)}
              onDeleteRequest={setDeleteChatCandidate}
              onToggleMute={toggleMutedChat}
              onTogglePinned={togglePinnedChat}
              onToggleUnread={toggleUnreadChat}
              preparing={preparingChatId === item.id}
              onOpen={(nextItem) => void openChat(nextItem)}
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
                <Avatar label={activeChat.title} src={activeChat.room?.avatarUrl} />
                <ConnectionDot state={chatConnectionStateFor(activeChat, chatReady, matrixSession, syncState, preparingChatId === activeChat.id)} />
              </span>
              <div className="conversation-title">
                <strong>{activeChat.title}</strong>
                <span>{conversationSubtitle(activeChat, selectedRoom)}</span>
              </div>
              <div className="conversation-actions">
                {selectedRoom?.encrypted ? <span className="e2ee-chip"><ShieldCheck size={14} /> E2EE</span> : null}
                <button className="round-icon" disabled type="button" aria-label="Videohovor">
                  <Video size={21} />
                </button>
                <button className="round-icon" disabled type="button" aria-label="Hovor">
                  <Phone size={21} />
                </button>
                <div className="chat-menu-anchor" ref={messageMenuRef}>
                  <button className="round-icon" onClick={() => setMessageMenuOpen((open) => !open)} type="button" aria-expanded={messageMenuOpen} aria-label="Další">
                    <MoreVertical size={21} />
                  </button>
                  {messageMenuOpen ? (
                    <ChatActionMenu
                      activeChat={activeChat}
                      muted={activeChat.muted}
                      onInfo={openChatInfo}
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
                actionLabel={encryptionRecoveryStatus?.needsSetup ? "Nastavit" : "Obnovit"}
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
            ) : !selectedRoomId ? (
              <ChatLockedState
                actionLabel="Otevřít chat"
                icon={<MessageCircle size={28} />}
                title={activeChat.title}
                onAction={() => void openChat(activeChat)}
              />
            ) : !encryptionRecoveryReady ? (
              <ChatLockedState
                actionLabel={encryptionRecoveryStatus?.needsSetup ? "Nastavit obnovu" : "Obnovit zařízení"}
                icon={<KeyRound size={30} />}
                title="Dokončete zabezpečení E2EE"
                text={encryptionRecoveryStatus?.needsSetup
                  ? "Před psaním zpráv nastavte obnovovací klíč. Nové zprávy pak půjde bezpečně číst i na dalších zařízeních."
                  : "Zadejte obnovovací klíč, aby toto zařízení získalo přístup k vaší E2EE záloze."}
                onAction={() => setRecoveryDialogOpen(true)}
              />
            ) : (
              <>
                <div
                  className="message-canvas"
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    setShowJumpToLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 180);
                  }}
                >
                  <HistoryLoader
                    exhausted={historyExhausted}
                    loading={historyLoading}
                    onLoad={() => void loadOlderMessages()}
                  />
                  {timelineRows.length === 0 ? <div className="day-pill">Dnes</div> : null}
                  {timelineRows.map((row) => row.kind === "date" ? (
                    <div className="day-pill" key={row.id}>{row.label}</div>
                  ) : (
                    <MessageRow
                      grouped={row.grouped}
                      activeSearchMatch={activeSearchMessageId === row.message.eventId}
                      key={row.message.eventId}
                      matrixSession={matrixSession}
                      message={row.message}
                      replyToMessage={row.message.replyToEventId ? messageById.get(row.message.replyToEventId) ?? null : null}
                      searchQuery={messageSearchQuery}
                      selectable={selectionMode}
                      selected={selectedMessageIds.has(row.message.eventId)}
                      senderLabel={messageSenderLabel(row.message, selectedConversation, authSession)}
                      onDownloadAttachment={(message) => void downloadAttachment(message)}
                      onOpenActions={openMessageActions}
                      onOpenPreview={setPreviewItem}
                      onReact={(message, key) => void reactToMessage(message, key)}
                      onToggleSelected={toggleSelectedMessage}
                    />
                  ))}
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
                    disabled={!composerEnabled || sending}
                    pendingAttachment={pendingAttachment}
                    replyTo={replyDraft}
                    sending={sending}
                    text={composerText}
                    onAttachmentClear={clearPendingAttachment}
                    onAttachmentPick={pickAttachment}
                    onReplyClear={() => setReplyDraft(null)}
                    onSend={() => void sendMessage()}
                    onShareLocation={() => void shareLocation()}
                    onTextChange={setComposerText}
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
        <NewChatDialog
          canChat={chatReady}
          directQuery={directQuery}
          directSuggestions={directSuggestions}
          memberQuery={memberQuery}
          memberSuggestions={memberSuggestions}
          mode={composeMode}
          newGroupName={newGroupName}
          searchLoading={searchLoading}
          onAddMember={(user) => void addMemberToSelectedGroup(user)}
          onClose={() => setComposeMode(null)}
          onCreateDirect={(user) => void createDirectChat(user)}
          onCreateGroup={() => void createGroupChat()}
          onDirectQueryChange={setDirectQuery}
          onGroupNameChange={setNewGroupName}
          onMemberQueryChange={setMemberQuery}
          onModeChange={setComposeMode}
        />
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
        <ForwardDialog
          items={chatItems}
          query={forwardQuery}
          workingId={forwardWorkingId}
          onClose={() => {
            setForwardDraftMessages([]);
            setForwardQuery("");
          }}
          onForward={(item) => void forwardMessagesToChat(item)}
          onQueryChange={setForwardQuery}
        />
      ) : null}

      {previewItem ? <MediaPreviewDialog item={previewItem} onClose={() => setPreviewItem(null)} /> : null}
      {infoPanelOpen && activeChat ? (
        <ChatInfoPanel
          activeChat={activeChat}
          authSession={authSession}
          conversation={selectedConversation}
          group={selectedGroup}
          mediaTab={mediaPanelTab}
          messages={timelineMessages}
          messageRetentionSeconds={activeMessageRetentionSeconds}
          muted={activeChat.muted}
          pinned={activeChat.pinned}
          tab={infoPanelTab}
          onClose={() => setInfoPanelOpen(false)}
          onMediaTabChange={setMediaPanelTab}
          onTabChange={setInfoPanelTab}
          onTogglePinned={() => togglePinnedChat(activeChat)}
          onToggleMute={activeChat.muted ? clearActiveMute : () => setMuteDialogOpen(true)}
          onOpenRetentionSettings={() => setRetentionDialogOpen(true)}
          onOpenPreview={setPreviewItem}
        />
      ) : null}
      {muteDialogOpen && activeChat ? (
        <MuteDialog
          title={activeChat.title}
          onClose={() => setMuteDialogOpen(false)}
          onMute={applyMuteChoice}
        />
      ) : null}
      {deleteChatCandidate ? (
        <DeleteChatDialog
          title={deleteChatCandidate.title}
          onClose={() => setDeleteChatCandidate(null)}
          onConfirm={() => hideChatFromList(deleteChatCandidate)}
        />
      ) : null}
      {retentionDialogOpen && activeChat ? (
        <MessageRetentionDialog
          currentSeconds={activeMessageRetentionSeconds}
          saving={retentionSaving}
          title={activeChat.title}
          onClose={() => setRetentionDialogOpen(false)}
          onSelect={(seconds) => void applyMessageRetention(seconds)}
        />
      ) : null}
      {recoveryDialogOpen ? (
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
          onRecoveryKeyInputChange={setRecoveryKeyInput}
          onReset={() => void createEncryptionRecovery(true)}
          onRestore={() => void restoreEncryptionRecovery()}
        />
      ) : null}
    </main>
  );
}

function PinnedChats({
  items,
  connectionStateForItem,
  onOpen,
  onTogglePinned
}: {
  items: ChatListItem[];
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
              <Avatar label={item.title} src={item.room?.avatarUrl} />
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
  onDeleteRequest,
  onToggleMute,
  onTogglePinned,
  onToggleUnread,
  preparing,
  onOpen
}: {
  connectionState: ChatConnectionState;
  item: ChatListItem;
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
          <span>Smazat</span>
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
            <Avatar label={item.title} src={item.room?.avatarUrl} />
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

function ChatActionMenu({
  activeChat,
  muted,
  onInfo,
  onMute,
  onRecovery,
  onSearch,
  onSelect,
  onToggleMute,
  onTogglePinned
}: {
  activeChat: ChatListItem;
  muted: boolean;
  onInfo: () => void;
  onMute: () => void;
  onRecovery: () => void;
  onSearch: () => void;
  onSelect: () => void;
  onToggleMute: () => void;
  onTogglePinned: () => void;
}) {
  const infoLabel = activeChat.type === "direct" ? "O kontaktu" : "O skupině";
  return (
    <div className="chat-action-menu" role="menu" aria-label="Akce chatu">
      <button onClick={onInfo} role="menuitem" type="button">
        <Info size={17} />
        {infoLabel}
      </button>
      <button onClick={onTogglePinned} role="menuitem" type="button">
        {activeChat.pinned ? <PinOff size={17} /> : <Pin size={17} />}
        {activeChat.pinned ? "Odepnout" : "Připnout"}
      </button>
      <button onClick={onSearch} role="menuitem" type="button">
        <Search size={17} />
        Hledat
      </button>
      <button onClick={onRecovery} role="menuitem" type="button">
        <KeyRound size={17} />
        Obnova E2EE
      </button>
      <button onClick={onSelect} role="menuitem" type="button">
        <CheckCheck size={17} />
        Vybrat zprávy
      </button>
      <button onClick={muted ? onToggleMute : onMute} role="menuitem" type="button">
        <BellOff size={17} />
        {muted ? "Zrušit ztlumení" : "Ztlumit"}
      </button>
    </div>
  );
}

function MessageSearchBar({
  activeIndex,
  matchCount,
  query,
  onClose,
  onMove,
  onQueryChange
}: {
  activeIndex: number;
  matchCount: number;
  query: string;
  onClose: () => void;
  onMove: (delta: number) => void;
  onQueryChange: (value: string) => void;
}) {
  return (
    <div className="message-search-bar" role="search">
      <Search size={19} />
      <input autoFocus aria-label="Hledat ve zprávách" placeholder="Hledat ve zprávách" value={query} onChange={(event) => onQueryChange(event.target.value)} />
      <span>{query.trim() ? `${matchCount ? activeIndex + 1 : 0}/${matchCount}` : ""}</span>
      <button className="round-icon small" disabled={matchCount === 0} onClick={() => onMove(-1)} type="button" aria-label="Předchozí výsledek">
        <ChevronUp size={18} />
      </button>
      <button className="round-icon small" disabled={matchCount === 0} onClick={() => onMove(1)} type="button" aria-label="Další výsledek">
        <ChevronDown size={18} />
      </button>
      <button className="search-done" onClick={onClose} type="button">Hotovo</button>
    </div>
  );
}

function SelectionToolbar({
  count,
  onCancel,
  onCopy,
  onForward,
  onShare
}: {
  count: number;
  onCancel: () => void;
  onCopy: () => void;
  onForward: () => void;
  onShare: () => void;
}) {
  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Vybrané zprávy">
      <strong>Vybráno {count}</strong>
      <button disabled={count === 0} onClick={onForward} type="button">
        <Forward size={20} />
        Přeposlat
      </button>
      <button disabled={count === 0} onClick={onCopy} type="button">
        <Copy size={20} />
        Zkopírovat
      </button>
      <button disabled={count === 0} onClick={onShare} type="button">
        <Share2 size={20} />
        Sdílet
      </button>
      <button className="selection-cancel" onClick={onCancel} type="button">Zrušit</button>
    </div>
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
        className="message-action-popover"
        role="menu"
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
      </div>
    </>
  );
}

function ForwardDialog({
  items,
  query,
  workingId,
  onClose,
  onForward,
  onQueryChange
}: {
  items: ChatListItem[];
  query: string;
  workingId: string | null;
  onClose: () => void;
  onForward: (item: ChatListItem) => void;
  onQueryChange: (query: string) => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase("cs-CZ");
  const filteredItems = items
    .filter((item) => !normalizedQuery || item.searchable.toLocaleLowerCase("cs-CZ").includes(normalizedQuery) || item.title.toLocaleLowerCase("cs-CZ").includes(normalizedQuery))
    .slice(0, 24);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="forward-dialog" role="dialog" aria-modal="true" aria-label="Přeposlat zprávu">
        <header>
          <button className="round-icon" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={19} />
          </button>
          <strong>Přeposlat</strong>
          <span />
        </header>
        <label className="forward-search">
          <Search size={18} />
          <input autoFocus placeholder="Hledat chat" value={query} onChange={(event) => onQueryChange(event.target.value)} />
        </label>
        <div className="forward-list" role="list">
          {filteredItems.length === 0 ? (
            <p>Žádný chat neodpovídá hledání.</p>
          ) : filteredItems.map((item) => (
            <button disabled={Boolean(workingId)} key={item.id} onClick={() => onForward(item)} role="listitem" type="button">
              <Avatar label={item.title} src={item.room?.avatarUrl} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.type === "direct" ? "přímý chat" : "skupina"}</small>
              </span>
              {workingId === item.id ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            </button>
          ))}
        </div>
      </section>
    </div>
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
  disabled,
  pendingAttachment,
  replyTo,
  sending,
  text,
  onAttachmentClear,
  onAttachmentPick,
  onReplyClear,
  onSend,
  onShareLocation,
  onTextChange
}: {
  disabled: boolean;
  pendingAttachment: PendingChatAttachment | null;
  replyTo: MatrixTimelineMessage | null;
  sending: boolean;
  text: string;
  onAttachmentClear: () => void;
  onAttachmentPick: (kind: MatrixAttachmentKind) => void;
  onReplyClear: () => void;
  onSend: () => void;
  onShareLocation: () => void;
  onTextChange: (value: string) => void;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const canSend = Boolean(text.trim() || pendingAttachment) && !disabled;
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
        if (canSend) {
          onSend();
        }
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
              onTextChange(event.target.value);
              syncTextareaHeight();
            }}
            onFocus={syncTextareaHeight}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) {
                  onSend();
                }
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

function MessageRow({
  activeSearchMatch,
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
  grouped: boolean;
  matrixSession: MatrixMessagingSession | null;
  message: MatrixTimelineMessage;
  replyToMessage: MatrixTimelineMessage | null;
  searchQuery: string;
  selectable: boolean;
  selected: boolean;
  senderLabel: string;
  onDownloadAttachment: (message: MatrixTimelineMessage) => void;
  onOpenActions: (message: MatrixTimelineMessage, rect: DOMRect, stickerTrayOpen?: boolean) => void;
  onOpenPreview: (item: MediaPreviewItem) => void;
  onReact: (message: MatrixTimelineMessage, key: string) => void;
  onToggleSelected: (messageId: string) => void;
}) {
  const rowRef = React.useRef<HTMLElement | null>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const longPressHandledRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const hasReactions = Boolean(message.reactions?.length);

  const clearLongPressTimer = React.useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, []);

  React.useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  function openActions(stickerTrayOpen = false) {
    const rect = rowRef.current?.querySelector(".message-bubble")?.getBoundingClientRect() ?? rowRef.current?.getBoundingClientRect();
    if (rect) {
      onOpenActions(message, rect, stickerTrayOpen);
    }
  }

  return (
    <article
      ref={rowRef}
      className={clsx("message-row", message.own && "own", grouped && "grouped", selectable && "selectable", selected && "selected", activeSearchMatch && "search-active", hasReactions && "has-reactions")}
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
        openActions(false);
      }}
      onContextMenu={(event) => {
        if (selectable || isInteractiveMessageTarget(event.target)) {
          return;
        }
        event.preventDefault();
        openActions(false);
      }}
      onPointerDown={(event) => {
        if (selectable || isInteractiveMessageTarget(event.target)) {
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
        {replyToMessage ? <ReplyPreview message={replyToMessage} /> : null}
        {message.kind === "location" && message.location ? (
          <LocationMessage message={message} onOpenPreview={onOpenPreview} />
        ) : message.attachment ? (
          <AttachmentMessage
            matrixSession={matrixSession}
            message={message}
            onDownloadAttachment={onDownloadAttachment}
            onOpenPreview={onOpenPreview}
          />
        ) : (
          <HighlightedMessageText query={searchQuery} text={message.body} />
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
      </div>
    </article>
  );
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
  onOpenActions: (message: MatrixTimelineMessage, rect: DOMRect, stickerTrayOpen?: boolean) => void;
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
              onOpenActions(message, event.currentTarget.getBoundingClientRect(), true);
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
  const showCaption = Boolean(attachment && message.body && message.body !== attachment.fileName);

  React.useEffect(() => {
    if (!attachment || !matrixSession || !canRenderMedia || objectUrl) {
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
  }, [attachment, canRenderMedia, matrixSession, message, objectUrl]);

  React.useEffect(() => () => {
    if (objectUrl?.startsWith("blob:")) {
      window.URL.revokeObjectURL(objectUrl);
    }
  }, [objectUrl]);

  if (!attachment) {
    return null;
  }

  const preview = matrixMessagePreviewItem(message, objectUrl ?? undefined);
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
          {message.kind === "image" && objectUrl ? <img alt="" src={objectUrl} /> : null}
          {message.kind === "video" && objectUrl ? <video muted playsInline src={objectUrl} /> : null}
          {message.kind === "image" && !objectUrl ? <PreviewPlaceholder loading={loading} failed={failed} icon={<ImageIcon size={22} />} /> : null}
          {message.kind === "video" && !objectUrl ? <PreviewPlaceholder loading={loading} failed={failed} icon={<Video size={22} />} /> : null}
          {message.kind === "file" ? <DocumentThumb fileName={attachment.fileName} /> : null}
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
      <span className="map-tile" aria-hidden="true">
        <MapPin size={22} />
      </span>
      <span>
        <strong>{location.label ?? "Sdílená poloha"}</strong>
        <small>{formatCoordinates(location)}</small>
      </span>
    </button>
  );
}

function NewChatDialog({
  canChat,
  directQuery,
  directSuggestions,
  memberQuery,
  memberSuggestions,
  mode,
  newGroupName,
  searchLoading,
  onAddMember,
  onClose,
  onCreateDirect,
  onCreateGroup,
  onDirectQueryChange,
  onGroupNameChange,
  onMemberQueryChange,
  onModeChange
}: {
  canChat: boolean;
  directQuery: string;
  directSuggestions: UserDirectoryEntry[];
  memberQuery: string;
  memberSuggestions: UserDirectoryEntry[];
  mode: ComposeMode;
  newGroupName: string;
  searchLoading: boolean;
  onAddMember: (user: UserDirectoryEntry) => void;
  onClose: () => void;
  onCreateDirect: (user: UserDirectoryEntry) => void;
  onCreateGroup: () => void;
  onDirectQueryChange: (value: string) => void;
  onGroupNameChange: (value: string) => void;
  onMemberQueryChange: (value: string) => void;
  onModeChange: (value: ComposeMode) => void;
}) {
  const directActive = mode === "direct";
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="new-chat-dialog" role="dialog" aria-modal="true" aria-label={directActive ? "Nový chat" : "Nová skupina"} onClick={(event) => event.stopPropagation()}>
        <header>
          <button className="round-icon mobile-only" onClick={onClose} type="button" aria-label="Zavřít">
            <ArrowLeft size={20} />
          </button>
          <strong>{directActive ? "Nový chat" : "Nová skupina"}</strong>
          <button className="round-icon" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={20} />
          </button>
        </header>
        <div className="dialog-tabs">
          <button className={directActive ? "active" : ""} onClick={() => onModeChange("direct")} type="button">
            <MessageCircle size={17} />
            Chat
          </button>
          <button className={!directActive ? "active" : ""} onClick={() => onModeChange("group")} type="button">
            <Users size={17} />
            Skupina
          </button>
        </div>

        {directActive ? (
          <>
            <label className="dialog-search">
              <Search size={18} />
              <input
                autoFocus
                disabled={!canChat}
                placeholder="Jméno, e-mail nebo login"
                value={directQuery}
                onChange={(event) => onDirectQueryChange(event.target.value)}
              />
            </label>
            <button className="dialog-action-row" onClick={() => onModeChange("group")} type="button">
              <span><Users size={20} /></span>
              <strong>Nová skupina</strong>
            </button>
            <div className="dialog-list">
              {searchLoading ? <DialogHint icon={<Loader2 className="spin" size={18} />} text="Vyhledávám" /> : null}
              {!searchLoading && directQuery.trim().length < 2 ? <DialogHint icon={<Search size={18} />} text="Zadejte alespoň dvě písmena" /> : null}
              {!searchLoading && directQuery.trim().length >= 2 && directSuggestions.length === 0 ? <DialogHint icon={<UserPlus size={18} />} text="Nikdo nenalezen" /> : null}
              {directSuggestions.map((user) => (
                <button className="contact-row" key={user.subjectId} onClick={() => onCreateDirect(user)} type="button">
                  <Avatar label={user.displayName || user.username} />
                  <span>
                    <strong>{user.displayName || user.username}</strong>
                    <small>{user.email ?? user.username}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="dialog-search">
              <Users size={18} />
              <input
                autoFocus
                disabled={!canChat}
                maxLength={80}
                placeholder="Název skupiny"
                value={newGroupName}
                onChange={(event) => onGroupNameChange(event.target.value)}
              />
            </label>
            <button className="primary-dialog-action" disabled={!canChat || !newGroupName.trim()} onClick={onCreateGroup} type="button">
              Vytvořit skupinu
            </button>
            <label className="dialog-search compact">
              <Search size={18} />
              <input
                disabled={!canChat}
                placeholder="Přidat člena do vybrané skupiny"
                value={memberQuery}
                onChange={(event) => onMemberQueryChange(event.target.value)}
              />
            </label>
            <div className="dialog-list">
              {memberSuggestions.map((user) => (
                <button className="contact-row" key={user.subjectId} onClick={() => onAddMember(user)} type="button">
                  <Avatar label={user.displayName || user.username} />
                  <span>
                    <strong>{user.displayName || user.username}</strong>
                    <small>{user.email ?? user.username}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
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

function DialogHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="dialog-hint">
      {icon}
      <span>{text}</span>
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

function MediaPreviewDialog({ item, onClose }: { item: MediaPreviewItem; onClose: () => void }) {
  return (
    <div className="preview-backdrop" onClick={onClose} role="presentation">
      <section className="preview-dialog" role="dialog" aria-modal="true" aria-label={`Náhled ${item.title}`} onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <strong>{item.title}</strong>
            <small>{mediaKindLabel(item.kind)}</small>
          </span>
          <button className="round-icon" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={20} />
          </button>
        </header>
        <div className={clsx("preview-stage", item.kind)}>
          {item.kind === "image" && item.url ? <img alt={item.title} src={item.url} /> : null}
          {item.kind === "video" && item.url ? <video controls src={item.url} /> : null}
          {item.kind === "location" && item.location ? (
            <div className="large-map">
              <MapPin size={32} />
              <strong>{formatCoordinates(item.location)}</strong>
            </div>
          ) : null}
          {((item.kind !== "image" && item.kind !== "video" && item.kind !== "location") || !item.url) && item.kind !== "location" ? (
            <div className="document-preview">
              <DocumentThumb fileName={item.title} large />
              <span>{item.contentType ?? "Soubor"}</span>
              {item.byteSizeLabel ? <small>{item.byteSizeLabel}</small> : null}
            </div>
          ) : null}
        </div>
        {item.caption ? <p>{item.caption}</p> : null}
      </section>
    </div>
  );
}

function ChatInfoPanel({
  activeChat,
  authSession,
  conversation,
  group,
  mediaTab,
  messages,
  messageRetentionSeconds,
  muted,
  pinned,
  tab,
  onClose,
  onMediaTabChange,
  onOpenRetentionSettings,
  onOpenPreview,
  onTabChange,
  onToggleMute,
  onTogglePinned
}: {
  activeChat: ChatListItem;
  authSession: AuthSession;
  conversation: MessagingConversationSummary | null;
  group: CommunityGroup | null;
  mediaTab: MediaPanelTab;
  messages: MatrixTimelineMessage[];
  messageRetentionSeconds: MessageRetentionSeconds;
  muted: boolean;
  pinned: boolean;
  tab: InfoPanelTab;
  onClose: () => void;
  onMediaTabChange: (tab: MediaPanelTab) => void;
  onOpenRetentionSettings: () => void;
  onOpenPreview: (item: MediaPreviewItem) => void;
  onTabChange: (tab: InfoPanelTab) => void;
  onToggleMute: () => void;
  onTogglePinned: () => void;
}) {
  const isDirect = activeChat.type === "direct";
  const members = infoMembersForChat(activeChat, conversation, group, authSession);
  const mediaMessages = messages.filter((message) => message.attachment && (message.kind === "image" || message.kind === "video"));
  const documentMessages = messages.filter((message) => message.attachment && message.kind === "file");
  const locationMessages = messages.filter((message) => message.kind === "location" && message.location);
  const activeMediaMessages = mediaTab === "media" ? mediaMessages : mediaTab === "documents" ? documentMessages : locationMessages;
  const title = isDirect ? "O kontaktu" : "O skupině";
  return (
    <div className="info-backdrop" role="presentation" onClick={onClose}>
      <section className="info-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
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
            <Avatar label={activeChat.title} src={activeChat.room?.avatarUrl} />
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
              <div className="info-actions-row">
                <button onClick={onTogglePinned} type="button">
                  {pinned ? <PinOff size={18} /> : <Pin size={18} />}
                  {pinned ? "Odepnout" : "Připnout"}
                </button>
                <button onClick={onToggleMute} type="button">
                  <BellOff size={18} />
                  {muted ? "Zrušit ztlumení" : "Ztlumit"}
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
                  {activeMediaMessages.map((message) => (
                    <button key={message.eventId} onClick={() => onOpenPreview(matrixMessagePreviewItem(message, directBrowserMediaUrl(message) ?? undefined))} type="button">
                      {message.kind === "location" ? <MapPin size={24} /> : message.kind === "file" ? <FileText size={24} /> : <ImageIcon size={24} />}
                      <span>{mediaGridLabel(message)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {tab === "members" ? (
            <div className="info-section members-section">
              {members.map((member) => (
                <div className="member-row" key={member.id}>
                  <Avatar label={member.name} small />
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.subtitle}</small>
                  </span>
                </div>
              ))}
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

function MuteDialog({ title, onClose, onMute }: { title: string; onClose: () => void; onMute: (choice: MuteChoice) => void }) {
  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section className="mute-dialog" role="dialog" aria-modal="true" aria-label={`Ztlumit ${title}`} onClick={(event) => event.stopPropagation()}>
        <h2>Ztlumit upozornění</h2>
        <p>Ostatní členové neuvidí, že jste chat ztlumil/a. Upozornění stále dostanete, pokud vás někdo zmíní.</p>
        <button onClick={() => onMute("8h")} type="button">8 hodin</button>
        <button onClick={() => onMute("1w")} type="button">1 týden</button>
        <button onClick={() => onMute("forever")} type="button">Vždy</button>
        <button onClick={onClose} type="button">Zrušit</button>
      </section>
    </div>
  );
}

function DeleteChatDialog({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section className="mute-dialog delete-chat-dialog" role="dialog" aria-modal="true" aria-label={`Smazat ${title}`} onClick={(event) => event.stopPropagation()}>
        <h2>Smazat chat ze seznamu?</h2>
        <p>Chat {title} se skryje z tohoto seznamu. Historie zpráv na serveru zůstane zachovaná a nová zpráva chat znovu zobrazí.</p>
        <button className="danger" onClick={onConfirm} type="button">Smazat ze seznamu</button>
        <button onClick={onClose} type="button">Zrušit</button>
      </section>
    </div>
  );
}

function MessageRetentionDialog({
  currentSeconds,
  saving,
  title,
  onClose,
  onSelect
}: {
  currentSeconds: MessageRetentionSeconds;
  saving: boolean;
  title: string;
  onClose: () => void;
  onSelect: (seconds: MessageRetentionSeconds) => void;
}) {
  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section className="retention-dialog" role="dialog" aria-modal="true" aria-label={`Automatické odstraňování zpráv ${title}`} onClick={(event) => event.stopPropagation()}>
        <header>
          <button className="round-icon small" onClick={onClose} type="button" aria-label="Zpět">
            <ArrowLeft size={20} />
          </button>
          <span>
            <h2>Automatické odstraňování zpráv</h2>
            <small>{title}</small>
          </span>
        </header>
        <div className="retention-illustration" aria-hidden="true">
          <Clock3 size={58} />
        </div>
        <p>
          Zprávy v tomto chatu se po zvolené době nebudou zobrazovat v COP Chat.
          Nastavení se ukládá do chatové místnosti a platí pro členy používající COP Chat.
        </p>
        <strong className="retention-section-title">Časový interval</strong>
        <div className="retention-options">
          {messageRetentionOptions.map((option) => {
            const active = normalizeMessageRetentionSeconds(currentSeconds) === option.seconds;
            return (
              <button disabled={saving} key={option.label} onClick={() => onSelect(option.seconds)} type="button">
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {active ? <Check size={22} /> : null}
              </button>
            );
          })}
        </div>
        <footer>
          <button disabled={saving} onClick={onClose} type="button">Hotovo</button>
        </footer>
      </section>
    </div>
  );
}

function EncryptionRecoveryDialog({
  generatedRecoveryKey,
  recoveryKeyInput,
  saving,
  status,
  onClose,
  onCreate,
  onRecoveryKeyInputChange,
  onReset,
  onRestore
}: {
  generatedRecoveryKey: string | null;
  recoveryKeyInput: string;
  saving: boolean;
  status: MatrixEncryptionRecoveryStatus | null;
  onClose: () => void;
  onCreate: () => void;
  onRecoveryKeyInputChange: (value: string) => void;
  onReset: () => void;
  onRestore: () => void;
}) {
  const hasBackup = status?.keyBackupExists === true;
  const ready = status?.ready === true;
  const [copyState, setCopyState] = React.useState<"copied" | "error" | "idle">("idle");

  React.useEffect(() => {
    if (copyState === "idle") {
      return undefined;
    }
    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  async function copyRecoveryKey() {
    if (!generatedRecoveryKey) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(generatedRecoveryKey);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section className="recovery-dialog" role="dialog" aria-modal="true" aria-label="Obnova E2EE" onClick={(event) => event.stopPropagation()}>
        <header>
          <button className="round-icon small" onClick={onClose} type="button" aria-label="Zavřít">
            <ArrowLeft size={20} />
          </button>
          <span>
            <h2>Obnova E2EE</h2>
            <small>{ready ? "Key backup je aktivní" : hasBackup ? "Obnovte toto zařízení" : "Nastavte více zařízení"}</small>
          </span>
        </header>
        <div className="recovery-illustration" aria-hidden="true">
          <KeyRound size={54} />
        </div>

        {generatedRecoveryKey ? (
          <>
            <p>
              Uložte tento obnovovací klíč do správce hesel nebo na bezpečné místo.
              Bez něj nepůjde obnovit E2EE na novém zařízení, pokud nebude dostupné jiné ověřené zařízení.
            </p>
            <div className="recovery-key-box">
              <code>{generatedRecoveryKey}</code>
              <button
                className={clsx("recovery-copy-button", copyState !== "idle" && copyState)}
                onClick={() => void copyRecoveryKey()}
                type="button"
                aria-label="Zkopírovat obnovovací klíč"
              >
                {copyState === "copied" ? <Check size={18} /> : <Copy size={18} />}
                {copyState === "copied" ? "Zkopírováno" : "Zkopírovat"}
              </button>
              <span className={clsx("recovery-copy-feedback", copyState)} role="status" aria-live="polite">
                {copyState === "copied"
                  ? "Klíč je zkopírovaný do schránky."
                  : copyState === "error"
                    ? "Kopírování se nepodařilo. Označte klíč ručně."
                    : ""}
              </span>
            </div>
            <footer>
              <button className="primary-dialog-action" onClick={onClose} type="button">Mám uloženo</button>
            </footer>
          </>
        ) : ready ? (
          <>
            <p>
              Toto zařízení má přístup k E2EE key backupu. Pokud obnovovací klíč unikl nebo iOS hlásí
              nekompatibilní E2EE metadata, resetujte obnovu a použijte nově vygenerovaný klíč.
            </p>
            <footer>
              <button className="primary-dialog-action" onClick={onClose} type="button">Hotovo</button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Resetovat E2EE obnovu
              </button>
            </footer>
          </>
        ) : hasBackup ? (
          <>
            <p>
              Zadejte obnovovací klíč uložený při prvním nastavení. Klíč zůstane pouze v tomto prohlížeči
              a použije se k odemčení šifrované zálohy.
            </p>
            <label className="recovery-input">
              <span>Obnovovací klíč</span>
              <textarea
                autoFocus
                spellCheck={false}
                value={recoveryKeyInput}
                onChange={(event) => onRecoveryKeyInputChange(event.target.value)}
              />
            </label>
            <footer>
              <button disabled={saving || !recoveryKeyInput.trim()} className="primary-dialog-action" onClick={onRestore} type="button">
                {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                Obnovit zařízení
              </button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Začít znovu bez staré historie
              </button>
            </footer>
          </>
        ) : (
          <>
            <p>
              Vytvořte obnovovací klíč před psaním zpráv. COP ani Matrix server tento klíč neznají;
              bez uloženého klíče ztratíte možnost obnovit historii na novém zařízení.
            </p>
            <footer>
              <button disabled={saving} className="primary-dialog-action" onClick={onCreate} type="button">
                {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                Vytvořit obnovovací klíč
              </button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Resetovat staré nastavení
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function DocumentThumb({ fileName, large = false }: { fileName: string; large?: boolean }) {
  const extension = fileName.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE";
  return (
    <span className={clsx("document-thumb", large && "large")}>
      <FileText size={large ? 38 : 22} />
      <small>{extension}</small>
    </span>
  );
}

function Avatar({ label, small = false, src }: { label: string; small?: boolean; src?: string }) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    setFailedSrc(null);
  }, [src]);
  const imageSrc = src && failedSrc !== src ? src : undefined;
  return (
    <span className={clsx("avatar", small && "small", imageSrc && "image")} aria-hidden="true">
      {imageSrc ? <img alt="" src={imageSrc} onError={() => setFailedSrc(imageSrc)} /> : initialsFor(label)}
    </span>
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

function buildChatItems({
  conversations,
  filter,
  groups,
  query,
  rooms,
  selectedConversationId,
  selectedGroupId,
  selectedRoomId,
  timelineForRoom
}: {
  conversations: MessagingConversationSummary[];
  filter: ChatFilter;
  groups: CommunityGroup[];
  query: string;
  rooms: MatrixRoomSummary[];
  selectedConversationId: string | null;
  selectedGroupId: string | null;
  selectedRoomId: string | null;
  timelineForRoom: (roomId: string) => MatrixTimelineMessage[];
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
    const latest = roomId ? lastTimelineMessage(timelineForRoom(roomId)) : undefined;
    const id = roomId
      ? `room:${roomId}`
      : groupId
        ? `group:${groupId}`
        : `conversation:${conversation.conversationId}`;
    remember({
      active: selectedConversationId === conversation.conversationId || selectedRoomId === conversation.matrix?.roomId || selectedGroupId === group?.groupId,
      conversation,
      ...(group ? { group } : {}),
      id,
      latest,
      memberCount: conversation.memberCount ?? conversation.members?.length ?? group?.members.length ?? 2,
      muted: false,
      pinned: false,
      preferenceKey: chatPreferenceKeyForConversation(conversation, group ?? undefined),
      preview: latest ? latestMessagePreview(latest) : roomId ? "Nový chat" : "Klepnutím otevřít chat",
      ...(room ? { room } : {}),
      roomId,
      searchable: `${conversation.title} ${group?.name ?? ""} ${conversation.members?.map((member) => member.displayName ?? member.userId).join(" ") ?? ""}`,
      sortAt: timestampMillis(latest?.timestamp ?? conversation.updatedAt ?? group?.updatedAt),
      timestamp: latest ? formatShortTimestamp(latest.timestamp) : formatShortTimestamp(conversation.updatedAt ?? group?.updatedAt),
      title: conversation.title,
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
          memberCount: current.memberCount || group.members.length,
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
          memberCount: current.memberCount || group.members.length,
          searchable: `${current.searchable} ${group.name} ${group.members.map((member) => member.displayName || member.username).join(" ")}`
        };
        remember(merged);
      }
      return;
    }
    const metadataRoomId = communityGroupMatrixRoomId(group);
    const metadataRoom = metadataRoomId ? rooms.find((room) => room.roomId === metadataRoomId) : undefined;
    const metadataLatest = metadataRoomId ? lastTimelineMessage(timelineForRoom(metadataRoomId)) : undefined;
    remember({
      active: selectedGroupId === group.groupId || selectedRoomId === metadataRoomId,
      group,
      id: metadataRoomId ? `room:${metadataRoomId}` : `group:${group.groupId}`,
      latest: metadataLatest,
      memberCount: group.members.length,
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
    const latest = lastTimelineMessage(timelineForRoom(room.roomId));
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
      id: `room:${room.roomId}`,
      latest,
      memberCount: 2,
      muted: false,
      pinned: false,
      preferenceKey: chatPreferenceKeyForRoom(room.roomId),
      preview: latest ? latestMessagePreview(latest) : "Nový chat",
      room,
      roomId: room.roomId,
      searchable: room.name,
      sortAt: timestampMillis(latest?.timestamp),
      timestamp: latest ? formatShortTimestamp(latest.timestamp) : undefined,
      title: room.name,
      type: "room",
      unreadCount: room.unreadCount
    });
  });

  const normalizedQuery = query.trim().toLocaleLowerCase("cs-CZ");
  return dedupeChatItems(Array.from(items.values()))
    .filter((item) => filter === "all" || (filter === "direct" ? item.type === "direct" : item.type !== "direct"))
    .filter((item) => normalizedQuery ? `${item.title} ${item.preview} ${item.searchable}`.toLocaleLowerCase("cs-CZ").includes(normalizedQuery) : true)
    .sort((left, right) => right.sortAt - left.sortAt || left.title.localeCompare(right.title, "cs-CZ"));
}

function dedupeChatItems(items: ChatListItem[]): ChatListItem[] {
  const deduped = new Map<string, ChatListItem>();
  items.forEach((item) => {
    const key = chatDedupeKey(item);
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, item);
      return;
    }
    const preferred = preferChatListItem(current, item);
    deduped.set(key, {
      ...preferred,
      active: current.active || item.active,
      unreadCount: Math.max(current.unreadCount, item.unreadCount)
    });
  });
  return Array.from(deduped.values());
}

function chatDedupeKey(item: ChatListItem): string {
  const memberIds = item.conversation?.members?.map((member) => member.userId).filter(Boolean).sort().join("|");
  if (item.type === "direct" && memberIds) {
    return `direct:${memberIds}`;
  }
  return `${item.type === "direct" ? "direct" : "group"}:${normalizeTitle(item.title)}`;
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

function buildTimelineRows(messages: MatrixTimelineMessage[]): Array<
  | { id: string; kind: "date"; label: string }
  | { grouped: boolean; kind: "message"; message: MatrixTimelineMessage }
> {
  const rows: Array<
    | { id: string; kind: "date"; label: string }
    | { grouped: boolean; kind: "message"; message: MatrixTimelineMessage }
  > = [];
  let previousDay = "";
  let previousSender = "";
  messages.forEach((message) => {
    const day = formatDate(message.timestamp);
    if (day !== previousDay) {
      rows.push({ id: `date-${day}`, kind: "date", label: day });
      previousDay = day;
      previousSender = "";
    }
    const grouped = previousSender === message.sender;
    rows.push({ grouped, kind: "message", message });
    previousSender = message.sender;
  });
  return rows;
}

function applyChatPreferences(items: ChatListItem[], preferences: ChatPreferences): ChatListItem[] {
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

function chatPreferenceSnapshot(item: ChatListItem): string {
  return item.latest?.eventId ?? "__no_latest__";
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

function findGroupByTitle(title: string, groups: CommunityGroup[]): CommunityGroup | undefined {
  const normalized = normalizeTitle(title);
  return groups.find((group) => normalizeTitle(group.name) === normalized);
}

function conversationCommunityGroupId(conversation: MessagingConversationSummary): string | undefined {
  const externalId = conversation.metadata?.externalId;
  return typeof externalId === "string" && conversation.metadata?.source === "cop.community" ? externalId : undefined;
}

interface CommunityGroupChatMetadata {
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

function communityGroupChatMetadata(group: CommunityGroup): CommunityGroupChatMetadata {
  const chat = asRecord(group.metadata?.chat);
  if (!chat) {
    return {};
  }
  const disappearingMessages = asRecord(chat.disappearingMessages);
  const retentionSeconds = normalizeMessageRetentionSeconds(disappearingMessages?.seconds);
  const retentionEnabled = disappearingMessages?.enabled === true && retentionSeconds !== null;
  return {
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

function communityGroupConversationId(group: CommunityGroup): string | undefined {
  return communityGroupChatMetadata(group).conversationId;
}

function communityGroupMatrixRoomId(group: CommunityGroup): string | undefined {
  return communityGroupChatMetadata(group).matrixRoomId;
}

function messageRetentionSecondsForActiveChat(room: MatrixRoomSummary | null, group: CommunityGroup | null): MessageRetentionSeconds {
  return normalizeMessageRetentionSeconds(room?.messageRetentionSeconds ?? (group ? communityGroupChatMetadata(group).disappearingMessages?.seconds : null));
}

function normalizeMessageRetentionSeconds(value: unknown): MessageRetentionSeconds {
  if (value === 86_400 || value === 604_800 || value === 7_776_000) {
    return value;
  }
  return null;
}

function messageRetentionLabel(seconds: MessageRetentionSeconds): string {
  return messageRetentionOptions.find((option) => option.seconds === seconds)?.label ?? "Vypnuto";
}

function messageRetentionShortLabel(seconds: MessageRetentionSeconds): string {
  return seconds === null ? "Vyp." : messageRetentionLabel(seconds);
}

function filterTimelineByRetention(messages: MatrixTimelineMessage[], seconds: MessageRetentionSeconds): MatrixTimelineMessage[] {
  if (seconds === null) {
    return messages;
  }
  const minTimestamp = Date.now() - seconds * 1000;
  return messages.filter((message) => {
    const timestamp = Date.parse(message.timestamp);
    return !Number.isFinite(timestamp) || timestamp >= minTimestamp;
  });
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

function ensureConversationHasMember(conversation: MessagingConversationSummary, user: UserDirectoryEntry): MessagingConversationSummary {
  if (conversation.members?.some((member) => member.userId === user.subjectId)) {
    return conversation;
  }
  return {
    ...conversation,
    members: [
      ...(conversation.members ?? []),
      { displayName: user.displayName || user.username, role: "member", userId: user.subjectId }
    ]
  };
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

function lastTimelineMessage(messages: MatrixTimelineMessage[]): MatrixTimelineMessage | undefined {
  return messages[messages.length - 1];
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

function latestMessagePreview(message: MatrixTimelineMessage): string {
  if (message.kind === "location") {
    return message.location?.label ?? "Sdílená poloha";
  }
  if (message.attachment) {
    return message.body && message.body !== message.attachment.fileName ? message.body : message.attachment.fileName;
  }
  return message.own ? `Vy: ${message.body}` : message.body;
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
  if (message.own) {
    return <CheckCheck size={15} />;
  }
  return null;
}

function matrixMessagePreviewItem(message: MatrixTimelineMessage, url?: string): MediaPreviewItem {
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
  return {
    contentType: attachment.encrypted ? "chráněná příloha" : attachment.contentType ?? "soubor",
    kind,
    title: attachment.fileName,
    ...(attachment.size ? { byteSizeLabel: formatBytes(attachment.size) } : {}),
    ...(message.body && message.body !== attachment.fileName ? { caption: message.body } : {}),
    ...(url ? { url } : {})
  };
}

function directBrowserMediaUrl(message: MatrixTimelineMessage): string | null {
  const url = message.attachment?.mediaUrl;
  return url && url.startsWith("http") && !message.attachment?.encrypted ? url : null;
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

function conversationSubtitle(item: ChatListItem, room: MatrixRoomSummary | null): string {
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

function chatIdentityFor(session: AuthSession, config: AuthConfig, serverProfile: ServerUserProfile | null): ChatIdentityProfile {
  const operatorProfile = operatorProfileFromServer(serverProfile);
  const displayName = operatorProfile.displayName ?? authDisplayName(session, config);
  const avatarUrl = operatorProfile.avatarDataUrl
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
  preparing: boolean
): ChatConnectionState {
  if (!chatReady || isMatrixSyncOffline(syncState)) {
    return "offline";
  }
  if (preparing || !matrixSession || isMatrixSyncWarming(syncState)) {
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
  return normalized.includes("sync")
    || normalized.includes("catch")
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

function userFacingError(message: string): string {
  const normalized = message.trim();
  if (/\b(401|403)\b/u.test(normalized) || /unauthori[sz]ed|forbidden|přihlášen/i.test(normalized)) {
    return "Pro tuto akci je potřeba platné přihlášení.";
  }
  if (/\b(500|502|503|504)\b/u.test(normalized) || /service unavailable|gateway timeout|bad gateway/i.test(normalized)) {
    return "Služba zpráv je dočasně nedostupná.";
  }
  if (/fetch failed|load failed|failed to fetch|network/i.test(normalized)) {
    return "Služba zpráv není z tohoto zařízení dostupná.";
  }
  return normalized || "Akci se nepodařilo dokončit.";
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

function normalizeChatPreferences(preferences: Partial<ChatPreferences>): ChatPreferences {
  const now = Date.now();
  const mutedUntilByKey = Object.fromEntries(
    Object.entries(preferences.mutedUntilByKey ?? {})
      .filter(([key, value]) => key && (value === "forever" || Date.parse(value) > now))
  );
  const hiddenByKey = Object.fromEntries(
    Object.entries(preferences.hiddenByKey ?? {})
      .filter(([key, value]) => key && typeof value === "string" && value)
      .slice(0, 200)
  );
  const readOverrideByKey = Object.fromEntries(
    Object.entries(preferences.readOverrideByKey ?? {})
      .filter(([key, value]) => key && typeof value === "string" && value)
      .slice(0, 200)
  );
  return {
    hiddenByKey,
    manualUnreadKeys: Array.from(new Set((preferences.manualUnreadKeys ?? []).filter(Boolean))).slice(0, 200),
    mutedUntilByKey,
    pinnedKeys: Array.from(new Set((preferences.pinnedKeys ?? []).filter(Boolean))).slice(0, 24),
    readOverrideByKey
  };
}

function isChatMuted(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return value === "forever" || Date.parse(value) > Date.now();
}

function muteChoiceToStorageValue(choice: MuteChoice): string {
  if (choice === "forever") {
    return "forever";
  }
  const durationMs = choice === "8h" ? 8 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + durationMs).toISOString();
}

function messageMatchesQuery(message: MatrixTimelineMessage, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase("cs-CZ");
  if (!normalized) {
    return false;
  }
  return messageSearchText(message).toLocaleLowerCase("cs-CZ").includes(normalized);
}

function messageSearchText(message: MatrixTimelineMessage): string {
  return [
    message.body,
    message.attachment?.fileName,
    message.location ? formatCoordinates(message.location) : "",
    message.location?.label ?? ""
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

function formatMessageForClipboard(message: MatrixTimelineMessage): string {
  const time = new Date(message.timestamp).toLocaleString("cs-CZ");
  return `[${time}] ${message.own ? "Vy" : message.senderDisplayName ?? "Člen"}: ${messageSearchText(message) || message.body}`;
}

function formatMessageForForward(message: MatrixTimelineMessage): string {
  const prefix = message.own ? "Přeposláno od vás" : `Přeposláno od ${message.senderDisplayName ?? "člena"}`;
  return `${prefix}:\n${messageSearchText(message) || message.body}`;
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
): Array<{ id: string; name: string; subtitle: string }> {
  if (group) {
    return group.members.map((member) => ({
      id: member.subjectId,
      name: member.displayName || member.username || member.subjectId,
      subtitle: member.role === "owner" ? "správce" : member.status === "active" ? "člen" : member.status
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

function readRouteSelection(): string | null {
  const path = window.location.pathname.replace(/\/+$/u, "");
  const prefix = "/chat";
  if (path === prefix || !path.startsWith(`${prefix}/`)) {
    return null;
  }
  const raw = path.slice(prefix.length + 1).split("/")[0];
  if (!raw) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function writeChatRoute(selection: string | null) {
  const nextPath = selection ? `/chat/${encodeURIComponent(selection)}` : "/chat";
  const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;
  window.history.pushState({}, "", nextUrl);
}

function getOrCreateMatrixDeviceId(ownerId: string): string {
  const storageKey = `${matrixDeviceIdStoragePrefix}.${stableStorageKey(ownerId)}`;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (isValidMatrixDeviceId(stored)) {
      return stored;
    }
    const next = createMatrixDeviceId();
    window.localStorage.setItem(storageKey, next);
    return next;
  } catch {
    const fallback = fallbackMatrixDeviceIds.get(storageKey) ?? createMatrixDeviceId();
    fallbackMatrixDeviceIds.set(storageKey, fallback);
    return fallback;
  }
}

function createMatrixDeviceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.every((value) => value === 0)) {
    return `COPWEB.${Date.now().toString(36)}`;
  }
  return `COPWEB.${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function isValidMatrixDeviceId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9._=-]{1,64}$/u.test(value));
}

function stableStorageKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._=-]+/gu, "_")
    .slice(0, 96) || "anonymous";
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

function mediaKindLabel(kind: MediaPreviewItem["kind"]): string {
  if (kind === "image") {
    return "Fotografie";
  }
  if (kind === "video") {
    return "Video";
  }
  if (kind === "location") {
    return "Poloha";
  }
  if (kind === "document") {
    return "Dokument";
  }
  return "Soubor";
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

function formatCoordinates(location: { lat: number; lon: number }): string {
  return `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long"
  }).format(date);
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

function initialsFor(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  const initials = parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
    : value.slice(0, 2);
  return initials.toLocaleUpperCase("cs-CZ");
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
