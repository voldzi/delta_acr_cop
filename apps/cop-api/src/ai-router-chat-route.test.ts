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

describe("ordinary COP chat through local Router", () => {
  it("uses an authenticated local-only request with bounded visible context and no invented citations", async () => {
    enablePilot();
    vi.stubEnv("COP_AI_CHAT_ROUTER_FULL_ENABLED", "true");
    vi.stubEnv("COP_AI_SEMANTIC_RETRIEVAL_ENABLED", "false");
    vi.stubEnv("COP_AI_CONTEXT_INDEX_ENABLED", "false");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "router-local-1", model: "gemma4:12b-mlx", tier: "local_fast",
      output: "Lokální odpověď k viditelné zprávě.", usage: { inputTokens: 80, outputTokens: 12, estimatedMicrousd: 0 },
      requiresHumanReview: true
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/ai/chat-agent/query", headers: auth,
        payload: { question: "Co říká předchozí zpráva?", chatContext: {
          source: "browser-visible-decrypted-timeline", encrypted: true,
          messages: [{ body: "Viditelná soukromá zpráva", senderDisplayName: "Operátor", eventId: "secret-event-id", attachment: "SECRET_ATTACHMENT" }]
        } } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "NEEDS_HUMAN_REVIEW", provider: "local", model: "gemma4:12b-mlx" });
      expect(JSON.stringify(response.json())).not.toContain("citations");
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/v1/ai-router/generate"));
      expect(call).toBeTruthy();
      const sent = JSON.parse(String(call?.[1]?.body));
      expect(sent).toMatchObject({ dataClass: "internal", preference: "local", allowExternal: false,
        copContext: { attestation: "cop-internal-reviewed-v1" } });
      expect(JSON.stringify(sent)).toContain("Viditelná soukromá zpráva");
      expect(JSON.stringify(sent)).not.toContain("SECRET_ATTACHMENT");
      expect(JSON.stringify(sent)).not.toContain("secret-event-id");
    } finally { await app.close(); }
  });

  it("returns Router limit and outage errors without using another provider", async () => {
    enablePilot();
    vi.stubEnv("COP_AI_CHAT_ROUTER_FULL_ENABLED", "true");
    vi.stubEnv("COP_AI_SEMANTIC_RETRIEVAL_ENABLED", "false");
    vi.stubEnv("COP_AI_CONTEXT_INDEX_ENABLED", "false");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockRejectedValueOnce(new Error("router offline"));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    const payload = { question: "Zkušební interní dotaz" };
    try {
      expect((await app.inject({ method: "POST", url: "/api/v1/ai/chat-agent/query", headers: auth, payload })).statusCode).toBe(429);
      expect((await app.inject({ method: "POST", url: "/api/v1/ai/chat-agent/query", headers: auth, payload })).statusCode).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });
});
