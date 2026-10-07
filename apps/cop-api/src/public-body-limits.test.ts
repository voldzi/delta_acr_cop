import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";

afterEach(() => vi.unstubAllEnvs());

describe("public JSON request limits", () => {
  it.each([
    { url: "/api/v1/map/query", maxBytes: 64 * 1024 },
    { url: "/_matrix/push/v1/notify", maxBytes: 256 * 1024 },
    { url: "/api/v1/auth/logout", maxBytes: 1024 }
  ])("rejects an oversized unauthenticated body at $url before the handler", async ({ url, maxBytes }) => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    vi.stubEnv("COP_API_BODY_LIMIT_BYTES", "536870912");
    const app = buildServer();
    try {
      const response = await app.inject({
        method: "POST", url, headers: { "x-correlation-id": "synthetic-body-limit" },
        payload: { padding: "x".repeat(maxBytes) }
      });
      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE", correlationId: "synthetic-body-limit" } });
    } finally {
      await app.close();
    }
  });

  it("still authenticates protected large uploads before the body-limit parser", async () => {
    vi.stubEnv("COP_API_BODY_LIMIT_BYTES", "1024");
    const app = buildServer();
    try {
      const response = await app.inject({
        method: "POST", url: "/api/v1/community/reports", payload: { padding: "x".repeat(2048) }
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("UNAUTHORIZED");
    } finally {
      await app.close();
    }
  });
});
