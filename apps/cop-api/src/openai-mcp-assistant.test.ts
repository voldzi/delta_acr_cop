import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import {
  actualUsdMicros,
  extractResponseText,
  openAiMcpAssistantConfig,
  reservedUsdMicros,
  safeSourceHealthContext
} from "./openai-mcp-assistant.js";

describe("OpenAI MCP assistant safety boundary", () => {
  it("keeps the paid endpoint unavailable without opt-in and requires authentication", async () => {
    const app = buildServer({ now: () => new Date("2026-09-25T10:00:00Z") });
    try {
      const anonymous = await app.inject({ method: "POST", url: "/api/v1/ai/mcp-assistant/source-health" });
      expect(anonymous.statusCode).toBe(401);
      const operator = await app.inject({ method: "POST", url: "/api/v1/ai/mcp-assistant/source-health",
        headers: { authorization: "Bearer dev-lab-token" } });
      expect(operator.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it("never forwards source identifiers, provider details or report text", () => {
    const result = safeSourceHealthContext({
      items: [
        { sourceId: "partner-secret", health: "ONLINE", message: "sensitive report" },
        { sourceId: "sim", health: "UNAVAILABLE", token: "secret" }
      ]
    });
    expect(result).toEqual({ sourceCount: 2, healthCounts: { ONLINE: 1, UNAVAILABLE: 1 } });
    expect(JSON.stringify(result)).not.toMatch(/partner-secret|sensitive report|token|secret/);
  });

  it("rejects invalid configuration before enabling paid calls", () => {
    expect(() => openAiMcpAssistantConfig({ COP_OPENAI_MCP_ENABLED: "true" } as NodeJS.ProcessEnv))
      .toThrow(/requires OPENAI_API_KEY and COP_DATABASE_URL/);
    expect(openAiMcpAssistantConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it("reserves more than measured standard-price usage for a bounded request", () => {
    expect(() => reservedUsdMicros(12_001)).toThrow(/size limit/);
    expect(reservedUsdMicros(500)).toBeGreaterThan(actualUsdMicros(600, 512));
    expect(actualUsdMicros(1_000, 500)).toBe(350);
  });

  it("accepts only bounded output text from a valid Responses API result", () => {
    expect(extractResponseText({ output: [{ content: [{ type: "output_text", text: "  Stav zdrojů je nejistý.  " }] }] }))
      .toBe("Stav zdrojů je nejistý.");
    expect(() => extractResponseText({ output: [{ content: [] }] })).toThrow();
  });
});
