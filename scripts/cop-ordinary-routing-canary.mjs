/** Root-operated adapter integration only; never claims HTTP user authentication. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const modulePath = "/app/apps/cop-api/dist/routing-source.js";
const digest = value => createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(value && typeof value === "object"
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))
  : value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { canaryCode: code }); };
const dataset = { version: "sim-routing-2026-10-25-1792897718", builtAt: "2026-10-25T03:08:38.000Z" };
const failureCodes = new Set(["ADMISSION_REQUIRED", "EXISTING_CONFIG_MISMATCH", "EXISTING_URL_INVALID", "ADAPTER_UNAVAILABLE",
  "NO_RETRY_BUDGET", "OUTBOUND_REQUEST_MISMATCH", "UNEXPECTED_ORDINARY_AUTH", "ADAPTER_CALL_COUNT_OR_MUTATION",
  "ROUTE_OR_DATASET_INVALID", "ACCEPTED_ROUTE_EVIDENCE_INVALID", "EXPLICIT_EXECUTION_REQUIRED", "MANIFEST_BOUND", "INSTALLED_MODULE_PIN_MISMATCH"]);

export function safeFailure(error) {
  return { completed: false, code: failureCodes.has(error?.canaryCode) ? error.canaryCode : "ORDINARY_ADAPTER_CANARY_FAILED",
    attemptedAdapterRequests: Number.isInteger(error?.attemptedAdapterRequests) && error.attemptedAdapterRequests >= 0 && error.attemptedAdapterRequests <= 2
      ? error.attemptedAdapterRequests : 0, automaticRetry: false,
    publicHttpUserAuthenticationVerified: false, rawPayloadOrResponseExported: false };
}

export function publicRequests() {
  const common = { profileId: "car", to: { lat: 50.1215849, lon: 17.3810814 },
    includeSteps: true, includeRoadAttributes: true,
    vehicleProfile: { version: "sim-mapped-road-profile-v1", intent: "car",
      coverageAcknowledged: "mapped_restrictions_incomplete",
      vehicle: { heightM: 2, widthM: 2, lengthM: 5, loadedWeightKg: 3000 } } };
  return [
    { ...structuredClone(common), from: { lat: 50.1439208984375, lon: 17.378921508789062 }, alternatives: 1 },
    { ...structuredClone(common), from: { lat: 50.1209513, lon: 17.3831568 }, alternatives: 3 }
  ];
}

export async function runOrdinaryPair(sourceModule, manifest) {
  need(manifest?.schema === "cop-ordinary-adapter-canary-v1" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(manifest.admissionId ?? "") &&
    /^[a-f0-9]{64}$/.test(manifest.baseUrlSha256 ?? ""), "ADMISSION_REQUIRED");
  const config = sourceModule.createRoutingSourceConfigFromEnv();
  need(config.enabled && digest(config.baseUrl) === manifest.baseUrlSha256, "EXISTING_CONFIG_MISMATCH");
  const expectedUrl = new URL("routing/alternatives", config.baseUrl.replace(/\/+$/, "") + "/");
  need(["http:", "https:"].includes(expectedUrl.protocol) && !expectedUrl.username && !expectedUrl.password &&
    !expectedUrl.search && !expectedUrl.hash, "EXISTING_URL_INVALID");
  const source = sourceModule.createRoutingSourceFromEnv();
  need(source && typeof source.route === "function", "ADAPTER_UNAVAILABLE");
  const requests = publicRequests(), transport = globalThis.fetch;
  let attempted = 0, active = -1;
  const rows = [];
  globalThis.fetch = async (url, init) => {
    need(active >= 0 && active < 2 && attempted === active && attempted < 2, "NO_RETRY_BUDGET");
    need(String(url) === expectedUrl.href && init?.method === "POST" &&
      canonical(JSON.parse(String(init.body))) === canonical(requests[active]), "OUTBOUND_REQUEST_MISMATCH");
    // Preserve the real adapter's headers. In this revision ordinary routing
    // has no service credential; never inject planning's token to fake success.
    need(!new Headers(init.headers).has("authorization"), "UNEXPECTED_ORDINARY_AUTH");
    attempted++;
    return transport(url, init);
  };
  try {
    for (let index = 0; index < requests.length; index++) {
      active = index;
      const original = canonical(requests[index]);
      const result = await source.route(requests[index], new Date(), { correlationId: manifest.admissionId });
      need(attempted === index + 1 && canonical(requests[index]) === original, "ADAPTER_CALL_COUNT_OR_MUTATION");
      need(Array.isArray(result.routes) && result.routes.length >= 1 && result.routes.length <= requests[index].alternatives &&
        canonical(result.coverage?.routingDataset) === canonical(dataset), "ROUTE_OR_DATASET_INVALID");
      for (const route of result.routes) {
        need(route.status === "ok" && route.quality?.mode === "engine_route" &&
          route.mappedProfileAssessment?.state === "applied" && route.knownClosures?.state === "applied" &&
          canonical(route.mappedProfileAssessment.appliedProfile) === canonical(requests[index].vehicleProfile) &&
          route.mappedProfileAssessment.engine?.fallbackUsed === false && route.knownClosures.engine?.fallbackUsed === false &&
          Date.parse(route.mappedProfileAssessment.validUntil) > Date.now() && Date.parse(route.knownClosures.validUntil) > Date.now(),
        "ACCEPTED_ROUTE_EVIDENCE_INVALID");
      }
      rows.push({ case: index === 0 ? "public_mnichov" : "public_control", requestedAlternatives: requests[index].alternatives,
        returnedRoutes: result.routes.length, mappedAndClosureEvidenceAcceptedByInstalledAdapter: true, datasetMatches: true });
    }
    return { schema: "cop-ordinary-adapter-canary-result-v1", completed: true, attemptedAdapterRequests: attempted,
      rows, actualInstalledAdapterExecuted: true, publicHttpUserAuthenticationVerified: false,
      accountGuardExecuted: false, rawPayloadOrResponseExported: false, productionActivationGranted: false };
  } catch (error) {
    throw Object.assign(new Error("Ordinary adapter canary failed."), safeFailure(error),
      { canaryCode: safeFailure(error).code, attemptedAdapterRequests: attempted });
  } finally { globalThis.fetch = transport; }
}

/** Can also be called from a hash-pinned data: module in docker exec.
 * This avoids copying files into the running application or changing its env.
 */
export async function executeReviewedManifest(manifest) {
  need(Buffer.byteLength(JSON.stringify(manifest), "utf8") <= 16384, "MANIFEST_BOUND");
  need(/^[a-f0-9]{64}$/.test(manifest.moduleSha256 ?? "") && digest(readFileSync(modulePath)) === manifest.moduleSha256,
    "INSTALLED_MODULE_PIN_MISMATCH");
  return runOrdinaryPair(await import(pathToFileURL(modulePath).href), manifest);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    need(process.argv.length === 3 && process.argv[2] === "--execute-reviewed-ordinary-pair", "EXPLICIT_EXECUTION_REQUIRED");
    const input = readFileSync(0);
    need(input.length <= 16384, "MANIFEST_BOUND");
    const manifest = JSON.parse(input.toString("utf8"));
    process.stdout.write(JSON.stringify(await executeReviewedManifest(manifest)) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify(safeFailure(error)) + "\n");
    process.exitCode = 1;
  }
}
