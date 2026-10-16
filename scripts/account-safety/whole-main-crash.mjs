/** Controlled crash of the exact owned synthetic whole probe, never a provider. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { assessAcceptedConfirmation, confirmationEvidenceSha256 } from "./confirmation-evidence.mjs";
const need = (value, code) => { if (!value) throw Error(code); }, root = "/dev/shm/cop-whole";
const expected = JSON.parse(readFileSync(0, "utf8")), f = JSON.parse(readFileSync(root + "/private-manifest.json", "utf8")),
  before = JSON.parse(readFileSync(root + "/pre-deletion-checkpoint.json", "utf8")), leaseBytes = readFileSync(root + "/run-lease.json"), lease = JSON.parse(leaseBytes),
  attempt = JSON.parse(readFileSync(root + "/initial-confirmation-attempt.json", "utf8"));
need(f.contractVersion === "cop-account-erasure-whole-fixture-v1" && f.issuer === "https://cop-erasure-keycloak.invalid/realms/cop-erasure-whole" &&
  before.operationId === lease.operationId && attempt.operationId === lease.operationId &&
  (attempt.actualHttpStatus === 202 || attempt.actualHttpStatus === 503 && f.integration.expectedInitialOutage503 === true),
  "WHOLE_CRASH_HTTP_SCENARIO_NOT_ACCEPTED");
const initialBytes = readFileSync(root + "/initial-confirmation-attempt.json"),
  recovery = existsSync(root + "/recovery-accepted-confirmation.json") ? JSON.parse(readFileSync(root + "/recovery-accepted-confirmation.json", "utf8")) : undefined;

need(Number.isInteger(lease.pid) && lease.pid > 1 && lease.pid !== process.pid && !existsSync(root + "/main-crash-verified-checkpoint.json"), "WHOLE_CRASH_PID_OR_REPETITION_REJECTED");
const sourceSha = createHash("sha256").update(readFileSync(root + "/probe.mjs")).digest("hex");
need(sourceSha === expected.sourceSha, "WHOLE_CRASH_SOURCE_MISMATCH");
function pidProof() {
  const cmd = readFileSync("/proc/" + lease.pid + "/cmdline").toString().split("\0").filter(Boolean), stat = readFileSync("/proc/" + lease.pid + "/stat", "utf8"),
    fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
  need(cmd.length === 2 && cmd[0] === "node" && cmd[1] === root + "/probe.mjs" && /^\d+$/u.test(fields[19]) && fields[0] !== "Z", "WHOLE_CRASH_MAIN_PROCESS_UNPROVEN");
  return { pid: lease.pid, startTicks: fields[19], command: cmd, sourceSha };
}
const processProof = pidProof(), { Pool } = createRequire("/app/apps/cop-api/package.json")("pg"),
  { PostgresAccountErasureContinuity } = await import("file://" + root + "/apps/cop-api/dist/account-erasure-continuity-postgres.js"), db = f.database,
  guard = new Pool({ connectionString: db.guardRuntimeUrl, max: 1 }), target = new Pool({ connectionString: db.guardTargetReadUrl, max: 1 }),
  continuity = new PostgresAccountErasureContinuity(guard, target, { guardStoreId: db.guardStoreId, applicationStoreId: db.applicationStoreId,
    incarnationId: db.incarnationId, configurationFingerprint: db.configurationFingerprint });
try {
  const snapshot = await continuity.snapshot(), key = createHmac("sha256", f.integration.environment.COP_ACCOUNT_ERASURE_SECRET)
    .update("cop-account-erasure-identity-v1\0").update(JSON.stringify([f.issuer, f.actors.a.subjectId])).digest("hex"),
    entry = snapshot.entries.find(value => value.accountKey === key && value.job.operationId === lease.operationId),
    jobKey = "account-erasure:job:" + key,
    job = (await target.query("SELECT value FROM cop_mobility_v1 WHERE key=$1", [jobKey])).rows[0]?.value;
  need(entry && job?.operationId === entry.job.operationId && job.requestedAt === entry.job.requestedAt &&
    typeof job.sealedPrincipal === "string" && !job.completedAt, "WHOLE_CRASH_ORIGINAL_SEALED_JOB_MISSING");
  const accepted = assessAcceptedConfirmation({ initial: attempt, recovery, initialAttemptSha256: confirmationEvidenceSha256(initialBytes),
    operationId: job.operationId, requestedAt: job.requestedAt });
  need(!accepted.recoveryAccepted202Verified || recovery.serverPid === processProof.pid && recovery.serverStartTicks === processProof.startTicks,
    "WHOLE_CRASH_ACCEPTED_202_OTHER_PROCESS");
  const acceptedConfirmationSha256 = accepted.initialNormal202Verified ? confirmationEvidenceSha256(initialBytes) : confirmationEvidenceSha256(JSON.stringify(recovery));
  const completed = Object.keys(job.checkpoints).filter(id => job.checkpoints[id].status === "completed").sort(), checkpointPath = root + "/pre-crash-checkpoint-" + randomUUID() + ".json";
  need(completed.length > 0 && completed.length < 11, "WHOLE_CRASH_PARTIAL_CHECKPOINT_REQUIRED");
  writeFileSync(checkpointPath, JSON.stringify({ contractVersion: "cop-whole-pre-crash-checkpoint-v1", ...processProof,
    operationId: job.operationId, requestedAt: job.requestedAt, originalGuardSnapshot: snapshot, localJob: job, completed,
    originalBefore: before.before, originalPreDeletionCheckpointSha256: createHash("sha256").update(readFileSync(root + "/pre-deletion-checkpoint.json")).digest("hex"),
    source: f.testedSource, checkedAt: new Date().toISOString(), productionChanged: false }), { mode: 0o600, flag: "wx" });
  need(JSON.stringify(pidProof()) === JSON.stringify(processProof) && readFileSync(root + "/run-lease.json").equals(leaseBytes), "WHOLE_CRASH_PID_OR_LEASE_CHANGED");
  const signalSentAt = new Date().toISOString(); process.kill(lease.pid, "SIGTERM");
  const deadline = Date.now() + 15000; while (existsSync("/proc/" + lease.pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  need(!existsSync("/proc/" + lease.pid), "WHOLE_CRASH_MAIN_DID_NOT_STOP");
  const processStoppedAt = new Date().toISOString();
  const after = await continuity.snapshot(), current = (await target.query("SELECT value FROM cop_mobility_v1 WHERE key=$1", [jobKey])).rows[0]?.value;
  need(JSON.stringify(snapshot) === JSON.stringify(after) && current?.operationId === job.operationId && current.requestedAt === job.requestedAt &&
    current.sealedPrincipal === job.sealedPrincipal && !current.completedAt, "WHOLE_CRASH_DURABLE_BINDING_CHANGED");
  for (const id of completed) need(JSON.stringify(current.checkpoints[id]) === JSON.stringify(job.checkpoints[id]), "WHOLE_CRASH_COMPLETED_PROOF_CHANGED");
  const roles = [...new Set([new URL(db.businessRuntimeUrl).username, new URL(db.guardTargetReadUrl).username])],
    targetConnections = (await target.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename=ANY($1::text[]) AND pid<>pg_backend_pid()", [roles])).rows[0].n,
    guardConnections = (await guard.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename=$1 AND pid<>pg_backend_pid()", [new URL(db.guardRuntimeUrl).username])).rows[0].n;
  need(targetConnections === 0 && guardConnections === 0, "WHOLE_CRASH_RUNTIME_CONNECTIONS_REMAIN");
  const result = { contractVersion: "cop-whole-main-crash-checkpoint-v1", phase: "actual_whole_main_crash_checkpoint_verified", ...processProof,
    operationId: job.operationId, requestedAt: job.requestedAt, signal: "SIGTERM", signalSentAt, processStoppedAt, acceptedConfirmationSha256, processStopped: true, gracefulCloseVerified: false,
    independentJournalUnchanged: true, originalSealedJobPreserved: true, originalDateAndOperationPreserved: true, completedOwnerCount: completed.length,
    targetConnections, guardConnections, workerLeaseReset: false, initialHttpStatus: accepted.initialHttpStatus, initialNormal202Verified: accepted.initialNormal202Verified,
    recoveryAccepted202Verified: accepted.recoveryAccepted202Verified, wholeAccountAccepted: false, productionChanged: false };
  writeFileSync(root + "/main-crash-verified-checkpoint.json", JSON.stringify({ ...result, priorCheckpointPath: checkpointPath, originalGuardSnapshot: snapshot, localJob: current }), { mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
} finally { await continuity.close(); }
