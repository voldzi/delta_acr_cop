import type React from "react";
import { ArrowLeft, Loader2, MessageCircle, Search, Sparkles, UserPlus, Users, X } from "lucide-react";
import type { UserDirectoryEntry } from "@cop/core/cop-data";
import { Avatar } from "../components/Avatar";
import { useModalFocus } from "../hooks/useModalFocus";

export type NewChatMode = "direct" | "group" | "member" | null;

export default function NewChatDialog({
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
  onCreateAiAgentChat,
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
  mode: NewChatMode;
  newGroupName: string;
  searchLoading: boolean;
  onAddMember: (user: UserDirectoryEntry) => void;
  onClose: () => void;
  onCreateAiAgentChat: () => void;
  onCreateDirect: (user: UserDirectoryEntry) => void;
  onCreateGroup: () => void;
  onDirectQueryChange: (value: string) => void;
  onGroupNameChange: (value: string) => void;
  onMemberQueryChange: (value: string) => void;
  onModeChange: (value: NewChatMode) => void;
}) {
  const directActive = mode === "direct";
  const memberActive = mode === "member";
  const title = directActive ? "Nový chat" : memberActive ? "Přidat člena" : "Nová skupina";
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="new-chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <header>
          <button className="round-icon mobile-only" onClick={onClose} type="button" aria-label="Zavřít">
            <ArrowLeft size={20} />
          </button>
          <strong>{title}</strong>
          <button className="round-icon" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={20} />
          </button>
        </header>
        {!memberActive ? <div className="dialog-tabs">
          <button className={directActive ? "active" : ""} onClick={() => onModeChange("direct")} type="button">
            <MessageCircle size={17} />
            Chat
          </button>
          <button className={!directActive ? "active" : ""} onClick={() => onModeChange("group")} type="button">
            <Users size={17} />
            Skupina
          </button>
        </div> : null}

        {directActive ? (
          <>
            <label className="dialog-search">
              <Search size={18} />
              <input
                autoFocus
                data-modal-autofocus="true"
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
            <button className="dialog-action-row" onClick={onCreateAiAgentChat} type="button">
              <span><Sparkles size={20} /></span>
              <strong>Chat s AI agentem</strong>
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
        ) : memberActive ? (
          <>
            <label className="dialog-search">
              <Search size={18} />
              <input
                autoFocus
                data-modal-autofocus="true"
                disabled={!canChat}
                placeholder="Jméno, e-mail nebo login člena"
                value={memberQuery}
                onChange={(event) => onMemberQueryChange(event.target.value)}
              />
            </label>
            <div className="dialog-list">
              {memberQuery.trim().length < 2 ? <DialogHint icon={<Search size={18} />} text="Zadejte alespoň dvě písmena" /> : null}
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
        ) : (
          <>
            <label className="dialog-search">
              <Users size={18} />
              <input
                autoFocus
                data-modal-autofocus="true"
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

function DialogHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="dialog-hint">
      {icon}
      <span>{text}</span>
    </div>
  );
}
