import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";

describe("COP web BFF session", () => {
  const previousEnabled = process.env.COP_WEB_BFF_SESSION_ENABLED;

  afterEach(() => {
    if (previousEnabled === undefined) delete process.env.COP_WEB_BFF_SESSION_ENABLED;
    else process.env.COP_WEB_BFF_SESSION_ENABLED = previousEnabled;
  });

  it("returns only profile metadata and never an OAuth token", async () => {
    process.env.COP_WEB_BFF_SESSION_ENABLED = "true";
    const sessions = new InMemoryWebSessionStore();
    const record = await sessions.create({
      accessToken: "server-only-access-token",
      accessTokenExpiresAt: new Date(Date.now() + 300_000),
      profile: { name: "COP Operator", subjectId: "operator-1", username: "operator" },
      refreshToken: "server-only-refresh-token"
    }, new Date(Date.now() + 86_400_000));
    const app = buildServer({ webSessionStore: sessions });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/session",
        headers: { cookie: `cop_web_session_v1=${record.sessionId}` }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        authenticated: true,
        expiresAt: record.accessTokenExpiresAt.toISOString(),
        profile: { name: "COP Operator", subjectId: "operator-1", username: "operator" }
      });
      expect(response.body).not.toContain("server-only-access-token");
      expect(response.body).not.toContain("server-only-refresh-token");
    } finally {
      await app.close();
    }
  });
});
