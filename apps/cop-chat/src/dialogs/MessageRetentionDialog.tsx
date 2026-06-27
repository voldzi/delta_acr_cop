import { ArrowLeft, Check, Clock3 } from "lucide-react";

import { useModalFocus } from "../hooks/useModalFocus";
import {
  messageRetentionOptions,
  normalizeMessageRetentionSeconds,
  type MessageRetentionSeconds
} from "./messageRetention";

export default function MessageRetentionDialog({
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
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="retention-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Automatické odstraňování zpráv ${title}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
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
