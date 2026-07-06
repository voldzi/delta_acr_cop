import React from "react";
import { Check, Copy, Loader2, Send, Sparkles, X } from "lucide-react";
import type { AiCopResponse, AiModelPreference } from "@cop/core/cop-data";
import { AiEvidencePanel } from "../components/AiEvidencePanel";
import { AiMarkdownOutput } from "../components/AiMarkdownOutput";
import { useModalFocus } from "../hooks/useModalFocus";
import { aiResponseSummary, aiStatusLabel } from "./aiResponse";

export default function AiAgentDialog({
  error,
  jobStatus,
  modelPreference,
  question,
  response,
  sending,
  working,
  onAsk,
  onClose,
  onModelPreferenceChange,
  onQuestionChange,
  onSendToChat
}: {
  error?: string | null;
  jobStatus?: string | null;
  modelPreference: AiModelPreference;
  question: string;
  response: AiCopResponse | null;
  sending: boolean;
  working: boolean;
  onAsk: () => void;
  onClose: () => void;
  onModelPreferenceChange: (value: AiModelPreference) => void;
  onQuestionChange: (value: string) => void;
  onSendToChat: (text: string) => void;
}) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const modal = useModalFocus<HTMLElement>(onClose);
  const answer = response ? aiResponseSummary(response) : "";
  const canAsk = question.trim().length > 0 && !working;
  const canUseAnswer = answer.trim().length > 0 && !working;

  async function copyAnswer() {
    if (!canUseAnswer) {
      return;
    }
    try {
      await navigator.clipboard.writeText(answer);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modal.dialogRef}
        className="ai-agent-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="AI agent"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <header>
          <span>
            <Sparkles size={19} />
            <strong>AI agent</strong>
          </span>
          <button className="round-icon small" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={18} />
          </button>
        </header>

        <label className="ai-agent-question">
          <span>Dotaz pro COP AI agenta</span>
          <textarea
            autoFocus
            data-modal-autofocus="true"
            disabled={working}
            maxLength={2000}
            placeholder="Např. Co je teď v okolí nejisté a které zdroje jsou zpožděné?"
            rows={4}
            value={question}
            onChange={(event) => {
              setCopyState("idle");
              onQuestionChange(event.target.value);
            }}
          />
        </label>

        <div className="dialog-tabs ai-agent-model-tabs" role="group" aria-label="Model AI agenta">
          <button
            className={modelPreference === "auto" ? "active" : ""}
            disabled={working}
            onClick={() => onModelPreferenceChange("auto")}
            type="button"
          >
            Auto
          </button>
          <button
            className={modelPreference === "fast" ? "active" : ""}
            disabled={working}
            onClick={() => onModelPreferenceChange("fast")}
            type="button"
          >
            Rychlý
          </button>
          <button
            className={modelPreference === "reasoning" ? "active" : ""}
            disabled={working}
            onClick={() => onModelPreferenceChange("reasoning")}
            type="button"
          >
            Reasoning
          </button>
        </div>

        {working ? (
          <div className="ai-situation-status compact">
            <Loader2 className="spin" size={22} />
            <strong>AI agent odpovídá</strong>
            {jobStatus ? <p>{jobStatus}</p> : null}
          </div>
        ) : error ? (
          <div className="ai-situation-error compact">
            <strong>AI agent neodpověděl</strong>
            <p>{error}</p>
          </div>
        ) : response ? (
          <>
            <div className="ai-situation-output">
              <AiMarkdownOutput text={answer} variant="dialog" />
            </div>
            <dl className="ai-situation-meta">
              <div>
                <dt>Stav</dt>
                <dd>{aiStatusLabel(response.status)}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>
                  {response.provider ?? "auto"}
                  {response.model ? ` / ${response.model}` : ""}
                </dd>
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
            <AiEvidencePanel response={response} />
          </>
        ) : (
          <div className="ai-situation-empty compact">
            <Sparkles size={24} />
            <strong>Agent použije jen auditovaný COP kontext, ne šifrovanou historii místnosti.</strong>
          </div>
        )}

        <footer>
          <button className="secondary-dialog-action" disabled={!canAsk} onClick={onAsk} type="button">
            {working ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
            Zeptat se
          </button>
          <button
            className="secondary-dialog-action"
            disabled={!canUseAnswer}
            onClick={() => void copyAnswer()}
            type="button"
          >
            {copyState === "copied" ? <Check size={17} /> : <Copy size={17} />}
            {copyState === "copied" ? "Zkopírováno" : copyState === "failed" ? "Kopírování selhalo" : "Zkopírovat"}
          </button>
          <button
            className="primary-dialog-action"
            disabled={!canUseAnswer || sending}
            onClick={() => onSendToChat(answer)}
            type="button"
          >
            {sending ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
            Odeslat odpověď
          </button>
        </footer>
      </section>
    </div>
  );
}
