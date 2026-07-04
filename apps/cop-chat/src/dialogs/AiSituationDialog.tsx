import React from "react";
import { Check, Copy, Loader2, RefreshCcw, Send, Sparkles, X } from "lucide-react";
import type { AiCopResponse } from "@cop/core/cop-data";
import { useModalFocus } from "../hooks/useModalFocus";

export default function AiSituationDialog({
  response,
  sending,
  working,
  onClose,
  onRefresh,
  onSendToChat
}: {
  response: AiCopResponse | null;
  sending: boolean;
  working: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSendToChat: (text: string) => void;
}) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const modal = useModalFocus<HTMLElement>(onClose);
  const summary = response ? aiResponseSummary(response) : "";
  const canUseSummary = summary.trim().length > 0 && !working;

  async function copySummary() {
    if (!canUseSummary) {
      return;
    }
    try {
      await navigator.clipboard.writeText(summary);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="ai-situation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="AI situační souhrn"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <header>
          <span>
            <Sparkles size={19} />
            <strong>AI situační souhrn</strong>
          </span>
          <button className="round-icon small" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={18} />
          </button>
        </header>

        {working ? (
          <div className="ai-situation-status">
            <Loader2 className="spin" size={22} />
            <strong>Připravuji souhrn</strong>
          </div>
        ) : response ? (
          <>
            <div className="ai-situation-output">{summary}</div>
            <dl className="ai-situation-meta">
              <div>
                <dt>Stav</dt>
                <dd>{aiStatusLabel(response.status)}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{response.provider ?? "auto"}{response.model ? ` / ${response.model}` : ""}</dd>
              </div>
              <div>
                <dt>Audit</dt>
                <dd>{response.auditId}</dd>
              </div>
              <div>
                <dt>Policy</dt>
                <dd>{response.policy.reason}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="ai-situation-empty">
            <Sparkles size={24} />
            <strong>Souhrn zatím není vytvořený.</strong>
          </div>
        )}

        <footer>
          <button className="secondary-dialog-action" disabled={working} onClick={onRefresh} type="button">
            <RefreshCcw size={17} />
            {response ? "Obnovit" : "Vygenerovat"}
          </button>
          <button className="secondary-dialog-action" disabled={!canUseSummary} onClick={() => void copySummary()} type="button">
            {copyState === "copied" ? <Check size={17} /> : <Copy size={17} />}
            {copyState === "copied" ? "Zkopírováno" : copyState === "failed" ? "Kopírování selhalo" : "Zkopírovat"}
          </button>
          <button className="primary-dialog-action" disabled={!canUseSummary || sending} onClick={() => onSendToChat(summary)} type="button">
            {sending ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
            Odeslat do chatu
          </button>
        </footer>
      </section>
    </div>
  );
}

export function aiResponseSummary(response: AiCopResponse): string {
  const summary = response.result.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  const content = response.result.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  const text = response.result.text;
  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }
  return JSON.stringify(response.result, null, 2);
}

function aiStatusLabel(status: AiCopResponse["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "dokončeno";
    case "NEEDS_HUMAN_REVIEW":
      return "vyžaduje kontrolu";
    case "REJECTED":
      return "zamítnuto";
  }
}
