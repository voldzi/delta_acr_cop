import React from "react";
import { Lock, LogIn, MessageCircle, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { fetchMessagingBootstrap } from "../cop-data";
import { createMatrixMessagingSession } from "./matrixClient";
import type { MatrixMessagingSession, MatrixRoomSummary, MatrixTimelineMessage, MessagingPanelProps } from "./types";

type Tone = "ok" | "warn" | "neutral";

export function MessagingPanel({
  apiBase,
  authenticated,
  authConfig,
  authToken,
  error,
  loading,
  session,
  status,
  onClose,
  onLogin,
  onRefresh
}: MessagingPanelProps) {
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = React.useState(false);
  const [matrixSession, setMatrixSession] = React.useState<MatrixMessagingSession | null>(null);
  const [rooms, setRooms] = React.useState<MatrixRoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);
  const [timeline, setTimeline] = React.useState<MatrixTimelineMessage[]>([]);
  const [composerText, setComposerText] = React.useState("");
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
      const bootstrap = await fetchMessagingBootstrap(apiBase, authToken);
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
    <section className="messaging-panel" aria-label="Zprávy">
      <div className="messaging-panel-header">
        <div className="panel-title">
          <MessageCircle size={17} />
          <strong>Zprávy</strong>
        </div>
        <button aria-label="Zavřít zprávy" className="icon-button compact" onClick={onClose} title="Zavřít" type="button">
          <X size={16} />
        </button>
      </div>

      <div className="messaging-status-grid">
        <ReadinessRow label="Provider" value={status?.serviceName ?? "CSM Messaging"} tone={messagingStatusTone(providerStatus)} />
        <ReadinessRow label="Stav" value={messagingStatusLabel(providerStatus, loading)} tone={messagingStatusTone(providerStatus)} />
        <ReadinessRow label="Přihlášení" value={authenticated ? operatorDisplayName(session, authConfig) : "vyžaduje účet"} tone={authenticated ? "ok" : "neutral"} />
        <ReadinessRow label="E2EE" value={e2eeRequired ? "vyžadováno" : "čeká na kontrakt"} tone={e2eeRequired ? "ok" : "neutral"} />
        <ReadinessRow label="Bootstrap" value={matrixBootstrapReady ? "Matrix token" : "disabled"} tone={matrixBootstrapReady ? "ok" : "neutral"} />
        <ReadinessRow label="Sync" value={matrixSession ? syncState : "neaktivní"} tone={matrixSession ? "ok" : "neutral"} />
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
          <strong>Matrix/E2EE bootstrap je připraven.</strong>
          <p>Po otevření konverzací bude web klient komunikovat přímo přes Matrix client-server API.</p>
          <div className="messaging-security-note">
            <ShieldCheck size={15} />
            COP zůstává pouze policy/bootstrap vrstva. Zprávy nejdou přes COP API.
          </div>
        </div>
      ) : (
        <div className="messaging-empty-state">
          <strong>Chat zatím běží v integračním režimu.</strong>
          <p>COP čte pouze server-side capability/health metadata. Obsah zpráv se přes COP ani Phoenix API neposílá jako plaintext.</p>
        </div>
      )}

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
          {bootstrapLoading ? "Spouštím Matrix" : matrixSession ? "Konverzace otevřeny" : "Otevřít konverzace"}
        </button>
      </div>
    </section>
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

function ReadinessRow({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className={`readiness-row ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
