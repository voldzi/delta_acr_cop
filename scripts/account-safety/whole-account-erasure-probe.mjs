import { publicConfirmationRecoveryEvidence, verifyConfirmationRecovery } from "./confirmation-evidence.mjs";
import { prepareAdditionalActors, verifyAdditionalActorsPreserved, eraseNoviceAfterPrimaryRestore, readAdditionalActors, publicControlBSnapshot, publicAdditionalActorsEvidence, validateAdditionalActorsEvidence, WHOLE_PHASE_LIMITS } from "./additional-actors.mjs";
/** Whole acceptance entrypoint inside the owned shared provider namespace.
 * Real buildServer composition only. Fixture exports may seed/inspect/restore
 * real test providers; they cannot replace COP adapters or readiness methods. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(readFileSync(0, "utf8"));
const need = (condition, code) => { if (!condition) throw Error(code); };
const issuer = "https://cop-erasure-keycloak.invalid/realms/cop-erasure-whole";
need(manifest.contractVersion === "cop-account-erasure-whole-fixture-v1" && manifest.issuer === issuer &&
  manifest.integration?.ready === true && manifest.integration.missingComponents?.length === 0 &&
  manifest.leaseExpiresAt * 1000 > Date.now(), "WHOLE_FIXTURE_NOT_READY");
need(manifest.actors?.a?.subjectId !== manifest.actors?.b?.subjectId &&
  Object.values(manifest.actors).every(actor => /^[0-9a-f-]{36}$/u.test(actor.subjectId)), "ACTUAL_KEYCLOAK_SUBJECTS_REQUIRED");
const fixtureModule = "/dev/shm/cop-whole/integration-fixture.mjs";
need(createHash("sha256").update(readFileSync(fixtureModule)).digest("hex") === manifest.integration.fixtureModuleSha256,
  "WHOLE_PROVIDER_FIXTURE_SOURCE_MISMATCH");
const fixture = await import(pathToFileURL(fixtureModule));
const localFixture = await import("file:///dev/shm/cop-whole/cop-local-fixture.mjs");
const mediaFixture = await import("file:///dev/shm/cop-whole/media-edge-fixture.mjs");
for (const name of ["seedWholeErasureFixture", "readWholeErasureFixture"])
  need(typeof fixture[name] === "function", "WHOLE_PROVIDER_FIXTURE_EXPORT_MISSING");
const env = { ...manifest.integration.environment, COP_MEDIA_UPLOAD_EXPIRES_SECONDS: "1" };
for (const key of Object.keys(process.env)) if (key.startsWith("COP_")) delete process.env[key];
for (const [key, value] of Object.entries(env)) {
  need(/^COP_[A-Z0-9_]+$/u.test(key) && typeof value === "string", "WHOLE_ENVIRONMENT_REJECTED");
  if (value && /(?:URL|ENDPOINT)$/u.test(key)) {
    const url = new URL(value);
    need(["127.0.0.1", "cop-erasure-keycloak.invalid", "cop-erasure-whole.invalid", "cop-erasure-messaging.invalid"].includes(url.hostname), "WHOLE_PROVIDER_MUST_USE_OWNED_NAMESPACE");
  }
  process.env[key] = value;
}
need(env.COP_OIDC_ISSUER === issuer && env.COP_ACCOUNT_ERASURE_ENABLED === "true" &&
  env.COP_ACCOUNT_SAFETY_GUARD_REQUIRED === "true" && env.COP_ACCOUNT_SAFETY_AUTHORITY_MODE === "database_v2" &&
  env.COP_MEDIA_UPLOAD_TRANSPORT === "cop_api", "WHOLE_REAL_COMPOSITION_REQUIRED");
const database = manifest.database;
for (const [key, name] of [["guardRuntimeUrl", "cop_account_safety_guard"], ["guardTargetReadUrl", "cop_erasure_test"], ["businessRuntimeUrl", "cop_erasure_test"]]) {
  const url = new URL(database[key]);
  need(url.hostname === "127.0.0.1" && ["5432", "5433"].includes(url.port) && url.pathname === "/" + name &&
    ["cop_whole_app", "cop_whole_guard_runtime"].includes(url.username), "WHOLE_OWNED_DATABASE_REQUIRED");
}
const nativeFetch = globalThis.fetch, providerCalls = [];
let initialProviderOutageArmed = false, initialProviderOutageIntercepted = false, peerRequestCapture;
const requireAdditionalActors = manifest.serverLocal?.contractVersion === "cop-whole-server-local-v1";
// Only the fixture TLS transport changes. Every JWT, JWKS and provider response
// is issued by the actual shared Keycloak. This does not test production TLS.
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.origin === "https://cop-erasure-keycloak.invalid") {
    need(url.pathname.startsWith("/realms/cop-erasure-whole/") || url.pathname.startsWith("/admin/realms/cop-erasure-whole/"), "WHOLE_KEYCLOAK_SCOPE_REJECTED");
    providerCalls.push({ provider: "keycloak", method: options?.method ?? "GET", path: url.pathname });
    return nativeFetch("http://127.0.0.1:8080" + url.pathname + url.search, options);
  }
  if (url.origin === "https://cop-erasure-messaging.invalid") {
    need(url.pathname === "/api/v1/communication/voice-erasure" && !url.search && !url.hash, "WHOLE_LIVEKIT_RELAY_SCOPE_REJECTED");
    providerCalls.push({ provider: "actual_messaging_livekit_relay", method: options?.method ?? "GET", path: url.pathname });
    return nativeFetch("http://127.0.0.1:4000" + url.pathname, options);
  }
  need(url.hostname === "127.0.0.1", "WHOLE_EXTERNAL_NETWORK_REJECTED");
  providerCalls.push({ provider: "owned_namespace", method: options?.method ?? "GET", port: url.port, path: url.pathname });
  if (peerRequestCapture && url.origin === "http://127.0.0.1:4000" && url.pathname === "/api/v1/conversations" && options?.method === "POST") {
    need(typeof options.body === "string" && options.body.length <= 16384, "WHOLE_NEW_PEER_REQUEST_BODY_UNPROVEN");
    const body = JSON.parse(options.body), headers = new Headers(options.headers);
    peerRequestCapture.push({ checkedAt: new Date().toISOString(), actorUserId: headers.get("x-csm-user-id"), issuer: headers.get("x-csm-oidc-issuer"),
      targetUserIds: body.members?.map(member => member.userId), peerBindings: body.peerBindings });
  }
  if (initialProviderOutageArmed && !initialProviderOutageIntercepted && url.origin === "http://127.0.0.1:4000" &&
    url.pathname === "/api/v1/communication/account-erasure/owner-v2" && options?.method === "POST") {
    need(manifest.serverLocal?.contractVersion === "cop-whole-server-local-v1" && manifest.integration.expectedInitialOutage503 === true,
      "WHOLE_UNREVIEWED_PROVIDER_FAULT_REJECTED");
    initialProviderOutageIntercepted = true;
    process.stdout.write(JSON.stringify({ phase: "whole_inject_provider_outage_required", operationId, productionChanged: false }) + "\n");
    const deadline = Date.now() + 8000;
    while (!existsSync("/dev/shm/cop-whole/injected-provider-outage.json") && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 25));
    const proof = JSON.parse(readFileSync("/dev/shm/cop-whole/injected-provider-outage.json", "utf8"));
    need(proof.operationId === operationId && proof.provider === "messaging" && proof.actualPaused === true && proof.originalSealedJobVerified === true,
      "WHOLE_ACTUAL_PAUSED_PROVIDER_PROOF_MISSING");
  }
  return nativeFetch(input, options);
};
const { Pool } = createRequire("/app/apps/cop-api/package.json")("pg");
const api = "file:///dev/shm/cop-whole/apps/cop-api/dist/";
const { buildServer } = await import(api + "server.js");
const { ACCOUNT_ERASURE_ADAPTER_IDS } = await import(api + "account-erasure.js");
const { PostgresAccountErasureContinuity } = await import(api + "account-erasure-continuity-postgres.js");
const { createBackupRestoreErasureAdapter } = await import(api + "backup-restore-erasure.js");
const { PostgresMediaUploadSettlement, mediaCredentialFingerprint } = await import(api + "media-upload-settlement.js");
const { createMediaStorageFromEnv } = await import(api + "media-storage.js");
const expectedIds = [...ACCOUNT_ERASURE_ADAPTER_IDS].sort();
const path = "/api/v1/me/account-deletion";
const continuation = manifest.integration.continueOperation === true
  ? JSON.parse(readFileSync("/dev/shm/cop-whole/pre-deletion-checkpoint.json", "utf8")) : undefined;
const operationId = continuation?.operationId ?? randomUUID();
const initialAttemptPath = "/dev/shm/cop-whole/initial-confirmation-attempt.json";
const priorInitialAttempt = continuation && existsSync(initialAttemptPath) ? JSON.parse(readFileSync(initialAttemptPath, "utf8")) : undefined;
let initialNormal202Verified = priorInitialAttempt?.contractVersion === "cop-whole-initial-confirmation-attempt-v1" && priorInitialAttempt.operationId === operationId &&
  priorInitialAttempt.actualHttpStatus === 202 && priorInitialAttempt.normalPendingReceiptVerified === true;
let app, resources = [], testStage = "start_actual_cop", ownsRunLease = false;
const pool = url => { const value = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 3000 }); resources.push(value); return value; };
const stateDigest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function verifyContinuationBeforeWorkers() {
  need(continuation?.contractVersion === "cop-whole-pre-deletion-checkpoint-v1" && continuation.issuer === issuer &&
    typeof continuation.receiptCapability === "string" && /^[a-f0-9-]{36}$/u.test(operationId), "WHOLE_CONTINUATION_CHECKPOINT_UNPROVEN");
  const guard = new Pool({ connectionString: database.guardRuntimeUrl, max: 1 }), target = new Pool({ connectionString: database.guardTargetReadUrl, max: 1 }),
    continuity = new PostgresAccountErasureContinuity(guard, target, { guardStoreId: database.guardStoreId,
      applicationStoreId: database.applicationStoreId, incarnationId: database.incarnationId, configurationFingerprint: database.configurationFingerprint });
  try {
    const actual = await continuity.snapshot(), accountKey = createHmac("sha256", env.COP_ACCOUNT_ERASURE_SECRET)
      .update("cop-account-erasure-identity-v1\0").update(JSON.stringify([issuer, manifest.actors.a.subjectId])).digest("hex");
    const entry = actual.entries.find(value => value.accountKey === accountKey && value.job.operationId === operationId);
    need(entry && entry.job.required.slice().sort().join() === expectedIds.join(), "WHOLE_ORIGINAL_INDEPENDENT_FENCE_MISSING");
    if (initialNormal202Verified) need(priorInitialAttempt.requestedAt === entry.job.requestedAt, "WHOLE_INITIAL_202_ORIGINAL_DATE_MISMATCH");
    const local = (await target.query("SELECT value FROM cop_mobility_v1 WHERE key=$1", ["account-erasure:job:" + accountKey])).rows[0]?.value;
    need(local?.operationId === operationId && local.requestedAt === entry.job.requestedAt && typeof local.sealedPrincipal === "string" &&
      !local.completedAt, "WHOLE_ORIGINAL_SEALED_JOB_MISSING");
    const checkpoint = { contractVersion: "cop-whole-continuation-checkpoint-v1", operationId, requestedAt: entry.job.requestedAt,
      originalCheckpointSha256: createHash("sha256").update(readFileSync("/dev/shm/cop-whole/pre-deletion-checkpoint.json")).digest("hex"),
      originalTestedSource: continuation.testedSource, currentTestedSource: manifest.testedSource,
      firstConfirmationWasNot202: !initialNormal202Verified, initialHttpStatusCaptured: priorInitialAttempt !== undefined,
      originalGuardAndLocalJobVerified: true, workerStarted: false, productionChanged: false };
    writeFileSync("/dev/shm/cop-whole/continuation-checkpoint-" + randomUUID() + ".json", JSON.stringify(checkpoint), { mode: 0o600, flag: "wx" });
    process.stdout.write(JSON.stringify({ phase: "whole_original_operation_continuation_verified", operationId, requestedAt: entry.job.requestedAt,
      originalGuardAndLocalJobVerified: true, reseeded: false, firstConfirmationWasNot202: !initialNormal202Verified, wholeAccountAccepted: false, productionChanged: false }) + "\n");
  } finally { await continuity.close(); }
}
async function start(binding) {
  process.env.COP_ACCOUNT_SAFETY_INCARNATION_ID = binding.incarnationId;
  const continuity = new PostgresAccountErasureContinuity(pool(database.guardRuntimeUrl), pool(database.guardTargetReadUrl), {
    guardStoreId: database.guardStoreId, applicationStoreId: database.applicationStoreId,
    incarnationId: binding.incarnationId, configurationFingerprint: database.configurationFingerprint
  });
  const settlement = new PostgresMediaUploadSettlement(pool(database.guardRuntimeUrl), pool(database.businessRuntimeUrl), {
    bucket: env.COP_MEDIA_S3_BUCKET, endpoint: env.COP_MEDIA_S3_ENDPOINT,
    credentialFingerprint: mediaCredentialFingerprint(env.COP_MEDIA_S3_ACCESS_KEY_ID, env.COP_MEDIA_S3_SECRET_ACCESS_KEY),
    applicationStoreId: database.applicationStoreId, incarnationId: binding.incarnationId
  });
  app = buildServer({ logger: false, accountErasureContinuity: continuity,
    backupRestoreErasureAdapter: createBackupRestoreErasureAdapter({ continuity, issuer, identitySecret: env.COP_ACCOUNT_ERASURE_SECRET }),
    mediaStorage: createMediaStorageFromEnv(process.env, { uploadSettlement: settlement }),
    simErasureIdentityReview: (actor, context) => continuity.reviewRouterIdentity(actor, context, { issuer, userIdSecret: env.COP_AI_CHAT_ROUTER_USER_ID_SECRET }) });
  await app.listen({ host: "127.0.0.1", port: 4310 });
}
async function stop() {
  await app?.close(); app = undefined;
  await Promise.all(resources.splice(0).map(value => value.end()));
}
async function actualCodeLogin(actor) {
  const redirectUri = "https://cop-erasure-whole.invalid/auth/callback", state = randomBytes(24).toString("base64url"),
    nonce = randomBytes(24).toString("base64url"), verifier = randomBytes(48).toString("base64url"), cookies = new Map();
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, redirect: "manual", headers: { ...options.headers,
      ...(cookies.size ? { cookie: [...cookies].map(([key, value]) => key + "=" + value).join("; ") } : {}) }, signal: AbortSignal.timeout(10000) });
    for (const value of response.headers.getSetCookie()) { const pair = value.split(";", 1)[0], split = pair.indexOf("="); cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
    return response;
  };
  const auth = issuer + "/protocol/openid-connect/auth?" + new URLSearchParams({ client_id: "cop-web", response_type: "code", redirect_uri: redirectUri,
    scope: "openid", state, nonce, prompt: "login", max_age: "0", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const page = await request(auth); need(page.status === 200, "ACTUAL_KEYCLOAK_CODE_LOGIN_FORM_UNAVAILABLE");
  const html = await page.text(); need(html.length < 262144, "ACTUAL_KEYCLOAK_LOGIN_FORM_TOO_LARGE");
  const forms = [...html.matchAll(/<form\b[^>]*>/gu)].map(value => value[0]).filter(value => /\bid="kc-form-login"/u.test(value));
  need(forms.length === 1, "ACTUAL_KEYCLOAK_LOGIN_FORM_AMBIGUOUS");
  const action = forms[0].match(/\baction="([^"]+)"/u)?.[1]?.replaceAll("&amp;", "&");
  need(action?.startsWith(issuer + "/login-actions/authenticate?"), "ACTUAL_KEYCLOAK_LOGIN_FORM_SCOPE_REJECTED");
  const result = await request(action, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: actor.username, password: actor.password, credentialId: "" }) });
  need(result.status === 302 || result.status === 303, "ACTUAL_KEYCLOAK_PASSWORD_AUTHENTICATION_FAILED");
  const location = new URL(result.headers.get("location"));
  need(location.origin + location.pathname === redirectUri && location.searchParams.get("state") === state &&
    location.searchParams.get("iss") === issuer && location.searchParams.get("code"), "ACTUAL_KEYCLOAK_CODE_CALLBACK_REJECTED");
  const exchange = await fetch(issuer + "/protocol/openid-connect/token", { method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: "cop-web", redirect_uri: redirectUri,
      code: location.searchParams.get("code"), code_verifier: verifier }), signal: AbortSignal.timeout(10000) });
  need(exchange.status === 200, "ACTUAL_KEYCLOAK_PKCE_EXCHANGE_FAILED");
  const value = await exchange.json(), claims = JSON.parse(Buffer.from(value.access_token.split(".")[1], "base64url")),
    id = JSON.parse(Buffer.from(value.id_token.split(".")[1], "base64url"));
  need(claims.iss === issuer && claims.sub === actor.subjectId && Number.isSafeInteger(claims.auth_time) &&
    claims.auth_time <= Math.floor(Date.now() / 1000) && Math.floor(Date.now() / 1000) - claims.auth_time <= 300 && id.nonce === nonce,
    "ACTUAL_KEYCLOAK_FRESH_SIGNED_AUTH_TIME_MISSING");
  return value;
}
async function token(actor, clientId = "cop-web", refresh) {
  if (clientId === "cop-web" && !refresh) return actualCodeLogin(actor);
  const response = await fetch(issuer + "/protocol/openid-connect/token", { method: "POST", redirect: "error",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId,
      ...(refresh ? { grant_type: "refresh_token", refresh_token: refresh } : { grant_type: "password", username: actor.username, password: actor.password }), scope: clientId === "csm-sim-web" ? "openid offline_access" : "openid" }), signal: AbortSignal.timeout(10000) });
  need(response.status === 200, "ACTUAL_KEYCLOAK_LOGIN_FAILED");
  const result = await response.json(), claims = JSON.parse(Buffer.from(result.access_token.split(".")[1], "base64url"));
  need(claims.iss === issuer && claims.sub === actor.subjectId, "ACTUAL_KEYCLOAK_IDENTITY_CHANGED"); return result;
}
function checkSnapshot(snapshot, label) {
  need(snapshot && snapshot.contractVersion === "cop-whole-erasure-readback-v1" &&
    Object.keys(snapshot.owners ?? {}).sort().join() === expectedIds.join(), "WHOLE_OWNER_READBACK_INCOMPLETE_" + label);
  for (const id of expectedIds) {
    const owner = snapshot.owners[id];
    need(Number.isSafeInteger(owner.removableA) && owner.removableA >= 0 && Number.isSafeInteger(owner.removableB) && owner.removableB >= 0 &&
      typeof owner.preservedBFingerprint === "string" && /^[0-9a-f]{64}$/u.test(owner.preservedBFingerprint), "WHOLE_OWNER_READBACK_INVALID_" + id);
  }
  return snapshot;
}
function erased(before, after) {
  checkSnapshot(after, "after");
  for (const id of expectedIds) {
    need(after.owners[id].removableA === 0, "WHOLE_OWNER_DATA_REMAINS_" + id);
    need(after.owners[id].removableB === before.owners[id].removableB && after.owners[id].preservedBFingerprint === before.owners[id].preservedBFingerprint,
      "WHOLE_CONTROL_USER_CHANGED_" + id);
  }
}
let lastReceipt;
async function waitDeleted(headers, capability, awaitedOperationId = operationId, maxWaitMs = WHOLE_PHASE_LIMITS.onlineWaitMs) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ url: path + (capability ? "/receipts/" : "/") + awaitedOperationId, headers: capability ? { "x-cop-erasure-receipt-capability": capability } : headers });
    need(response.statusCode === 200, "WHOLE_DURABLE_RECEIPT_UNAVAILABLE");
    const value = response.json(); if (awaitedOperationId === operationId) lastReceipt = value;
    if (value.accountDeleted === true) {
      need(value.status === "deleted" && value.remaining.length === 0 && value.operationId === awaitedOperationId, "WHOLE_FALSE_FINAL_RECEIPT"); return value;
    }
    need(manifest.leaseExpiresAt * 1000 > Date.now(), "WHOLE_FIXTURE_LEASE_EXPIRED_DURING_DELETION");
    need(value.accountDeleted === false && value.status === "deleting", "WHOLE_PENDING_MISREPORTED");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Error("WHOLE_DELETION_STILL_PENDING_" + (lastReceipt?.remaining ?? []).join("_"));
}
try {
  need(continuation || !existsSync("/dev/shm/cop-whole/confirmed-operation-checkpoint.json"), "WHOLE_CONFIRMED_OPERATION_REQUIRES_CONTINUATION");
  const leasePath = "/dev/shm/cop-whole/run-lease.json";
  if (existsSync(leasePath)) {
    need(continuation, "WHOLE_EXISTING_RUN_REQUIRES_CONFIRMED_CONTINUATION");
    const bytes = readFileSync(leasePath), stale = JSON.parse(bytes);
    need(stale.operationId === operationId && Number.isInteger(stale.pid) && stale.pid > 1 && stale.pid !== process.pid, "WHOLE_PRIOR_RUN_LEASE_UNPROVEN");
    try { process.kill(stale.pid, 0); throw Error("WHOLE_PRIOR_RUN_STILL_ACTIVE"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    const crash = JSON.parse(readFileSync("/dev/shm/cop-whole/main-crash-verified-checkpoint.json", "utf8"));
    need(crash.contractVersion === "cop-whole-main-crash-checkpoint-v1" && crash.operationId === operationId && crash.pid === stale.pid &&
      crash.processStopped === true && crash.independentJournalUnchanged === true && crash.originalSealedJobPreserved === true,
      "WHOLE_PRIOR_MAIN_CRASH_UNPROVEN");
    await verifyContinuationBeforeWorkers();
    writeFileSync("/dev/shm/cop-whole/archived-run-lease-" + randomUUID() + ".json", bytes, { mode: 0o600, flag: "wx" });
    need(readFileSync(leasePath).equals(bytes), "WHOLE_PRIOR_RUN_LEASE_CHANGED");
    unlinkSync(leasePath);
  } else if (continuation) await verifyContinuationBeforeWorkers();
  writeFileSync(leasePath, JSON.stringify({ pid: process.pid, operationId }), { mode: 0o600, flag: "wx" });
  ownsRunLease = true;
  await start({ incarnationId: database.incarnationId, restoreGeneration: database.restoreGeneration });
  const a = await token(manifest.actors.a), b = await token(manifest.actors.b),
    headerA = { authorization: "Bearer " + a.access_token }, headerB = { authorization: "Bearer " + b.access_token };
  const context = { manifest, environment: process.env, app, operationId, nativeFetch, headersA: headerA, headersB: headerB };
  const seeded = continuation?.seeded ?? {};
  const additionalPreservation = {};
  if (!continuation) {
    if (requireAdditionalActors) {
      testStage = "actual_novice_preview_and_first_contact";
      seeded.additional = await prepareAdditionalActors(context, { login: token, observePeerRequest: async action => {
        need(!peerRequestCapture, "WHOLE_PEER_CAPTURE_ALREADY_ACTIVE"); const captured = []; peerRequestCapture = captured;
        try { await action(); return captured; } finally { peerRequestCapture = undefined; }
      } });
    }
    testStage = "seed_actual_cop_owners";
    seeded.local = await localFixture.seedCopLocalOwners(context);
    testStage = "verify_actual_sim_messaging_seed";
    seeded.sim = await fixture.seedWholeErasureFixture(context);
    testStage = "seed_actual_media_edge";
    seeded.media = await mediaFixture.seedMediaEdgeFixture(context);
  }
  testStage = "read_actual_all_owner_baseline";
  const readWhole = async (currentApp = app) => {
    const actualContext = { ...context, app: currentApp };
    const [local, sim, media, copMeasurements] = await Promise.all([
      localFixture.readCopLocalOwners({ ...actualContext, seed: seeded }),
      fixture.readWholeErasureFixture({ ...actualContext, seed: seeded.sim }),
      mediaFixture.readMediaEdgeFixture({ ...actualContext, seed: seeded.media }),
      localFixture.readCopMeasurementConsent(actualContext)
    ]);
    const simOwners = sim.owners ?? sim;
    need(Object.keys(simOwners).every(id => ["sim_measurements", "ai_router", "messaging_matrix"].includes(id)), "SIM_FIXTURE_MUST_NOT_CLAIM_COP_OWNERS");
    simOwners.sim_measurements = {
      removableA: simOwners.sim_measurements.removableA + copMeasurements.a.count,
      removableB: simOwners.sim_measurements.removableB + copMeasurements.b.count,
      preservedBFingerprint: stateDigest([simOwners.sim_measurements.preservedBFingerprint, copMeasurements.b.fingerprint])
    };
    const mediaOwners = media.owners ?? media;
    need(Object.keys(mediaOwners).every(id => id === "cop_content_media"), "MEDIA_FIXTURE_MUST_NOT_CLAIM_OTHER_OWNERS");
    return { contractVersion: "cop-whole-erasure-readback-v1", owners: { ...local, ...simOwners, ...mediaOwners } };
  };
  const before = checkSnapshot(continuation?.before ?? await readWhole(), "before");
  let capability = continuation?.receiptCapability;
  if (!continuation) {
  need(Object.values(before.owners).some(owner => owner.removableA > 0) && Object.values(before.owners).some(owner => owner.removableB > 0), "WHOLE_NONEMPTY_TWO_USER_SEEDS_REQUIRED");
  need((await app.inject({ url: "/api/v1/me/preferences", headers: headerA })).statusCode === 200, "WHOLE_A_ACCESS_BEFORE_FAILED");
  need((await app.inject({ url: "/api/v1/me/preferences", headers: headerB })).statusCode === 200, "WHOLE_B_ACCESS_BEFORE_FAILED");
  testStage = "actual_capability_preflight";
  const capabilityResponse = await app.inject({ url: path + "/capabilities", headers: headerA });
  const capabilityReady = capabilityResponse.statusCode === 200 && capabilityResponse.json().accountDeletion === true;
  const plan = await app.inject({ method: "POST", url: path + "/preflight", headers: { ...headerA, "idempotency-key": operationId }, payload: {} });
  if (!capabilityReady || plan.statusCode !== 200 || plan.json().canConfirm !== true) {
    process.stdout.write(JSON.stringify({ phase: "whole_fixture_preflight_diagnostic", capabilityReady,
      preflightStatus: plan.statusCode, blockers: (plan.json().blockers ?? []).map(value => ({ domain: value.domain, reason: value.reason })),
      productionChanged: false }) + "\n");
    throw Error("WHOLE_ACTUAL_OWNER_PREFLIGHT_FAILED");
  }
  capability = plan.headers["x-cop-erasure-receipt-capability"];
  need(typeof capability === "string", "WHOLE_RECEIPT_CAPABILITY_MISSING");
  writeFileSync("/dev/shm/cop-whole/pre-deletion-checkpoint.json", JSON.stringify({
    contractVersion: "cop-whole-pre-deletion-checkpoint-v1", issuer, operationId, before, seeded,
    planId: plan.json().planId, receiptCapability: capability, testedSource: manifest.testedSource
  }), { mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify({ phase: "whole_fixture_snapshot_required", operationId,
    independentGuardMustNotBeRestored: true, productionChanged: false }) + "\n");
  const snapshotDeadline = Date.now() + 180000;
  let snapshot;
  while (Date.now() < snapshotDeadline) {
    try { snapshot = JSON.parse(readFileSync("/dev/shm/cop-whole/pre-deletion-snapshot-ack.json", "utf8")); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  need(snapshot?.contractVersion === "cop-whole-pre-deletion-snapshot-v1" && snapshot.operationId === operationId &&
    snapshot.independentGuardIncluded === false && Array.isArray(snapshot.dumps) && snapshot.dumps.length === 5 &&
    snapshot.dumps.every(value => /^[a-f0-9]{64}$/u.test(value.sha256)), "WHOLE_ACTUAL_PREDELETION_SNAPSHOT_MISSING");
  const wrongIdentity = await app.inject({ method: "POST", url: path, headers: { ...headerB, "idempotency-key": operationId,
    "x-cop-erasure-plan": plan.json().planId, "x-cop-erasure-receipt-capability": capability }, payload: { confirmAccountDeletion: true } });
  need([409, 503].includes(wrongIdentity.statusCode), "WHOLE_CROSS_ACCOUNT_PLAN_ACCEPTED");
  testStage = "actual_confirmation";
  initialProviderOutageArmed = manifest.serverLocal?.contractVersion === "cop-whole-server-local-v1" && manifest.integration.expectedInitialOutage503 === true;
  const confirmed = await app.inject({ method: "POST", url: path, headers: { ...headerA, "idempotency-key": operationId,
    "x-cop-erasure-plan": plan.json().planId, "x-cop-erasure-receipt-capability": capability }, payload: { confirmAccountDeletion: true } });
  const confirmationBody = confirmed.json();
  initialNormal202Verified = confirmed.statusCode === 202 && confirmationBody.accountDeleted === false && confirmationBody.status === "deleting" && confirmationBody.operationId === operationId;
  writeFileSync(initialAttemptPath, JSON.stringify({ contractVersion: "cop-whole-initial-confirmation-attempt-v1", operationId,
    actualHttpStatus: confirmed.statusCode, normalPendingReceiptVerified: initialNormal202Verified,
    ...(typeof confirmationBody.requestedAt === "string" ? { requestedAt: confirmationBody.requestedAt } : {}),
    ...(typeof confirmationBody.error?.code === "string" && /^[A-Z0-9_]{1,100}$/u.test(confirmationBody.error.code) ? { errorCode: confirmationBody.error.code } : {}),
    testedSource: manifest.testedSource, checkedAt: new Date().toISOString(), wholeAccountAccepted: false, productionChanged: false }), { mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify({ phase: "actual_confirmation_http_observed", operationId, actualHttpStatus: confirmed.statusCode,
    initialNormal202Verified, wholeAccountAccepted: false, productionChanged: false }) + "\n");
  const injected = manifest.integration.expectedInitialOutage503 === true && existsSync("/dev/shm/cop-whole/injected-provider-outage.json")
    ? JSON.parse(readFileSync("/dev/shm/cop-whole/injected-provider-outage.json", "utf8")) : undefined;
  need(initialNormal202Verified || confirmed.statusCode === 503 && injected?.contractVersion === "cop-whole-injected-provider-outage-v1" &&
    injected.operationId === operationId && injected.provider === "messaging" && injected.actualPaused === true,
    "WHOLE_NORMAL_CONFIRMATION_NOT_ACCEPTED_202");
  writeFileSync("/dev/shm/cop-whole/confirmed-operation-checkpoint.json", JSON.stringify({
    contractVersion: "cop-whole-confirmed-operation-checkpoint-v1", issuer,
    subjects: { a: manifest.actors.a.subjectId, b: manifest.actors.b.subjectId }, operationId,
    before, seeded, receiptCapability: capability, confirmedAt: new Date().toISOString(),
    testedSource: manifest.testedSource
  }), { mode: 0o600, flag: "wx" });
  }
  need((await app.inject({ url: "/api/v1/me/preferences", headers: headerA })).statusCode === 403, "WHOLE_OLD_A_BEARER_NOT_FENCED");
  need((await app.inject({ url: "/api/v1/me/preferences", headers: headerB })).statusCode === 200, "WHOLE_B_BEARER_DAMAGED_BEFORE_WAIT");
  process.stdout.write(JSON.stringify({ phase: "whole_actual_deletion_pending", expectedMinimumVoiceWaitSeconds: 3690,
    originalOperationPreserved: true, wholeAccountAccepted: false, productionChanged: false }) + "\n");
  testStage = "wait_actual_online_deletion";
  await waitDeleted(headerA, capability);
  const freshB = await token(manifest.actors.b);
  headerB.authorization = "Bearer " + freshB.access_token;
  need((await app.inject({ url: "/api/v1/me/preferences", headers: headerB })).statusCode === 200, "WHOLE_B_BEARER_DAMAGED");
  testStage = "verify_actual_online_readback";
  const onlineSnapshot = await readWhole(); erased(before, onlineSnapshot);
  if (requireAdditionalActors) { const additional = await verifyAdditionalActorsPreserved(context, seeded.additional);
    additionalPreservation.online = { checkedAt: new Date().toISOString(), controlB: publicControlBSnapshot(onlineSnapshot, expectedIds), peerD: additional.d }; }
  const sim = await token(manifest.actors.a, "csm-sim-web", manifest.actors.a.sim.refresh_token);
  const userinfo = await fetch(issuer + "/protocol/openid-connect/userinfo", { headers: { authorization: "Bearer " + sim.access_token }, signal: AbortSignal.timeout(10000) });
  need(userinfo.status === 200 && (await userinfo.json()).sub === manifest.actors.a.subjectId, "WHOLE_SIM_SHARED_IDENTITY_DAMAGED");
  await stop();
  writeFileSync("/dev/shm/cop-whole/online-deletion-verified-checkpoint.json", JSON.stringify({
    contractVersion: "cop-whole-online-deletion-checkpoint-v1", operationId, issuer,
    actualOwnerCount: expectedIds.length, testedSource: manifest.testedSource, appStopped: true,
    allOwnerReadbacksVerified: true, productionChanged: false
  }), { mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify({ phase: "actual_online_whole_deletion_verified", actualOwnerCount: expectedIds.length,
    wholeAccountAccepted: false, productionChanged: false }) + "\n");
  testStage = "wait_actual_operator_restore";
  const operatorDeadline = Date.now() + WHOLE_PHASE_LIMITS.operatorRestoreWaitMs;
  let restored;
  while (Date.now() < operatorDeadline) {
    try { restored = JSON.parse(readFileSync("/dev/shm/cop-whole/operator-restore-ack.json", "utf8")); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  need(restored?.contractVersion === "cop-whole-operator-restore-ack-v1" && restored.operationId === operationId &&
    restored.independentGuardRestored === false && Array.isArray(restored.restoredDatabases) &&
    [...restored.restoredDatabases].sort().join() === ["cop_erasure_test", "sim_driver_measurements", "sim_ai_router", "messaging_joint_test", "csm_synapse"].sort().join(),
    "WHOLE_RESTORE_OPERATOR_GATE_PENDING");
  need(restored?.restoreGeneration === database.restoreGeneration + 1 && restored.incarnationId !== database.incarnationId &&
    /^[0-9a-f-]{36}$/u.test(restored.incarnationId), "WHOLE_RESTORE_TRANSITION_MISSING");
  await mediaFixture.restoreMediaEdgeFixture({ ...context, app: undefined, seed: seeded.media, restoredBinding: restored });
  await start(restored);
  // This is the existing fresh signature-verified actor recovery exception,
  // never identity reconstructed from a pseudonymous journal entry.
  const freshA = await token(manifest.actors.a);
  const recovered = await app.inject({ url: path + "/" + operationId, headers: { authorization: "Bearer " + freshA.access_token } });
  need(recovered.statusCode === 200 && recovered.json().accountDeleted === false, "WHOLE_COPIED_COMPLETION_NOT_RESET");
  // Capabilities created after the restored snapshot may be absent. The
  // existing authenticated receipt path remains bound to the original actor.
  await waitDeleted({ authorization: "Bearer " + freshA.access_token }, undefined, operationId, WHOLE_PHASE_LIMITS.postRestoreWaitMs);
  const restoredSnapshot = await readWhole(); erased(before, restoredSnapshot);
  if (requireAdditionalActors) { const additional = await verifyAdditionalActorsPreserved({ ...context, app }, seeded.additional);
    additionalPreservation.restored = { checkedAt: new Date().toISOString(), controlB: publicControlBSnapshot(restoredSnapshot, expectedIds), peerD: additional.d }; }
  need((await app.inject({ url: "/api/v1/me/preferences", headers: { authorization: "Bearer " + freshA.access_token } })).statusCode === 403,
    "WHOLE_RESTORED_A_NOT_FENCED");
  const restoredB = await token(manifest.actors.b);
  headerB.authorization = "Bearer " + restoredB.access_token;
  need((await app.inject({ url: "/api/v1/me/preferences", headers: headerB })).statusCode === 200, "WHOLE_RESTORED_B_DAMAGED");
  let additionalActorsEvidence;
  if (requireAdditionalActors) {
    testStage = "actual_novice_deletion_after_primary_restore";
    const noviceDeletion = await eraseNoviceAfterPrimaryRestore({ ...context, app }, seeded.additional, { primaryRestoreVerified: true,
      login: token, waitDeleted, writeCheckpoint: value => writeFileSync("/dev/shm/cop-whole/novice-confirmed-operation-checkpoint.json",
        JSON.stringify(value), { mode: 0o600, flag: "wx" }), phase: value => process.stdout.write(JSON.stringify(value) + "\n"), verifySimIdentity: async actor => {
        const value = await token(actor, "csm-sim-web", actor.sim.refresh_token), response = await fetch(issuer + "/protocol/openid-connect/userinfo", {
          headers: { authorization: "Bearer " + value.access_token }, signal: AbortSignal.timeout(10000) });
        const info = await response.json(); need(response.status === 200 && info.sub === actor.subjectId, "WHOLE_NOVICE_SIM_SHARED_IDENTITY_DAMAGED");
        return { status: response.status, subjectId: info.sub };
      }, readOwnerCompletion: async (noviceOperationId, requestedAt, subjectId) => {
        const accountKey = createHmac("sha256", env.COP_ACCOUNT_ERASURE_SECRET).update("cop-account-erasure-identity-v1\0").update(JSON.stringify([issuer, subjectId])).digest("hex"),
          target = pool(database.guardTargetReadUrl), guard = pool(database.guardRuntimeUrl);
        const local = (await target.query("SELECT value->>'operationId' operation_id,value->>'requestedAt' requested_at,value->'required' required,value->'checkpoints' checkpoints FROM cop_mobility_v1 WHERE key=$1", ["account-erasure:job:" + accountKey])).rows[0],
          independent = (await guard.query("SELECT entry->'job'->>'operationId' operation_id,entry->'job'->>'requestedAt' requested_at,entry->'job'->'checkpoints' checkpoints FROM cop_safety_v2.fences WHERE account_key=$1", [accountKey])).rows[0];
        need(local?.operation_id === noviceOperationId && independent?.operation_id === noviceOperationId && local.requested_at === requestedAt && independent.requested_at === requestedAt &&
          [...(local.required ?? [])].sort().join() === expectedIds.join() && Object.keys(local.checkpoints ?? {}).sort().join() === expectedIds.join() && Object.keys(independent.checkpoints ?? {}).sort().join() === expectedIds.join() &&
          expectedIds.every(owner => local.checkpoints[owner]?.status === "completed" && typeof local.checkpoints[owner]?.proofId === "string" && local.checkpoints[owner].proofId.length > 0 && independent.checkpoints?.[owner]?.status === "completed"),
          "WHOLE_NOVICE_ACTUAL_OWNER_JOURNAL_UNPROVEN");
        return { operationId: noviceOperationId, requestedAt, completedOwners: expectedIds, journalDigest: stateDigest([local, independent]) };
      } });
    const finalB = await token(manifest.actors.b); headerB.authorization = "Bearer " + finalB.access_token;
    need((await app.inject({ url: "/api/v1/me/preferences", headers: headerB })).statusCode === 200, "WHOLE_B_DAMAGED_AFTER_NOVICE");
    const finalSnapshot = await readWhole(); erased(before, finalSnapshot);
    const additional = await readAdditionalActors({ ...context, app });
    additionalPreservation.afterNovice = { checkedAt: new Date().toISOString(), controlB: publicControlBSnapshot(finalSnapshot, expectedIds), peerD: additional.d };
    additionalActorsEvidence = publicAdditionalActorsEvidence({ manifest, testedSource: manifest.testedSource,
      helperSha256: createHash("sha256").update(readFileSync("/dev/shm/cop-whole/additional-actors.mjs")).digest("hex"),
      primaryOperationId: operationId, primaryRequestedAt: lastReceipt.requestedAt, checkpoint: seeded.additional,
      controlBBefore: publicControlBSnapshot(before, expectedIds), preservation: additionalPreservation, noviceDeletion });
  }
  need(providerCalls.some(call => call.provider === "keycloak" && call.method === "DELETE"), "WHOLE_REAL_KEYCLOAK_REVOKE_NOT_OBSERVED");
  assert(providerCalls.length > 0);
  const crashEvidence = existsSync("/dev/shm/cop-whole/main-crash-verified-checkpoint.json")
    ? JSON.parse(readFileSync("/dev/shm/cop-whole/main-crash-verified-checkpoint.json", "utf8")) : undefined;
  const initialBytes = readFileSync(initialAttemptPath), initialFact = JSON.parse(initialBytes),
    recoveryAccepted = existsSync("/dev/shm/cop-whole/recovery-accepted-confirmation.json")
      ? JSON.parse(readFileSync("/dev/shm/cop-whole/recovery-accepted-confirmation.json", "utf8")) : undefined,
    retries = readdirSync("/dev/shm/cop-whole").filter(name => /^confirmation-retry-evidence-[a-f0-9-]{36}\.json$/u.test(name))
      .map(name => JSON.parse(readFileSync("/dev/shm/cop-whole/" + name, "utf8")));
  let confirmationEvidence;
  let confirmation = { initialHttpStatus: initialFact.actualHttpStatus, initialNormal202Verified,
    recoveryAccepted202Verified: false, controlledMainCrashVerified: false, retryNormal202Verified: false };
  for (const retry of retries) {
    try {
      const input = { initial: initialFact, recovery: recoveryAccepted,
        initialAttemptSha256: createHash("sha256").update(initialBytes).digest("hex"), crash: crashEvidence, retry,
        operationId, requestedAt: lastReceipt.requestedAt };
      const verifiedEvidence = publicConfirmationRecoveryEvidence(input);
      const verifiedConfirmation = verifyConfirmationRecovery(verifiedEvidence);
      confirmationEvidence = verifiedEvidence;
      confirmation = verifiedConfirmation;
      break;
    } catch { /* Unknown evidence cannot satisfy acceptance. */ }
  }
  if (manifest.integration.requireControlledCrashRetry === true)
    need(confirmationEvidence !== undefined && (confirmation.initialNormal202Verified || confirmation.initialHttpStatus === 503 && confirmation.recoveryAccepted202Verified &&
      manifest.integration.expectedInitialOutage503 === true) && confirmation.controlledMainCrashVerified && confirmation.retryNormal202Verified,
      "WHOLE_REQUIRED_ACTUAL_CRASH_RETRY_UNPROVEN");
  if (requireAdditionalActors) validateAdditionalActorsEvidence(additionalActorsEvidence, {
    whole: { ...manifest.testedSource, confirmationEvidence }, expectedOwners: expectedIds, helperSha256: additionalActorsEvidence.helperSha256 });
  process.stdout.write(JSON.stringify({ phase: "whole_account_acceptance_complete", contractVersion: "cop-whole-erasure-acceptance-v1",
    actualOwners: expectedIds, startCrashRecoveryScenario: Boolean(continuation), ...confirmation, confirmationEvidence,
    providerCallMetadataDigest: stateDigest(providerCalls), twoRealKeycloakActors: true, additionalActorsEvidence,
    sourceRevision: manifest.testedSource.sourceRevision, sourceWorkingTreeDirty: manifest.testedSource.sourceWorkingTreeDirty, compiledApiClosureSha256: manifest.testedSource.compiledApiClosureSha256, runtimeResourceClosureSha256: manifest.testedSource.runtimeResourceClosureSha256, compiledWorkspaceClosureSha256: manifest.testedSource.compiledWorkspaceClosureSha256, nodeBaseImageId: manifest.testedSource.nodeBaseImageId, productionTlsVerified: false, productionChanged: false, wholeAccountAccepted: true }) + "\n");
} catch (error) {
  const code = typeof error.message === "string" && /^[A-Za-z0-9_]{1,512}$/u.test(error.message) ? error.message : "WHOLE_ACTUAL_PROVIDER_TEST_FAILED";
  const frames = typeof error.stack === "string" ? error.stack.split("\n").slice(1, 9).map(value => value.match(/file:\/\/\/[A-Za-z0-9_./-]+\.(?:js|mjs):\d+:\d+/u)?.[0]).filter(Boolean) : [];
  process.stdout.write(JSON.stringify({ phase: "whole_account_acceptance_failed", code, testStage, errorType: error.name, frames, providerErrorCode: typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : undefined, wholeAccountAccepted: false, productionChanged: false }) + "\n");
  process.exitCode = 1;
} finally {
  await stop(); globalThis.fetch = nativeFetch;
  if (ownsRunLease) unlinkSync("/dev/shm/cop-whole/run-lease.json");
}
