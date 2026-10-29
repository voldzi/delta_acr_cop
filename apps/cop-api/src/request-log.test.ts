import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { safeRequestLog } from "./request-log.js";
import { registerDriverMeasurementRoutes } from "./routes/driver-measurement-routes.js";
import { registerPlanningOriginRoutes } from "./routes/routing-planning-routes.js";

describe("operational request log", () => {
  it("does not log planning coordinates, identities, IPs or malformed request text", async () => {
    const lines: string[] = [];
    const app = Fastify({ logger: { serializers: { req: safeRequestLog }, stream: { write(line: string) { lines.push(line); } } } });
    registerPlanningOriginRoutes(app, { now: () => new Date() });
    try {
      const malformed = await app.inject({ method: "POST", url: "/api/v1/routing/planning-origin/candidates?lat=PRIVATE_COORDINATE",
        remoteAddress: "198.51.100.27", headers: { "content-type": "application/json", authorization: "Bearer PRIVATE_TOKEN", "x-cop-planning-actor": "PRIVATE_ACTOR" },
        payload: "PRIVATE_REQUEST_BODY" });
      expect(malformed.statusCode).toBe(400); expect(malformed.body).not.toContain("PRIVATE_");
      const large = await app.inject({ method: "POST", url: "/api/v1/routing/planning-origin/preview", payload: { content: "PRIVATE_REQUEST_BODY".repeat(2000) } });
      expect(large.statusCode).toBe(413);
      const output = lines.join("");
      for (const value of ["PRIVATE_", "198.51.100.27"]) expect(output).not.toContain(value);
      expect(safeRequestLog({ method: "POST", url: "/api/v1/routing/planning-origin/PRIVATE_ACCOUNT" })).toEqual({
        method: "POST", url: "/api/v1/routing/planning-origin/[redacted]" });
    } finally { await app.close(); }
  });
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

  it("records no IP, port, headers or free path segments for measurement requests", () => {
    const base = { method: "POST", headers: { "accept-version": "private-header" }, host: "private-host",
      ip: "198.51.100.27", socket: { remotePort: 12345 } };
    expect(safeRequestLog({ ...base, url: "/api/v1/driver-measurements/v1/batches?lat=50.1" })).toEqual({
      method: "POST", url: "/api/v1/driver-measurements/v1/batches"
    });
    expect(safeRequestLog({ ...base, url: "/api/v1/driver-measurements/private-account" })).toEqual({
      method: "POST", url: "/api/v1/driver-measurements/[redacted]"
    });
  });

  it("sanitizes malformed measurement JSON and bounds consent bodies without logging request content", async () => {
    const lines: string[] = [];
    const app = Fastify({ logger: { serializers: { req: safeRequestLog }, stream: { write(line: string) { lines.push(line); } } } });
    registerDriverMeasurementRoutes(app, { enabled: false, cleanupEnabled: false, oidcClientId: "csm-mobile",
      secret: "", now: () => new Date() });
    try {
      for (const [method, suffix] of [["POST", "consent"], ["DELETE", "consent"], ["POST", "batches"]] as const) {
        const response = await app.inject({ method, url: `/api/v1/driver-measurements/v1/${suffix}`,
          remoteAddress: "198.51.100.27", headers: { "content-type": "application/json", authorization: "Bearer private-token" },
          payload: "private-gps-marker" });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("DRIVER_MEASUREMENTS_REQUEST_ERROR");
        expect(response.body).not.toContain("private-gps-marker");
      }
      const large = await app.inject({ method: "POST", url: "/api/v1/driver-measurements/v1/consent",
        payload: { content: "private-gps-marker".repeat(100) } });
      expect(large.statusCode).toBe(413);
      const output = lines.join("");
      for (const value of ["198.51.100.27", "private-token", "private-gps-marker"]) expect(output).not.toContain(value);
      expect(lines.map((line) => JSON.parse(line)).filter((line) => line.req).length).toBeGreaterThan(0);
    } finally { await app.close(); }
  });
});
