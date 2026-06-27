import { useModalFocus } from "../hooks/useModalFocus";

export default function DeleteChatDialog({
  title,
  onClose,
  onConfirm
}: {
  title: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="mute-dialog delete-chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Smazat ${title}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <h2>Smazat chat ze seznamu?</h2>
        <p>Chat {title} se skryje z tohoto seznamu. Historie zpráv na serveru zůstane zachovaná a nová zpráva chat znovu zobrazí.</p>
        <button className="danger" onClick={onConfirm} type="button">Smazat ze seznamu</button>
        <button onClick={onClose} type="button">Zrušit</button>
      </section>
    </div>
  );
}
