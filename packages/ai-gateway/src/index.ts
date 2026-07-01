import { evaluateAiGuardrails } from "@cop/ai-guardrails";

export type AiProviderId = "openai" | "codex" | "ollama" | "local" | "mock";
export type AiDependencyStatus = "ok" | "degraded" | "disabled";

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

export interface AiProviderHealth {
  status: AiDependencyStatus;
  detail: string;
}

export interface AiProvider {
  id: AiProviderId;
  model: string;
  available: boolean;
  execute(query: AiCopQuery): Promise<Record<string, unknown>>;
  health?(): Promise<AiProviderHealth>;
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

  async health(): Promise<AiProviderHealth> {
    return {
      status: "degraded",
      detail: "mock provider only"
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

  async health(): Promise<AiProviderHealth> {
    return {
      status: "disabled",
      detail: `${this.id} provider is disabled`
    };
  }
}

export interface LocalLlmGatewayProviderOptions {
  baseUrl: string;
  token?: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  retryAttempts: number;
  think: boolean;
}

interface LlmGatewayChatResponse {
  id?: string;
  model?: string;
  content?: string;
  finish_reason?: string;
  provider?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OllamaProviderOptions {
  baseUrls: string[];
  token?: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  retryAttempts: number;
  think: boolean;
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    content?: string;
    role?: string;
    thinking?: unknown;
  };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaAiProvider implements AiProvider {
  id: AiProviderId = "ollama";
  available = true;

  constructor(private readonly options: OllamaProviderOptions) {}

  get model(): string {
    return this.options.model;
  }

  async execute(query: AiCopQuery): Promise<Record<string, unknown>> {
    const response = await this.postChat(query);
    const content = typeof response.message?.content === "string" ? response.message.content.trim() : "";
    if (!content) {
      throw new Error("Ollama returned an empty response.");
    }

    const promptTokens = Number.isFinite(response.prompt_eval_count) ? Number(response.prompt_eval_count) : 0;
    const completionTokens = Number.isFinite(response.eval_count) ? Number(response.eval_count) : 0;
    return {
      summary: content,
      structured: {
        provider: "ollama",
        model: response.model ?? this.model,
        finishReason: response.done_reason ?? "unknown",
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        }
      }
    };
  }

  async health(): Promise<AiProviderHealth> {
    const errors: string[] = [];
    const timeoutMs = Math.min(this.options.timeoutMs, 1500);
    for (const baseUrl of this.normalizedBaseUrls()) {
      try {
        const response = await fetchWithTimeout(
          `${baseUrl}/api/tags`,
          {
            method: "GET",
            headers: this.headers()
          },
          timeoutMs
        );
        if (!response.ok) {
          errors.push(`${baseUrl}: HTTP ${response.status}`);
          continue;
        }
        return {
          status: "ok",
          detail: `COP Ollama provider ready; model ${this.model}; endpoint ${baseUrl}`
        };
      } catch (error) {
        errors.push(`${baseUrl}: ${errorMessage(error)}`);
      }
    }
    return {
      status: "degraded",
      detail: `COP Ollama provider unavailable: ${errors.join("; ") || "no endpoint responded"}`
    };
  }

  private async postChat(query: AiCopQuery): Promise<OllamaChatResponse> {
    const body = {
      model: this.options.model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(query.outputFormat)
        },
        {
          role: "user",
          content: buildUserPrompt(query)
        }
      ],
      stream: false,
      think: this.options.think,
      options: {
        num_predict: this.options.maxTokens
      }
    };

    return this.requestJsonWithFallback(
      "/api/chat",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body)
      },
      this.options.timeoutMs
    ) as Promise<OllamaChatResponse>;
  }

  private async requestJsonWithFallback(path: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.retryAttempts; attempt += 1) {
      for (const baseUrl of this.normalizedBaseUrls()) {
        try {
          const response = await fetchWithTimeout(`${baseUrl}${path}`, init, timeoutMs);
          if (!response.ok) {
            const detail = await readShortResponse(response);
            throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
          }
          return (await response.json()) as Record<string, unknown>;
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw new Error(`Ollama request failed: ${errorMessage(lastError)}`);
  }

  private normalizedBaseUrls(): string[] {
    return this.options.baseUrls.map((baseUrl) => baseUrl.replace(/\/+$/, ""));
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Service-Name": "cop-api"
    };
    if (this.options.token) {
      headers.Authorization = `Bearer ${this.options.token}`;
    }
    return headers;
  }
}

export class LocalLlmGatewayProvider implements AiProvider {
  id: AiProviderId = "local";
  available = true;

  constructor(private readonly options: LocalLlmGatewayProviderOptions) {}

  get model(): string {
    return this.options.model;
  }

  async execute(query: AiCopQuery): Promise<Record<string, unknown>> {
    const response = await this.postChatCompletion(query);
    const content = typeof response.content === "string" ? response.content.trim() : "";

    if (!content) {
      throw new Error("Local LLM Gateway returned an empty response.");
    }

    return {
      summary: content,
      structured: {
        provider: response.provider ?? "local",
        model: response.model ?? this.model,
        finishReason: response.finish_reason ?? "unknown",
        usage: response.usage ?? null
      }
    };
  }

  async health(): Promise<AiProviderHealth> {
    try {
      const response = await fetchWithTimeout(
        `${this.normalizedBaseUrl()}/ready`,
        {
          headers: this.headers()
        },
        Math.min(this.options.timeoutMs, 3000)
      );
      if (!response.ok) {
        return {
          status: "degraded",
          detail: `local LLM Gateway readiness returned HTTP ${response.status}`
        };
      }
      return {
        status: "ok",
        detail: `local LLM Gateway ready; model ${this.model}`
      };
    } catch (error) {
      return {
        status: "degraded",
        detail: `local LLM Gateway unavailable: ${errorMessage(error)}`
      };
    }
  }

  private async postChatCompletion(query: AiCopQuery): Promise<LlmGatewayChatResponse> {
    const body = {
      model: this.options.model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(query.outputFormat)
        },
        {
          role: "user",
          content: buildUserPrompt(query)
        }
      ],
      max_tokens: this.options.maxTokens,
      think: this.options.think,
      stream: false,
      metadata: {
        requestId: query.requestId,
        purpose: query.purpose,
        safetyScope: query.safetyScope,
        caller: "cop-api"
      }
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.retryAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(
          `${this.normalizedBaseUrl()}/api/v1/chat/completions`,
          {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(body)
          },
          this.options.timeoutMs
        );

        if (!response.ok) {
          const detail = await readShortResponse(response);
          throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
        }
        return (await response.json()) as LlmGatewayChatResponse;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`Local LLM Gateway request failed: ${errorMessage(lastError)}`);
  }

  private normalizedBaseUrl(): string {
    return this.options.baseUrl.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Service-Name": "cop-api"
    };
    if (this.options.token) {
      headers.Authorization = `Bearer ${this.options.token}`;
    }
    return headers;
  }
}

export interface AiGatewayEnv {
  COP_EXTERNAL_AI_ENABLED?: string;
  COP_AI_DEFAULT_PROVIDER?: string;
  COP_AI_OLLAMA_BASE_URL?: string;
  COP_AI_OLLAMA_BASE_URLS?: string;
  COP_AI_OLLAMA_TOKEN?: string;
  COP_AI_OLLAMA_MODEL?: string;
  COP_AI_OLLAMA_MAX_TOKENS?: string;
  COP_AI_OLLAMA_TIMEOUT_MS?: string;
  COP_AI_OLLAMA_RETRY_ATTEMPTS?: string;
  COP_AI_OLLAMA_THINK?: string;
  COP_AI_LOCAL_GATEWAY_URL?: string;
  COP_AI_LOCAL_GATEWAY_TOKEN?: string;
  COP_AI_LOCAL_MODEL?: string;
  COP_AI_LOCAL_MAX_TOKENS?: string;
  COP_AI_LOCAL_TIMEOUT_MS?: string;
  COP_AI_LOCAL_RETRY_ATTEMPTS?: string;
  COP_AI_LOCAL_THINK?: string;
}

export function createProviderRegistry(env: AiGatewayEnv = process.env): Map<AiProviderId, AiProvider> {
  const mock = new MockAiProvider();
  const externalAiEnabled = parseBoolean(env.COP_EXTERNAL_AI_ENABLED, false);
  const ollamaBaseUrls = parseCsv(env.COP_AI_OLLAMA_BASE_URLS ?? env.COP_AI_OLLAMA_BASE_URL);
  const ollamaProvider =
    externalAiEnabled && ollamaBaseUrls.length > 0
      ? new OllamaAiProvider({
          baseUrls: ollamaBaseUrls,
          token: env.COP_AI_OLLAMA_TOKEN?.trim() || undefined,
          model: env.COP_AI_OLLAMA_MODEL?.trim() || env.COP_AI_LOCAL_MODEL?.trim() || "gemma4:12b-mlx",
          maxTokens: parsePositiveInteger(env.COP_AI_OLLAMA_MAX_TOKENS ?? env.COP_AI_LOCAL_MAX_TOKENS, 512),
          timeoutMs: parsePositiveInteger(env.COP_AI_OLLAMA_TIMEOUT_MS ?? env.COP_AI_LOCAL_TIMEOUT_MS, 30000),
          retryAttempts: parseNonNegativeInteger(env.COP_AI_OLLAMA_RETRY_ATTEMPTS ?? env.COP_AI_LOCAL_RETRY_ATTEMPTS, 2),
          think: parseBoolean(env.COP_AI_OLLAMA_THINK ?? env.COP_AI_LOCAL_THINK, false)
        })
      : new DisabledAiProvider("ollama", "ollama-provider-disabled");
  const localGatewayUrl = env.COP_AI_LOCAL_GATEWAY_URL?.trim();
  const localProvider =
    externalAiEnabled && localGatewayUrl
      ? new LocalLlmGatewayProvider({
          baseUrl: localGatewayUrl,
          token: env.COP_AI_LOCAL_GATEWAY_TOKEN?.trim() || undefined,
          model: env.COP_AI_LOCAL_MODEL?.trim() || "gemma4:12b-mlx",
          maxTokens: parsePositiveInteger(env.COP_AI_LOCAL_MAX_TOKENS, 512),
          timeoutMs: parsePositiveInteger(env.COP_AI_LOCAL_TIMEOUT_MS, 30000),
          retryAttempts: parseNonNegativeInteger(env.COP_AI_LOCAL_RETRY_ATTEMPTS, 2),
          think: parseBoolean(env.COP_AI_LOCAL_THINK, false)
        })
      : new DisabledAiProvider("local", "local-llm-gateway-disabled");
  return new Map<AiProviderId, AiProvider>([
    ["mock", mock],
    ["ollama", ollamaProvider],
    ["local", localProvider],
    ["openai", new DisabledAiProvider("openai", "openai-provider-disabled")],
    ["codex", new DisabledAiProvider("codex", "codex-provider-disabled")]
  ]);
}

export class AiGateway {
  private readonly defaultProvider: AiProviderId | "auto";

  constructor(
    private readonly providers = createProviderRegistry(),
    options: { defaultProvider?: AiProviderId | "auto" } = {}
  ) {
    this.defaultProvider = options.defaultProvider ?? "auto";
  }

  static fromEnv(env: AiGatewayEnv = process.env): AiGateway {
    return new AiGateway(createProviderRegistry(env), {
      defaultProvider: parseProviderId(env.COP_AI_DEFAULT_PROVIDER, "mock")
    });
  }

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

    let result: Record<string, unknown>;
    let status: AiCopResponse["status"] = decision.humanReviewRequired ? "NEEDS_HUMAN_REVIEW" : "COMPLETED";
    try {
      result = await provider.execute(query);
    } catch (error) {
      status = "NEEDS_HUMAN_REVIEW";
      result = {
        summary: "AI provider is temporarily unavailable. The request was not sent to an external public AI service.",
        structured: {
          provider: provider.id,
          error: errorMessage(error)
        }
      };
    }

    return {
      requestId: query.requestId,
      status,
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

  async health(): Promise<AiProviderHealth> {
    const checked: string[] = [];
    for (const provider of this.healthProviderCandidates()) {
      if (!provider.available) {
        checked.push(`${provider.id}: disabled`);
        continue;
      }
      if (!provider.health) {
        return {
          status: "ok",
          detail: `${provider.id} provider available; no provider health probe`
        };
      }
      const health = await provider.health();
      checked.push(`${provider.id}: ${health.status} (${health.detail})`);
      if (health.status === "ok") {
        return health;
      }
      if (health.status === "disabled") {
        continue;
      }
    }
    return {
      status: checked.every((item) => item.includes(": disabled")) ? "disabled" : "degraded",
      detail: checked.join("; ") || "AI providers are not configured"
    };
  }

  private healthProviderCandidates(): AiProvider[] {
    const candidates: AiProvider[] = [];
    const append = (provider: AiProvider | undefined) => {
      if (provider && !candidates.some((candidate) => candidate.id === provider.id)) {
        candidates.push(provider);
      }
    };
    if (this.defaultProvider !== "auto") {
      append(this.providers.get(this.defaultProvider));
    }
    append(this.providers.get("ollama"));
    append(this.providers.get("local"));
    append(this.providers.get("mock"));
    return candidates;
  }

  private selectProvider(preference: AiProviderId | "auto"): AiProvider {
    if (preference !== "auto") {
      const preferred = this.providers.get(preference);
      if (preferred?.available) {
        return preferred;
      }
    }
    const configuredDefault = this.defaultProvider === "auto" ? undefined : this.providers.get(this.defaultProvider);
    if (configuredDefault?.available) {
      return configuredDefault;
    }
    const local = this.providers.get("local");
    const ollama = this.providers.get("ollama");
    if (ollama?.available) {
      return ollama;
    }
    if (local?.available) {
      return local;
    }
    return this.providers.get("mock") ?? new MockAiProvider();
  }
}

function buildSystemPrompt(outputFormat: AiCopQuery["outputFormat"]): string {
  return [
    "Jsi asistivní analytický modul pro Civilní situační mapu.",
    "Pomáháš pouze s vysvětlením dat, kvality zdrojů, filtrů a situačních reportů.",
    "Nedoporučuješ zásah, cíl, použití síly, taktické navedení ani jiné weapon workflow.",
    `Odpovídej ve formátu ${outputFormat}. Odpověď drž stručnou, věcnou a použitelnou pro civilní krizový přehled.`
  ].join(" ");
}

function buildUserPrompt(query: AiCopQuery): string {
  return [
    `Účel: ${query.purpose}`,
    `Bezpečnostní rozsah: ${query.safetyScope}`,
    `Dotaz: ${query.prompt}`,
    `Kontext JSON: ${JSON.stringify(query.context ?? {})}`
  ].join("\n");
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readShortResponse(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseProviderId(value: string | undefined, fallback: AiProviderId | "auto"): AiProviderId | "auto" {
  if (value === "openai" || value === "codex" || value === "ollama" || value === "local" || value === "mock" || value === "auto") {
    return value;
  }
  return fallback;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
