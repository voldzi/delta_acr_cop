import assert from "node:assert/strict";
import { test } from "node:test";
import { publicConfirmationRecoveryEvidence, assessAcceptedConfirmation, confirmationEvidenceSha256, verifyConfirmationRecovery } from "./whole-confirmation-evidence.mjs";
const operationId="10000000-0000-4000-8000-000000000001",requestedAt="2026-10-16T12:00:00.000Z",initialAttemptSha256="a".repeat(64);
function fixture(){const initial={contractVersion:"cop-whole-initial-confirmation-attempt-v1",operationId,actualHttpStatus:503,normalPendingReceiptVerified:false,checkedAt:"2026-10-16T12:00:02.000Z"};const recovery={contractVersion:"cop-whole-recovery-accepted-confirmation-v1",operationId,requestedAt,actualHttpStatus:202,acceptedNormal202Verified:true,originalOperationAndDatePreserved:true,initialAttemptSha256,acceptedAt:"2026-10-16T12:01:00.000Z",serverPid:100,serverStartTicks:"1000"};const crash={contractVersion:"cop-whole-main-crash-checkpoint-v1",operationId,requestedAt,processStopped:true,independentJournalUnchanged:true,originalSealedJobPreserved:true,targetConnections:0,guardConnections:0,pid:100,startTicks:"1000",signalSentAt:"2026-10-16T12:02:00.000Z",processStoppedAt:"2026-10-16T12:02:01.000Z",acceptedConfirmationSha256:confirmationEvidenceSha256(JSON.stringify(recovery))};const retry={contractVersion:"cop-whole-confirmation-retry-v1",operationId,requestedAt,actualHttpStatus:202,retryNormal202Verified:true,originalOperationAndDatePreserved:true,serverPid:101,serverStartTicks:"2000",checkedAt:"2026-10-16T12:03:00.000Z"};return {initial,recovery,crash,retry,initialAttemptSha256,operationId,requestedAt};}
test("real503 fact is preserved separately from later accepted202/crash/retry",()=>{const f=fixture();assert.deepEqual(verifyConfirmationRecovery(f),{initialHttpStatus:503,initialNormal202Verified:false,recoveryAccepted202Verified:true,controlledMainCrashVerified:true,retryNormal202Verified:true});assert.equal(f.initial.actualHttpStatus,503);});
test("first accepted202 cannot count as postcrash retry",()=>{const f=fixture();assert.throws(()=>verifyConfirmationRecovery({...f,retry:{...f.retry,serverPid:100,serverStartTicks:"1000",checkedAt:f.recovery.acceptedAt}}));});
test("missing evidence and false or substituted proof are rejected",()=>{for(const key of ["initial","recovery","crash","retry"]){const f=fixture();delete f[key];assert.throws(()=>verifyConfirmationRecovery(f));}const f=fixture();for(const [key,value] of [["processStopped",false],["independentJournalUnchanged",false],["targetConnections",1],["acceptedConfirmationSha256","b".repeat(64)]])assert.throws(()=>verifyConfirmationRecovery({...f,crash:{...f.crash,[key]:value}}));});
test("foreign operation, date, initialhash and owner process are rejected",()=>{for(const [key,value]of [["operationId","foreign"],["requestedAt","2026-10-16T11:00:00.000Z"],["initialAttemptSha256","b".repeat(64)],["serverPid",2]]){const f=fixture();assert.throws(()=>verifyConfirmationRecovery({...f,recovery:{...f.recovery,[key]:value}}));}});
test("backwards clocks and old process start cannot pass",()=>{const f=fixture();for(const [part,key,value]of [["recovery","acceptedAt","2026-10-16T11:59:00.000Z"],["crash","signalSentAt","2026-10-16T12:00:30.000Z"],["retry","checkedAt","2026-10-16T12:01:59.000Z"],["retry","serverStartTicks","999"]])assert.throws(()=>verifyConfirmationRecovery({...f,[part]:{...f[part],[key]:value}}));});
test("normal initial202 remains supported without recovery reclassification",()=>{const f=fixture();f.initial={...f.initial,requestedAt,actualHttpStatus:202,normalPendingReceiptVerified:true};delete f.recovery;f.crash.acceptedConfirmationSha256=initialAttemptSha256;assert.equal(assessAcceptedConfirmation(f).initialNormal202Verified,true);assert.equal(verifyConfirmationRecovery(f).recoveryAccepted202Verified,false);});

function publicFixture() {
  const value = fixture();
  value.initialAttemptSha256 = confirmationEvidenceSha256(JSON.stringify(value.initial));
  value.recovery.initialAttemptSha256 = value.initialAttemptSha256;
  value.crash.acceptedConfirmationSha256 = confirmationEvidenceSha256(JSON.stringify(value.recovery));
  return value;
}
test("public confirmation receipt excludes sealed job, guard snapshot and arbitrary private checkpoint fields", () => {
  const input = publicFixture();
  input.crash.localJob = { sealedPrincipal: "private-synthetic-value" };
  input.crash.originalGuardSnapshot = { key: "private-synthetic-value" };
  input.crash.priorCheckpointPath = "/private/synthetic/path";
  const result = publicConfirmationRecoveryEvidence(input);
  assert.equal(JSON.stringify(result).includes("private-synthetic"), false);
  assert.equal(result.initial.actualHttpStatus, 503);
  assert.equal(verifyConfirmationRecovery(result).retryNormal202Verified, true);
});
test("unexpected initial or recovery fields cannot silently change their original hash chain", () => {
  const input = publicFixture();
  input.initial.secret = "private-synthetic-value";
  input.initialAttemptSha256 = confirmationEvidenceSha256(JSON.stringify(input.initial));
  assert.throws(() => publicConfirmationRecoveryEvidence(input), /WHOLE_PUBLIC_INITIAL_EVIDENCE_CHANGED/);
  const other = publicFixture();
  other.recovery.secret = "private-synthetic-value";
  other.crash.acceptedConfirmationSha256 = confirmationEvidenceSha256(JSON.stringify(other.recovery));
  assert.throws(() => publicConfirmationRecoveryEvidence(other), /WHOLE_PUBLIC_RECOVERY_EVIDENCE_CHANGED/);
});
test("public initial202 branch preserves the original initial bytes hash", () => {
  const input = publicFixture();
  input.initial = { ...input.initial, requestedAt, actualHttpStatus: 202, normalPendingReceiptVerified: true };
  input.initialAttemptSha256 = confirmationEvidenceSha256(JSON.stringify(input.initial));
  delete input.recovery;
  input.crash.acceptedConfirmationSha256 = input.initialAttemptSha256;
  assert.equal(verifyConfirmationRecovery(publicConfirmationRecoveryEvidence(input)).initialNormal202Verified, true);
});
