import { useModalFocus } from "../hooks/useModalFocus";

export type MuteChoice = "8h" | "1w" | "forever";

export default function MuteDialog({
  title,
  onClose,
  onMute
}: {
  title: string;
  onClose: () => void;
  onMute: (choice: MuteChoice) => void;
}) {
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="mute-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Ztlumit ${title}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <h2>Ztlumit upozornění</h2>
        <p>Ostatní členové neuvidí, že jste chat ztlumil/a. Upozornění stále dostanete, pokud vás někdo zmíní.</p>
        <button onClick={() => onMute("8h")} type="button">
          8 hodin
        </button>
        <button onClick={() => onMute("1w")} type="button">
          1 týden
        </button>
        <button onClick={() => onMute("forever")} type="button">
          Vždy
        </button>
        <button onClick={onClose} type="button">
          Zrušit
        </button>
      </section>
    </div>
  );
}
