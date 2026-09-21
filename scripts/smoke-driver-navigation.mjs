import assert from "node:assert/strict";
import { createRoutingSourceFromEnv } from "../apps/cop-api/dist/routing-source.js";
const headers = { authorization: `Bearer ${process.env.COP_LAB_TOKEN}`, "content-type": "application/json" };
const source = createRoutingSourceFromEnv();
assert(source);
for (const path of ["/health/live", "/health/ready", "/health/dependencies"]) {
  const r = await fetch(`http://127.0.0.1:4310${path}`, { signal: AbortSignal.timeout(20000) });
  assert.equal(r.status, 200, path);
  const data = await r.json();
  console.log(
    JSON.stringify({
      check: path,
      status: r.status,
      health: data.status,
      dependencies: data.dependencies?.map((d) => ({ name: d.name, status: d.status }))
    })
  );
  const text = JSON.stringify(data);
  assert(!text.includes("valhalla.home.cz"));
  assert(!text.includes("docker.home.cz:5020"));
}
const request = {
  from: { lat: 50.075, lon: 14.438 },
  to: { lat: 50.1, lon: 14.48 },
  profileId: "car",
  includeSteps: true,
  alternatives: 3
};
const r = await fetch("http://127.0.0.1:4310/api/v1/routing/route", {
  method: "POST",
  headers,
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(60000)
});
assert.equal(r.status, 200);
const cop = await r.json();
const serializedRoute = JSON.stringify(cop);
assert(!serializedRoute.includes(source.config.baseUrl), "internal SIM endpoint is not public route data");
assert(!serializedRoute.includes("valhalla.home.cz"), "internal Valhalla endpoint is not public route data");
if (process.env.COP_LAB_TOKEN) assert(!serializedRoute.includes(process.env.COP_LAB_TOKEN), "token is not route data");
const sim = await source.route(request, new Date());
assert(cop.routes?.length > 0);
assert.equal(cop.generatedAt, sim.generatedAt, "compare same cached snapshot");
const fields = [
  "enabled",
  "state",
  "updatedAt",
  "sourceObservedAt",
  "ageSeconds",
  "appliedFlowCount",
  "appliedEdgeCount",
  "mappingCoveragePercent",
  "routingDataset",
  "detail"
];
for (const route of cop.routes) {
  assert(route.durationSeconds > 0);
  assert.equal(route.quality.mode, "engine_route");
  assert.equal(route.quality.engine, "valhalla");
  assert(["ok", "partial"].includes(route.status));
  assert(route.geometry.coordinates.length > 1);
  assert(route.steps.length > 0);
  let end = 0;
  for (const step of route.steps) {
    assert.equal(step.beginShapeIndex, end, "contiguous global shape indices");
    assert(Number.isInteger(step.endShapeIndex));
    assert(step.endShapeIndex >= end);
    assert(step.endShapeIndex < route.geometry.coordinates.length);
    assert(Number.isInteger(step.maneuverType));
    end = step.endShapeIndex;
  }
  assert.equal(end, route.geometry.coordinates.length - 1, "steps cover complete geometry");
  const upstream = sim.routes.find((x) => x.routeId === route.routeId);
  assert(upstream);
  assert.equal(route.durationSeconds, upstream.durationSeconds, "SIM traffic time counted once");
  for (const field of fields)
    assert.deepEqual(
      (route.traffic?.liveSpeeds ?? cop.traffic?.liveSpeeds)?.[field],
      (upstream.traffic?.liveSpeeds ?? sim.traffic?.liveSpeeds)?.[field]
    );
}
const live = cop.traffic?.liveSpeeds ?? cop.routes[0].traffic?.liveSpeeds;
console.log(
  JSON.stringify({
    check: "native-navigation-contract",
    routes: cop.routes.length,
    distanceM: cop.routes[0].distanceM,
    durationSeconds: cop.routes[0].durationSeconds,
    vertices: cop.routes[0].geometry.coordinates.length,
    steps: cop.routes[0].steps.length,
    liveState: live?.state,
    coverage: live?.mappingCoveragePercent,
    ageSeconds: live?.ageSeconds,
    sameSnapshot: true
  })
);
const match = await source.nearestAccess(
  { profileId: "car", point: request.from, radiusM: 50, includeRoadMatch: true, headingDeg: 90 },
  new Date()
);
assert.equal(match.roadMatch?.contractVersion, "sim-road-match-v1");
assert(["matched", "ambiguous", "unavailable"].includes(match.roadMatch.state));
assert(match.roadMatch.matchedAt);
if (match.roadMatch.state === "matched") {
  assert(match.roadMatch.routingDataset);
  assert.match(match.roadMatch.candidate.directedEdgeId, /^\d+$/);
}
console.log(
  JSON.stringify({
    check: "directed-road-evidence",
    state: match.roadMatch.state,
    dataset: match.roadMatch.routingDataset,
    reason: match.roadMatch.reason
  })
);
