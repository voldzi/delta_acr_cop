import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createRoutingRequestContext, RoutingSourceAdapter } from "./routing-source.js";
const raw = JSON.parse(readFileSync(new URL("../../../docs/api/examples/mapped-road-profiles-v1.sim-fixture.json", import.meta.url), "utf8"));
const fixture = () => structuredClone(raw.cases[0]);
const cid = "0444D3C6-0707-498D-B52C-8F66EFAD61BC";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const source = () => new RoutingSourceAdapter({ baseUrl: "https://fixture.invalid/api/v1", enabled: true, timeoutMs: 1000 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("server-only opaque routing correlation", () => {
  it.each(["route", "alternatives"])("propagates the authenticated %s UUID without adding identity or changing the route body", async endpoint => {
    const f = fixture();
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json(f.response));
    vi.stubGlobal("fetch", fetch);
    const app = buildServer({ routingSource: source(), now: () => new Date(f.response.generatedAt) });
    try {
      const result = await app.inject({ method: "POST", url: `/api/v1/routing/${endpoint}`, payload: f.request,
        headers: { authorization: "Bearer dev-lab-token", "x-correlation-id": cid } });
      expect(result.statusCode).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(1);
      const init = fetch.mock.calls[0]?.[1]; const headers = new Headers(init?.headers);
      expect(headers.get("x-correlation-id")).toBe(cid);
      expect(headers.get("authorization")).toBeNull(); expect(headers.get("cookie")).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual(f.request);
      expect(result.json().routes).toEqual(f.response.routes);
    } finally { await app.close(); }
  });
  it.each(["ROUTING_RESTRICTIONS_RELAXATION_REQUIRED", "ROUTING_PRIVATE_CANARY"])("logs only fixed rejection metadata and retains the existing public error envelope (%s)", async code => {
    const f = fixture(); f.request.from.label = "PRIVATE_LOCATION_CANARY";
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({
      error: { code, message: "PRIVATE_PROVIDER_TEXT_CANARY" }
    }, { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    const app = buildServer({ routingSource: source() }); const info = vi.spyOn(app.log, "info");
    try {
      const result = await app.inject({ method: "POST", url: "/api/v1/routing/route", payload: f.request,
        headers: { authorization: "Bearer dev-lab-token", "x-correlation-id": cid } });
      expect(result.statusCode).toBe(422); expect(result.json().error.correlationId).toBe(cid);
      expect(result.json()).not.toHaveProperty("routes"); expect(result.json()).not.toHaveProperty("diagnostic");
      const event = info.mock.calls.find(call => call[1] === "SIM routing requirements rejected.");
      expect(event?.[0]).toEqual({ routingCorrelationId: cid, upstreamStatus: 422, routingCode: code === "ROUTING_RESTRICTIONS_RELAXATION_REQUIRED" ? code : "OTHER_REJECTION" });
      expect(JSON.stringify(event)).not.toContain("CANARY");
      expect(JSON.stringify(event)).not.toContain("vehicleProfile");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it("substitutes an opaque UUID upstream for a legacy non-UUID correlation without changing its public echo", async () => {
    const f = fixture();
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ error: { code: "ROUTING_REQUIREMENTS_UNAVAILABLE" } }, { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    const app = buildServer({ routingSource: source() });
    try {
      const result = await app.inject({ method: "POST", url: "/api/v1/routing/route", payload: f.request,
        headers: { authorization: "Bearer dev-lab-token", "x-correlation-id": "legacy-CANARY" } });
      expect(result.statusCode).toBe(422); expect(result.json().error.correlationId).toBe("legacy-CANARY");
      const upstream = new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-correlation-id");
      expect(upstream).toMatch(uuid); expect(upstream).not.toContain("CANARY");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it("does not contact SIM for an unauthenticated request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const app = buildServer({ routingSource: source() });
    try {
      const result = await app.inject({ method: "POST", url: "/api/v1/routing/route", payload: fixture().request, headers: { "x-correlation-id": cid } });
      expect(result.statusCode).toBe(401); expect(fetch).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each(["route", "alternatives"])("preserves the original %s rejection when diagnostic logging throws", async endpoint => {
    const fetch = vi.fn(async () => Response.json({ error: { code: "ROUTING_RESTRICTIONS_RELAXATION_REQUIRED" } }, { status: 422 }));
    vi.stubGlobal("fetch", fetch); const app = buildServer({ routingSource: source() });
    const info = vi.spyOn(app.log, "info").mockImplementation((...args: unknown[]) => {
      if (args[1] === "SIM routing requirements rejected.") throw new Error("SYNTHETIC_LOG_FAILURE");
    });
    try {
      const result = await app.inject({ method: "POST", url: `/api/v1/routing/${endpoint}`, payload: fixture().request,
        headers: { authorization: "Bearer dev-lab-token", "x-correlation-id": cid } });
      expect(result.statusCode).toBe(422);
      expect(result.json().error.code).toBe("ROUTING_RESTRICTIONS_RELAXATION_REQUIRED");
      expect(result.json().error.correlationId).toBe(cid);
      expect(result.json()).not.toHaveProperty("routes");
      expect(JSON.stringify(result.json())).not.toContain("SYNTHETIC_LOG_FAILURE");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(info.mock.calls.filter(call => call[1] === "SIM routing requirements rejected.")).toHaveLength(1);
    } finally { await app.close(); }
  });
  it("rejects a forged context header at the adapter boundary", async () => {
    const f = fixture(); const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json(f.response));
    vi.stubGlobal("fetch", fetch);
    await source().route(f.request, new Date(f.response.generatedAt), { correlationId: "bad\r\nCookie: CANARY" });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-correlation-id")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps valid UUIDs and generates a new bounded UUID for malformed or oversized input", () => {
    expect(createRoutingRequestContext(cid)).toEqual({ correlationId: cid });
    for (const value of ["", "CANARY", "a".repeat(100000), `${cid}\n`]) {
      const result = createRoutingRequestContext(value);
      expect(result.correlationId).toMatch(uuid); expect(result.correlationId).toHaveLength(36);
    }
  });
});
