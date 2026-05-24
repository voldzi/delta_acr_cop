import React from "react";
import { Lock, LogIn, MessageCircle, Pin, PinOff, Plus, RefreshCw, Send, ShieldCheck, Users, X } from "lucide-react";
import { fetchMessagingBootstrap } from "../cop-data";
import { createMatrixMessagingSession } from "./matrixClient";
import type { MatrixMessagingSession, MatrixRoomSummary, MatrixTimelineMessage, MessagingPanelProps } from "./types";

type Tone = "ok" | "warn" | "neutral";

const matrixDeviceIdStorageKey = "cop.messaging.matrixDeviceId";
let fallbackMatrixDeviceId: string | null = null;

export function MessagingPanel({
  apiBase,
  authenticated,
  authConfig,
  authToken,
  communityGroups,
  communityGroupsError,
  error,
  loading,
  pinned,
  session,
  status,
  onAddGroupMember,
  onClose,
  onCreateGroup,
  onLogin,
  onPinnedChange,
  onRefresh
}: MessagingPanelProps) {
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = React.useState(false);
  const [matrixSession, setMatrixSession] = React.useState<MatrixMessagingSession | null>(null);
  const [rooms, setRooms] = React.useState<MatrixRoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);
  const [timeline, setTimeline] = React.useState<MatrixTimelineMessage[]>([]);
  const [composerText, setComposerText] = React.useState("");
  const [groupActionError, setGroupActionError] = React.useState<string | null>(null);
  const [groupActionLoading, setGroupActionLoading] = React.useState(false);
  const [groupMemberSubjectId, setGroupMemberSubjectId] = React.useState("");
  const [newGroupName, setNewGroupName] = React.useState("");
  const [newGroupVisibility, setNewGroupVisibility] = React.useState<"private" | "public">("private");
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  const [syncState, setSyncState] = React.useState("idle");

  React.useEffect(() => () => {
    matrixSession?.stop();
  }, [matrixSession]);

  React.useEffect(() => {
    if (!matrixSession || !selectedRoomId) {
      setTimeline([]);
      return;
    }
    setTimeline(matrixSession.getTimeline(selectedRoomId));
  }, [matrixSession, rooms, selectedRoomId]);

  const providerStatus = status?.status ?? "degraded";
  const chatReady = Boolean(status?.chatAvailable && authenticated && authToken);
  const e2eeRequired = status?.features?.endToEndEncryptionRequired === true;
  const matrixBootstrapReady = status?.features?.matrixTokenBootstrap === true;
  const selectedGroup = communityGroups.find((group) => group.groupId === selectedGroupId) ?? communityGroups[0] ?? null;

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name) {
      setGroupActionError("Doplňte název skupiny.");
      return;
    }
    setGroupActionLoading(true);
    setGroupActionError(null);
    try {
      const group = await onCreateGroup(name, newGroupVisibility);
      setSelectedGroupId(group.groupId);
      setNewGroupName("");
    } catch (caught) {
      setGroupActionError(caught instanceof Error ? caught.message : "Skupinu se nepodařilo vytvořit.");
    } finally {
      setGroupActionLoading(false);
    }
  }

  async function addMember() {
    const subjectId = groupMemberSubjectId.trim();
    if (!selectedGroup || !subjectId) {
      return;
    }
    setGroupActionLoading(true);
    setGroupActionError(null);
    try {
      const group = await onAddGroupMember(selectedGroup.groupId, subjectId);
      setSelectedGroupId(group.groupId);
      setGroupMemberSubjectId("");
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
      const bootstrap = await fetchMessagingBootstrap(apiBase, authToken, getOrCreateMatrixDeviceId());
      if (!bootstrap.chatAvailable || !bootstrap.tokenAvailable || !bootstrap.accessToken) {
        setBootstrapError(bootstrap.detail ?? bootstrap.warnings[0] ?? "Matrix token bootstrap není připravený.");
        return;
      }
      matrixSession?.stop();
      const nextSession = await createMatrixMessagingSession(bootstrap, {
        onRoomsChanged: (nextRooms) => {
          setRooms(nextRooms);
          setSelectedRoomId((current) => current ?? nextRooms[0]?.roomId ?? null);
        },
        onSyncState: setSyncState
      });
      const nextRooms = nextSession.getRooms();
      setMatrixSession(nextSession);
      setRooms(nextRooms);
      setSelectedRoomId(nextRooms[0]?.roomId ?? null);
      setSyncState("starting");
    } catch (caught) {
      setBootstrapError(caught instanceof Error ? caught.message : "Matrix klient se nepodařilo spustit.");
    } finally {
      setBootstrapLoading(false);
    }
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
        <span>{matrixSession ? `sync ${syncState}` : matrixBootstrapReady ? "chat připraven" : "čeká na chat"}</span>
        {e2eeRequired ? <span>E2EE</span> : null}
      </div>

      {error ? <div className="error-banner">Messaging: {error}</div> : null}
      {bootstrapError ? <div className="error-banner">Matrix: {bootstrapError}</div> : null}

      {!authenticated ? (
        <div className="messaging-empty-state">
          <strong>Komunikace je přihlášená funkce.</strong>
          <p>Mapa zůstává dostupná i bez účtu, ale zprávy musí být svázané s ověřenou identitou uživatele.</p>
          <button className="primary-button secondary" onClick={onLogin} type="button">
            <LogIn size={16} />
            Přihlásit přes Keycloak
          </button>
        </div>
      ) : matrixSession ? (
        <MatrixChatShell
          composerText={composerText}
          rooms={rooms}
          selectedRoomId={selectedRoomId}
          timeline={timeline}
          onComposerChange={setComposerText}
          onRoomSelect={setSelectedRoomId}
          onSend={() => void sendMessage()}
        />
      ) : chatReady ? (
        <div className="messaging-empty-state">
          <strong>Konverzace jsou připravené.</strong>
          <p>Otevřete chat a pokračujte ve skupinách navázaných na sdílení v mapě.</p>
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
          memberSubjectId={groupMemberSubjectId}
          newGroupName={newGroupName}
          newGroupVisibility={newGroupVisibility}
          selectedGroup={selectedGroup}
          onAddMember={() => void addMember()}
          onApproveMember={(subjectId, displayName) => void approveMember(subjectId, displayName)}
          onCreateGroup={() => void createGroup()}
          onMemberSubjectIdChange={setGroupMemberSubjectId}
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
  memberSubjectId,
  newGroupName,
  newGroupVisibility,
  selectedGroup,
  onAddMember,
  onApproveMember,
  onCreateGroup,
  onMemberSubjectIdChange,
  onNewGroupNameChange,
  onNewGroupVisibilityChange,
  onSelectGroup
}: {
  actionError: string | null;
  actionLoading: boolean;
  groups: MessagingPanelProps["communityGroups"];
  memberSubjectId: string;
  newGroupName: string;
  newGroupVisibility: "private" | "public";
  selectedGroup: MessagingPanelProps["communityGroups"][number] | null;
  onAddMember: () => void;
  onApproveMember: (subjectId: string, displayName?: string) => void;
  onCreateGroup: () => void;
  onMemberSubjectIdChange: (value: string) => void;
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
        <select
          value={newGroupVisibility}
          onChange={(event) => onNewGroupVisibilityChange(event.target.value as "private" | "public")}
        >
          <option value="private">S povolením</option>
          <option value="public">Veřejná</option>
        </select>
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
              placeholder="subjectId uživatele"
              value={memberSubjectId}
              onChange={(event) => onMemberSubjectIdChange(event.target.value)}
            />
            <button className="mini-button" disabled={actionLoading || !memberSubjectId.trim()} onClick={onAddMember} type="button">
              Přidat
            </button>
          </div>
        </div>
      ) : null}
      {actionError ? <div className="error-banner">{actionError}</div> : null}
    </div>
  );
}

function MatrixChatShell({
  composerText,
  rooms,
  selectedRoomId,
  timeline,
  onComposerChange,
  onRoomSelect,
  onSend
}: {
  composerText: string;
  rooms: MatrixRoomSummary[];
  selectedRoomId: string | null;
  timeline: MatrixTimelineMessage[];
  onComposerChange: (value: string) => void;
  onRoomSelect: (roomId: string) => void;
  onSend: () => void;
}) {
  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) ?? null;
  return (
    <div className="matrix-chat-shell">
      <div className="matrix-room-list" aria-label="Konverzace">
        {rooms.length === 0 ? <div className="empty-mini">Matrix zatím nevrátil žádné konverzace.</div> : null}
        {rooms.map((room) => (
          <button
            aria-pressed={room.roomId === selectedRoomId}
            className={room.roomId === selectedRoomId ? "active" : ""}
            key={room.roomId}
            onClick={() => onRoomSelect(room.roomId)}
            type="button"
          >
            <strong>{room.name}</strong>
            <small>{room.encrypted ? "E2EE" : "bez E2EE"} · {room.unreadCount} nové</small>
          </button>
        ))}
      </div>
      <div className="matrix-room-view">
        <div className="matrix-room-header">
          <strong>{selectedRoom?.name ?? "Vyberte konverzaci"}</strong>
          <small>{selectedRoom?.encrypted ? "E2EE aktivní" : "E2EE stav neznámý"}</small>
        </div>
        <div className="matrix-timeline" aria-live="polite">
          {timeline.length === 0 ? <div className="empty-mini">Žádné zprávy v lokálně načtené timeline.</div> : null}
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
            disabled={!selectedRoomId}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="Napsat zprávu..."
            value={composerText}
          />
          <button className="mini-button" disabled={!selectedRoomId || !composerText.trim()} onClick={onSend} type="button">
            <Send size={14} />
            Odeslat
          </button>
        </div>
      </div>
    </div>
  );
}

function getOrCreateMatrixDeviceId(): string {
  if (typeof window === "undefined") {
    fallbackMatrixDeviceId ??= createMatrixDeviceId();
    return fallbackMatrixDeviceId;
  }

  try {
    const stored = window.localStorage.getItem(matrixDeviceIdStorageKey);
    if (isValidMatrixDeviceId(stored)) {
      return stored;
    }

    const next = createMatrixDeviceId();
    window.localStorage.setItem(matrixDeviceIdStorageKey, next);
    return next;
  } catch {
    fallbackMatrixDeviceId ??= createMatrixDeviceId();
    return fallbackMatrixDeviceId;
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

function isValidMatrixDeviceId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9._=-]{1,64}$/u.test(value));
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

function operatorDisplayName(session: MessagingPanelProps["session"], authConfig: MessagingPanelProps["authConfig"]): string {
  if (session.status === "authenticated") {
    return session.profile?.name ?? session.profile?.username ?? "přihlášen";
  }
  if (session.status === "authenticating") {
    return "ověřuji";
  }
  return authConfig.mode === "lab" ? "Lab operator" : "nepřihlášen";
}
