/** Four-actor scenario for the single, newly owned server-local fixture.
 * Provider responses and COP handlers stay real. This is not an erasure adapter.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
const need = (value, code) => { if (!value) throw Error(code); };
const OWNER = "cop-erasure-whole-92f0a7d635c8", HEX = /^[a-f0-9]{64}$/u;
export const WHOLE_PHASE_LIMITS = Object.freeze({ onlineWaitMs: 4_200_000, operatorRestoreWaitMs: 1_800_000,
  postRestoreWaitMs: 4_200_000, noviceWaitMs: 4_200_000, serverLocalLeaseSeconds: 18_000 });
function scope(manifest) {
  need(manifest?.serverLocal?.contractVersion === "cop-whole-server-local-v1" && manifest.ownerLabel === OWNER &&
    Object.keys(manifest.actors ?? {}).sort().join() === "a,b,c,d" &&
    ["a","b","c","d"].every(key => /^[a-f0-9-]{36}$/u.test(manifest.actors?.[key]?.subjectId)) &&
    new Set(Object.values(manifest.actors).map(actor => actor.subjectId)).size === 4, "WHOLE_ADDITIONAL_ACTOR_SCOPE_REJECTED");
}
export function validateAdditionalActorReadback(value) {
  need(value?.contractVersion === "cop-whole-erasure-readback-v1" && value.additionalActors &&
    Object.keys(value.additionalActors).sort().join() === "c,d", "WHOLE_ADDITIONAL_READBACK_MISSING");
  for (const key of ["c", "d"]) {
    const row = value.additionalActors[key];
    need(row && Object.keys(row).sort().join() === "communicationUsageCount,fingerprint,matrixMappingCount,matrixRemovableCount" &&
      ["matrixMappingCount","communicationUsageCount","matrixRemovableCount"].every(field => Number.isSafeInteger(row[field]) && row[field] >= 0) &&
      HEX.test(row.fingerprint), "WHOLE_ADDITIONAL_READBACK_INVALID");
  }
  return structuredClone(value.additionalActors);
}
export async function readAdditionalActors(context) {
  scope(context.manifest);
  const binding = context.manifest.integration.providerReadbacks?.messaging_matrix;
  need(binding?.url === "http://127.0.0.1:4323/readback" && typeof binding.token === "string" && binding.token.length >= 32,
    "WHOLE_ADDITIONAL_READBACK_BINDING_MISSING");
  const response = await context.nativeFetch(binding.url, { method: "GET", redirect: "error", headers: { authorization: "Bearer " + binding.token }, signal: AbortSignal.timeout(15000) });
  need(response.status === 200, "WHOLE_ADDITIONAL_READBACK_UNAVAILABLE");
  return validateAdditionalActorReadback(await response.json());
}
export function verifyActualPeerAttestation(requests, manifest) {
  scope(manifest);
  need(Array.isArray(requests) && requests.length === 1, "WHOLE_NEW_PEER_OUTBOUND_REQUEST_UNPROVEN");
  const request = requests[0], packet = request.peerBindings, observed = Date.parse(request.checkedAt);
  need(request.actorUserId === manifest.actors.a.subjectId && request.issuer === manifest.issuer &&
    request.targetUserIds?.join() === manifest.actors.d.subjectId && packet &&
    Object.keys(packet).sort().join() === "actorUserId,contractVersion,issuer,observedAt,peers,source,validUntil" &&
    packet.contractVersion === "cop-verified-peer-bindings-v1" && packet.source === "canonical_cop_profile" &&
    packet.actorUserId === manifest.actors.a.subjectId && packet.issuer === manifest.issuer &&
    Array.isArray(packet.peers) && packet.peers.length === 1 && Object.keys(packet.peers[0]).sort().join() === "issuer,userId" &&
    packet.peers[0].userId === manifest.actors.d.subjectId && packet.peers[0].issuer === manifest.issuer &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(packet.observedAt) &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(packet.validUntil) &&
    Date.parse(packet.validUntil) - Date.parse(packet.observedAt) === 30000 && Number.isFinite(observed) && Date.parse(packet.observedAt) <= observed &&
    observed < Date.parse(packet.validUntil), "WHOLE_NEW_PEER_ATTESTATION_UNPROVEN");
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}
export async function prepareAdditionalActors(context, options) {
  scope(context.manifest);
  const before = await readAdditionalActors(context);
  for (const key of ["c","d"]) need(before[key].matrixMappingCount === 0 && before[key].communicationUsageCount === 0 &&
    before[key].matrixRemovableCount === 0, "WHOLE_NOVICE_OR_PEER_PREPROVISIONED");
  const c = await options.login(context.manifest.actors.c), headerC = { authorization: "Bearer " + c.access_token }, previewOperationId = randomUUID();
  const preview = await context.app.inject({ method: "POST", url: "/api/v1/me/account-deletion/preflight", headers: { ...headerC, "idempotency-key": previewOperationId }, payload: {} });
  need(preview.statusCode === 200 && preview.json().canConfirm === true, "WHOLE_NOVICE_PURE_PREVIEW_UNAVAILABLE");
  const afterPreview = await readAdditionalActors(context);
  assert.deepEqual(afterPreview, before, "WHOLE_NOVICE_PREVIEW_MUTATED_USAGE_OR_MATRIX");
  const previewCheckedAt = new Date().toISOString();
  const d = await options.login(context.manifest.actors.d), headerD = { authorization: "Bearer " + d.access_token };
  const warmed = await context.app.inject({ url: "/api/v1/me/preferences", headers: headerD });
  need(warmed.statusCode === 200 && warmed.json().actor?.subjectId === context.manifest.actors.d.subjectId &&
    warmed.json().actor?.issuer === context.manifest.issuer, "WHOLE_PEER_CANONICAL_PROFILE_WARMUP_FAILED");
  let firstContactStatus;
  const captured = await options.observePeerRequest(async () => {
    const created = await context.app.inject({ method: "POST", url: "/api/v1/messaging/conversations", headers: context.headersA,
      payload: { title: "Synthetic first contact", type: "direct", members: [{ userId: context.manifest.actors.d.subjectId }] } });
    firstContactStatus = created.statusCode;
    need(created.statusCode === 201 && created.json().conversation?.matrix?.roomId, "WHOLE_FIRST_CONTACT_VIA_COP_FAILED");
  });
  const peerAttestationSha256 = verifyActualPeerAttestation(captured, context.manifest), firstContactCheckedAt = new Date().toISOString(), afterContact = await readAdditionalActors(context);
  need(afterContact.d.matrixMappingCount > 0 && afterContact.d.communicationUsageCount > 0,
    "WHOLE_FIRST_CONTACT_D_ACTUAL_PROVISIONING_UNPROVEN");
  assert.deepEqual(afterContact.c, before.c, "WHOLE_FIRST_CONTACT_MUTATED_NOVICE");
  return { contractVersion: "cop-whole-additional-actors-checkpoint-v1", novicePreviewVerified: true, actualCodeLoginsVerified: true,
    firstContactViaCopVerified: true, peerAttestationSha256, noviceBefore: before.c, preservedD: afterContact.d,
    novicePreview: { operationId: previewOperationId, checkedAt: previewCheckedAt, actualHttpStatus: preview.statusCode, canConfirm: preview.json().canConfirm,
      before: before.c, after: afterPreview.c }, firstContact: { checkedAt: firstContactCheckedAt, actualHttpStatus: firstContactStatus,
      peerProfile: { subjectId: warmed.json().actor.subjectId, issuer: warmed.json().actor.issuer }, outbound: captured[0], peerAttestationSha256,
      before: before.d, after: afterContact.d } };
}
export async function verifyAdditionalActorsPreserved(context, checkpoint) {
  scope(context.manifest);
  need(checkpoint?.contractVersion === "cop-whole-additional-actors-checkpoint-v1", "WHOLE_ADDITIONAL_CHECKPOINT_MISSING");
  const actual = await readAdditionalActors(context);
  assert.deepEqual(actual.d, checkpoint.preservedD, "WHOLE_CONTROL_D_CHANGED");
  assert.deepEqual(actual.c, checkpoint.noviceBefore, "WHOLE_NOVICE_CHANGED_BEFORE_OWN_DELETION");
  return actual;
}
export async function eraseNoviceAfterPrimaryRestore(context, checkpoint, options) {
  scope(context.manifest);
  need(options.primaryRestoreVerified === true, "WHOLE_NOVICE_MUST_FOLLOW_PRIMARY_RESTORE");
  need(typeof options.writeCheckpoint === "function", "WHOLE_NOVICE_PRIVATE_CHECKPOINT_REQUIRED");
  await verifyAdditionalActorsPreserved(context, checkpoint);
  const c = await options.login(context.manifest.actors.c), headers = { authorization: "Bearer " + c.access_token }, operationId = randomUUID(), path = "/api/v1/me/account-deletion";
  const plan = await context.app.inject({ method: "POST", url: path + "/preflight", headers: { ...headers, "idempotency-key": operationId }, payload: {} });
  need(plan.statusCode === 200 && plan.json().canConfirm === true && typeof plan.headers["x-cop-erasure-receipt-capability"] === "string",
    "WHOLE_NOVICE_FRESH_PREFLIGHT_FAILED");
  const capability = plan.headers["x-cop-erasure-receipt-capability"], confirmed = await context.app.inject({ method: "POST", url: path,
    headers: { ...headers, "idempotency-key": operationId, "x-cop-erasure-plan": plan.json().planId, "x-cop-erasure-receipt-capability": capability }, payload: { confirmAccountDeletion: true } });
  need(confirmed.statusCode === 202 && confirmed.json().operationId === operationId && confirmed.json().accountDeleted === false,
    "WHOLE_NOVICE_CONFIRMATION_NOT_PENDING_202");
  const confirmedAt = new Date().toISOString();
  const oldBearerHttpStatus = (await context.app.inject({ url: "/api/v1/me/preferences", headers })).statusCode;
  need(oldBearerHttpStatus === 403, "WHOLE_NOVICE_OLD_BEARER_NOT_FENCED");
  options.writeCheckpoint({ contractVersion: "cop-whole-novice-confirmed-checkpoint-v1", operationId,
    primaryOperationId: context.operationId, requestedAt: confirmed.json().requestedAt, receiptCapability: capability,
    peerAttestationSha256: checkpoint.peerAttestationSha256, originalPrimaryRestoreVerified: true });
  options.phase({ phase: "whole_novice_actual_deletion_pending", expectedMinimumVoiceWaitSeconds: 3690, wholeAccountAccepted: false, productionChanged: false });
  const receipt = await options.waitDeleted(headers, capability, operationId, WHOLE_PHASE_LIMITS.noviceWaitMs);
  need(receipt.operationId === operationId && receipt.requestedAt === confirmed.json().requestedAt && receipt.accountDeleted === true && receipt.status === "deleted" && receipt.remaining?.length === 0, "WHOLE_NOVICE_FINAL_RECEIPT_UNPROVEN");
  const freshC = await options.login(context.manifest.actors.c), freshBearerHttpStatus = (await context.app.inject({ url: "/api/v1/me/preferences",
    headers: { authorization: "Bearer " + freshC.access_token } })).statusCode;
  need(freshBearerHttpStatus === 403, "WHOLE_NOVICE_FRESH_BEARER_NOT_FENCED");
  const after = await readAdditionalActors(context);
  need(after.c.matrixMappingCount === 0 && after.c.matrixRemovableCount === 0, "WHOLE_NOVICE_MATRIX_DATA_REMAINS");
  assert.deepEqual(after.d, checkpoint.preservedD, "WHOLE_CONTROL_D_CHANGED_AFTER_NOVICE");
  const simUserinfo = await options.verifySimIdentity(context.manifest.actors.c);
  const freshD = await options.login(context.manifest.actors.d);
  need((await context.app.inject({ url: "/api/v1/me/preferences", headers: { authorization: "Bearer " + freshD.access_token } })).statusCode === 200,
    "WHOLE_D_ACCESS_DAMAGED_AFTER_NOVICE");
  const ownerCompletion = await options.readOwnerCompletion(operationId, receipt.requestedAt, context.manifest.actors.c.subjectId);
  return { operationId, requestedAt: receipt.requestedAt, confirmedAt, actualHttpStatus: confirmed.statusCode, finalReceipt: receipt,
    ownerCompletion, matrixAfter: after.c, oldBearerHttpStatus, freshBearerHttpStatus, simUserinfo, controlDHttpStatus: 200 };
}
const SOURCE_FIELDS = ["sourceRevision","sourceWorkingTreeDirty","compiledApiClosureSha256","runtimeResourceClosureSha256","compiledWorkspaceClosureSha256","nodeBaseImageId"];
const ISSUER = "https://cop-erasure-keycloak.invalid/realms/cop-erasure-whole";
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const instant = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function publicControlBSnapshot(value, expectedOwners) {
  need(Object.keys(value.owners ?? {}).sort().join() === [...expectedOwners].sort().join(), "WHOLE_ADDITIONAL_B_OWNER_READBACK_MISSING");
  return [...expectedOwners].sort().map(owner => { const row = value.owners[owner];
    need(Number.isSafeInteger(row.removableB) && row.removableB >= 0 && HEX.test(row.preservedBFingerprint), "WHOLE_ADDITIONAL_B_OWNER_READBACK_INVALID");
    return { owner, count: row.removableB, fingerprint: row.preservedBFingerprint }; });
}
export function publicAdditionalActorsEvidence(input) {
  scope(input.manifest);
  const result = { contractVersion: "cop-whole-additional-actors-evidence-v1", fixtureOwner: OWNER, issuer: input.manifest.issuer,
    actors: Object.fromEntries(["a","b","c","d"].map(key => [key,input.manifest.actors[key].subjectId])),
    actorRoles: { primary: "a", control: "b", novice: "c", peer: "d" }, testedSource: Object.fromEntries(SOURCE_FIELDS.map(key => [key,input.testedSource[key]])),
    helperSha256: input.helperSha256, primaryOperationId: input.primaryOperationId, primaryRequestedAt: input.primaryRequestedAt,
    keycloak: input.manifest.actualSeedProof, novicePreview: input.checkpoint.novicePreview, firstContact: input.checkpoint.firstContact,
    controlBBefore: input.controlBBefore, preservation: input.preservation, noviceDeletion: input.noviceDeletion,
    noviceRestoreTested: false };
  // Validation is shared with the production installer. No job, token or receipt
  // capability is copied into this exact public envelope.
  return result;
}
export function validateAdditionalActorsEvidence(evidence, options) {
  const { whole, expectedOwners, helperSha256 } = options, e = evidence, owners = [...expectedOwners].sort();
  need(exact(e,["contractVersion","fixtureOwner","issuer","actors","actorRoles","testedSource","helperSha256","primaryOperationId","primaryRequestedAt","keycloak","novicePreview","firstContact","controlBBefore","preservation","noviceDeletion","noviceRestoreTested"]) &&
    e.contractVersion === "cop-whole-additional-actors-evidence-v1" && e.fixtureOwner === OWNER && e.issuer === ISSUER && e.noviceRestoreTested === false,
    "ACTUAL_ADDITIONAL_EVIDENCE_SCOPE_MISSING");
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  need(exact(e.actors,["a","b","c","d"]) && Object.values(e.actors).every(value => uuid.test(value)) && new Set(Object.values(e.actors)).size === 4 &&
    JSON.stringify(e.actorRoles) === JSON.stringify({primary:"a",control:"b",novice:"c",peer:"d"}), "ACTUAL_ADDITIONAL_ACTOR_BINDING_MISSING");
  need(exact(e.testedSource,SOURCE_FIELDS) && SOURCE_FIELDS.every(key => e.testedSource[key] === whole[key]) &&
    HEX.test(helperSha256 ?? "") && e.helperSha256 === helperSha256 && e.primaryOperationId === whole.confirmationEvidence.operationId &&
    e.primaryRequestedAt === whole.confirmationEvidence.requestedAt, "ACTUAL_ADDITIONAL_SOURCE_BINDING_MISSING");
  need(exact(e.keycloak,["signedActorCount","signedClientTokenCount","clientIds","signatureAndUserinfoVerified"]) && e.keycloak.signedActorCount === 4 && e.keycloak.signedClientTokenCount === 12 &&
    JSON.stringify(e.keycloak.clientIds) === JSON.stringify(["cop-web","csm-mobile","csm-sim-web"]) && e.keycloak.signatureAndUserinfoVerified === true,
    "ACTUAL_ADDITIONAL_KEYCLOAK_PROOF_MISSING");
  const state = value => exact(value,["matrixMappingCount","communicationUsageCount","matrixRemovableCount","fingerprint"]) &&
    ["matrixMappingCount","communicationUsageCount","matrixRemovableCount"].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) && HEX.test(value.fingerprint);
  const zero = value => state(value) && value.matrixMappingCount === 0 && value.communicationUsageCount === 0 && value.matrixRemovableCount === 0;
  const preview = e.novicePreview;
  need(exact(preview,["operationId","checkedAt","actualHttpStatus","canConfirm","before","after"]) && uuid.test(preview.operationId) && instant(preview.checkedAt) &&
    preview.operationId !== e.primaryOperationId && preview.actualHttpStatus === 200 && preview.canConfirm === true && zero(preview.before) && zero(preview.after) &&
    JSON.stringify(preview.before) === JSON.stringify(preview.after), "ACTUAL_NOVICE_PURE_PREVIEW_UNPROVEN");
  const first = e.firstContact;
  need(exact(first,["checkedAt","actualHttpStatus","peerProfile","outbound","peerAttestationSha256","before","after"]) && instant(first.checkedAt) &&
    first.actualHttpStatus === 201 && exact(first.peerProfile,["subjectId","issuer"]) && first.peerProfile.subjectId === e.actors.d && first.peerProfile.issuer === ISSUER &&
    zero(first.before) && state(first.after) && first.after.matrixMappingCount > 0 && first.after.communicationUsageCount > 0 &&
    exact(first.outbound,["checkedAt","actorUserId","issuer","targetUserIds","peerBindings"]), "ACTUAL_FIRST_CONTACT_UNPROVEN");
  const outbound = first.outbound, packet = outbound.peerBindings;
  need(outbound.actorUserId === e.actors.a && outbound.issuer === ISSUER && JSON.stringify(outbound.targetUserIds) === JSON.stringify([e.actors.d]) &&
    exact(packet,["contractVersion","actorUserId","issuer","source","observedAt","validUntil","peers"]) && packet.contractVersion === "cop-verified-peer-bindings-v1" &&
    packet.actorUserId === e.actors.a && packet.issuer === ISSUER && packet.source === "canonical_cop_profile" && instant(packet.observedAt) && instant(packet.validUntil) &&
    Date.parse(packet.validUntil) - Date.parse(packet.observedAt) === 30000 && instant(outbound.checkedAt) && Date.parse(packet.observedAt) <= Date.parse(outbound.checkedAt) &&
    Date.parse(outbound.checkedAt) < Date.parse(packet.validUntil) && Date.parse(first.checkedAt) >= Date.parse(outbound.checkedAt) && JSON.stringify(packet.peers) === JSON.stringify([{userId:e.actors.d,issuer:ISSUER}]) &&
    first.peerAttestationSha256 === digest(packet), "ACTUAL_FIRST_CONTACT_PACKET_UNPROVEN");
  const control = value => Array.isArray(value) && value.length === owners.length && value.every((row,index) => exact(row,["owner","count","fingerprint"]) &&
    row.owner === owners[index] && Number.isSafeInteger(row.count) && row.count >= 0 && HEX.test(row.fingerprint));
  need(control(e.controlBBefore) && exact(e.preservation,["online","restored","afterNovice"]), "ACTUAL_ADDITIONAL_PRESERVATION_MISSING");
  for (const key of ["online","restored","afterNovice"]) { const value = e.preservation[key];
    need(exact(value,["checkedAt","controlB","peerD"]) && instant(value.checkedAt) && control(value.controlB) &&
      JSON.stringify(value.controlB) === JSON.stringify(e.controlBBefore) && JSON.stringify(value.peerD) === JSON.stringify(first.after),
      "ACTUAL_ADDITIONAL_CONTROL_CHANGED"); }
  const deletion = e.noviceDeletion, receipt = deletion?.finalReceipt;
  need(exact(deletion,["operationId","requestedAt","confirmedAt","actualHttpStatus","finalReceipt","ownerCompletion","matrixAfter","oldBearerHttpStatus","freshBearerHttpStatus","simUserinfo","controlDHttpStatus"]) &&
    uuid.test(deletion.operationId) && deletion.operationId !== e.primaryOperationId && deletion.operationId !== preview.operationId && instant(deletion.requestedAt) && instant(deletion.confirmedAt) && deletion.actualHttpStatus === 202 &&
    exact(receipt,["contractVersion","deletionScope","operationId","status","requestedAt","completedAt","accountDeleted","revocationEnforced","remaining","pendingReasons"]) &&
    receipt.contractVersion === "cop-account-erasure-v1" && receipt.deletionScope === "cop_jizda_preserve_shared_identity_sim" && receipt.operationId === deletion.operationId && receipt.requestedAt === deletion.requestedAt && instant(receipt.completedAt) &&
    receipt.status === "deleted" && receipt.accountDeleted === true && receipt.revocationEnforced === true && Array.isArray(receipt.remaining) && receipt.remaining.length === 0 && exact(receipt.pendingReasons,[]) &&
    Date.parse(receipt.completedAt) - Date.parse(deletion.requestedAt) >= 3690000 && state(deletion.matrixAfter) && deletion.matrixAfter.matrixMappingCount === 0 && deletion.matrixAfter.matrixRemovableCount === 0 &&
    deletion.oldBearerHttpStatus === 403 && deletion.freshBearerHttpStatus === 403 && exact(deletion.simUserinfo,["status","subjectId"]) && deletion.simUserinfo.status === 200 && deletion.simUserinfo.subjectId === e.actors.c && deletion.controlDHttpStatus === 200,
    "ACTUAL_NOVICE_COMPLETE_DELETION_UNPROVEN");
  const completed = deletion.ownerCompletion;
  need(exact(completed,["operationId","requestedAt","completedOwners","journalDigest"]) && completed.operationId === deletion.operationId && completed.requestedAt === deletion.requestedAt &&
    JSON.stringify(completed.completedOwners) === JSON.stringify(owners) && HEX.test(completed.journalDigest), "ACTUAL_NOVICE_ALL_OWNERS_UNPROVEN");
  const dates = [preview.checkedAt,first.checkedAt,e.primaryRequestedAt,whole.confirmationEvidence.retry.checkedAt,e.preservation.online.checkedAt,
    e.preservation.restored.checkedAt,deletion.requestedAt,deletion.confirmedAt,receipt.completedAt,e.preservation.afterNovice.checkedAt].map(Date.parse);
  need(dates.every(Number.isFinite) && dates.every((value,index) => index === 0 || value >= dates[index-1]), "ACTUAL_ADDITIONAL_CHRONOLOGY_UNPROVEN");
  return true;
}
