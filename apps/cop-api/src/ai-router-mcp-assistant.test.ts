import { afterEach, describe, expect, it, vi } from "vitest";
import { AiRouterMcpAssistant, aiRouterMcpConfig } from "./ai-router-mcp-assistant.js";
import { buildServer } from "./server.js";

const config = { enabled: true, baseUrl: "http://ai-router-api:4050", token: "cop-token-at-least-thirty-two-characters" };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("COP aggregate source-health Router adapter", () => {
  it("is opt-in and requires a dedicated internal service token", () => {
    expect(aiRouterMcpConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(() => aiRouterMcpConfig({ COP_AI_ROUTER_ENABLED: "true", COP_AI_ROUTER_URL: config.baseUrl } as NodeJS.ProcessEnv)).toThrow();
  });

  it("sends only health counts and maps aggregate usage", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: "Dva zdroje vyžadují kontrolu.", model: "gpt-6-luna", requiresHumanReview: true,
        usage: { inputTokens: 50, outputTokens: 20, estimatedMicrousd: 30 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dailyMicrousd: 30, monthlyMicrousd: 30, dailyRequests: 1, monthlyRequests: 1,
        dailyInputTokens: 50, dailyOutputTokens: 20, monthlyInputTokens: 50, monthlyOutputTokens: 20,
        limits: { dailyMicrousd: 1_000_000, monthlyMicrousd: 10_000_000, perUserDailyRequests: 10 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const assistant = new AiRouterMcpAssistant(config);
    const result = await assistant.summarize({ items: [
      { sourceId: "secret-partner", health: "ONLINE", message: "private report" },
      { sourceId: "public", health: "UNAVAILABLE", token: "never-forward" }
    ] }, "operator-1");
    expect(result.summary).toContain("kontrolu");
    expect(result.usage.daily.requests).toBe(1);
    expect(result.usage.daily.limitUsd).toBe(1);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/ai-router/generate");
    const body = JSON.parse(String(options.body));
    expect(body).toMatchObject({ taskType: "source_health", dataClass: "public_aggregate", userId: "operator-1", allowPaidEscalation: false });
    expect(body.prompt).toContain('"sourceCount":2');
    expect(body.prompt).not.toMatch(/secret-partner|private report|never-forward/);
  });

  it("fails closed when the shared budget is exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "daily_budget_exceeded" }), { status: 429 })));
    await expect(new AiRouterMcpAssistant(config).summarize({ items: [] }, "operator-1")).rejects.toThrow("OpenAI MCP usage limit reached.");
  });

  it("keeps the COP route opt-in and fails closed without touching other AI routes", async () => {
    vi.stubEnv("COP_AI_ROUTER_ENABLED", "true");
    vi.stubEnv("COP_AI_ROUTER_URL", config.baseUrl);
    vi.stubEnv("COP_AI_ROUTER_TOKEN", config.token);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: "Stav zdrojů vyžaduje kontrolu.", model: "gpt-6-luna", requiresHumanReview: true,
        usage: { inputTokens: 40, outputTokens: 20, estimatedMicrousd: 25 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dailyMicrousd: 25, monthlyMicrousd: 25, dailyRequests: 1, monthlyRequests: 1,
        dailyInputTokens: 40, dailyOutputTokens: 20, monthlyInputTokens: 40, monthlyOutputTokens: 20,
        limits: { dailyMicrousd: 1_000_000, monthlyMicrousd: 10_000_000, perUserDailyRequests: 10 } }), { status: 200 })));
    const app = buildServer({ now: () => new Date("2026-09-25T10:00:00Z") });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/ai/mcp-assistant/source-health",
        headers: { authorization: "Bearer dev-lab-token" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ summary: "Stav zdrojů vyžaduje kontrolu.", model: "gpt-6-luna", humanReviewRequired: true });
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls).toHaveLength(2);
      expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({ taskType: "source_health", dataClass: "public_aggregate" });
    } finally {
      await app.close();
    }
  });
});
