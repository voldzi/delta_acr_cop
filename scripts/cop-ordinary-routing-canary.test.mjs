import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publicRequests, runOrdinaryPair, safeFailure, executeReviewedManifest } from "./cop-ordinary-routing-canary.mjs";

const baseUrl = "https://synthetic.invalid/api/v1";
const manifest = { schema: "cop-ordinary-adapter-canary-v1", admissionId: "11111111-1111-4111-8111-111111111111",
  baseUrlSha256: createHash("sha256").update(baseUrl).digest("hex") };
const result = request => ({ coverage: { routingDataset: { version: "sim-routing-2026-10-25-1792897718", builtAt: "2026-10-25T03:08:38.000Z" } },
  routes: [{ status: "ok", quality: { mode: "engine_route" },
    mappedProfileAssessment: { state: "applied", appliedProfile: request.vehicleProfile, engine: { fallbackUsed: false }, validUntil: new Date(Date.now() + 60_000).toISOString() },
    knownClosures: { state: "applied", engine: { fallbackUsed: false }, validUntil: new Date(Date.now() + 60_000).toISOString() } }] });
const module = behavior => ({ createRoutingSourceConfigFromEnv: () => ({ enabled: true, baseUrl }),
  createRoutingSourceFromEnv: () => ({ route: async request => behavior(request) }) });
const send = request => fetch(baseUrl + "/routing/alternatives", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
async function withTransport(action) {
  const original = globalThis.fetch;
  let calls = 0;
  const transport = async () => { calls++; return Response.json({}); };
  globalThis.fetch = transport;
  try { await action(() => calls, transport); } finally { globalThis.fetch = original; }
}

test("two fixed public requests match client profile and 1/3 alternative choices without time mutation", () => {
  const requests = publicRequests();
  assert.deepEqual(requests.map(r => r.alternatives), [1, 3]);
  for (const r of requests) {
    assert.equal(r.profileId, "car"); assert.equal(r.includeRoadAttributes, true);
    for (const key of ["departureTime", "arrival", "trip", "avoid", "via"]) assert.equal(Object.hasOwn(r, key), false);
  }
  requests[0].vehicleProfile.vehicle.heightM = 9;
  assert.equal(requests[1].vehicleProfile.vehicle.heightM, 2);
});
test("successful integration records only bounded facts and explicitly excludes HTTP user-auth proof", async () => withTransport(async (calls, transport) => {
  const r = await runOrdinaryPair(module(async request => { await send(request); return result(request); }), manifest);
  assert.equal(calls(), 2); assert.equal(globalThis.fetch, transport);
  assert.equal(r.completed, true); assert.equal(r.publicHttpUserAuthenticationVerified, false);
  assert.equal(r.accountGuardExecuted, false); assert.equal(r.rawPayloadOrResponseExported, false);
  assert.equal(JSON.stringify(r).includes("50.143"), false);
}));
test("a failed route stops before the second case and never exports provider text", async () => withTransport(async calls => {
  let failure;
  try { await runOrdinaryPair(module(async request => { await send(request); throw new Error("PRIVATE_PROVIDER_SENTINEL"); }), manifest); }
  catch (error) { failure = safeFailure(error); }
  assert.equal(calls(), 1); assert.equal(failure.attemptedAdapterRequests, 1);
  assert.equal(JSON.stringify(failure).includes("PRIVATE_PROVIDER_SENTINEL"), false);
}));
test("retry is denied before the transport sees another request", async () => withTransport(async calls => {
  await assert.rejects(runOrdinaryPair(module(async request => { await send(request); await send(request); return result(request); }), manifest),
    error => error.canaryCode === "NO_RETRY_BUDGET");
  assert.equal(calls(), 1);
}));
test("wrong dataset or absent acceptance evidence stops before the second case", async () => withTransport(async calls => {
  await assert.rejects(runOrdinaryPair(module(async request => { await send(request); return { ...result(request), coverage: {} }; }), manifest),
    error => error.canaryCode === "ROUTE_OR_DATASET_INVALID");
  assert.equal(calls(), 1);
}));
test("no credentials can be injected into ordinary requests", async () => withTransport(async calls => {
  await assert.rejects(runOrdinaryPair(module(async request => {
    await fetch(baseUrl + "/routing/alternatives", { method: "POST", headers: { Authorization: "Bearer SYNTHETIC" }, body: JSON.stringify(request) });
    return result(request);
  }), manifest), error => error.canaryCode === "UNEXPECTED_ORDINARY_AUTH");
  assert.equal(calls(), 0);
}));
test("admission/config mismatch is rejected without network and unknown errors are redacted", async () => withTransport(async calls => {
  await assert.rejects(runOrdinaryPair(module(() => { throw new Error(); }), { ...manifest, baseUrlSha256: "0".repeat(64) }));
  assert.equal(calls(), 0);
  assert.equal(safeFailure({ canaryCode: "PRIVATE_PROVIDER_SENTINEL" }).code, "ORDINARY_ADAPTER_CANARY_FAILED");
}));
test("the executable entry rejects a missing installed-module pin before any network", async () => withTransport(async calls => {
  await assert.rejects(executeReviewedManifest(manifest), error => error.canaryCode === "INSTALLED_MODULE_PIN_MISMATCH");
  assert.equal(calls(), 0);
}));
