export interface AiGuardrailInput {
  purpose: string;
  prompt: string;
  safetyScope: string;
}

export interface AiGuardrailDecision {
  allowed: boolean;
  reason: string;
  redactionsRequired: boolean;
  humanReviewRequired: boolean;
  matchedRule?: string;
}

const allowedPurposes = new Set([
  "COP_EXPLANATION",
  "REPORT_DRAFT",
  "FILTER_SUGGESTION",
  "DATA_CONFLICT_ANALYSIS",
  "DATA_QUALITY_CHECK",
  "DEV_HELP",
  "RUNBOOK_DRAFT"
]);

const deniedPatterns: Array<{ id: string; pattern: RegExp }> = [
  { id: "USE_OF_FORCE", pattern: /\b(attack|strike|target|weapon|kill|fire mission)\b/i },
  { id: "CS_CZ_USE_OF_FORCE", pattern: /\b(útok|zasah|zásah|cíl|cíle|zbraň|navádění|palba)\b/i },
  { id: "EVASION", pattern: /\b(evade detection|avoid detection|bypass security)\b/i }
];

export function evaluateAiGuardrails(input: AiGuardrailInput): AiGuardrailDecision {
  if (input.safetyScope !== "COP_DATA_ASSISTANCE_ONLY") {
    return {
      allowed: false,
      reason: "Unsupported AI safety scope.",
      redactionsRequired: true,
      humanReviewRequired: false,
      matchedRule: "SAFETY_SCOPE"
    };
  }

  if (!allowedPurposes.has(input.purpose)) {
    return {
      allowed: false,
      reason: "AI purpose is not allowed for COP assistant.",
      redactionsRequired: true,
      humanReviewRequired: false,
      matchedRule: "PURPOSE_DENY"
    };
  }

  for (const rule of deniedPatterns) {
    if (rule.pattern.test(input.prompt)) {
      return {
        allowed: false,
        reason: "Request is outside COP data assistance boundaries.",
        redactionsRequired: true,
        humanReviewRequired: false,
        matchedRule: rule.id
      };
    }
  }

  return {
    allowed: true,
    reason: "Request is limited to COP data assistance.",
    redactionsRequired: true,
    humanReviewRequired: input.purpose === "REPORT_DRAFT" || input.purpose === "DATA_CONFLICT_ANALYSIS"
  };
}
