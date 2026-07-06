import { UserMinus } from "lucide-react";

import { useModalFocus } from "../hooks/useModalFocus";

export default function RemoveMemberDialog({
  groupName,
  memberName,
  working = false,
  onClose,
  onRemove
}: {
  groupName: string;
  memberName: string;
  working?: boolean;
  onClose: () => void;
  onRemove: () => void;
}) {
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="mute-dialog delete-chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Odebrat člena ${memberName}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <h2>Odebrat člena?</h2>
        <p>
          Člen {memberName} bude odebrán ze skupiny {groupName}. Přestane být aktivním členem COP skupiny a změna se
          promítne do CSM Messaging.
        </p>
        <div className="delete-chat-dialog__actions">
          <button className="danger" disabled={working} onClick={onRemove} type="button">
            <UserMinus size={17} />
            {working ? "Odebírám..." : "Odebrat člena"}
          </button>
          <button disabled={working} onClick={onClose} type="button">
            Zrušit
          </button>
        </div>
      </section>
    </div>
  );
}
