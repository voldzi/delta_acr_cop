import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopByokError, CopByokRouterClient } from "./ai-router-byok.js";
import { buildServer } from "./server.js";

const config = {
  baseUrl: "http://ai-router-api:4050",
  token: "cop-dedicated-service-token-at-least-32-characters",
  userIdSecret: "stable-user-id-secret-at-least-32-characters",
  actorSecret: "separate-actor-secret-at-least-32-characters"
};
const keyA = `sk-proj-${"a".repeat(40)}`;
const keyB = `sk-proj-${"b".repeat(40)}`;
const auth = { authorization: "Bearer dev-lab-token" };

function enable() {
  vi.stubEnv("COP_AI_CHAT_BYOK_ENABLED", "true");
  vi.stubEnv("COP_AI_CHAT_BYOK_ROUTING_ENABLED", "true");
  vi.stubEnv("COP_AI_ROUTER_URL", config.baseUrl);
  vi.stubEnv("COP_AI_ROUTER_TOKEN", config.token);
  vi.stubEnv("COP_AI_CHAT_ROUTER_USER_ID_SECRET", config.userIdSecret);
  vi.stubEnv("COP_AI_ROUTER_ACTOR_SECRET", config.actorSecret);
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("COP BYOK Router contract", () => {
  it("signs distinct opaque users and isolates add, replace and delete without copying a key into responses", async () => {
    const keys = new Map<string, string>();
    const seen = new Set<string>();
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const actor = headers["x-cop-actor"]!;
      expect(headers["x-cop-actor-signature"]).toBe(createHmac("sha256", config.actorSecret).update(actor).digest("hex"));
      const assertion = JSON.parse(Buffer.from(actor, "base64url").toString("utf8"));
      expect(Object.keys(assertion).sort()).toEqual(["aud", "exp", "iat", "sub"]);
      expect(assertion.aud).toBe("sim-ai-router");
      expect(assertion.exp - assertion.iat).toBe(60);
      expect(assertion.sub).toMatch(/^cop_[A-Za-z0-9_-]+$/u);
      seen.add(assertion.sub);
      expect(headers.authorization).toBe(`Bearer ${config.token}`);
      if (init.method === "PUT") {
        const body = JSON.parse(String(init.body));
        expect(Object.keys(body)).toEqual(["apiKey"]);
        keys.set(assertion.sub, body.apiKey);
        return new Response(JSON.stringify({ configured: true }), { status: 200 });
      }
      if (init.method === "DELETE") {
        keys.delete(assertion.sub);
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ configured: keys.has(assertion.sub) }), { status: 200 });
    }));
    const client = new CopByokRouterClient(config);
    expect(await client.putKey("user-a", keyA)).toEqual({ configured: true });
    expect(await client.putKey("user-b", keyB)).toEqual({ configured: true });
    expect(keys.size).toBe(2);
    expect(new Set(keys.values())).toEqual(new Set([keyA, keyB]));
    expect(await client.putKey("user-a", keyB)).toEqual({ configured: true });
    expect(await client.deleteKey("user-a")).toEqual({ configured: false });
    expect(await client.status("user-a")).toEqual({ configured: false });
    expect(await client.status("user-b")).toEqual({ configured: true });
    expect(seen.size).toBe(2);
  });

  it("sends the exact authored question and no private or browser-selected context, key, payer or model", async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => new Response(JSON.stringify({
      requestId: "8fcb2f75-95dc-4a62-b10e-163833f4d35c", billingSource: "user_openai_key",
      model: "gpt-6-luna", output: "Odpověď", requiresHumanReview: true,
      usage: { inputTokens: 12, outputTokens: 5, estimatedMicrousd: 42, actualProviderChargesVerified: false }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CopByokRouterClient(config);
    await client.chat("user-a", "  Jak postupovat?  ");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://ai-router-api:4050/api/v1/ai-router/cop/chat");
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent).toEqual({ contractVersion: "cop-chat-byok-v1", billingSource: "user_openai_key",
      question: "  Jak postupovat?  ", allowExternal: true });
    expect(JSON.stringify(sent)).not.toContain(keyA);
    await expect(client.chat("user-a", "test", { items: [] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed for bad identity, 422, 429 and outages", async () => {
    const client = new CopByokRouterClient(config);
    await expect(client.chat("", "hello")).rejects.toMatchObject({ code: "invalid_input" });
    for (const [status, code] of [[422, "key_unavailable"], [429, "limit_reached"], [503, "router_unavailable"]] as const) {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(client.chat("user-a", "hello")).rejects.toMatchObject({ code });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(client.chat("user-a", "hello")).rejects.toBeInstanceOf(CopByokError);
  });

  it("keeps the single chat disabled until routing flag and uses no fallback when enabled", async () => {
    enable();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    try {
      expect((await app.inject({ method: "GET", url: "/api/v1/ai/chat-agent/credential" })).statusCode).toBe(401);
      const response = await app.inject({ method: "POST", url: "/api/v1/ai/chat-agent/query", headers: auth,
        payload: { question: "Pomoc", chatContext: [{ text: "Private" }], modelPreference: "reasoning" } });
      expect(response.statusCode).toBe(429);
      const forbidden = await app.inject({ method: "POST", url: "/api/v1/ai/chat-agent/query", headers: auth,
        payload: { question: "Pomoc", automaticContext: { items: [{ kind: "chat_message", text: "Private" }] } } });
      expect(forbidden.statusCode).toBe(400);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
        contractVersion: "cop-chat-byok-v1", billingSource: "user_openai_key", question: "Pomoc", allowExternal: true
      });
    } finally { await app.close(); }
  });

  it("does not enable other Router chat routes when only credential management is staged", async () => {
    enable();
    vi.stubEnv("COP_AI_CHAT_BYOK_ROUTING_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/ai/chat-agent/reviewed-general",
        headers: auth, payload: { topic: "power_outage" } });
      expect(response.statusCode).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("relays credential changes through COP API without returning the key", async () => {
    enable();
    vi.stubEnv("COP_AI_CHAT_BYOK_ROUTING_ENABLED", "false");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    const path = "/api/v1/ai/chat-agent/credential";
    try {
      expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: path, headers: auth })).json()).toEqual({
        available: true, configured: false, provider: "openai", routingEnabled: false
      });
      const saved = await app.inject({ method: "PUT", url: path, headers: auth, payload: { apiKey: keyA } });
      expect(saved.statusCode).toBe(200);
      expect(saved.body).not.toContain(keyA);
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ apiKey: keyA });
      const deleted = await app.inject({ method: "DELETE", url: path, headers: auth });
      expect(deleted.json()).toMatchObject({ configured: false, routingEnabled: false });
      expect(deleted.body).not.toContain(keyA);
    } finally { await app.close(); }
  });
});
