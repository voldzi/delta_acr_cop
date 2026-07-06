import {
  BellOff,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  Forward,
  Info,
  KeyRound,
  Pin,
  PinOff,
  Search,
  Share2,
  Sparkles,
  Trash2,
  UserPlus
} from "lucide-react";

export interface ChatActionMenuChat {
  pinned: boolean;
  type: "direct" | "group" | "room";
}

export function ChatActionMenu({
  activeChat,
  aiAgentAvailable = false,
  aiAgentChatActive = false,
  aiAgentEnabled = false,
  canAddMember = false,
  canToggleAiAgent = false,
  muted,
  onAddMember,
  onAskAiAgent,
  onInfo,
  onManage,
  onMute,
  onRecovery,
  onSearch,
  onSelect,
  onSituationSummary,
  onStartAiAgentChat,
  onToggleAiAgent,
  onToggleMute,
  onTogglePinned
}: {
  activeChat: ChatActionMenuChat;
  aiAgentAvailable?: boolean;
  aiAgentChatActive?: boolean;
  aiAgentEnabled?: boolean;
  canAddMember?: boolean;
  canToggleAiAgent?: boolean;
  muted: boolean;
  onAddMember?: () => void;
  onAskAiAgent?: () => void;
  onInfo: () => void;
  onManage: () => void;
  onMute: () => void;
  onRecovery: () => void;
  onSearch: () => void;
  onSelect: () => void;
  onSituationSummary: () => void;
  onStartAiAgentChat?: () => void;
  onToggleAiAgent?: () => void;
  onToggleMute: () => void;
  onTogglePinned: () => void;
}) {
  const infoLabel = activeChat.type === "direct" ? "O kontaktu" : "O skupině";
  const manageLabel = activeChat.type === "direct" ? "Smazat ze seznamu" : "Opustit / smazat skupinu";
  return (
    <div className="chat-action-menu" role="menu" aria-label="Akce chatu">
      <button onClick={onInfo} role="menuitem" type="button">
        <Info size={17} />
        {infoLabel}
      </button>
      {activeChat.type !== "direct" && canAddMember && onAddMember ? (
        <button onClick={onAddMember} role="menuitem" type="button">
          <UserPlus size={17} />
          Přidat člena
        </button>
      ) : null}
      {activeChat.type !== "direct" && canToggleAiAgent && onToggleAiAgent ? (
        <button onClick={onToggleAiAgent} role="menuitem" type="button">
          <Sparkles size={17} />
          {aiAgentEnabled ? "Vypnout AI agenta" : "Zapnout AI agenta"}
        </button>
      ) : null}
      {activeChat.type === "direct" && !aiAgentChatActive && onStartAiAgentChat ? (
        <button onClick={onStartAiAgentChat} role="menuitem" type="button">
          <Sparkles size={17} />
          Chat s AI agentem
        </button>
      ) : null}
      <button onClick={onSituationSummary} role="menuitem" type="button">
        <Sparkles size={17} />
        AI situační souhrn
      </button>
      {aiAgentAvailable && onAskAiAgent ? (
        <button onClick={() => onAskAiAgent()} role="menuitem" type="button">
          <Sparkles size={17} />
          Zeptat se AI agenta
        </button>
      ) : null}
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
      <button onClick={onManage} role="menuitem" type="button">
        <Trash2 size={17} />
        {manageLabel}
      </button>
    </div>
  );
}

export function MessageSearchBar({
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
      <input
        autoFocus
        aria-label="Hledat ve zprávách"
        placeholder="Hledat ve zprávách"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <span>{query.trim() ? `${matchCount ? activeIndex + 1 : 0}/${matchCount}` : ""}</span>
      <button
        className="round-icon small"
        disabled={matchCount === 0}
        onClick={() => onMove(-1)}
        type="button"
        aria-label="Předchozí výsledek"
      >
        <ChevronUp size={18} />
      </button>
      <button
        className="round-icon small"
        disabled={matchCount === 0}
        onClick={() => onMove(1)}
        type="button"
        aria-label="Další výsledek"
      >
        <ChevronDown size={18} />
      </button>
      <button className="search-done" onClick={onClose} type="button">
        Hotovo
      </button>
    </div>
  );
}

export function SelectionToolbar({
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
      <button className="selection-cancel" onClick={onCancel} type="button">
        Zrušit
      </button>
    </div>
  );
}
