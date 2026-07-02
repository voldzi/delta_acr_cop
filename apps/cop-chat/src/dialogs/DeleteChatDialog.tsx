import { useModalFocus } from "../hooks/useModalFocus";

export default function DeleteChatDialog({
  canDeleteGroup,
  canLeaveGroup,
  chatKind,
  working = false,
  title,
  onClose,
  onDeleteGroup,
  onHide,
  onLeaveGroup
}: {
  canDeleteGroup: boolean;
  canLeaveGroup: boolean;
  chatKind: "direct" | "group";
  working?: boolean;
  title: string;
  onClose: () => void;
  onDeleteGroup: () => void;
  onHide: () => void;
  onLeaveGroup: () => void;
}) {
  const modal = useModalFocus<HTMLElement>(onClose);
  const isDirect = chatKind === "direct";
  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="mute-dialog delete-chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Správa chatu ${title}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <h2>{isDirect ? "Skrýt chat?" : "Správa skupiny"}</h2>
        <p>
          {isDirect
            ? `Chat ${title} se odstraní ze seznamu v tomto zařízení. Historie na serveru zůstane zachovaná a nová zpráva chat znovu zobrazí.`
            : `Skupinu ${title} můžete skrýt jen v tomto zařízení, opustit, nebo ji smazat v COP.`}
        </p>
        <div className="delete-chat-dialog__actions">
          <button disabled={working} onClick={onHide} type="button">
            {isDirect ? "Skrýt chat" : "Skrýt ze seznamu"}
          </button>
          {!isDirect ? (
            <button className="danger" disabled={!canLeaveGroup || working} onClick={onLeaveGroup} type="button">
              {working ? "Opouštím..." : "Opustit skupinu"}
            </button>
          ) : null}
          {!isDirect ? (
            <button className="danger" disabled={!canDeleteGroup || working} onClick={onDeleteGroup} type="button">
              {working ? "Mažu..." : "Smazat skupinu"}
            </button>
          ) : null}
          <button disabled={working} onClick={onClose} type="button">Zrušit</button>
        </div>
        {!isDirect && !canLeaveGroup && !canDeleteGroup ? (
          <p className="delete-chat-dialog__note">Tato položka zatím nemá aktivní Matrix místnost ani COP skupinu, proto ji lze pouze skrýt.</p>
        ) : null}
      </section>
    </div>
  );
}
