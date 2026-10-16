/** Actual idempotent retry of the already accepted synthetic operation only. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { assessAcceptedConfirmation, confirmationEvidenceSha256 } from "./confirmation-evidence.mjs";
const { Pool } = createRequire("/app/apps/cop-api/package.json")("pg");
const { PostgresAccountErasureContinuity } = await import("file:///dev/shm/cop-whole/apps/cop-api/dist/account-erasure-continuity-postgres.js");
const need = (value, code) => { if (!value) throw Error(code); };
const manifest = JSON.parse(readFileSync("/dev/shm/cop-whole/private-manifest.json", "utf8")),
  original = JSON.parse(readFileSync("/dev/shm/cop-whole/pre-deletion-checkpoint.json", "utf8")),
  issuer = "https://cop-erasure-keycloak.invalid/realms/cop-erasure-whole";
need(manifest.issuer === issuer && original.issuer === issuer && original.contractVersion === "cop-whole-pre-deletion-checkpoint-v1", "WHOLE_ORIGINAL_RETRY_SCOPE_REJECTED");
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(String(input));
  if (url.origin === "https://cop-erasure-keycloak.invalid") {
    need(url.pathname.startsWith("/realms/cop-erasure-whole/"), "WHOLE_REAL_LOGIN_SCOPE_REJECTED");
    return nativeFetch("http://127.0.0.1:8080" + url.pathname + url.search, options);
  }
  need(url.origin === "http://127.0.0.1:4310" && url.pathname === "/api/v1/me/account-deletion", "WHOLE_RETRY_TRANSPORT_SCOPE_REJECTED");
  return nativeFetch(input, options);
};
async function operationBinding() {
  const config = manifest.database, guard = new Pool({ connectionString: config.guardRuntimeUrl, max: 1 }),
    target = new Pool({ connectionString: config.guardTargetReadUrl, max: 1 }),
    continuity = new PostgresAccountErasureContinuity(guard, target, { guardStoreId: config.guardStoreId, applicationStoreId: config.applicationStoreId,
      incarnationId: config.incarnationId, configurationFingerprint: config.configurationFingerprint });
  try {
    const view = await continuity.snapshot(), key = createHmac("sha256", manifest.integration.environment.COP_ACCOUNT_ERASURE_SECRET)
      .update("cop-account-erasure-identity-v1\0").update(JSON.stringify([issuer, manifest.actors.a.subjectId])).digest("hex"),
      entry = view.entries.find(value => value.accountKey === key && value.job.operationId === original.operationId),
      job = (await target.query("SELECT value FROM cop_mobility_v1 WHERE key=$1", ["account-erasure:job:" + key])).rows[0]?.value;
    need(entry && job?.operationId === original.operationId && job.requestedAt === entry.job.requestedAt, "WHOLE_ORIGINAL_RETRY_BINDING_UNPROVEN");
    return { operationId: entry.job.operationId, requestedAt: entry.job.requestedAt };
  } finally { await continuity.close(); }
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
function serverProof() {
  const lease = JSON.parse(readFileSync("/dev/shm/cop-whole/run-lease.json", "utf8"));
  need(Number.isInteger(lease.pid) && lease.pid > 1 && lease.operationId === original.operationId, "WHOLE_RETRY_SERVER_LEASE_UNPROVEN");
  const command = readFileSync("/proc/" + lease.pid + "/cmdline").toString().split("\0").filter(Boolean), raw = readFileSync("/proc/" + lease.pid + "/stat", "utf8"),
    fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/u);
  need(command.length === 2 && command[0] === "node" && command[1] === "/dev/shm/cop-whole/probe.mjs" && fields[0] !== "Z" && /^[0-9]+$/u.test(fields[19]), "WHOLE_RETRY_SERVER_PID_UNPROVEN");
  return { serverPid: lease.pid, serverStartTicks: fields[19] };
}
try {
  const before = await operationBinding(), initialBytes = readFileSync("/dev/shm/cop-whole/initial-confirmation-attempt.json"), initial = JSON.parse(initialBytes),
    recoveryPath = "/dev/shm/cop-whole/recovery-accepted-confirmation.json", recovery = existsSync(recoveryPath) ? JSON.parse(readFileSync(recoveryPath, "utf8")) : undefined,
    crash = existsSync("/dev/shm/cop-whole/main-crash-verified-checkpoint.json") ? JSON.parse(readFileSync("/dev/shm/cop-whole/main-crash-verified-checkpoint.json", "utf8")) : undefined,
    acceptingRecovery = initial.actualHttpStatus === 503 && !recovery && !crash;
  need(initial.operationId === before.operationId && (initial.actualHttpStatus === 202 ||
    initial.actualHttpStatus === 503 && manifest.integration.expectedInitialOutage503 === true), "WHOLE_RETRY_HTTP_SCENARIO_UNREVIEWED");
  const processProof = serverProof();
  if (!acceptingRecovery) {
    assessAcceptedConfirmation({ initial, recovery, initialAttemptSha256: confirmationEvidenceSha256(initialBytes), ...before });
    need(crash?.operationId === before.operationId && crash.requestedAt === before.requestedAt && crash.processStopped === true &&
      processProof.serverPid !== crash.pid && BigInt(processProof.serverStartTicks) > BigInt(crash.startTicks), "WHOLE_POST_CRASH_RETRY_NOT_YET_ALLOWED");
  }
  const authentication = await actualCodeLogin(manifest.actors.a);
  const response = await fetch("http://127.0.0.1:4310/api/v1/me/account-deletion", { method: "POST", redirect: "error",
    headers: { authorization: "Bearer " + authentication.access_token, "content-type": "application/json", "idempotency-key": before.operationId },
    body: JSON.stringify({ confirmAccountDeletion: true }), signal: AbortSignal.timeout(180000) });
  const value = await response.json(), after = await operationBinding();
  need(JSON.stringify(before) === JSON.stringify(after), "WHOLE_RETRY_CHANGED_ORIGINAL_OPERATION");
  const retryNormal202Verified = response.status === 202 && value.accountDeleted === false && value.status === "deleting" &&
    value.operationId === before.operationId && value.requestedAt === before.requestedAt;
  need(JSON.stringify(processProof) === JSON.stringify(serverProof()), "WHOLE_RETRY_SERVER_CHANGED_DURING_REQUEST");
  const checkedAt = new Date().toISOString();
  if (acceptingRecovery) {
    const accepted = { contractVersion: "cop-whole-recovery-accepted-confirmation-v1", phase: "actual_original_confirmation_recovery_accepted", ...before,
      actualHttpStatus: response.status, acceptedNormal202Verified: retryNormal202Verified, originalOperationAndDatePreserved: true,
      initialAttemptSha256: confirmationEvidenceSha256(initialBytes), acceptedAt: checkedAt, ...processProof,
      initialHttpStatus: initial.actualHttpStatus, initialNormal202Verified: false, wholeAccountAccepted: false, productionChanged: false };
    writeFileSync("/dev/shm/cop-whole/recovery-accepted-attempt-" + randomUUID() + ".json", JSON.stringify(accepted), { mode: 0o600, flag: "wx" });
    if (retryNormal202Verified) writeFileSync(recoveryPath, JSON.stringify(accepted), { mode: 0o600, flag: "wx" });
    process.stdout.write(JSON.stringify(accepted) + "\n");
  } else {
    const result = { contractVersion: "cop-whole-confirmation-retry-v1", phase: "actual_original_confirmation_retry", ...before,
      actualHttpStatus: response.status, retryNormal202Verified, checkedAt, ...processProof,
      initialHttpStatus: initial.actualHttpStatus, initialNormal202Verified: initial.actualHttpStatus === 202 && initial.normalPendingReceiptVerified === true,
      originalOperationAndDatePreserved: true, accountDeleted: value.accountDeleted === true, wholeAccountAccepted: false, productionChanged: false };
    writeFileSync("/dev/shm/cop-whole/confirmation-retry-evidence-" + randomUUID() + ".json", JSON.stringify(result), { mode: 0o600, flag: "wx" });
    process.stdout.write(JSON.stringify(result) + "\n");
  }
  if (!retryNormal202Verified) process.exitCode = 2;
} catch (error) {
  process.stdout.write(JSON.stringify({ phase: "actual_original_confirmation_retry_failed",
    code: /^[A-Z0-9_]{1,150}$/u.test(error.message ?? "") ? error.message : "WHOLE_ORIGINAL_RETRY_FAILED", productionChanged: false, wholeAccountAccepted: false }) + "\n");
  process.exitCode = 2;
} finally { globalThis.fetch = nativeFetch; }
