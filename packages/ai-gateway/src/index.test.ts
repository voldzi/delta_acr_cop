import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGateway, LocalLlmGatewayProvider, createProviderRegistry } from "./index.js";

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
  it("uses the local LLM Gateway provider when enabled", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "gemma4:12b",
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
      COP_AI_LOCAL_MODEL: "gemma4:12b",
      COP_AI_LOCAL_MAX_TOKENS: "512",
      COP_AI_LOCAL_THINK: "false"
    });

    const response = await gateway.queryCopAssistant(baseQuery);

    expect(response.status).toBe("COMPLETED");
    expect(response.provider).toBe("local");
    expect(response.model).toBe("gemma4:12b");
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
      model: "gemma4:12b",
      maxTokens: 512,
      timeoutMs: 30000,
      retryAttempts: 0,
      think: false
    });

    const health = await provider.health();

    expect(health.status).toBe("ok");
    expect(health.detail).toContain("gemma4:12b");
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
});
