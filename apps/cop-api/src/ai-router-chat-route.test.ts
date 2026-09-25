import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";

const path = "/api/v1/ai/chat-agent/reviewed-synthetic";
const allowed = { scenarioId: "flood-central-bohemia", intent: "summarize" };

function enablePilot() {
  vi.stubEnv("COP_AI_CHAT_ROUTER_ENABLED", "true");
  vi.stubEnv("COP_AI_ROUTER_URL", "http://ai-router-api:4050");
  vi.stubEnv("COP_AI_ROUTER_TOKEN", "cop-dedicated-token-at-least-thirty-two-characters");
  vi.stubEnv("COP_AI_CHAT_ROUTER_USER_ID_SECRET", "stable-private-user-id-hmac-key-32-characters");
}

const auth = { authorization: "Bearer dev-lab-token" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reviewed synthetic chat route", () => {
  it("authenticates users and sends only server-owned exercise facts", async () => {
    enablePilot();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "router-1", model: "gpt-6-luna", tier: "external_economy",
      output: "Jde o cvičení.", usage: { inputTokens: 40, outputTokens: 8, estimatedMicrousd: 10 },
      requiresHumanReview: true
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    try {
      expect((await app.inject({ method: "POST", url: path, payload: allowed })).statusCode).toBe(401);
      const bad = await app.inject({ method: "POST", url: path, headers: auth,
        payload: { ...allowed, chatContext: { privateMessage: "TAJNÉ" } } });
      expect(bad.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      const good = await app.inject({ method: "POST", url: path, headers: auth, payload: allowed });
      expect(good.statusCode).toBe(200);
      expect(good.json().model).toBe("gpt-6-luna");
      const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(sent.dataClass).toBe("synthetic");
      expect(sent.allowExternal).toBe(true);
      expect(sent.copContext.facts.every((fact: string) => fact.includes("Fiktivní") || fact.includes("Cvičný") || fact.includes("simulované"))).toBe(true);
      expect(JSON.stringify(sent)).not.toContain("TAJNÉ");
    } finally { await app.close(); }
  });

  it("fails closed on Router limit and outage", async () => {
    enablePilot();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    try {
      expect((await app.inject({ method: "POST", url: path, headers: auth, payload: allowed })).statusCode).toBe(429);
      expect((await app.inject({ method: "POST", url: path, headers: auth, payload: allowed })).statusCode).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });
});
