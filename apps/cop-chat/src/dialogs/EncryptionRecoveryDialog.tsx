import * as React from "react";
import clsx from "clsx";
import { ArrowLeft, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import type { MatrixEncryptionRecoveryStatus } from "@cop/messaging/types";
import { useModalFocus } from "../hooks/useModalFocus";

export interface EncryptionRecoveryDialogProps {
  generatedRecoveryKey: string | null;
  recoveryKeyInput: string;
  saving: boolean;
  status: MatrixEncryptionRecoveryStatus | null;
  onClose: () => void;
  onCreate: () => void;
  onRecoveryKeyInputChange: (value: string) => void;
  onReset: () => void;
  onRestore: () => void;
}

export default function EncryptionRecoveryDialog({
  generatedRecoveryKey,
  recoveryKeyInput,
  saving,
  status,
  onClose,
  onCreate,
  onRecoveryKeyInputChange,
  onReset,
  onRestore
}: EncryptionRecoveryDialogProps) {
  const hasBackup = status?.keyBackupExists === true;
  const ready = status?.ready === true;
  const [copyState, setCopyState] = React.useState<"copied" | "error" | "idle">("idle");

  React.useEffect(() => {
    if (copyState === "idle") {
      return undefined;
    }
    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);
  const modal = useModalFocus<HTMLElement>(onClose);

  async function copyRecoveryKey() {
    if (!generatedRecoveryKey) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(generatedRecoveryKey);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="mute-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Obnova E2EE"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <header>
          <button className="round-icon small" onClick={onClose} type="button" aria-label="Zavřít">
            <ArrowLeft size={20} />
          </button>
          <span>
            <h2>Obnova E2EE</h2>
            <small>{ready ? "Key backup je aktivní" : hasBackup ? "Obnovte toto zařízení" : "Nastavte více zařízení"}</small>
          </span>
        </header>
        <div className="recovery-illustration" aria-hidden="true">
          <KeyRound size={54} />
        </div>

        {generatedRecoveryKey ? (
          <>
            <p>
              Uložte tento obnovovací klíč do správce hesel nebo na bezpečné místo.
              Bez něj nepůjde obnovit E2EE na novém zařízení, pokud nebude dostupné jiné ověřené zařízení.
            </p>
            <div className="recovery-key-box">
              <code>{generatedRecoveryKey}</code>
              <button
                className={clsx("recovery-copy-button", copyState !== "idle" && copyState)}
                onClick={() => void copyRecoveryKey()}
                type="button"
                aria-label="Zkopírovat obnovovací klíč"
              >
                {copyState === "copied" ? <Check size={18} /> : <Copy size={18} />}
                {copyState === "copied" ? "Zkopírováno" : "Zkopírovat"}
              </button>
              <span className={clsx("recovery-copy-feedback", copyState)} role="status" aria-live="polite">
                {copyState === "copied"
                  ? "Klíč je zkopírovaný do schránky."
                  : copyState === "error"
                    ? "Kopírování se nepodařilo. Označte klíč ručně."
                    : ""}
              </span>
            </div>
            <footer>
              <button className="primary-dialog-action" onClick={onClose} type="button">Mám uloženo</button>
            </footer>
          </>
        ) : ready ? (
          <>
            <p>
              Toto zařízení má přístup k E2EE key backupu. Pokud obnovovací klíč unikl nebo iOS hlásí
              nekompatibilní E2EE metadata, resetujte obnovu a použijte nově vygenerovaný klíč.
            </p>
            <footer>
              <button className="primary-dialog-action" onClick={onClose} type="button">Hotovo</button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Resetovat E2EE obnovu
              </button>
            </footer>
          </>
        ) : hasBackup ? (
          <>
            <p>
              Zadejte obnovovací klíč uložený při prvním nastavení. Klíč zůstane pouze v tomto prohlížeči
              a použije se k odemčení šifrované zálohy.
            </p>
            <label className="recovery-input">
              <span>Obnovovací klíč</span>
              <textarea
                autoFocus
                data-modal-autofocus="true"
                spellCheck={false}
                value={recoveryKeyInput}
                onChange={(event) => onRecoveryKeyInputChange(event.target.value)}
              />
            </label>
            <footer>
              <button disabled={saving || !recoveryKeyInput.trim()} className="primary-dialog-action" onClick={onRestore} type="button">
                {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                Obnovit zařízení
              </button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Začít znovu bez staré historie
              </button>
            </footer>
          </>
        ) : (
          <>
            <p>
              Vytvořte obnovovací klíč před psaním zpráv. COP ani Matrix server tento klíč neznají;
              bez uloženého klíče ztratíte možnost obnovit historii na novém zařízení.
            </p>
            <footer>
              <button disabled={saving} className="primary-dialog-action" onClick={onCreate} type="button">
                {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                Vytvořit obnovovací klíč
              </button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Resetovat staré nastavení
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
