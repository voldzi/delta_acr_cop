import * as React from "react";
import clsx from "clsx";
import { ArrowLeft, Check, Copy, KeyRound, Loader2, RefreshCcw } from "lucide-react";
import type { MatrixEncryptionRecoveryStatus } from "@cop/messaging/types";
import { useModalFocus } from "../hooks/useModalFocus";

export interface EncryptionRecoveryDialogProps {
  generatedRecoveryKey: string | null;
  manualRestore: boolean;
  recoveryKeyInput: string;
  saving: boolean;
  status: MatrixEncryptionRecoveryStatus | null;
  onClose: () => void;
  onCreate: () => void;
  onManualRestore: () => void;
  onPrepareMobile: () => void;
  onRepairDevice?: () => void;
  onRecoveryKeyInputChange: (value: string) => void;
  onReset: () => void;
  onRestore: () => void;
}

export default function EncryptionRecoveryDialog({
  generatedRecoveryKey,
  manualRestore,
  recoveryKeyInput,
  saving,
  status,
  onClose,
  onCreate,
  onManualRestore,
  onPrepareMobile,
  onRepairDevice,
  onRecoveryKeyInputChange,
  onReset,
  onRestore
}: EncryptionRecoveryDialogProps) {
  const hasBackup = status?.keyBackupExists === true;
  const webReady = status?.ready === true;
  const mobileReady = status?.matrixRustCompatible === true;
  const needsMobilePreparation = webReady && !mobileReady;
  const subtitle = mobileReady
    ? "Připraveno pro web i iPhone/iPad"
    : needsMobilePreparation
      ? "Web je obnovený, iOS metadata nejsou kompletní"
      : hasBackup
        ? "Obnovte toto zařízení"
        : "Nastavte více zařízení";
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
            <small>{subtitle}</small>
          </span>
        </header>
        <div className="recovery-illustration" aria-hidden="true">
          <KeyRound size={54} />
        </div>

        {onRepairDevice && !generatedRecoveryKey ? (
          <aside className="recovery-device-repair" aria-label="Oprava tohoto webového zařízení">
            <p>
              Pokud je šifrování poškozené jen v tomto prohlížeči, vytvoří se nová Matrix šifrovací identita pouze pro
              toto webové zařízení. Účet, ostatní zařízení ani E2EE záloha se tím neresetují.
            </p>
            <button disabled={saving} className="secondary-dialog-action" onClick={onRepairDevice} type="button">
              <RefreshCcw size={18} />
              Opravit pouze toto webové zařízení
            </button>
          </aside>
        ) : null}

        {generatedRecoveryKey ? (
          <>
            <p>
              Uložte tento obnovovací klíč do správce hesel nebo na bezpečné místo. Tento klíč použijte pro web i
              iPhone/iPad. Starší klíč považujte za neplatný, zejména pokud se objevil ve screenshotu.
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
              <button className="primary-dialog-action" onClick={onClose} type="button">
                Mám uloženo
              </button>
            </footer>
          </>
        ) : manualRestore && hasBackup ? (
          <>
            <p>
              Zadejte obnovovací klíč znovu. Použije se k opětovnému odemčení E2EE zálohy v tomto prohlížeči a může
              doplnit klíče pro starší zprávy, které se zatím zobrazují jako nečitelné.
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
              <button
                disabled={saving || !recoveryKeyInput.trim()}
                className="primary-dialog-action"
                onClick={onRestore}
                type="button"
              >
                {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                Obnovit klíče
              </button>
              <button disabled={saving} className="secondary-dialog-action" onClick={onClose} type="button">
                Zavřít
              </button>
              {status?.canPrepareForMobile ? (
                <button disabled={saving} className="secondary-dialog-action" onClick={onPrepareMobile} type="button">
                  {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                  Vygenerovat nový klíč pro iPhone/iPad
                </button>
              ) : null}
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Nouzově začít znovu bez staré historie
              </button>
            </footer>
          </>
        ) : mobileReady ? (
          <>
            <p>
              E2EE obnova je kompletní: key backup, secret storage i cross-signing jsou připravené pro web i nativní
              iPhone/iPad aplikaci. Pokud starší zprávy stále nejdou přečíst, zadejte uložený obnovovací klíč znovu.
            </p>
            <footer>
              <button className="primary-dialog-action" onClick={onClose} type="button">
                Hotovo
              </button>
              <button disabled={saving} className="secondary-dialog-action" onClick={onManualRestore} type="button">
                Zadat klíč znovu
              </button>
              <button disabled={saving} className="secondary-dialog-action" onClick={onPrepareMobile} type="button">
                Vygenerovat nový klíč pro iPhone/iPad
              </button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Nouzově začít znovu
              </button>
            </footer>
          </>
        ) : needsMobilePreparation ? (
          <>
            <div className="recovery-status-panel positive" role="status">
              <Check size={18} />
              <span>Web má aktivní E2EE key backup a může šifrované zprávy používat.</span>
            </div>
            <p>
              Účet ale nemá kompletní cross-signing/secret-storage metadata, která vyžaduje nativní iPhone/iPad
              aplikace. Pokud jste recovery reset provedli v iOS, web už nemusí vytvářet nový klíč. Webový reset
              používejte jen jako pokročilou opravu. Požadované Matrix ověření dokončí CSM Messaging bez zpřístupnění
              hesla nebo soukromých šifrovacích klíčů prohlížeči.
            </p>
            <footer>
              <button className="primary-dialog-action" onClick={onClose} type="button">
                Hotovo
              </button>
              <button disabled={saving} className="secondary-dialog-action" onClick={onManualRestore} type="button">
                Zadat klíč znovu
              </button>
              <button disabled={saving} className="secondary-dialog-action" onClick={onPrepareMobile} type="button">
                {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                Pokusit se vytvořit nový klíč pro iOS
              </button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Nouzově začít znovu bez staré historie
              </button>
            </footer>
          </>
        ) : hasBackup ? (
          <>
            <p>
              Zadejte obnovovací klíč uložený při prvním nastavení. Klíč zůstane pouze v tomto prohlížeči a použije se k
              odemčení šifrované zálohy.
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
              <button
                disabled={saving || !recoveryKeyInput.trim()}
                className="primary-dialog-action"
                onClick={onRestore}
                type="button"
              >
                {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                Obnovit zařízení
              </button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Nouzově začít znovu bez staré historie
              </button>
            </footer>
          </>
        ) : (
          <>
            <p>
              Vytvořte obnovovací klíč před psaním zpráv. COP ani Matrix server tento klíč neznají; bez uloženého klíče
              ztratíte možnost obnovit historii na novém zařízení.
            </p>
            <footer>
              <button disabled={saving} className="primary-dialog-action" onClick={onCreate} type="button">
                {saving ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                Vytvořit klíč pro web+iOS
              </button>
              <button disabled={saving} className="secondary-danger-action" onClick={onReset} type="button">
                Nouzově resetovat staré nastavení
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
