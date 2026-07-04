import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGateway, LocalLlmGatewayProvider, OllamaAiProvider, OllamaEmbeddingProvider, createProviderRegistry } from "./index.js";

const baseQuery = {
  requestId: "req_test",
  purpose: "DATA_QUALITY_CHECK",
  prompt: "Shrň kvalitu dat.",
  context: { objectIds: ["obj-1"] },
  providerPreference: "auto" as const,
  outputFormat: "MARKDOWN" as const,
  safetyScope: "COP_DATA_ASSISTANCE_ONLY" as const
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiGateway", () => {
  it("uses the COP-owned Ollama provider before the compatibility gateway", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: {
            role: "assistant",
            content: "Ollama odpověděla přes COP server-side provider."
          },
          done_reason: "stop",
          prompt_eval_count: 10,
          eval_count: 8
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const gateway = AiGateway.fromEnv({
      COP_EXTERNAL_AI_ENABLED: "true",
      COP_AI_DEFAULT_PROVIDER: "auto",
      COP_AI_OLLAMA_BASE_URLS: "http://ollama-primary:11434,http://ollama-secondary:11434",
      COP_AI_LOCAL_GATEWAY_URL: "http://llm-gateway:8080",
      COP_AI_OLLAMA_MODEL: "gemma4:12b-mlx",
      COP_AI_OLLAMA_MAX_TOKENS: "384",
      COP_AI_OLLAMA_THINK: "false"
    });

    const response = await gateway.queryCopAssistant(baseQuery);

    expect(response.status).toBe("COMPLETED");
    expect(response.provider).toBe("ollama");
    expect(response.model).toBe("gemma4:12b-mlx");
    expect(response.routing).toMatchObject({
      modelRole: "fast",
      selectedModel: "gemma4:12b-mlx",
      strategy: "deterministic-v1"
    });
    expect(response.result.summary).toBe("Ollama odpověděla přes COP server-side provider.");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama-primary:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Service-Name": "cop-api"
        })
      })
    );
    const fetchInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(fetchInit.body as string);
    expect(requestBody.model).toBe("gemma4:12b-mlx");
    expect(requestBody.think).toBe(false);
    expect(requestBody.options.num_predict).toBe(384);
  });

  it("routes complex COP awareness questions to the reasoning Ollama model", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          model: body.model,
          message: {
            role: "assistant",
            content: "Komplexní situační odpověď z reasoning profilu."
          },
          done_reason: "stop",
          prompt_eval_count: 120,
          eval_count: 80
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const gateway = AiGateway.fromEnv({
      COP_EXTERNAL_AI_ENABLED: "true",
      COP_AI_DEFAULT_PROVIDER: "auto",
      COP_AI_MODEL_ROUTER_COMPLEXITY_THRESHOLD: "60",
      COP_AI_OLLAMA_BASE_URLS: "http://ollama:11434",
      COP_AI_OLLAMA_FAST_MODEL: "gemma4:12b-mlx",
      COP_AI_OLLAMA_REASONING_MODEL: "gemma4:31b-mlx",
      COP_AI_OLLAMA_REASONING_MAX_TOKENS: "1400",
      COP_AI_OLLAMA_REASONING_TIMEOUT_MS: "90000",
      COP_AI_OLLAMA_EMBEDDING_MODEL: "bge-m3:latest"
    });

    const response = await gateway.queryCopAssistant({
      ...baseQuery,
      purpose: "COP_EXPLANATION",
      prompt: "Porovnej konflikty zdrojů, rizika, dopady a vývoj situational awareness.",
      context: {
        scope: {
          alertCount: 12,
          chatMessageCount: 20,
          communityReportCount: 10,
          incidentCount: 7,
          objectCount: 50,
          sourceCount: 9
        }
      }
    });

    expect(response.status).toBe("COMPLETED");
    expect(response.model).toBe("gemma4:31b-mlx");
    expect(response.routing).toMatchObject({
      embeddingModel: "bge-m3:latest",
      fallbackModel: "gemma4:12b-mlx",
      modelRole: "reasoning",
      provider: "ollama",
      selectedModel: "gemma4:31b-mlx"
    });
    expect(response.routing?.complexityScore).toBeGreaterThanOrEqual(60);
    const fetchInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(fetchInit.body as string);
    expect(requestBody.model).toBe("gemma4:31b-mlx");
    expect(requestBody.options.num_predict).toBe(1400);
  });

  it("allows an explicit fast model preference to bypass reasoning escalation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          model: body.model,
          message: {
            role: "assistant",
            content: "Rychlá odpověď."
          },
          done_reason: "stop"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const gateway = AiGateway.fromEnv({
      COP_EXTERNAL_AI_ENABLED: "true",
      COP_AI_DEFAULT_PROVIDER: "auto",
      COP_AI_OLLAMA_BASE_URLS: "http://ollama:11434",
      COP_AI_OLLAMA_FAST_MODEL: "gemma4:12b-mlx",
      COP_AI_OLLAMA_REASONING_MODEL: "gemma4:31b-mlx"
    });

    const response = await gateway.queryCopAssistant({
      ...baseQuery,
      modelPreference: "fast",
      purpose: "COP_EXPLANATION",
      prompt: "Porovnej konflikty zdrojů, rizika a očekávaný vývoj."
    });

    expect(response.model).toBe("gemma4:12b-mlx");
    expect(response.routing?.modelRole).toBe("fast");
    const fetchInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(fetchInit.body as string);
    expect(requestBody.model).toBe("gemma4:12b-mlx");
  });

  it("falls back to the fast Ollama model when the reasoning model fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.model === "gemma4:31b-mlx") {
        return new Response(JSON.stringify({ error: "model temporarily unavailable" }), { status: 503 });
      }
      return new Response(
        JSON.stringify({
          model: body.model,
          message: {
            role: "assistant",
            content: "Fallback odpověď z fast profilu."
          },
          done_reason: "stop"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const gateway = AiGateway.fromEnv({
      COP_EXTERNAL_AI_ENABLED: "true",
      COP_AI_DEFAULT_PROVIDER: "auto",
      COP_AI_MODEL_ROUTER_COMPLEXITY_THRESHOLD: "20",
      COP_AI_OLLAMA_BASE_URLS: "http://ollama:11434",
      COP_AI_OLLAMA_FAST_MODEL: "gemma4:12b-mlx",
      COP_AI_OLLAMA_REASONING_MODEL: "gemma4:31b-mlx",
      COP_AI_OLLAMA_REASONING_RETRY_ATTEMPTS: "0"
    });

    const response = await gateway.queryCopAssistant({
      ...baseQuery,
      purpose: "COP_EXPLANATION",
      prompt: "Porovnej konflikty zdrojů."
    });

    expect(response.status).toBe("COMPLETED");
    expect(response.model).toBe("gemma4:12b-mlx");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.result.structured).toMatchObject({
      routing: {
        fallbackUsed: true,
        requestedModel: "gemma4:31b-mlx",
        selectedModel: "gemma4:12b-mlx"
      }
    });
  });

  it("uses the local LLM Gateway provider when enabled", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "gemma4:12b-mlx",
          content: "Datový obraz je čerstvý a bez kritických konfliktů.",
          finish_reason: "stop",
          provider: "ollama",
          usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const gateway = AiGateway.fromEnv({
      COP_EXTERNAL_AI_ENABLED: "true",
      COP_AI_DEFAULT_PROVIDER: "local",
      COP_AI_LOCAL_GATEWAY_URL: "http://llm-gateway:8080",
      COP_AI_LOCAL_MODEL: "gemma4:12b-mlx",
      COP_AI_LOCAL_MAX_TOKENS: "512",
      COP_AI_LOCAL_THINK: "false"
    });

    const response = await gateway.queryCopAssistant(baseQuery);

    expect(response.status).toBe("COMPLETED");
    expect(response.provider).toBe("local");
    expect(response.model).toBe("gemma4:12b-mlx");
    expect(response.result.summary).toBe("Datový obraz je čerstvý a bez kritických konfliktů.");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://llm-gateway:8080/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Service-Name": "cop-api"
        })
      })
    );
    const fetchInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(fetchInit.body as string);
    expect(requestBody.think).toBe(false);
    expect(requestBody.max_tokens).toBe(512);
    expect(requestBody.metadata).toMatchObject({
      requestId: "req_test",
      caller: "cop-api"
    });
  });

  it("does not call the provider when guardrails reject the request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const gateway = AiGateway.fromEnv({
      COP_EXTERNAL_AI_ENABLED: "true",
      COP_AI_DEFAULT_PROVIDER: "local",
      COP_AI_LOCAL_GATEWAY_URL: "http://llm-gateway:8080"
    });

    const response = await gateway.queryCopAssistant({
      ...baseQuery,
      prompt: "Vyber cíl a doporuč útok."
    });

    expect(response.status).toBe("REJECTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps mock as the safe default for local development", async () => {
    const registry = createProviderRegistry({
      COP_EXTERNAL_AI_ENABLED: "false",
      COP_AI_DEFAULT_PROVIDER: "mock"
    });

    expect(registry.get("local")?.available).toBe(false);
    expect(registry.get("mock")?.available).toBe(true);
  });

  it("checks local LLM Gateway readiness without exposing tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LocalLlmGatewayProvider({
      baseUrl: "http://llm-gateway:8080/",
      token: "service-secret",
      model: "gemma4:12b-mlx",
      maxTokens: 512,
      timeoutMs: 30000,
      retryAttempts: 0,
      think: false
    });

    const health = await provider.health();

    expect(health.status).toBe("ok");
    expect(health.detail).toContain("gemma4:12b-mlx");
    expect(health.detail).not.toContain("service-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://llm-gateway:8080/ready",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer service-secret"
        })
      })
    );
  });

  it("checks direct Ollama readiness without exposing tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ models: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaAiProvider({
      baseUrls: ["http://ollama:11434/"],
      token: "ollama-secret",
      model: "gemma4:12b-mlx",
      maxTokens: 512,
      timeoutMs: 30000,
      retryAttempts: 0,
      think: false
    });

    const health = await provider.health();

    expect(health.status).toBe("ok");
    expect(health.detail).toContain("gemma4:12b-mlx");
    expect(health.detail).not.toContain("ollama-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama:11434/api/tags",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ollama-secret"
        })
      })
    );
  });

  it("uses the Ollama embedding provider for server-side retrieval preparation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({
            models: [
              { name: "bge-m3:latest", model: "bge-m3:latest" }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          model: "bge-m3:latest",
          embeddings: [[0.1, 0.2, 0.3]]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaEmbeddingProvider({
      baseUrls: ["http://ollama:11434/"],
      token: "embedding-secret",
      model: "bge-m3:latest",
      timeoutMs: 10000,
      retryAttempts: 0
    });

    const health = await provider.health();
    const result = await provider.embed("COP situační dotaz");

    expect(health.status).toBe("ok");
    expect(health.detail).toContain("bge-m3:latest");
    expect(health.detail).not.toContain("embedding-secret");
    expect(result).toEqual({
      embedding: [0.1, 0.2, 0.3],
      model: "bge-m3:latest"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama:11434/api/embed",
      expect.objectContaining({
        body: JSON.stringify({ model: "bge-m3:latest", input: "COP situační dotaz" }),
        method: "POST"
      })
    );
  });
});
