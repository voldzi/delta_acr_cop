import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { safeRequestLog } from "./request-log.js";

describe("operational request log", () => {
  it("keeps request correlation and path without OAuth credentials, media tickets or query data", async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: { serializers: { req: safeRequestLog }, stream: { write(line: string) { lines.push(line); } } }
    });
    app.get("/api/v1/auth/callback", () => ({ ok: true }));
    try {
      await app.inject({
        url: "/api/v1/auth/callback?code=synthetic-oauth-code&state=synthetic-state&mediaToken=synthetic-ticket&lat=50.1",
        headers: { authorization: "Bearer synthetic-bearer", cookie: "session=synthetic-cookie" }
      });
      const output = lines.join("");
      for (const forbidden of ["synthetic-oauth-code", "synthetic-state", "synthetic-ticket", "50.1", "synthetic-bearer", "synthetic-cookie"]) {
        expect(output).not.toContain(forbidden);
      }
      const requestLog = lines.map((line) => JSON.parse(line)).find((line) => line.req);
      expect(requestLog).toMatchObject({ reqId: expect.any(String), req: { method: "GET", url: "/api/v1/auth/callback" } });
    } finally {
      await app.close();
    }
  });

  it("redacts the bearer credential in a mobile pairing path", () => {
    expect(safeRequestLog({ method: "GET", url: "/mobile/pair/synthetic-invitation?code=secret" })).toMatchObject({
      method: "GET", url: "/mobile/pair/[redacted]"
    });
  });
});
