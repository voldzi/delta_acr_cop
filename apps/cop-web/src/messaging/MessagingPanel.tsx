import React from "react";
import { Lock, LogIn, MessageCircle, Pin, PinOff, Plus, RefreshCw, Send, ShieldCheck, Users, X } from "lucide-react";
import { fetchMessagingBootstrap } from "../cop-data";
import type { MessagingMatrixIdentityResolutionResponse, MessagingMatrixRoomBindingResponse, UserDirectoryEntry } from "../cop-data";
import { SelectField } from "../ui/select";
import {
  clearMatrixMessagingDeviceState,
  createMatrixMessagingSession,
  isMatrixAccountStoreMismatchError
} from "./matrixClient";
import type { MatrixMessagingSession, MatrixRoomSummary, MatrixTimelineMessage, MessagingPanelProps } from "./types";

type Tone = "ok" | "warn" | "neutral";

const communityGroupVisibilityOptions: Array<{ label: string; value: "private" | "public" }> = [
  { label: "S povolením", value: "private" },
  { label: "Veřejná", value: "public" }
];

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

export function MessagingPanel({
  apiBase,
  authenticated,
  authConfig,
  authToken,
  conversations,
  conversationsError,
  communityGroups,
  communityGroupsError,
  error,
  loading,
  pinned,
  session,
  status,
  onAddGroupMember,
  onBindMatrixRoom,
  onClose,
  onCreateDirectConversation,
  onCreateGroup,
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
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  const [syncState, setSyncState] = React.useState("idle");
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
    if (!matrixSession || !selectedRoomId || !composerText.trim()) {
      return;
    }
    const text = composerText;
    setComposerText("");
    await matrixSession.sendMessage(selectedRoomId, text);
    setTimeline(matrixSession.getTimeline(selectedRoomId));
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

  return (
    <section className={`messaging-panel ${pinned ? "pinned" : ""}`} aria-label="Konverzace">
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

      <div className="chat-status-strip">
        <span className={messagingStatusTone(providerStatus)}>{messagingStatusLabel(providerStatus, loading)}</span>
        <span>{authenticated ? operatorDisplayName(session, authConfig) : "bez účtu"}</span>
        <span>{matrixSession ? matrixSyncLabel(syncState) : matrixBootstrapReady ? "zprávy připravené" : "čeká na zprávy"}</span>
        {e2eeRequired ? <span>šifrováno</span> : null}
      </div>

      {error ? <div className="error-banner">Zprávy: {error}</div> : null}
      {conversationsError ? <div className="error-banner">Konverzace: {conversationsError}</div> : null}
      {bootstrapError ? <div className="error-banner">Chat: {bootstrapError}</div> : null}

      {!authenticated ? (
        <div className="messaging-empty-state">
          <strong>Komunikace je přihlášená funkce.</strong>
          <p>Mapa zůstává dostupná i bez účtu, ale zprávy musí být svázané s ověřenou identitou uživatele.</p>
          <button className="primary-button secondary" onClick={onLogin} type="button">
            <LogIn size={16} />
            Přihlásit
          </button>
        </div>
      ) : matrixSession ? (
        <MatrixChatShell
          conversations={conversations}
          composerText={composerText}
          directQuery={directQuery}
          directSearchError={directSearchError}
          directSearchLoading={directSearchLoading}
          directSuggestions={directSuggestions}
          rooms={rooms}
          selectedConversation={selectedConversation}
          selectedRoomId={selectedRoomId}
          timeline={timeline}
          onComposerChange={setComposerText}
          onConversationSelect={(conversationId) => {
            const conversation = conversations.find((item) => item.conversationId === conversationId);
            setSelectedRoomId(conversation?.matrix?.roomId ?? conversationId);
          }}
          onDirectQueryChange={setDirectQuery}
          onRoomSelect={setSelectedRoomId}
          onSend={() => void sendMessage()}
          onStartDirectConversation={(user) => void startDirectConversation(user)}
          onStartRoom={(conversationId) => void startRoomForConversation(conversationId)}
        />
      ) : chatReady ? (
        <div className="messaging-empty-state">
          <strong>{conversations.length > 0 ? `${conversations.length} konverzací připraveno.` : "Zatím nemáte žádnou konverzaci."}</strong>
          <p>{conversations.length > 0 ? "Otevřete chat a pokračujte ve skupinách navázaných na sdílení v mapě." : "Založte skupinu níže. Bude sloužit pro zprávy i omezení přístupu k médiím."}</p>
          <div className="messaging-security-note">
            <ShieldCheck size={15} />
            Šifrované zprávy nejdou přes COP API.
          </div>
        </div>
      ) : (
        <div className="messaging-empty-state">
          <strong>Chat zatím čeká na bezpečný bootstrap.</strong>
          <p>Skupiny pro sdílení médií můžete připravit už teď; zprávy se zapnou po Matrix/E2EE potvrzení.</p>
        </div>
      )}

      {authenticated ? (
        <CommunityGroupsPanel
          actionError={groupActionError ?? communityGroupsError}
          actionLoading={groupActionLoading}
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
          onSelectGroup={setSelectedGroupId}
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
    </section>
  );
}

function CommunityGroupsPanel({
  actionError,
  actionLoading,
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
  onSelectGroup
}: {
  actionError: string | null;
  actionLoading: boolean;
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
  onSelectGroup: (groupId: string) => void;
}) {
  const pendingMembers = selectedGroup?.members.filter((member) => member.status === "pending") ?? [];
  return (
    <div className="chat-groups-panel">
      <div className="chat-groups-title">
        <Users size={16} />
        <strong>Skupiny</strong>
      </div>
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
      {selectedGroup ? (
        <div className="chat-group-members">
          <strong>{selectedGroup.name}</strong>
          <span>{selectedGroup.members.filter((member) => member.status === "pending").length} žádostí čeká</span>
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
          <div>
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
        </div>
      ) : null}
      {actionError ? <div className="error-banner">{actionError}</div> : null}
    </div>
  );
}

function MatrixChatShell({
  conversations,
  composerText,
  directQuery,
  directSearchError,
  directSearchLoading,
  directSuggestions,
  rooms,
  selectedConversation,
  selectedRoomId,
  timeline,
  onComposerChange,
  onConversationSelect,
  onDirectQueryChange,
  onRoomSelect,
  onSend,
  onStartDirectConversation,
  onStartRoom
}: {
  conversations: MessagingPanelProps["conversations"];
  composerText: string;
  directQuery: string;
  directSearchError: string | null;
  directSearchLoading: boolean;
  directSuggestions: UserDirectoryEntry[];
  rooms: MatrixRoomSummary[];
  selectedConversation: MessagingPanelProps["conversations"][number] | null;
  selectedRoomId: string | null;
  timeline: MatrixTimelineMessage[];
  onComposerChange: (value: string) => void;
  onConversationSelect: (conversationId: string) => void;
  onDirectQueryChange: (value: string) => void;
  onRoomSelect: (roomId: string) => void;
  onSend: () => void;
  onStartDirectConversation: (user: UserDirectoryEntry) => void;
  onStartRoom: (conversationId: string) => void;
}) {
  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) ?? null;
  const conversationOnlySelected = Boolean(selectedConversation && !selectedRoom);
  const canSend = Boolean(selectedRoomId && selectedRoom);
  const standaloneRooms = visibleMatrixRooms(rooms, conversations);
  return (
    <div className="matrix-chat-shell">
      <div className="matrix-room-list" aria-label="Konverzace">
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
      <div className="matrix-room-view">
        <div className="matrix-room-header">
          <strong>{selectedRoom?.name ?? selectedConversation?.title ?? "Vyberte konverzaci"}</strong>
          <small>{selectedRoom ? selectedRoom.encrypted ? "šifrováno" : "ověřuji šifrování" : selectedConversation?.matrix?.roomId ? "synchronizuji místnost" : selectedConversation ? "připraveno" : "čeká"}</small>
        </div>
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
              <span>{message.body}</span>
            </div>
          ))}
        </div>
        <div className="matrix-composer">
          <input
            aria-label="Text zprávy"
            disabled={!canSend}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={canSend ? "Napsat zprávu..." : "Nejdřív vyberte aktivní chat"}
            value={composerText}
          />
          <button className="mini-button" disabled={!canSend || !composerText.trim()} onClick={onSend} type="button">
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
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

function stableStorageKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._=-]+/gu, "_")
    .slice(0, 96) || "anonymous";
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
