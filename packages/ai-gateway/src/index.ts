import { evaluateAiGuardrails } from "@cop/ai-guardrails";

export type AiProviderId = "openai" | "codex" | "local" | "mock";

export interface AiCopQuery {
  requestId: string;
  purpose: string;
  prompt: string;
  context?: Record<string, unknown>;
  providerPreference: AiProviderId | "auto";
  outputFormat: "TEXT" | "JSON" | "MARKDOWN";
  safetyScope: "COP_DATA_ASSISTANCE_ONLY";
}

export interface AiCopResponse {
  requestId: string;
  status: "COMPLETED" | "REJECTED" | "NEEDS_HUMAN_REVIEW";
  provider: AiProviderId;
  model: string;
  policy: {
    allowed: boolean;
    reason: string;
    redactionsApplied: boolean;
  };
  result: Record<string, unknown>;
  auditId: string;
}

export interface AiProvider {
  id: AiProviderId;
  model: string;
  available: boolean;
  execute(query: AiCopQuery): Promise<Record<string, unknown>>;
}

export class MockAiProvider implements AiProvider {
  id: AiProviderId = "mock";
  model = "mock-cop-assistant-v1";
  available = true;

  async execute(query: AiCopQuery): Promise<Record<string, unknown>> {
    return {
      summary: `Mock COP assistant response for ${query.purpose}.`,
      structured: {
        purpose: query.purpose,
        safetyScope: query.safetyScope,
        note: "Provider abstraction skeleton; no external AI call was made."
      }
    };
  }
}

class DisabledAiProvider implements AiProvider {
  available = false;

  constructor(
    public readonly id: AiProviderId,
    public readonly model: string
  ) {}

  async execute(): Promise<Record<string, unknown>> {
    return {
      summary: `${this.id} provider is disabled in this skeleton.`,
      structured: {
        provider: this.id,
        available: false
      }
    };
  }
}

export function createProviderRegistry(): Map<AiProviderId, AiProvider> {
  const mock = new MockAiProvider();
  return new Map<AiProviderId, AiProvider>([
    ["mock", mock],
    ["local", new DisabledAiProvider("local", "local-llm-placeholder")],
    ["openai", new DisabledAiProvider("openai", "openai-provider-disabled")],
    ["codex", new DisabledAiProvider("codex", "codex-provider-disabled")]
  ]);
}

export class AiGateway {
  constructor(private readonly providers = createProviderRegistry()) {}

  async queryCopAssistant(query: AiCopQuery): Promise<AiCopResponse> {
    const decision = evaluateAiGuardrails(query);
    const provider = this.selectProvider(query.providerPreference);
    const auditId = crypto.randomUUID();

    if (!decision.allowed) {
      return {
        requestId: query.requestId,
        status: "REJECTED",
        provider: provider.id,
        model: provider.model,
        policy: {
          allowed: false,
          reason: decision.reason,
          redactionsApplied: decision.redactionsRequired
        },
        result: {
          summary: "Request rejected by AI guardrails.",
          matchedRule: decision.matchedRule
        },
        auditId
      };
    }

    const result = await provider.execute(query);
    return {
      requestId: query.requestId,
      status: decision.humanReviewRequired ? "NEEDS_HUMAN_REVIEW" : "COMPLETED",
      provider: provider.id,
      model: provider.model,
      policy: {
        allowed: true,
        reason: decision.reason,
        redactionsApplied: decision.redactionsRequired
      },
      result,
      auditId
    };
  }

  listProviders(): Array<{ id: AiProviderId; model: string; available: boolean }> {
    return Array.from(this.providers.values()).map((provider) => ({
      id: provider.id,
      model: provider.model,
      available: provider.available
    }));
  }

  private selectProvider(preference: AiProviderId | "auto"): AiProvider {
    if (preference !== "auto") {
      const preferred = this.providers.get(preference);
      if (preferred?.available) {
        return preferred;
      }
    }
    return this.providers.get("mock") ?? new MockAiProvider();
  }
}
