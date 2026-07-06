import { Check, Loader2, Search, Send, X } from "lucide-react";
import type { UserDirectoryEntry } from "@cop/core/cop-data";
import type { ChatListItem } from "../ChatApp";
import { Avatar } from "../components/Avatar";
import { useModalFocus } from "../hooks/useModalFocus";

export interface ForwardTarget {
  avatarVariant?: "ai";
  avatarUrl?: string;
  chat?: ChatListItem;
  key: string;
  subtitle: string;
  title: string;
  type: "chat" | "user";
  user?: UserDirectoryEntry;
}

export default function ForwardDialog({
  draftCount,
  query,
  searchLoading,
  selectedCount,
  selectedKeys,
  targets,
  workingId,
  onClose,
  onSend,
  onToggleTarget,
  onQueryChange
}: {
  draftCount: number;
  query: string;
  searchLoading: boolean;
  selectedCount: number;
  selectedKeys: Set<string>;
  targets: ForwardTarget[];
  workingId: string | null;
  onClose: () => void;
  onSend: () => void;
  onToggleTarget: (target: ForwardTarget) => void;
  onQueryChange: (query: string) => void;
}) {
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="forward-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Přeposlat zprávu"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <header>
          <button className="round-icon" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={19} />
          </button>
          <strong>Přeposlat</strong>
          <button
            className="forward-send"
            disabled={selectedCount === 0 || Boolean(workingId)}
            onClick={onSend}
            type="button"
          >
            {workingId ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
            Odeslat
          </button>
        </header>
        <label className="forward-search">
          <Search size={18} />
          <input
            autoFocus
            data-modal-autofocus="true"
            placeholder="Hledat chat nebo osobu"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <div className="forward-summary">
          <span>{draftCount === 1 ? "1 zpráva" : `${draftCount} zpráv`}</span>
          <strong>{selectedCount === 0 ? "Vyberte příjemce" : `Vybráno ${selectedCount}`}</strong>
        </div>
        <div className="forward-list" role="list">
          {targets.length === 0 ? (
            <p>{searchLoading ? "Vyhledávám příjemce..." : "Žádný chat ani osoba neodpovídá hledání."}</p>
          ) : (
            targets.map((target) => (
              <button
                className={selectedKeys.has(target.key) ? "selected" : ""}
                disabled={Boolean(workingId)}
                key={target.key}
                onClick={() => onToggleTarget(target)}
                role="listitem"
                type="button"
              >
                <Avatar label={target.title} src={target.avatarUrl} variant={target.avatarVariant} />
                <span>
                  <strong>{target.title}</strong>
                  <small>{target.subtitle}</small>
                </span>
                {workingId === target.key ? (
                  <Loader2 className="spin" size={18} />
                ) : (
                  <span className="forward-check" aria-hidden="true">
                    {selectedKeys.has(target.key) ? <Check size={17} /> : null}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
