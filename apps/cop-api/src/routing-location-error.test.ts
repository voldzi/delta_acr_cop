import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { RoutingSourceAdapter, type RoutingRouteRequest } from "./routing-source.js";

const endpoints = ["route", "alternatives"] as const;
const baseRequest: RoutingRouteRequest = {
  profileId: "car",
  alternatives: 1,
  from: { lat: 50, lon: 14, label: "synthetic-from-marker" },
  to: { lat: 50.1, lon: 14.1, label: "synthetic-to-marker" }
};
const requests: Array<{ name: string; request: RoutingRouteRequest }> = [
  { name: "ordinary", request: baseRequest },
  {
    name: "mapped",
    request: {
      ...baseRequest,
      vehicleProfile: {
        version: "sim-mapped-road-profile-v1",
        intent: "car",
        coverageAcknowledged: "mapped_restrictions_incomplete"
      }
    }
  },
  {
    name: "strict",
    request: {
      ...baseRequest,
      avoid: ["road_closure"],
      trip: {
        version: "sim-road-trip-v1",
        requestId: "00000000-0000-4000-8000-000000000001",
        intent: "car",
        vehicle: { heightM: 1.7, widthM: 1.8, lengthM: 4.4, loadedWeightKg: 1650, trailer: { attached: false } },
        departure: { mode: "now" },
        preferences: { avoidTolls: false, preferPaved: true },
        requirements: { roadClosures: "mandatory", legalAccess: "mandatory", vehicleLimits: "mandatory" },
        waypoints: [],
        destination: { kind: "road_point" }
      }
    }
  }
];

beforeEach(() => {
  vi.stubEnv("COP_AUTH_MODE", "lab");
  vi.stubEnv("COP_ALLOW_LAB_TOKEN", "true");
  vi.stubEnv("COP_LAB_TOKEN", "synthetic-location-test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function source(): RoutingSourceAdapter {
  return new RoutingSourceAdapter({ baseUrl: "https://private-sim.test/api/v1", enabled: true, timeoutMs: 1000 });
}

function upstreamFailure(status: number, code?: string): Response {
  return new Response(JSON.stringify({
    error: {
      ...(code ? { code } : {}),
      message: "synthetic-engine-diagnostic-171 https://private-sim.test synthetic-from-marker synthetic-to-marker",
      correlationId: "upstream-correlation-must-not-replace-cop",
      error_code: 171,
      locationIndex: 1,
      target: true
    },
    routes: [{ routeId: "untrusted-error-route", geometry: { type: "LineString", coordinates: [[14, 50], [14.1, 50.1]] } }],
    vehicleProfileAssessment: { state: "applied" },
    knownClosures: { state: "applied" }
  }), { status, headers: { "content-type": "application/json" } });
}

describe("SIM location error through the COP adapter and handler", () => {
  it.each(endpoints.flatMap(endpoint => requests.map(({ name, request }) => ({ endpoint, name, request }))))(
    "preserves 422 and COP correlation without a substitute route for $endpoint / $name",
    async ({ endpoint, name, request }) => {
      const sent: RoutingRouteRequest[] = [];
      const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        expect(String(input)).toBe("https://private-sim.test/api/v1/routing/alternatives");
        expect(init?.method).toBe("POST");
        sent.push(JSON.parse(String(init?.body)) as RoutingRouteRequest);
        return upstreamFailure(422, "ROUTING_LOCATION_NOT_ROUTABLE");
      });
      vi.stubGlobal("fetch", fetchMock);
      const app = buildServer({ routingSource: source() });
      const correlationId = `location-${endpoint}-${name}`;
      try {
        const response = await app.inject({
          method: "POST", url: `/api/v1/routing/${endpoint}`,
          headers: { authorization: "Bearer synthetic-location-test-token", "x-correlation-id": correlationId },
          payload: request
        });
        expect(response.statusCode).toBe(422);
        expect(response.json()).toEqual({ error: {
          code: "ROUTING_LOCATION_NOT_ROUTABLE",
          message: "SIM cannot currently satisfy the requested routing requirements.",
          correlationId
        } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sent).toHaveLength(1);
        expect(sent[0]?.profileId).toBe(request.profileId);
        expect(sent[0]?.avoid).toEqual(request.avoid);
        expect(sent[0]?.vehicleProfile).toEqual(request.vehicleProfile);
        expect(sent[0]?.trip).toEqual(request.trip);
        for (const marker of ["private-sim.test", "synthetic-engine-diagnostic", "171", "synthetic-from-marker",
          "synthetic-to-marker", "locationIndex", "target", "routes", "Assessment", "knownClosures", "upstream-correlation"]) {
          expect(response.body).not.toContain(marker);
        }
      } finally { await app.close(); }
    }
  );

  it.each(endpoints)("rejects an anonymous %s before calling the provider", async endpoint => {
    const fetchMock = vi.fn(async () => upstreamFailure(422, "ROUTING_LOCATION_NOT_ROUTABLE"));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({ routingSource: source() });
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/routing/${endpoint}`,
        headers: { "x-correlation-id": "anonymous-location-fixture" }, payload: baseRequest });
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toMatchObject({ code: "UNAUTHORIZED", correlationId: "anonymous-location-fixture" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(response.json()).not.toHaveProperty("routes");
    } finally { await app.close(); }
  });

  it.each(endpoints.flatMap(endpoint => [
    { endpoint, status: 502, code: "ROUTING_KNOWN_CLOSURES_ENGINE_FAILED" },
    { endpoint, status: 502, code: "ROUTING_KNOWN_CLOSURES_INVALID" },
    { endpoint, status: 503, code: "ROUTING_KNOWN_CLOSURES_UNAVAILABLE" }
  ]))("does not reclassify protective $status / $code at $endpoint", async ({ endpoint, status, code }) => {
    const fetchMock = vi.fn(async () => upstreamFailure(status, code));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({ routingSource: source() });
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/routing/${endpoint}`,
        headers: { authorization: "Bearer synthetic-location-test-token", "x-correlation-id": "protective-location-fixture" },
        payload: baseRequest });
      expect(response.statusCode).toBe(status);
      expect(response.json().error).toMatchObject({ code, correlationId: "protective-location-fixture" });
      expect(response.body).not.toContain("ROUTING_LOCATION_NOT_ROUTABLE");
      expect(response.json()).not.toHaveProperty("routes");
      expect(response.json()).not.toHaveProperty("knownClosures");
      expect(response.body).not.toContain("synthetic-engine-diagnostic");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

  it.each(endpoints)("does not translate a raw Valhalla 171 at %s", async endpoint => {
    const fetchMock = vi.fn(async () => upstreamFailure(400));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({ routingSource: source() });
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/routing/${endpoint}`,
        headers: { authorization: "Bearer synthetic-location-test-token" }, payload: baseRequest });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("ROUTING_REQUIREMENTS_UNAVAILABLE");
      expect(response.body).not.toContain("ROUTING_LOCATION_NOT_ROUTABLE");
      expect(response.body).not.toContain("171");
      expect(response.json()).not.toHaveProperty("routes");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
