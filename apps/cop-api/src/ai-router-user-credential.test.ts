import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";

const path = "/api/v1/ai/chat-agent/credential";
const auth = { authorization: "Bearer dev-lab-token" };

function enableCredentials() {
  vi.stubEnv("COP_AI_CHAT_BYOK_ENABLED", "true");
  vi.stubEnv("COP_AI_ROUTER_URL", "http://ai-router-api:4050");
  vi.stubEnv("COP_AI_ROUTER_TOKEN", "cop-dedicated-token-at-least-thirty-two-characters");
  vi.stubEnv("COP_AI_CHAT_ROUTER_USER_ID_SECRET", "stable-private-user-id-hmac-key-32-characters");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("user-owned AI credential boundary", () => {
  it("is disabled by default and does not contact Router", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    try {
      const status = await app.inject({ method: "GET", url: path, headers: auth });
      expect(status.json()).toEqual({ available: false, configured: false, provider: "openai" });
      expect((await app.inject({ method: "PUT", url: path, headers: auth,
        payload: { apiKey: `sk-proj-${"a".repeat(40)}` } })).statusCode).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("keeps status private and never returns or audits the key", async () => {
    enableCredentials();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: false, provider: "openai" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true, provider: "openai" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: false, provider: "openai" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    const key = `sk-proj-${"a".repeat(40)}`;
    try {
      expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(401);
      const status = await app.inject({ method: "GET", url: path, headers: auth });
      expect(status.json()).toEqual({ available: true, configured: false, provider: "openai" });
      const save = await app.inject({ method: "PUT", url: path, headers: auth, payload: { apiKey: key } });
      expect(save.json()).toEqual({ available: true, configured: true, provider: "openai" });
      expect(save.body).not.toContain(key);
      const remove = await app.inject({ method: "DELETE", url: path, headers: auth });
      expect(remove.json()).toEqual({ available: true, configured: false, provider: "openai" });
      const sent = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
      expect(sent).toMatchObject({ provider: "openai", apiKey: key });
      expect(sent.userId).toMatch(/^cop_[A-Za-z0-9_-]+$/u);
      expect(sent.userId).not.toContain("dev-lab-token");
      expect(JSON.stringify(status.json())).not.toContain(key);
      expect(JSON.stringify(remove.json())).not.toContain(key);
    } finally { await app.close(); }
  });

  it("rejects malformed input and fails closed if Router is down", async () => {
    enableCredentials();
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer();
    try {
      expect((await app.inject({ method: "PUT", url: path, headers: auth,
        payload: { apiKey: "x", extra: "not allowed" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PUT", url: path, headers: auth,
        payload: { apiKey: "x" } })).statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await app.inject({ method: "GET", url: path, headers: auth })).statusCode).toBe(503);
    } finally { await app.close(); }
  });
});
