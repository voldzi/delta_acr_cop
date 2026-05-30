import React from "react";
import { Download, FileText, Image, Info, Lock, LogIn, MapPin, MessageCircle, Paperclip, Pin, PinOff, Plus, RefreshCw, Search, Send, ShieldCheck, Star, Users, Video, X } from "lucide-react";
import { fetchMessagingBootstrap } from "../cop-data";
import type { MessagingMatrixIdentityResolutionResponse, MessagingMatrixRoomBindingResponse, UserDirectoryEntry } from "../cop-data";
import { SelectField } from "../ui/select";
import {
  clearMatrixMessagingDeviceState,
  createMatrixMessagingSession,
  isMatrixAccountStoreMismatchError
} from "./matrixClient";
import type { MatrixAttachmentKind, MatrixLocationShare, MatrixMessagingSession, MatrixRoomSummary, MatrixTimelineMessage, MessagingPanelProps } from "./types";

type Tone = "ok" | "warn" | "neutral";
type MessagingDockTab = "chat" | "context" | "groups";

interface PendingChatAttachment {
  file: File;
  kind: MatrixAttachmentKind;
}

const communityGroupVisibilityOptions: Array<{ label: string; value: "private" | "public" }> = [
  { label: "S povolením", value: "private" },
  { label: "Veřejná", value: "public" }
];

const messagingDockMinWidth = 420;
const messagingDockMaxWidth = 760;
const chatListMinWidth = 184;
const chatListMaxWidth = 360;
const chatListWidthStorageKey = "cop.messaging.chatListWidth.v1";
const matrixDeviceIdStoragePrefix = "cop.messaging.matrixDeviceId.v2";
const fallbackMatrixDeviceIds = new Map<string, string>();

export function assertMatrixRoomBindingConfirmed(
  binding: MessagingMatrixRoomBindingResponse,
  roomId: string
): void {
  if (binding.status === "online" && binding.conversation?.matrix?.roomId === roomId) {
    return;
  }
  throw new Error(binding.warnings[0] ?? "Messaging provider nepotvrdil vazbu Matrix místnosti. Chat nebude lokálně aktivován.");
}

export function matrixUserIdsFromResolution(
  result: MessagingMatrixIdentityResolutionResponse,
  requestedUserIds: string[]
): string[] {
  if (result.status !== "online") {
    throw new Error(result.warnings[0] ?? "Některé členy se nepodařilo pozvat do Matrix místnosti.");
  }
  const requested = Array.from(new Set(requestedUserIds));
  const resolvedByUserId = new Map(result.identities.map((identity) => [identity.userId, identity.matrixUserId]));
  const missing = requested.filter((userId) => !resolvedByUserId.get(userId));
  if (missing.length > 0) {
    throw new Error(`Chybí Matrix identita pro členy: ${missing.slice(0, 5).join(", ")}.`);
  }
  return Array.from(new Set(requested.flatMap((userId) => resolvedByUserId.get(userId) ?? [])));
}

export function visibleMatrixRooms(
  rooms: MatrixRoomSummary[],
  conversations: MessagingPanelProps["conversations"]
): MatrixRoomSummary[] {
  const conversationRoomIds = new Set(conversations.flatMap((conversation) => conversation.matrix?.roomId ? [conversation.matrix.roomId] : []));
  return rooms.filter((room) => !conversationRoomIds.has(room.roomId));
}

export function linkedConversationForCommunityGroup(
  conversations: MessagingPanelProps["conversations"],
  group: MessagingPanelProps["communityGroups"][number] | null | undefined
): MessagingPanelProps["conversations"][number] | undefined {
  if (!group) {
    return undefined;
  }
  return conversations.find((conversation) => conversationCommunityGroupId(conversation) === group.groupId);
}

export function MessagingPanel({
  apiBase,
  authenticated,
  authConfig,
  authToken,
  conversations,
  conversationsError,
  communityGroups,
  communityGroupsError,
  dockWidth,
  error,
  loading,
  mapContext,
  pinned,
  session,
  status,
  onAddGroupMember,
  onBindMatrixRoom,
  onClose,
  onCreateDirectConversation,
  onCreateGroup,
  onCreateReportFromChat,
  onDockWidthChange,
  onLogin,
  onPinnedChange,
  onRefresh,
  onResolveMatrixIdentities,
  onSearchUsers
}: MessagingPanelProps) {
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = React.useState(false);
  const [matrixSession, setMatrixSession] = React.useState<MatrixMessagingSession | null>(null);
  const [rooms, setRooms] = React.useState<MatrixRoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);
  const [timeline, setTimeline] = React.useState<MatrixTimelineMessage[]>([]);
  const [composerText, setComposerText] = React.useState("");
  const [composerError, setComposerError] = React.useState<string | null>(null);
  const [messageSending, setMessageSending] = React.useState(false);
  const [pendingAttachment, setPendingAttachment] = React.useState<PendingChatAttachment | null>(null);
  const [directQuery, setDirectQuery] = React.useState("");
  const [directSuggestions, setDirectSuggestions] = React.useState<UserDirectoryEntry[]>([]);
  const [directSearchLoading, setDirectSearchLoading] = React.useState(false);
  const [directSearchError, setDirectSearchError] = React.useState<string | null>(null);
  const [groupActionError, setGroupActionError] = React.useState<string | null>(null);
  const [groupActionLoading, setGroupActionLoading] = React.useState(false);
  const [groupMemberQuery, setGroupMemberQuery] = React.useState("");
  const [groupMemberCandidate, setGroupMemberCandidate] = React.useState<UserDirectoryEntry | null>(null);
  const [groupMemberSuggestions, setGroupMemberSuggestions] = React.useState<UserDirectoryEntry[]>([]);
  const [groupMemberSearchLoading, setGroupMemberSearchLoading] = React.useState(false);
  const [groupMemberSearchError, setGroupMemberSearchError] = React.useState<string | null>(null);
  const [newGroupName, setNewGroupName] = React.useState("");
  const [newGroupVisibility, setNewGroupVisibility] = React.useState<"private" | "public">("private");
  const [activeDockTab, setActiveDockTab] = React.useState<MessagingDockTab>("chat");
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  const [chatListWidth, setChatListWidth] = React.useState(() => readChatListWidth());
  const [syncState, setSyncState] = React.useState("idle");
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const matrixAccountOwnerId = session.profile?.subjectId ?? session.profile?.username ?? "anonymous";
  const previousMatrixAccountOwnerRef = React.useRef<string | null>(null);

  React.useEffect(() => () => {
    matrixSession?.stop();
  }, [matrixSession]);

  React.useEffect(() => {
    if (authenticated) {
      return;
    }
    matrixSession?.stop();
    setMatrixSession(null);
    setRooms([]);
    setSelectedRoomId(null);
    setTimeline([]);
    void clearMatrixMessagingDeviceState();
  }, [authenticated]);

  React.useEffect(() => {
    if (!authenticated) {
      previousMatrixAccountOwnerRef.current = null;
      return;
    }
    const previousOwner = previousMatrixAccountOwnerRef.current;
    previousMatrixAccountOwnerRef.current = matrixAccountOwnerId;
    if (!previousOwner || previousOwner === matrixAccountOwnerId) {
      return;
    }
    matrixSession?.stop();
    setMatrixSession(null);
    setRooms([]);
    setSelectedRoomId(null);
    setTimeline([]);
    setBootstrapError(null);
    void clearMatrixMessagingDeviceState();
  }, [authenticated, matrixAccountOwnerId]);

  React.useEffect(() => {
    if (!authenticated || !authToken || !matrixSession?.bootstrap.expiresAt) {
      return undefined;
    }
    const expiresAt = Date.parse(matrixSession.bootstrap.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      return undefined;
    }
    const delayMs = Math.max(30_000, expiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      void renewMatrixSession();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [authenticated, authToken, matrixSession?.bootstrap.expiresAt]);

  React.useEffect(() => {
    if (!matrixSession || !selectedRoomId) {
      setTimeline([]);
      return;
    }
    setTimeline(matrixSession.getTimeline(selectedRoomId));
  }, [matrixSession, rooms, selectedRoomId]);

  React.useEffect(() => {
    const query = groupMemberQuery.trim();
    if (!authenticated || query.length < 2 || groupMemberCandidate?.subjectId === query || groupMemberCandidate?.username === query) {
      setGroupMemberSuggestions([]);
      setGroupMemberSearchError(null);
      setGroupMemberSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setGroupMemberSearchLoading(true);
      setGroupMemberSearchError(null);
      onSearchUsers(query)
        .then((items) => {
          if (!cancelled) {
            setGroupMemberSuggestions(items);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setGroupMemberSuggestions([]);
            setGroupMemberSearchError(error instanceof Error ? error.message : "Vyhledání uživatele selhalo.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setGroupMemberSearchLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authenticated, groupMemberCandidate?.subjectId, groupMemberQuery, onSearchUsers]);

  React.useEffect(() => {
    const query = directQuery.trim();
    if (!authenticated || query.length < 2) {
      setDirectSuggestions([]);
      setDirectSearchError(null);
      setDirectSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setDirectSearchLoading(true);
      setDirectSearchError(null);
      onSearchUsers(query)
        .then((items) => {
          if (!cancelled) {
            setDirectSuggestions(items.filter((item) => item.subjectId !== session.profile?.subjectId));
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setDirectSuggestions([]);
            setDirectSearchError(error instanceof Error ? error.message : "Vyhledání uživatele selhalo.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setDirectSearchLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authenticated, directQuery, onSearchUsers, session.profile?.subjectId]);

  const providerStatus = status?.status ?? "degraded";
  const chatReady = Boolean(status?.chatAvailable && authenticated && authToken);
  const e2eeRequired = status?.features?.endToEndEncryptionRequired === true;
  const matrixBootstrapReady = status?.features?.matrixTokenBootstrap === true;
  const selectedGroup = communityGroups.find((group) => group.groupId === selectedGroupId) ?? communityGroups[0] ?? null;
  const selectedConversation = conversations.find((conversation) => conversation.conversationId === selectedRoomId || conversation.matrix?.roomId === selectedRoomId) ?? null;
  const selectedConversationGroup = selectedConversation
    ? communityGroups.find((group) => group.groupId === conversationCommunityGroupId(selectedConversation)) ?? null
    : null;

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name) {
      setGroupActionError("Doplňte název skupiny.");
      return;
    }
    setGroupActionLoading(true);
    setGroupActionError(null);
    try {
      const { conversation, group } = await onCreateGroup(name, newGroupVisibility);
      setSelectedGroupId(group.groupId);
      setNewGroupName("");
      if (matrixSession && conversation) {
        const inviteUserIds = await resolveConversationMatrixUsers(conversation);
        const roomId = await matrixSession.createGroupRoom(group.name, inviteUserIds);
        const binding = await onBindMatrixRoom(conversation.conversationId, roomId, true);
        assertMatrixRoomBindingConfirmed(binding, roomId);
        onRefresh();
        const nextRooms = ensureRoomSummary(matrixSession.getRooms(), {
          encrypted: true,
          name: group.name,
          roomId,
          unreadCount: 0
        });
        setRooms(nextRooms);
        setSelectedRoomId(roomId);
      }
    } catch (caught) {
      setGroupActionError(caught instanceof Error ? caught.message : "Skupinu se nepodařilo vytvořit.");
    } finally {
      setGroupActionLoading(false);
    }
  }

  async function addMember() {
    const subjectId = groupMemberCandidate?.subjectId ?? groupMemberQuery.trim();
    if (!selectedGroup || !subjectId) {
      return;
    }
    setGroupActionLoading(true);
    setGroupActionError(null);
    try {
      const group = await onAddGroupMember(selectedGroup.groupId, subjectId, groupMemberCandidate?.displayName);
      setSelectedGroupId(group.groupId);
      setGroupMemberQuery("");
      setGroupMemberCandidate(null);
      setGroupMemberSuggestions([]);
    } catch (caught) {
      setGroupActionError(caught instanceof Error ? caught.message : "Člena se nepodařilo přidat.");
    } finally {
      setGroupActionLoading(false);
    }
  }

  async function approveMember(subjectId: string, displayName?: string) {
    if (!selectedGroup || !subjectId) {
      return;
    }
    setGroupActionLoading(true);
    setGroupActionError(null);
    try {
      const group = await onAddGroupMember(selectedGroup.groupId, subjectId, displayName);
      setSelectedGroupId(group.groupId);
    } catch (caught) {
      setGroupActionError(caught instanceof Error ? caught.message : "Žádost se nepodařilo potvrdit.");
    } finally {
      setGroupActionLoading(false);
    }
  }

  async function openConversations() {
    if (!authToken || !authenticated) {
      onLogin();
      return;
    }
    if (!status?.chatAvailable) {
      setBootstrapError("Messaging provider zatím nepotvrdil bezpečný Matrix/E2EE bootstrap.");
      return;
    }

    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const bootstrap = await fetchMessagingBootstrap(apiBase, authToken, getOrCreateMatrixDeviceId(matrixAccountOwnerId));
      if (!bootstrap.chatAvailable || !bootstrap.tokenAvailable || !bootstrap.accessToken) {
        setBootstrapError(bootstrap.detail ?? bootstrap.warnings[0] ?? "Matrix token bootstrap není připravený.");
        return;
      }
      await startMatrixSession(bootstrap);
    } catch (caught) {
      setBootstrapError(caught instanceof Error ? caught.message : "Matrix klient se nepodařilo spustit.");
    } finally {
      setBootstrapLoading(false);
    }
  }

  async function renewMatrixSession() {
    if (!authToken || !authenticated || !matrixSession) {
      return;
    }
    try {
      const bootstrap = await fetchMessagingBootstrap(apiBase, authToken, matrixSession.bootstrap.deviceId ?? getOrCreateMatrixDeviceId(matrixAccountOwnerId));
      if (!bootstrap.chatAvailable || !bootstrap.tokenAvailable || !bootstrap.accessToken) {
        setBootstrapError(bootstrap.detail ?? bootstrap.warnings[0] ?? "Matrix token se nepodařilo obnovit.");
        return;
      }
      await startMatrixSession(bootstrap, selectedRoomId);
    } catch (caught) {
      setBootstrapError(caught instanceof Error ? caught.message : "Matrix session se nepodařilo obnovit.");
    }
  }

  async function startMatrixSession(
    bootstrap: Awaited<ReturnType<typeof fetchMessagingBootstrap>>,
    preferredRoomId?: string | null,
    allowStoreRecovery = true
  ) {
    matrixSession?.stop();
    let nextSession: MatrixMessagingSession;
    try {
      nextSession = await createMatrixMessagingSession(bootstrap, {
        onRoomsChanged: (nextRooms) => {
          setRooms(nextRooms);
          setSelectedRoomId((current) => current ?? preferredRoomId ?? nextRooms[0]?.roomId ?? null);
        },
        onSyncState: setSyncState
      });
    } catch (caught) {
      if (allowStoreRecovery && authToken && isMatrixAccountStoreMismatchError(caught)) {
        await clearMatrixMessagingDeviceState();
        const recoveredBootstrap = await fetchMessagingBootstrap(apiBase, authToken, getOrCreateMatrixDeviceId(matrixAccountOwnerId));
        setBootstrapError("Lokální šifrovací stav patřil předchozímu účtu. Chat byl bezpečně obnoven pro aktuální přihlášení.");
        await startMatrixSession(recoveredBootstrap, preferredRoomId, false);
        return;
      }
      throw caught;
    }
    const nextRooms = nextSession.getRooms();
    setMatrixSession(nextSession);
    setRooms(nextRooms);
    setSelectedRoomId(preferredRoomId && nextRooms.some((room) => room.roomId === preferredRoomId) ? preferredRoomId : nextRooms[0]?.roomId ?? null);
    setSyncState("starting");
  }

  async function sendMessage() {
    if (!matrixSession || !selectedRoomId || (!composerText.trim() && !pendingAttachment)) {
      return;
    }
    const text = composerText.trim();
    const attachment = pendingAttachment;
    setMessageSending(true);
    setComposerError(null);
    try {
      if (attachment) {
        await matrixSession.sendAttachment(selectedRoomId, {
          caption: text || undefined,
          file: attachment.file,
          kind: attachment.kind
        });
      } else {
        await matrixSession.sendMessage(selectedRoomId, text);
      }
      setComposerText("");
      setPendingAttachment(null);
      setTimeline(matrixSession.getTimeline(selectedRoomId));
    } catch (caught) {
      setComposerError(caught instanceof Error ? caught.message : "Zprávu se nepodařilo odeslat.");
    } finally {
      setMessageSending(false);
    }
  }

  async function shareLocation() {
    if (!matrixSession || !selectedRoomId) {
      return;
    }
    setMessageSending(true);
    setComposerError(null);
    try {
      await matrixSession.sendLocation(selectedRoomId, preferredShareLocation(mapContext));
      setTimeline(matrixSession.getTimeline(selectedRoomId));
    } catch (caught) {
      setComposerError(caught instanceof Error ? caught.message : "Polohu se nepodařilo odeslat.");
    } finally {
      setMessageSending(false);
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
    setPendingAttachment({
      file,
      kind: normalizeAttachmentKind(file, requestedKind)
    });
    setComposerError(null);
  }

  async function downloadAttachment(message: MatrixTimelineMessage) {
    if (!matrixSession || !message.attachment) {
      return;
    }
    setComposerError(null);
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
      setComposerError(caught instanceof Error ? caught.message : "Přílohu se nepodařilo stáhnout.");
    }
  }

  function createReportFromCurrentChat() {
    const group = selectedConversationGroup ?? selectedGroup ?? undefined;
    onCreateReportFromChat({
      conversationId: selectedConversation?.conversationId,
      groupId: group?.groupId,
      groupName: group?.name ?? selectedConversation?.title,
      location: preferredShareLocation(mapContext),
      roomId: selectedRoomId ?? undefined,
      title: selectedConversation?.title ? `Hlášení: ${selectedConversation.title}` : "Hlášení z chatu"
    });
  }

  function beginDockResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!pinned) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampNumber(startWidth + startX - moveEvent.clientX, messagingDockMinWidth, messagingDockMaxWidth);
      onDockWidthChange(nextWidth);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handleChatListWidthChange(width: number) {
    const nextWidth = clampNumber(width, chatListMinWidth, chatListMaxWidth);
    setChatListWidth(nextWidth);
    writeChatListWidth(nextWidth);
  }

  async function startDirectConversation(user: UserDirectoryEntry) {
    if (!matrixSession) {
      setBootstrapError("Nejdřív otevřete šifrovaný chat.");
      return;
    }
    setBootstrapError(null);
    try {
      const conversation = await onCreateDirectConversation(user);
      const inviteUserIds = await resolveConversationMatrixUsers({
        ...conversation,
        members: [
          ...(conversation.members ?? []),
          { displayName: user.displayName, role: "member", userId: user.subjectId }
        ]
      });
      const roomId = await matrixSession.createGroupRoom(conversation.title, inviteUserIds);
      const binding = await onBindMatrixRoom(conversation.conversationId, roomId, true);
      assertMatrixRoomBindingConfirmed(binding, roomId);
      setDirectQuery("");
      setDirectSuggestions([]);
      onRefresh();
      const nextRooms = ensureRoomSummary(matrixSession.getRooms(), {
        encrypted: true,
        name: conversation.title,
        roomId,
        unreadCount: 0
      });
      setRooms(nextRooms);
      setSelectedRoomId(roomId);
    } catch (caught) {
      setBootstrapError(caught instanceof Error ? caught.message : "Přímý chat se nepodařilo založit.");
    }
  }

  async function startRoomForConversation(conversationId: string) {
    const conversation = conversations.find((item) => item.conversationId === conversationId);
    if (!conversation || !matrixSession) {
      return;
    }
    setBootstrapError(null);
    try {
      if (conversation.matrix?.roomId) {
        setSelectedRoomId(conversation.matrix.roomId);
        return;
      }
      const inviteUserIds = await resolveConversationMatrixUsers(conversation);
      const roomId = await matrixSession.createGroupRoom(conversation.title, inviteUserIds);
      const binding = await onBindMatrixRoom(conversation.conversationId, roomId, true);
      assertMatrixRoomBindingConfirmed(binding, roomId);
      onRefresh();
      const nextRooms = ensureRoomSummary(matrixSession.getRooms(), {
        encrypted: true,
        name: conversation.title,
        roomId,
        unreadCount: 0
      });
      setRooms(nextRooms);
      setSelectedRoomId(roomId);
    } catch (caught) {
      setBootstrapError(caught instanceof Error ? caught.message : "Chatovou místnost se nepodařilo založit.");
    }
  }

  async function resolveConversationMatrixUsers(conversation: MessagingPanelProps["conversations"][number]): Promise<string[]> {
    if (!conversation.members && (conversation.memberCount ?? 0) > 1) {
      throw new Error("Konverzace neobsahuje načtený seznam členů. Obnovte konverzace a zkuste to znovu.");
    }
    const userIds = (conversation.members ?? [])
      .map((member) => member.userId)
      .filter((userId) => userId && userId !== session.profile?.subjectId);
    if (userIds.length === 0) {
      return [];
    }
    const result = await onResolveMatrixIdentities(userIds);
    return matrixUserIdsFromResolution(result, userIds);
  }

  const panelStyle = pinned
    ? ({ "--messaging-dock-width": `${dockWidth}px` } as React.CSSProperties)
    : undefined;

  return (
    <section className={`messaging-panel ${pinned ? "pinned" : ""}`} aria-label="Konverzace" style={panelStyle}>
      {pinned ? <div aria-label="Změnit šířku komunikačního panelu" className="messaging-resize-handle" onPointerDown={beginDockResize} role="separator" /> : null}
      <input
        ref={attachmentInputRef}
        aria-hidden="true"
        className="visually-hidden"
        tabIndex={-1}
        type="file"
        onChange={(event) => handleAttachmentSelected(event.target.files)}
      />
      <div className="messaging-panel-main">
        <div className="messaging-panel-header">
          <div className="panel-title chat-panel-title">
            <MessageCircle size={17} />
            <div>
              <strong>Konverzace</strong>
              <span>Skupiny, zprávy a sdílená média</span>
            </div>
          </div>
          <div className="messaging-header-actions">
            <button aria-label={pinned ? "Odepnout konverzace" : "Připnout konverzace"} className="icon-button compact" onClick={() => onPinnedChange(!pinned)} title={pinned ? "Odepnout od mapy" : "Připnout k mapě"} type="button">
              {pinned ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
            <button aria-label="Zavřít konverzace" className="icon-button compact" onClick={onClose} title="Zavřít" type="button">
              <X size={16} />
            </button>
          </div>
        </div>

        {!pinned ? <MessagingDockTabs activeTab={activeDockTab} onChange={setActiveDockTab} /> : null}

        <div className="chat-status-strip">
          <span className={messagingStatusTone(providerStatus)}>{messagingStatusLabel(providerStatus, loading)}</span>
          <span>{authenticated ? operatorDisplayName(session, authConfig) : "bez účtu"}</span>
          <span>{matrixSession ? matrixSyncLabel(syncState) : matrixBootstrapReady ? "zprávy připravené" : "čeká na zprávy"}</span>
          {e2eeRequired ? <span>šifrováno</span> : null}
        </div>

        {error ? <div className="error-banner">Zprávy: {error}</div> : null}
        {conversationsError ? <div className="error-banner">Konverzace: {conversationsError}</div> : null}
        {bootstrapError ? <div className="error-banner">Chat: {bootstrapError}</div> : null}
        {composerError ? <div className="error-banner">Odeslání: {composerError}</div> : null}

        {!authenticated ? (
          <div className="messaging-empty-state">
            <strong>Komunikace je přihlášená funkce.</strong>
            <p>Mapa zůstává dostupná i bez účtu, ale zprávy musí být svázané s ověřenou identitou uživatele.</p>
            <button className="primary-button secondary" onClick={onLogin} type="button">
              <LogIn size={16} />
              Přihlásit
            </button>
          </div>
        ) : activeDockTab === "chat" && matrixSession ? (
          <MatrixChatShell
            chatListWidth={chatListWidth}
            conversations={conversations}
            composerText={composerText}
            directQuery={directQuery}
            directSearchError={directSearchError}
            directSearchLoading={directSearchLoading}
            directSuggestions={directSuggestions}
            mapContext={mapContext}
            messageSending={messageSending}
            pendingAttachment={pendingAttachment}
            pinned={pinned}
            rooms={rooms}
            selectedConversation={selectedConversation}
            selectedRoomId={selectedRoomId}
            timeline={timeline}
            onChatListWidthChange={handleChatListWidthChange}
            onComposerChange={setComposerText}
            onConversationSelect={(conversationId) => {
              const conversation = conversations.find((item) => item.conversationId === conversationId);
              setSelectedRoomId(conversation?.matrix?.roomId ?? conversationId);
            }}
            onAttachmentClear={() => setPendingAttachment(null)}
            onAttachmentPick={pickAttachment}
            onCreateReport={createReportFromCurrentChat}
            onDirectQueryChange={setDirectQuery}
            onDownloadAttachment={(message) => void downloadAttachment(message)}
            onRoomSelect={setSelectedRoomId}
            onSend={() => void sendMessage()}
            onShareLocation={() => void shareLocation()}
            onStartDirectConversation={(user) => void startDirectConversation(user)}
            onStartRoom={(conversationId) => void startRoomForConversation(conversationId)}
          />
        ) : activeDockTab === "chat" && chatReady ? (
          <div className="messaging-empty-state">
            <strong>{conversations.length > 0 ? `${conversations.length} konverzací připraveno.` : "Zatím nemáte žádnou konverzaci."}</strong>
            <p>{conversations.length > 0 ? "Otevřete chat a pokračujte ve skupinách navázaných na sdílení v mapě." : "Založte skupinu níže. Bude sloužit pro zprávy i omezení přístupu k médiím."}</p>
            <div className="messaging-security-note">
              <ShieldCheck size={15} />
              Šifrované zprávy nejdou přes COP API.
            </div>
          </div>
        ) : activeDockTab === "chat" ? (
          <div className="messaging-empty-state">
            <strong>Chat zatím čeká na bezpečný bootstrap.</strong>
            <p>Skupiny pro sdílení médií můžete připravit už teď; zprávy se zapnou po Matrix/E2EE potvrzení.</p>
          </div>
        ) : null}

        {authenticated && activeDockTab === "groups" ? (
          <CommunityGroupsPanel
            actionError={groupActionError ?? communityGroupsError}
            actionLoading={groupActionLoading}
            conversations={conversations}
            groups={communityGroups}
            memberCandidate={groupMemberCandidate}
            memberQuery={groupMemberQuery}
            memberSearchError={groupMemberSearchError}
            memberSearchLoading={groupMemberSearchLoading}
            memberSuggestions={groupMemberSuggestions}
            newGroupName={newGroupName}
            newGroupVisibility={newGroupVisibility}
            selectedGroup={selectedGroup}
            onAddMember={() => void addMember()}
            onApproveMember={(subjectId, displayName) => void approveMember(subjectId, displayName)}
            onCreateGroup={() => void createGroup()}
            onMemberCandidateChange={setGroupMemberCandidate}
            onMemberQueryChange={(value) => {
              setGroupMemberQuery(value);
              setGroupMemberCandidate(null);
            }}
            onNewGroupNameChange={setNewGroupName}
            onNewGroupVisibilityChange={setNewGroupVisibility}
            onOpenGroupChat={(conversationId) => {
              const conversation = conversations.find((item) => item.conversationId === conversationId);
              setSelectedRoomId(conversation?.matrix?.roomId ?? conversationId);
              setActiveDockTab("chat");
              if (matrixSession) {
                void startRoomForConversation(conversationId);
              }
            }}
            onSelectGroup={setSelectedGroupId}
          />
        ) : null}

        {authenticated && activeDockTab === "context" ? (
          <MessagingContextPanel
            mapContext={mapContext}
            selectedConversation={selectedConversation}
            selectedGroup={selectedConversationGroup ?? selectedGroup}
            selectedRoomId={selectedRoomId}
            onCreateReport={createReportFromCurrentChat}
          />
        ) : null}

        {status?.warnings.length ? (
          <div className="messaging-warning-list">
            {status.warnings.slice(0, 4).map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        ) : null}

        <div className="messaging-panel-actions">
          <button className="mini-button" disabled={loading} onClick={onRefresh} type="button">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Obnovit stav
          </button>
          <button className="mini-button" disabled={!chatReady || bootstrapLoading} onClick={() => void openConversations()} type="button">
            <Lock size={14} />
            {bootstrapLoading ? "Spouštím chat" : matrixSession ? "Konverzace otevřeny" : "Otevřít chat"}
          </button>
        </div>
      </div>
      {pinned ? <MessagingDockTabs activeTab={activeDockTab} rail onChange={setActiveDockTab} /> : null}
    </section>
  );
}

function MessagingDockTabs({ activeTab, onChange, rail = false }: { activeTab: MessagingDockTab; onChange: (tab: MessagingDockTab) => void; rail?: boolean }) {
  const tabs: Array<{ icon: React.ReactNode; label: string; value: MessagingDockTab }> = [
    { icon: <MessageCircle size={15} />, label: "Chat", value: "chat" },
    { icon: <Users size={15} />, label: "Skupiny", value: "groups" },
    { icon: <Info size={15} />, label: "Kontext", value: "context" }
  ];
  return (
    <div className={`messaging-dock-tabs ${rail ? "rail" : ""}`} role="tablist" aria-label="Zobrazení komunikace">
      {tabs.map((tab) => (
        <button
          aria-selected={activeTab === tab.value}
          className={activeTab === tab.value ? "active" : ""}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          role="tab"
          type="button"
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function MessagingContextPanel({
  mapContext,
  selectedConversation,
  selectedGroup,
  selectedRoomId,
  onCreateReport
}: {
  mapContext: MessagingPanelProps["mapContext"];
  selectedConversation: MessagingPanelProps["conversations"][number] | null;
  selectedGroup: MessagingPanelProps["communityGroups"][number] | null;
  selectedRoomId: string | null;
  onCreateReport: () => void;
}) {
  const activeTitle = selectedConversation?.title ?? selectedGroup?.name ?? selectedRoomId ?? "Bez vybraného chatu";
  return (
    <div className="messaging-context-panel">
      <section className="messaging-context-card">
        <span>Aktivní prostor</span>
        <strong>{activeTitle}</strong>
        <small>{selectedConversation?.type === "direct" ? "přímý chat" : selectedGroup ? `${selectedGroup.members.filter((member) => member.status === "active").length} aktivních členů` : "vyberte konverzaci"}</small>
      </section>
      <section className="messaging-context-card">
        <span>Mapa</span>
        <strong>{mapContext.selectedFeature?.title ?? "Střed aktuálního pohledu"}</strong>
        <small>{formatCoordinates(mapContext.userLocation ?? mapContext.center)}</small>
      </section>
      <button className="primary-button secondary wide" onClick={onCreateReport} type="button">
        <MapPin size={16} />
        Nahlásit z chatu
      </button>
      <div className="messaging-context-link-grid">
        <span>Konverzace</span>
        <strong>{selectedConversation?.conversationId ?? "není vybraná"}</strong>
        <span>Matrix místnost</span>
        <strong>{selectedRoomId ?? "čeká"}</strong>
        <span>Skupina</span>
        <strong>{selectedGroup?.name ?? "bez skupiny"}</strong>
      </div>
    </div>
  );
}

function CommunityGroupsPanel({
  actionError,
  actionLoading,
  conversations,
  groups,
  memberCandidate,
  memberQuery,
  memberSearchError,
  memberSearchLoading,
  memberSuggestions,
  newGroupName,
  newGroupVisibility,
  selectedGroup,
  onAddMember,
  onApproveMember,
  onCreateGroup,
  onMemberCandidateChange,
  onMemberQueryChange,
  onNewGroupNameChange,
  onNewGroupVisibilityChange,
  onOpenGroupChat,
  onSelectGroup
}: {
  actionError: string | null;
  actionLoading: boolean;
  conversations: MessagingPanelProps["conversations"];
  groups: MessagingPanelProps["communityGroups"];
  memberCandidate: UserDirectoryEntry | null;
  memberQuery: string;
  memberSearchError: string | null;
  memberSearchLoading: boolean;
  memberSuggestions: UserDirectoryEntry[];
  newGroupName: string;
  newGroupVisibility: "private" | "public";
  selectedGroup: MessagingPanelProps["communityGroups"][number] | null;
  onAddMember: () => void;
  onApproveMember: (subjectId: string, displayName?: string) => void;
  onCreateGroup: () => void;
  onMemberCandidateChange: (value: UserDirectoryEntry | null) => void;
  onMemberQueryChange: (value: string) => void;
  onNewGroupNameChange: (value: string) => void;
  onNewGroupVisibilityChange: (value: "private" | "public") => void;
  onOpenGroupChat: (conversationId: string) => void;
  onSelectGroup: (groupId: string) => void;
}) {
  const pendingMembers = selectedGroup?.members.filter((member) => member.status === "pending") ?? [];
  const activeMembers = selectedGroup?.members.filter((member) => member.status === "active") ?? [];
  const linkedConversation = linkedConversationForCommunityGroup(conversations, selectedGroup);
  return (
    <div className="chat-groups-panel">
      <div className="chat-groups-header">
        <div className="chat-groups-title">
          <Users size={16} />
          <strong>Skupiny</strong>
        </div>
        <span>{groups.length} celkem</span>
      </div>
      <div className="chat-group-create">
        <input
          maxLength={80}
          placeholder="Nová skupina"
          value={newGroupName}
          onChange={(event) => onNewGroupNameChange(event.target.value)}
        />
        <SelectField<"private" | "public">
          ariaLabel="Viditelnost nové skupiny"
          options={communityGroupVisibilityOptions}
          value={newGroupVisibility}
          onValueChange={onNewGroupVisibilityChange}
        />
        <button className="mini-button" disabled={actionLoading || !newGroupName.trim()} onClick={onCreateGroup} type="button">
          <Plus size={14} />
          Založit
        </button>
      </div>
      <div className="chat-groups-workspace">
        <div className="chat-group-list">
          {groups.length === 0 ? <span className="empty-mini">Zatím nemáte žádnou skupinu.</span> : null}
          {groups.map((group) => (
            <button
              className={selectedGroup?.groupId === group.groupId ? "active" : ""}
              key={group.groupId}
              onClick={() => onSelectGroup(group.groupId)}
              type="button"
            >
              <span>{group.name}</span>
              <small>{group.visibility === "public" ? "veřejná" : "s povolením"} · {group.members.filter((member) => member.status === "active").length} členů</small>
            </button>
          ))}
        </div>
        {selectedGroup ? (
          <div className="chat-group-members">
            <div className="chat-group-members-heading">
              <div>
                <strong>{selectedGroup.name}</strong>
                <span>{activeMembers.length} aktivních · {pendingMembers.length} čeká</span>
              </div>
              {linkedConversation ? (
                <button className="mini-button" disabled={actionLoading} onClick={() => onOpenGroupChat(linkedConversation.conversationId)} type="button">
                  <MessageCircle size={14} />
                  Chat
                </button>
              ) : null}
            </div>
            {pendingMembers.length > 0 ? (
              <div className="chat-group-pending-list">
                {pendingMembers.slice(0, 5).map((member) => (
                  <span key={member.subjectId}>
                    <small>{member.displayName}</small>
                    <button className="mini-button" disabled={actionLoading} onClick={() => onApproveMember(member.subjectId, member.displayName)} type="button">
                      Schválit
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="chat-group-member-search">
              <input
                placeholder="Uživatel nebo e-mail"
                value={memberQuery}
                onChange={(event) => onMemberQueryChange(event.target.value)}
              />
              <button className="mini-button" disabled={actionLoading || !memberQuery.trim()} onClick={onAddMember} type="button">
                Přidat
              </button>
            </div>
            {memberSearchLoading ? <span>Vyhledávám...</span> : null}
            {memberSearchError ? <span>{memberSearchError}</span> : null}
            {memberCandidate ? <span>{memberCandidate.displayName} · {memberCandidate.username}</span> : null}
            {memberSuggestions.length > 0 ? (
              <div className="chat-member-search-results">
                {memberSuggestions.slice(0, 6).map((user) => (
                  <button
                    key={user.subjectId}
                    onClick={() => {
                      onMemberQueryChange(user.username);
                      onMemberCandidateChange(user);
                    }}
                    type="button"
                  >
                    <strong>{user.displayName}</strong>
                    <small>{user.username}{user.email ? ` · ${user.email}` : ""}</small>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="chat-group-member-list">
              {selectedGroup.members.map((member) => (
                <button
                  className={member.status === "active" ? "active" : "pending"}
                  key={member.subjectId}
                  type="button"
                >
                  <span>{initialsFor(member.displayName || member.username || member.subjectId)}</span>
                  <strong>{member.displayName || member.username}</strong>
                  <small>{member.role} · {member.status === "active" ? "aktivní" : "čeká"}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {actionError ? <div className="error-banner">{actionError}</div> : null}
    </div>
  );
}

function MatrixChatShell({
  chatListWidth,
  conversations,
  composerText,
  directQuery,
  directSearchError,
  directSearchLoading,
  directSuggestions,
  mapContext,
  messageSending,
  pendingAttachment,
  pinned,
  rooms,
  selectedConversation,
  selectedRoomId,
  timeline,
  onChatListWidthChange,
  onComposerChange,
  onConversationSelect,
  onAttachmentClear,
  onAttachmentPick,
  onCreateReport,
  onDirectQueryChange,
  onDownloadAttachment,
  onRoomSelect,
  onSend,
  onShareLocation,
  onStartDirectConversation,
  onStartRoom
}: {
  chatListWidth: number;
  conversations: MessagingPanelProps["conversations"];
  composerText: string;
  directQuery: string;
  directSearchError: string | null;
  directSearchLoading: boolean;
  directSuggestions: UserDirectoryEntry[];
  mapContext: MessagingPanelProps["mapContext"];
  messageSending: boolean;
  pendingAttachment: PendingChatAttachment | null;
  pinned: boolean;
  rooms: MatrixRoomSummary[];
  selectedConversation: MessagingPanelProps["conversations"][number] | null;
  selectedRoomId: string | null;
  timeline: MatrixTimelineMessage[];
  onChatListWidthChange: (width: number) => void;
  onComposerChange: (value: string) => void;
  onConversationSelect: (conversationId: string) => void;
  onAttachmentClear: () => void;
  onAttachmentPick: (kind: MatrixAttachmentKind) => void;
  onCreateReport: () => void;
  onDirectQueryChange: (value: string) => void;
  onDownloadAttachment: (message: MatrixTimelineMessage) => void;
  onRoomSelect: (roomId: string) => void;
  onSend: () => void;
  onShareLocation: () => void;
  onStartDirectConversation: (user: UserDirectoryEntry) => void;
  onStartRoom: (conversationId: string) => void;
}) {
  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) ?? null;
  const conversationOnlySelected = Boolean(selectedConversation && !selectedRoom);
  const canSend = Boolean(selectedRoomId && selectedRoom);
  const hasDraft = Boolean(composerText.trim() || pendingAttachment);
  const standaloneRooms = visibleMatrixRooms(rooms, conversations);
  const shellStyle = pinned
    ? ({ "--chat-list-width": `${chatListWidth}px` } as React.CSSProperties)
    : undefined;
  const mapContextLabel = mapContext.selectedFeature?.title ?? formatCoordinates(mapContext.userLocation ?? mapContext.center);
  const activeRoomTitle = selectedRoom?.name ?? selectedConversation?.title ?? "Vyberte konverzaci";
  const activeRoomMeta = selectedRoom
    ? `${selectedConversation?.memberCount ?? 1} členů · ${selectedRoom.encrypted ? "šifrováno" : "ověřuji šifrování"}`
    : selectedConversation?.matrix?.roomId
      ? "synchronizuji šifrovanou místnost"
      : selectedConversation
        ? "připraveno k založení chatu"
        : "čeká na výběr";

  function beginChatListResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!pinned) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatListWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      onChatListWidthChange(startWidth + moveEvent.clientX - startX);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <div className={`matrix-chat-shell ${pinned ? "pinned" : ""}`} style={shellStyle}>
      <div className="matrix-room-list" aria-label="Konverzace">
        <div className="matrix-list-header">
          <div>
            <strong>Chat</strong>
            <span>{conversations.length + standaloneRooms.length} konverzací</span>
          </div>
          <Search size={15} aria-hidden="true" />
        </div>
        <div className="direct-chat-starter">
          <input
            aria-label="Vyhledat uživatele pro přímý chat"
            placeholder="Nový chat: jméno nebo e-mail"
            value={directQuery}
            onChange={(event) => onDirectQueryChange(event.target.value)}
          />
          {directSearchLoading ? <span>Vyhledávám...</span> : null}
          {directSearchError ? <span>{directSearchError}</span> : null}
          {directSuggestions.length > 0 ? (
            <div className="direct-chat-results">
              {directSuggestions.slice(0, 5).map((user) => (
                <button key={user.subjectId} onClick={() => onStartDirectConversation(user)} type="button">
                  <strong>{initialsFor(user.displayName || user.username)}</strong>
                  <span>
                    <b>{user.displayName}</b>
                    <small>{user.username}{user.email ? ` · ${user.email}` : ""}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {rooms.length === 0 && conversations.length === 0 ? <div className="empty-mini">Zatím nemáte žádnou konverzaci. Založte skupinu níže.</div> : null}
        {conversations.map((conversation) => (
          <button
            aria-pressed={conversation.conversationId === selectedRoomId || conversation.matrix?.roomId === selectedRoomId}
            className={conversation.conversationId === selectedRoomId || conversation.matrix?.roomId === selectedRoomId ? "active" : ""}
            key={conversation.conversationId}
            onClick={() => onConversationSelect(conversation.conversationId)}
            type="button"
          >
            <span className="matrix-room-avatar">{initialsFor(conversation.title)}</span>
            <span>
              <strong>{conversation.title}</strong>
              <small>{conversation.type === "group" ? "skupina" : "přímý chat"} · {conversation.memberCount ?? 1} členů · {conversation.matrix?.roomId ? "šifrovaný chat" : "připravit chat"}</small>
            </span>
          </button>
        ))}
        {standaloneRooms.map((room) => (
          <button
            aria-pressed={room.roomId === selectedRoomId}
            className={room.roomId === selectedRoomId ? "active" : ""}
            key={room.roomId}
            onClick={() => onRoomSelect(room.roomId)}
            type="button"
          >
            <span className="matrix-room-avatar">{initialsFor(room.name)}</span>
            <span>
              <strong>{room.name}</strong>
              <small>{room.encrypted ? "šifrované" : "stav šifrování neznámý"} · {room.unreadCount} nové</small>
            </span>
          </button>
        ))}
      </div>
      {pinned ? <div aria-label="Změnit šířku seznamu konverzací" className="matrix-chat-split-handle" onPointerDown={beginChatListResize} role="separator" /> : null}
      <div className="matrix-room-view">
        <div className="matrix-room-header">
          <div className="matrix-room-heading">
            <strong>{activeRoomTitle}</strong>
            <small>{activeRoomMeta}</small>
          </div>
          <div className="matrix-room-header-actions">
            <button className="icon-button compact" disabled={!selectedRoom && !selectedConversation} title="Připnout konverzaci" type="button">
              <Star size={14} />
            </button>
            <button className="icon-button compact" disabled={!selectedRoom && !selectedConversation} title="Informace o konverzaci" type="button">
              <Info size={14} />
            </button>
            <span className="matrix-room-context-chip" title={mapContextLabel}>
              <MapPin size={13} />
              {mapContextLabel}
            </span>
            <button className="mini-button" disabled={!selectedRoomId && !selectedConversation} onClick={onCreateReport} type="button">
              <MapPin size={14} />
              Nahlásit
            </button>
          </div>
        </div>
        {(selectedRoom || selectedConversation) ? (
          <div className="matrix-pinned-note">
            <Pin size={15} />
            <div>
              <strong>Připnutý kontext</strong>
              <span>{selectedConversation ? "Skupina, média a události jsou navázané na mapu." : `Kontext mapy: ${mapContextLabel}`}</span>
            </div>
          </div>
        ) : null}
        <div className="matrix-timeline" aria-live="polite">
          {conversationOnlySelected ? (
            <div className="conversation-start-card">
              <strong>{selectedConversation?.title}</strong>
              {selectedConversation?.matrix?.roomId ? (
                <span>Šifrovaná místnost už existuje. Probíhá synchronizace Matrix klienta; pokud se zprávy nenačtou, obnovte stav konverzací.</span>
              ) : (
                <>
                  <span>Skupina existuje pro sdílená média. Založte šifrovanou chatovou místnost a můžete začít psát.</span>
                  <button className="mini-button" onClick={() => selectedConversation ? onStartRoom(selectedConversation.conversationId) : undefined} type="button">
                    <Plus size={14} />
                    Začít chat
                  </button>
                </>
              )}
            </div>
          ) : timeline.length === 0 ? <div className="empty-mini">{selectedRoom ? "Zatím zde nejsou žádné zprávy." : "Vyberte nebo založte konverzaci."}</div> : null}
          {timeline.map((message) => (
            <div className={`matrix-message ${message.own ? "own" : ""}`} key={message.eventId}>
              <small>{message.sender} · {new Date(message.timestamp).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</small>
              <MatrixMessageBody message={message} onDownloadAttachment={onDownloadAttachment} />
            </div>
          ))}
        </div>
        <div className="matrix-attachment-shortcuts" aria-label="Rychlé vložení">
          <button disabled={!canSend || messageSending} onClick={() => onAttachmentPick("image")} type="button">
            <Image size={18} />
            <span>Fotografie</span>
          </button>
          <button disabled={!canSend || messageSending} onClick={() => onAttachmentPick("video")} type="button">
            <Video size={18} />
            <span>Video</span>
          </button>
          <button disabled={!canSend || messageSending} onClick={() => onAttachmentPick("file")} type="button">
            <FileText size={18} />
            <span>Soubor</span>
          </button>
          <button disabled={!canSend || messageSending} onClick={onShareLocation} type="button">
            <MapPin size={18} />
            <span>Poloha</span>
          </button>
        </div>
        <div className="matrix-composer">
          <div className="matrix-composer-tools" aria-label="Přílohy">
            <button aria-label="Přiložit fotku" className="icon-button compact" disabled={!canSend || messageSending} onClick={() => onAttachmentPick("image")} title="Přiložit fotku" type="button">
              <Image size={15} />
            </button>
            <button aria-label="Přiložit video" className="icon-button compact" disabled={!canSend || messageSending} onClick={() => onAttachmentPick("video")} title="Přiložit video" type="button">
              <Video size={15} />
            </button>
            <button aria-label="Přiložit soubor" className="icon-button compact" disabled={!canSend || messageSending} onClick={() => onAttachmentPick("file")} title="Přiložit soubor" type="button">
              <Paperclip size={15} />
            </button>
            <button aria-label="Sdílet polohu" className="icon-button compact" disabled={!canSend || messageSending} onClick={onShareLocation} title="Sdílet polohu" type="button">
              <MapPin size={15} />
            </button>
          </div>
          {pendingAttachment ? (
            <div className="matrix-attachment-chip">
              {attachmentIcon(pendingAttachment.kind)}
              <span>{pendingAttachment.file.name || attachmentKindLabel(pendingAttachment.kind)}</span>
              <small>{formatBytes(pendingAttachment.file.size)}</small>
              <button aria-label="Odebrat přílohu" className="icon-button compact" disabled={messageSending} onClick={onAttachmentClear} type="button">
                <X size={13} />
              </button>
            </div>
          ) : null}
          <textarea
            aria-label="Text zprávy"
            disabled={!canSend || messageSending}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={canSend ? "Napsat zprávu..." : "Nejdřív vyberte aktivní chat"}
            rows={1}
            value={composerText}
          />
          <button className="mini-button" disabled={!canSend || !hasDraft || messageSending} onClick={onSend} type="button">
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MatrixMessageBody({ message, onDownloadAttachment }: { message: MatrixTimelineMessage; onDownloadAttachment: (message: MatrixTimelineMessage) => void }) {
  if (message.kind === "location" && message.location) {
    return (
      <div className="matrix-message-location">
        <MapPin size={15} />
        <div>
          <strong>{message.location.label ?? "Sdílená poloha"}</strong>
          <span>{formatCoordinates(message.location)}</span>
        </div>
        {message.geoUri ? <a href={message.geoUri}>Mapa</a> : null}
      </div>
    );
  }

  if (message.attachment) {
    const showCaption = Boolean(message.body && message.body !== message.attachment.fileName);
    return (
      <>
        {showCaption ? <span>{message.body}</span> : null}
        <div className="matrix-attachment-card">
          {message.kind === "image" && message.attachment.mediaUrl?.startsWith("http") && !message.attachment.encrypted ? (
            <img alt="" src={message.attachment.mediaUrl} />
          ) : null}
          {message.kind === "video" && message.attachment.mediaUrl?.startsWith("http") && !message.attachment.encrypted ? (
            <video controls src={message.attachment.mediaUrl} />
          ) : null}
          <div>
            {attachmentIcon(message.kind === "text" || message.kind === "location" ? "file" : message.kind)}
            <span>
              <strong>{message.attachment.fileName}</strong>
              <small>{message.attachment.encrypted ? "E2EE příloha" : message.attachment.contentType ?? "soubor"}{message.attachment.size ? ` · ${formatBytes(message.attachment.size)}` : ""}</small>
            </span>
            <button className="mini-button" onClick={() => onDownloadAttachment(message)} type="button">
              <Download size={14} />
              Stáhnout
            </button>
          </div>
        </div>
      </>
    );
  }

  return <span>{message.body}</span>;
}

function initialsFor(value: string): string {
  const parts = value
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const initials = parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
    : value.slice(0, 2);
  return initials.toLocaleUpperCase("cs-CZ");
}

function getOrCreateMatrixDeviceId(ownerId: string): string {
  const storageKey = `${matrixDeviceIdStoragePrefix}.${stableStorageKey(ownerId)}`;
  if (typeof window === "undefined") {
    const fallback = fallbackMatrixDeviceIds.get(storageKey) ?? createMatrixDeviceId();
    fallbackMatrixDeviceIds.set(storageKey, fallback);
    return fallback;
  }

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

  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `COPWEB.${suffix}`;
}

function ensureRoomSummary(rooms: MatrixRoomSummary[], room: MatrixRoomSummary): MatrixRoomSummary[] {
  if (rooms.some((item) => item.roomId === room.roomId)) {
    return rooms;
  }
  return [room, ...rooms];
}

function isValidMatrixDeviceId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9._=-]{1,64}$/u.test(value));
}

function readChatListWidth(): number {
  if (typeof window === "undefined") {
    return 236;
  }
  const stored = Number(window.localStorage.getItem(chatListWidthStorageKey));
  return Number.isFinite(stored) ? clampNumber(stored, chatListMinWidth, chatListMaxWidth) : 236;
}

function writeChatListWidth(width: number): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(chatListWidthStorageKey, String(clampNumber(width, chatListMinWidth, chatListMaxWidth)));
}

function stableStorageKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._=-]+/gu, "_")
    .slice(0, 96) || "anonymous";
}

function preferredShareLocation(mapContext: MessagingPanelProps["mapContext"]): MatrixLocationShare {
  if (mapContext.userLocation) {
    return {
      accuracyM: mapContext.userLocation.accuracyM,
      label: "Moje poloha",
      lat: mapContext.userLocation.lat,
      lon: mapContext.userLocation.lon,
      source: "device"
    };
  }
  return {
    label: mapContext.selectedFeature?.title ?? "Střed mapy",
    lat: mapContext.center.lat,
    lon: mapContext.center.lon,
    source: "map"
  };
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

function attachmentIcon(kind: MatrixAttachmentKind | MatrixTimelineMessage["kind"]): React.ReactNode {
  if (kind === "image") {
    return <Image size={15} />;
  }
  if (kind === "video") {
    return <Video size={15} />;
  }
  return <FileText size={15} />;
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

function conversationCommunityGroupId(conversation: MessagingPanelProps["conversations"][number]): string | undefined {
  const externalId = conversation.metadata?.externalId;
  return typeof externalId === "string" && conversation.metadata?.source === "cop.community" ? externalId : undefined;
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function messagingStatusTone(status: "degraded" | "disabled" | "online"): Tone {
  if (status === "online") {
    return "ok";
  }
  if (status === "degraded") {
    return "warn";
  }
  return "neutral";
}

function messagingStatusLabel(status: "degraded" | "disabled" | "online", loading: boolean): string {
  if (loading) {
    return "ověřuji";
  }
  if (status === "online") {
    return "online";
  }
  if (status === "degraded") {
    return "degraded";
  }
  return "vypnuto";
}

function matrixSyncLabel(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "starting" || normalized === "prepared") {
    return "připojuji";
  }
  if (normalized === "syncing" || normalized === "sync") {
    return "synchronizace";
  }
  if (normalized === "error" || normalized === "reconnecting" || normalized === "stopped" || normalized.includes("error")) {
    return "omezené";
  }
  if (normalized === "started") {
    return "připojeno";
  }
  return "připojeno";
}

function operatorDisplayName(session: MessagingPanelProps["session"], authConfig: MessagingPanelProps["authConfig"]): string {
  if (session.status === "authenticated") {
    return session.profile?.name ?? session.profile?.username ?? "přihlášen";
  }
  if (session.status === "authenticating") {
    return "ověřuji";
  }
  return authConfig.mode === "lab" ? "Lab operator" : "nepřihlášen";
}
