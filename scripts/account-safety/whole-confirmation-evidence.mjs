/** Pure evidence checks. They cannot issue an HTTP request or mark whole GO. */
import { createHash } from "node:crypto";
const need = (value, code) => { if (!value) throw Error(code); };
const time = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? Date.parse(value) : NaN;
const bound = (value, operationId, requestedAt) => value?.operationId === operationId && value.requestedAt === requestedAt;
export const confirmationEvidenceSha256 = value => createHash("sha256").update(value).digest("hex");
export function assessAcceptedConfirmation({ initial, recovery, initialAttemptSha256, operationId, requestedAt }) {
  need(initial?.contractVersion === "cop-whole-initial-confirmation-attempt-v1" && initial.operationId === operationId &&
    /^[a-f0-9]{64}$/u.test(initialAttemptSha256) && Number.isFinite(time(initial.checkedAt)), "WHOLE_INITIAL_HTTP_FACT_MISSING");
  if (initial.actualHttpStatus === 202 && initial.normalPendingReceiptVerified === true && bound(initial, operationId, requestedAt))
    return { initialHttpStatus: 202, initialNormal202Verified: true, recoveryAccepted202Verified: false, acceptedAt: initial.checkedAt };
  need(initial.actualHttpStatus === 503 && initial.normalPendingReceiptVerified === false, "WHOLE_INITIAL_HTTP_SCENARIO_UNREVIEWED");
  need(recovery?.contractVersion === "cop-whole-recovery-accepted-confirmation-v1" && bound(recovery, operationId, requestedAt) &&
    recovery.actualHttpStatus === 202 && recovery.acceptedNormal202Verified === true && recovery.originalOperationAndDatePreserved === true &&
    recovery.initialAttemptSha256 === initialAttemptSha256 && Number.isInteger(recovery.serverPid) && recovery.serverPid > 1 &&
    typeof recovery.serverStartTicks === "string" && /^[0-9]+$/u.test(recovery.serverStartTicks) &&
    time(initial.checkedAt) <= time(recovery.acceptedAt), "WHOLE_RECOVERY_ACTUAL_ACCEPTED_202_MISSING");
  return { initialHttpStatus: 503, initialNormal202Verified: false, recoveryAccepted202Verified: true, acceptedAt: recovery.acceptedAt };
}
export function verifyConfirmationRecovery(input) {
  const { recovery, initialAttemptSha256, crash, retry, operationId, requestedAt } = input;
  const accepted = assessAcceptedConfirmation(input);
  need(crash?.contractVersion === "cop-whole-main-crash-checkpoint-v1" && bound(crash, operationId, requestedAt) && crash.processStopped === true &&
    crash.independentJournalUnchanged === true && crash.originalSealedJobPreserved === true && crash.targetConnections === 0 && crash.guardConnections === 0 &&
    Number.isInteger(crash.pid) && crash.pid > 1 && typeof crash.startTicks === "string" && /^[0-9]+$/u.test(crash.startTicks) &&
    time(accepted.acceptedAt) <= time(crash.signalSentAt) && time(crash.signalSentAt) <= time(crash.processStoppedAt), "WHOLE_ACTUAL_CRASH_EVIDENCE_MISSING");
  const acceptedBytesSha = accepted.initialNormal202Verified ? initialAttemptSha256 : confirmationEvidenceSha256(JSON.stringify(recovery));
  need(crash.acceptedConfirmationSha256 === acceptedBytesSha && (!accepted.recoveryAccepted202Verified ||
    recovery.serverPid === crash.pid && recovery.serverStartTicks === crash.startTicks), "WHOLE_CRASH_NOT_BOUND_TO_ACCEPTED_202");
  need(retry?.contractVersion === "cop-whole-confirmation-retry-v1" && bound(retry, operationId, requestedAt) && retry.actualHttpStatus === 202 &&
    retry.retryNormal202Verified === true && retry.originalOperationAndDatePreserved === true && Number.isInteger(retry.serverPid) && retry.serverPid > 1 &&
    retry.serverPid !== crash.pid && typeof retry.serverStartTicks === "string" && /^[0-9]+$/u.test(retry.serverStartTicks) &&
    BigInt(retry.serverStartTicks) > BigInt(crash.startTicks) && time(crash.processStoppedAt) <= time(retry.checkedAt), "WHOLE_ACTUAL_POST_CRASH_202_RETRY_MISSING");
  return { initialHttpStatus: accepted.initialHttpStatus, initialNormal202Verified: accepted.initialNormal202Verified,
    recoveryAccepted202Verified: accepted.recoveryAccepted202Verified, controlledMainCrashVerified: true, retryNormal202Verified: true };
}

/** Publish only the finite HTTP/process facts. The private crash checkpoint also
 * contains sealed jobs and guard snapshots; those must never enter a receipt. */
export function publicConfirmationRecoveryEvidence(input) {
  const pick = (value, keys) => value === undefined ? undefined : Object.fromEntries(Object.keys(value).filter(key => keys.includes(key)).map(key => [key, value[key]]));
  const initial = pick(input.initial, ["contractVersion", "operationId", "actualHttpStatus", "normalPendingReceiptVerified", "requestedAt", "errorCode", "testedSource", "checkedAt", "wholeAccountAccepted", "productionChanged"]);
  if (initial?.testedSource) initial.testedSource = pick(initial.testedSource, ["sourceRevision", "sourceWorkingTreeDirty", "compiledApiClosureSha256", "runtimeResourceClosureSha256", "compiledWorkspaceClosureSha256", "nodeBaseImageId"]);
  const recovery = pick(input.recovery, ["contractVersion", "phase", "operationId", "requestedAt", "actualHttpStatus", "acceptedNormal202Verified", "originalOperationAndDatePreserved", "initialAttemptSha256", "acceptedAt", "serverPid", "serverStartTicks", "initialHttpStatus", "initialNormal202Verified", "wholeAccountAccepted", "productionChanged"]);
  const crash = pick(input.crash, ["contractVersion", "operationId", "requestedAt", "processStopped", "independentJournalUnchanged", "originalSealedJobPreserved", "targetConnections", "guardConnections", "pid", "startTicks", "signalSentAt", "processStoppedAt", "acceptedConfirmationSha256", "sourceSha"]);
  const retry = pick(input.retry, ["contractVersion", "phase", "operationId", "requestedAt", "actualHttpStatus", "retryNormal202Verified", "checkedAt", "serverPid", "serverStartTicks", "initialHttpStatus", "initialNormal202Verified", "originalOperationAndDatePreserved", "accountDeleted", "wholeAccountAccepted", "productionChanged"]);
  need(confirmationEvidenceSha256(JSON.stringify(initial)) === input.initialAttemptSha256, "WHOLE_PUBLIC_INITIAL_EVIDENCE_CHANGED");
  need(recovery === undefined || JSON.stringify(recovery) === JSON.stringify(input.recovery), "WHOLE_PUBLIC_RECOVERY_EVIDENCE_CHANGED");
  const result = { initial, ...(recovery ? { recovery } : {}), crash, retry, initialAttemptSha256: input.initialAttemptSha256, operationId: input.operationId, requestedAt: input.requestedAt };
  verifyConfirmationRecovery(result);
  return result;
}
