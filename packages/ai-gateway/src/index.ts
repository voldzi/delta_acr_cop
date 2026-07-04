import { evaluateAiGuardrails } from "@cop/ai-guardrails";

export type AiProviderId = "openai" | "codex" | "ollama" | "local" | "mock";
export type AiDependencyStatus = "ok" | "degraded" | "disabled";
export type AiModelPreference = "auto" | "fast" | "reasoning";
export type AiModelRole = "fast" | "reasoning" | "provider-default";

export interface AiModelRoutingDecision {
  strategy: "deterministic-v1";
  provider: AiProviderId;
  modelRole: AiModelRole;
  selectedModel: string;
  complexityScore: number;
  reason: string;
  fallbackModel?: string;
  embeddingModel?: string;
}

export interface AiCopQuery {
  requestId: string;
  purpose: string;
  prompt: string;
  context?: Record<string, unknown>;
  modelPreference?: AiModelPreference;
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
  routing?: AiModelRoutingDecision;
  result: Record<string, unknown>;
  auditId: string;
}

export interface AiProviderHealth {
  status: AiDependencyStatus;
  detail: string;
}

export interface AiEmbeddingResponse {
  embedding: number[];
  model: string;
}

export interface AiProvider {
  id: AiProviderId;
  model: string;
  available: boolean;
  execute(query: AiCopQuery, routing?: AiModelRoutingDecision): Promise<Record<string, unknown>>;
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
  modelProfiles?: Partial<Record<Extract<AiModelRole, "fast" | "reasoning">, OllamaChatModelProfile>>;
  embeddingModel?: string;
}

export interface OllamaChatModelProfile {
  role: Extract<AiModelRole, "fast" | "reasoning">;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  retryAttempts: number;
  think: boolean;
}

export interface OllamaEmbeddingProviderOptions {
  baseUrls: string[];
  token?: string;
  model: string;
  timeoutMs: number;
  retryAttempts: number;
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

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

interface OllamaEmbedResponse {
  model?: string;
  embedding?: number[];
  embeddings?: number[][];
}

export class OllamaAiProvider implements AiProvider {
  id: AiProviderId = "ollama";
  available = true;

  constructor(private readonly options: OllamaProviderOptions) {}

  get model(): string {
    return this.chatProfile("fast").model;
  }

  async execute(query: AiCopQuery, routing?: AiModelRoutingDecision): Promise<Record<string, unknown>> {
    const profile = this.chatProfile(routing?.provider === "ollama" ? routing.modelRole : "fast");
    try {
      return await this.executeWithProfile(query, profile, routing);
    } catch (error) {
      const fallback = this.chatProfile("fast");
      if (profile.role !== "reasoning" || fallback.model === profile.model) {
        throw error;
      }
      const result = await this.executeWithProfile(query, fallback, routing);
      return {
        ...result,
        structured: {
          ...(isRecord(result.structured) ? result.structured : {}),
          routing: {
            fallbackReason: errorMessage(error),
            fallbackUsed: true,
            requestedModel: profile.model,
            selectedModel: fallback.model
          }
        }
      };
    }
  }

  private async executeWithProfile(
    query: AiCopQuery,
    profile: OllamaChatModelProfile,
    routing?: AiModelRoutingDecision
  ): Promise<Record<string, unknown>> {
    const response = await this.postChat(query, profile);
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
        model: response.model ?? profile.model,
        finishReason: response.done_reason ?? "unknown",
        routing: routing ? {
          complexityScore: routing.complexityScore,
          modelRole: routing.modelRole,
          reason: routing.reason,
          selectedModel: profile.model,
          strategy: routing.strategy
        } : undefined,
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
        const tags = (await response.json()) as OllamaTagsResponse;
        const missingModels = this.missingConfiguredModels(tags);
        if (missingModels.length > 0) {
          errors.push(`${baseUrl}: missing configured model(s) ${missingModels.join(", ")}`);
          continue;
        }
        return {
          status: "ok",
          detail: `COP Ollama provider ready; fast model ${this.chatProfile("fast").model}; reasoning model ${this.chatProfile("reasoning").model};${this.options.embeddingModel ? ` embedding model ${this.options.embeddingModel};` : ""} endpoint ${baseUrl}`
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

  private async postChat(query: AiCopQuery, profile: OllamaChatModelProfile): Promise<OllamaChatResponse> {
    const body = {
      model: profile.model,
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
      think: profile.think,
      options: {
        num_predict: profile.maxTokens
      }
    };

    return this.requestJsonWithFallback(
      "/api/chat",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body)
      },
      profile.timeoutMs,
      profile.retryAttempts
    ) as Promise<OllamaChatResponse>;
  }

  private async requestJsonWithFallback(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    retryAttempts = this.options.retryAttempts
  ): Promise<Record<string, unknown>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
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

  private chatProfile(role: AiModelRole): OllamaChatModelProfile {
    if (role === "reasoning" && this.options.modelProfiles?.reasoning) {
      return this.options.modelProfiles.reasoning;
    }
    if (this.options.modelProfiles?.fast) {
      return this.options.modelProfiles.fast;
    }
    return {
      role: "fast",
      model: this.options.model,
      maxTokens: this.options.maxTokens,
      timeoutMs: this.options.timeoutMs,
      retryAttempts: this.options.retryAttempts,
      think: this.options.think
    };
  }

  private missingConfiguredModels(tags: OllamaTagsResponse): string[] {
    const available = new Set((tags.models ?? []).flatMap((model) => [model.name, model.model]).filter(isNonEmptyString));
    if (available.size === 0) {
      return [];
    }
    return Array.from(new Set([
      this.chatProfile("fast").model,
      this.chatProfile("reasoning").model,
      this.options.embeddingModel
    ].filter(isNonEmptyString))).filter((model) => !available.has(model));
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

export class OllamaEmbeddingProvider {
  available = true;

  constructor(private readonly options: OllamaEmbeddingProviderOptions) {}

  get model(): string {
    return this.options.model;
  }

  async embed(input: string): Promise<AiEmbeddingResponse> {
    const body = {
      model: this.options.model,
      input
    };
    const response = await this.requestJsonWithFallback(
      "/api/embed",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body)
      },
      this.options.timeoutMs
    ) as OllamaEmbedResponse;
    const embedding = Array.isArray(response.embeddings?.[0])
      ? response.embeddings[0]
      : Array.isArray(response.embedding)
        ? response.embedding
        : undefined;
    if (!embedding || embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error("Ollama embedding provider returned an invalid embedding.");
    }
    return {
      embedding,
      model: response.model ?? this.options.model
    };
  }

  async health(): Promise<AiProviderHealth> {
    const errors: string[] = [];
    for (const baseUrl of this.normalizedBaseUrls()) {
      try {
        const response = await fetchWithTimeout(
          `${baseUrl}/api/tags`,
          {
            method: "GET",
            headers: this.headers()
          },
          Math.min(this.options.timeoutMs, 1500)
        );
        if (!response.ok) {
          errors.push(`${baseUrl}: HTTP ${response.status}`);
          continue;
        }
        const tags = (await response.json()) as OllamaTagsResponse;
        const available = new Set((tags.models ?? []).flatMap((model) => [model.name, model.model]).filter(isNonEmptyString));
        if (available.size > 0 && !available.has(this.options.model)) {
          errors.push(`${baseUrl}: missing embedding model ${this.options.model}`);
          continue;
        }
        return {
          status: "ok",
          detail: `Ollama embedding provider ready; model ${this.options.model}; endpoint ${baseUrl}`
        };
      } catch (error) {
        errors.push(`${baseUrl}: ${errorMessage(error)}`);
      }
    }
    return {
      status: "degraded",
      detail: `Ollama embedding provider unavailable: ${errors.join("; ") || "no endpoint responded"}`
    };
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
    throw new Error(`Ollama embedding request failed: ${errorMessage(lastError)}`);
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
  COP_AI_MODEL_ROUTER_ENABLED?: string;
  COP_AI_MODEL_ROUTER_COMPLEXITY_THRESHOLD?: string;
  COP_AI_OLLAMA_FAST_MODEL?: string;
  COP_AI_OLLAMA_MODEL?: string;
  COP_AI_OLLAMA_MAX_TOKENS?: string;
  COP_AI_OLLAMA_TIMEOUT_MS?: string;
  COP_AI_OLLAMA_RETRY_ATTEMPTS?: string;
  COP_AI_OLLAMA_THINK?: string;
  COP_AI_OLLAMA_REASONING_MODEL?: string;
  COP_AI_OLLAMA_REASONING_MAX_TOKENS?: string;
  COP_AI_OLLAMA_REASONING_TIMEOUT_MS?: string;
  COP_AI_OLLAMA_REASONING_RETRY_ATTEMPTS?: string;
  COP_AI_OLLAMA_REASONING_THINK?: string;
  COP_AI_OLLAMA_EMBEDDING_MODEL?: string;
  COP_AI_OLLAMA_EMBEDDING_TIMEOUT_MS?: string;
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
  const ollamaProfiles = ollamaChatProfilesFromEnv(env);
  const ollamaProvider =
    externalAiEnabled && ollamaBaseUrls.length > 0
      ? new OllamaAiProvider({
          baseUrls: ollamaBaseUrls,
          token: env.COP_AI_OLLAMA_TOKEN?.trim() || undefined,
          model: ollamaProfiles.fast.model,
          maxTokens: ollamaProfiles.fast.maxTokens,
          timeoutMs: ollamaProfiles.fast.timeoutMs,
          retryAttempts: ollamaProfiles.fast.retryAttempts,
          think: ollamaProfiles.fast.think,
          modelProfiles: ollamaProfiles,
          embeddingModel: optionalTrimmedString(env.COP_AI_OLLAMA_EMBEDDING_MODEL)
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

export function createOllamaEmbeddingProvider(env: AiGatewayEnv = process.env): OllamaEmbeddingProvider | undefined {
  const externalAiEnabled = parseBoolean(env.COP_EXTERNAL_AI_ENABLED, false);
  const baseUrls = parseCsv(env.COP_AI_OLLAMA_BASE_URLS ?? env.COP_AI_OLLAMA_BASE_URL);
  const model = optionalTrimmedString(env.COP_AI_OLLAMA_EMBEDDING_MODEL);
  if (!externalAiEnabled || baseUrls.length === 0 || !model) {
    return undefined;
  }
  return new OllamaEmbeddingProvider({
    baseUrls,
    token: optionalTrimmedString(env.COP_AI_OLLAMA_TOKEN),
    model,
    timeoutMs: parsePositiveInteger(env.COP_AI_OLLAMA_EMBEDDING_TIMEOUT_MS, 10000),
    retryAttempts: parseNonNegativeInteger(env.COP_AI_OLLAMA_RETRY_ATTEMPTS, 2)
  });
}

export interface AiModelRouterOptions {
  enabled: boolean;
  complexityThreshold: number;
  ollamaFastModel: string;
  ollamaReasoningModel?: string;
  ollamaEmbeddingModel?: string;
}

export class AiModelRouter {
  constructor(private readonly options: AiModelRouterOptions) {}

  route(query: AiCopQuery, provider: AiProvider): AiModelRoutingDecision {
    if (!this.options.enabled) {
      return this.providerDefaultRoute(provider, "Model router is disabled by configuration.");
    }
    if (provider.id !== "ollama") {
      return this.providerDefaultRoute(provider, `Provider ${provider.id} does not expose COP model profiles.`);
    }
    const complexity = scoreAiQueryComplexity(query);
    const preference = query.modelPreference ?? "auto";
    const reasoningModel = this.options.ollamaReasoningModel;
    const reasoningAvailable = Boolean(reasoningModel && reasoningModel !== this.options.ollamaFastModel);
    if (preference === "fast") {
      return this.ollamaRoute("fast", this.options.ollamaFastModel, complexity, "Fast model explicitly requested.");
    }
    if (preference === "reasoning" && reasoningAvailable && reasoningModel) {
      return this.ollamaRoute("reasoning", reasoningModel, 100, "Reasoning model explicitly requested.");
    }
    if (reasoningAvailable && reasoningModel && complexity >= this.options.complexityThreshold) {
      return this.ollamaRoute(
        "reasoning",
        reasoningModel,
        complexity,
        `Complexity score ${complexity} reached threshold ${this.options.complexityThreshold}.`
      );
    }
    return this.ollamaRoute(
      "fast",
      this.options.ollamaFastModel,
      complexity,
      reasoningAvailable
        ? `Complexity score ${complexity} stayed below threshold ${this.options.complexityThreshold}.`
        : "Reasoning model is not configured; using fast model."
    );
  }

  private ollamaRoute(
    modelRole: Extract<AiModelRole, "fast" | "reasoning">,
    selectedModel: string,
    complexityScore: number,
    reason: string
  ): AiModelRoutingDecision {
    return {
      strategy: "deterministic-v1",
      provider: "ollama",
      modelRole,
      selectedModel,
      complexityScore,
      reason,
      ...(modelRole === "reasoning" ? { fallbackModel: this.options.ollamaFastModel } : {}),
      ...(this.options.ollamaEmbeddingModel ? { embeddingModel: this.options.ollamaEmbeddingModel } : {})
    };
  }

  private providerDefaultRoute(provider: AiProvider, reason: string): AiModelRoutingDecision {
    return {
      strategy: "deterministic-v1",
      provider: provider.id,
      modelRole: "provider-default",
      selectedModel: provider.model,
      complexityScore: 0,
      reason
    };
  }
}

export function createModelRouter(env: AiGatewayEnv = process.env): AiModelRouter {
  const profiles = ollamaChatProfilesFromEnv(env);
  return new AiModelRouter({
    enabled: parseBoolean(env.COP_AI_MODEL_ROUTER_ENABLED, true),
    complexityThreshold: parsePositiveInteger(env.COP_AI_MODEL_ROUTER_COMPLEXITY_THRESHOLD, 70),
    ollamaFastModel: profiles.fast.model,
    ollamaReasoningModel: profiles.reasoning?.model,
    ollamaEmbeddingModel: optionalTrimmedString(env.COP_AI_OLLAMA_EMBEDDING_MODEL)
  });
}

export class AiGateway {
  private readonly defaultProvider: AiProviderId | "auto";

  constructor(
    private readonly providers = createProviderRegistry(),
    options: {
      defaultProvider?: AiProviderId | "auto";
      embeddingProvider?: OllamaEmbeddingProvider;
      modelRouter?: AiModelRouter;
    } = {}
  ) {
    this.defaultProvider = options.defaultProvider ?? "auto";
    this.embeddingProvider = options.embeddingProvider;
    this.modelRouter = options.modelRouter ?? createModelRouter();
  }

  private readonly embeddingProvider: OllamaEmbeddingProvider | undefined;
  private readonly modelRouter: AiModelRouter;

  static fromEnv(env: AiGatewayEnv = process.env): AiGateway {
    return new AiGateway(createProviderRegistry(env), {
      defaultProvider: parseProviderId(env.COP_AI_DEFAULT_PROVIDER, "mock"),
      embeddingProvider: createOllamaEmbeddingProvider(env),
      modelRouter: createModelRouter(env)
    });
  }

  async queryCopAssistant(query: AiCopQuery): Promise<AiCopResponse> {
    const decision = evaluateAiGuardrails(query);
    const provider = this.selectProvider(query.providerPreference);
    const routing = this.modelRouter.route(query, provider);
    const auditId = crypto.randomUUID();

    if (!decision.allowed) {
      return {
        requestId: query.requestId,
        status: "REJECTED",
        provider: provider.id,
        model: routing.selectedModel,
        policy: {
          allowed: false,
          reason: decision.reason,
          redactionsApplied: decision.redactionsRequired
        },
        routing,
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
      result = await provider.execute(query, routing);
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
      model: modelFromProviderResult(result, routing.selectedModel),
      policy: {
        allowed: true,
        reason: decision.reason,
        redactionsApplied: decision.redactionsRequired
      },
      routing,
      result,
      auditId
    };
  }

  async embedText(input: string): Promise<AiEmbeddingResponse> {
    if (!this.embeddingProvider) {
      throw new Error("AI embedding provider is not configured.");
    }
    return this.embeddingProvider.embed(input);
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
        const embeddingHealth = await this.embeddingHealthSummary();
        return {
          status: health.status,
          detail: embeddingHealth ? `${health.detail}; ${embeddingHealth}` : health.detail
        };
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

  private async embeddingHealthSummary(): Promise<string | undefined> {
    if (!this.embeddingProvider) {
      return undefined;
    }
    const health = await this.embeddingProvider.health();
    return `embedding ${health.status} (${health.detail})`;
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

function ollamaChatProfilesFromEnv(env: AiGatewayEnv): Record<"fast" | "reasoning", OllamaChatModelProfile> {
  const fast: OllamaChatModelProfile = {
    role: "fast",
    model: optionalTrimmedString(env.COP_AI_OLLAMA_FAST_MODEL)
      ?? optionalTrimmedString(env.COP_AI_OLLAMA_MODEL)
      ?? optionalTrimmedString(env.COP_AI_LOCAL_MODEL)
      ?? "gemma4:12b-mlx",
    maxTokens: parsePositiveInteger(env.COP_AI_OLLAMA_MAX_TOKENS ?? env.COP_AI_LOCAL_MAX_TOKENS, 512),
    timeoutMs: parsePositiveInteger(env.COP_AI_OLLAMA_TIMEOUT_MS ?? env.COP_AI_LOCAL_TIMEOUT_MS, 30000),
    retryAttempts: parseNonNegativeInteger(env.COP_AI_OLLAMA_RETRY_ATTEMPTS ?? env.COP_AI_LOCAL_RETRY_ATTEMPTS, 2),
    think: parseBoolean(env.COP_AI_OLLAMA_THINK ?? env.COP_AI_LOCAL_THINK, false)
  };
  const reasoningModel = optionalTrimmedString(env.COP_AI_OLLAMA_REASONING_MODEL) ?? fast.model;
  return {
    fast,
    reasoning: {
      role: "reasoning",
      model: reasoningModel,
      maxTokens: parsePositiveInteger(env.COP_AI_OLLAMA_REASONING_MAX_TOKENS, Math.max(fast.maxTokens, 1200)),
      timeoutMs: parsePositiveInteger(env.COP_AI_OLLAMA_REASONING_TIMEOUT_MS, Math.max(fast.timeoutMs, 90000)),
      retryAttempts: parseNonNegativeInteger(env.COP_AI_OLLAMA_REASONING_RETRY_ATTEMPTS, fast.retryAttempts),
      think: parseBoolean(env.COP_AI_OLLAMA_REASONING_THINK, fast.think)
    }
  };
}

function scoreAiQueryComplexity(query: AiCopQuery): number {
  if (query.modelPreference === "reasoning") {
    return 100;
  }
  if (query.modelPreference === "fast") {
    return 0;
  }

  let score = 0;
  const prompt = query.prompt.toLowerCase();
  const contextSize = JSON.stringify(query.context ?? {}).length;
  if (query.purpose === "DATA_CONFLICT_ANALYSIS") {
    score += 45;
  }
  if (query.purpose === "COP_EXPLANATION") {
    score += 15;
  }
  if (query.outputFormat === "JSON") {
    score += 10;
  }
  if (query.prompt.length > 600) {
    score += 10;
  }
  if (query.prompt.length > 1400) {
    score += 15;
  }
  if (contextSize > 10000) {
    score += 15;
  }
  if (contextSize > 25000) {
    score += 20;
  }

  const scope = isRecord(query.context?.scope) ? query.context.scope : undefined;
  if (scope) {
    score += Math.min(readFiniteNumber(scope.objectCount) ?? 0, 80) >= 35 ? 15 : 0;
    score += Math.min(readFiniteNumber(scope.alertCount) ?? 0, 50) >= 10 ? 10 : 0;
    score += Math.min(readFiniteNumber(scope.chatMessageCount) ?? 0, 60) >= 15 ? 15 : 0;
    score += Math.min(readFiniteNumber(scope.communityReportCount) ?? 0, 40) >= 8 ? 10 : 0;
    score += Math.min(readFiniteNumber(scope.incidentCount) ?? 0, 40) >= 6 ? 10 : 0;
    score += Math.min(readFiniteNumber(scope.sourceCount) ?? 0, 80) >= 8 ? 10 : 0;
  }

  const reasoningTerms = [
    "anomál",
    "co bude",
    "conflict",
    "dopad",
    "konflikt",
    "nejist",
    "porovnej",
    "predik",
    "progn",
    "proč",
    "risk",
    "rizik",
    "scénář",
    "situational awareness",
    "výhled",
    "vývoj",
    "what will happen"
  ];
  if (reasoningTerms.some((term) => prompt.includes(term))) {
    score += 25;
  }

  return Math.max(0, Math.min(100, score));
}

function modelFromProviderResult(result: Record<string, unknown>, fallback: string): string {
  const structured = isRecord(result.structured) ? result.structured : undefined;
  return optionalTrimmedString(structured?.model) ?? fallback;
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

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
