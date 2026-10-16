/** Actual owned COP/S3/Edge fixture only. Never replaces a runtime erasure adapter. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { Pool } = createRequire("/app/apps/cop-api/package.json")("pg");
const api = "file:///dev/shm/cop-whole/apps/cop-api/dist/";
const { S3PresignedMediaStorage } = await import(api + "media-storage.js");
const { PostgresMediaUploadSettlement, mediaCredentialFingerprint } = await import(api + "media-upload-settlement.js");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
function check(f) {
  assert.equal(f.contractVersion, "cop-account-erasure-whole-fixture-v1");
  assert.equal(f.media.contractVersion, "cop-media-whole-fixture-v1");
  assert.equal(f.media.endpoint, "http://127.0.0.1:8333");
  assert.equal(f.media.bucket, "cop-community-media");
  assert.equal(f.edge.endpoint, "http://127.0.0.1:4313");
  assert.equal(f.media.holderId, f.edge.holderId);
  assert.equal(f.edge.centralAuth.mode, "oidc");
  assert.equal(f.edge.centralAuth.issuer, f.issuer);
  for (const [name, port, user, db] of [["businessAdminUrl", "5433", "cop_whole_postgis_admin", "cop_erasure_test"], ["guardAdminUrl", "5432", "owned_fixture_admin", "cop_account_safety_guard"]]) {
    const url = new URL(f.database[name]); assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, port); assert.equal(url.username, user); assert.equal(url.pathname, "/" + db);
  }
}
function storage(f, key = "current", bucket = f.media.bucket) {
  return new S3PresignedMediaStorage({ ...f.media[key], bucket, endpoint: f.media.endpoint,
    publicEndpoint: f.media.endpoint, region: "us-east-1", uploadExpiresSeconds: 900, uploadTransport: "presigned" });
}
async function actualObject(store, key) {
  const response = await fetch(await store.createReadUrl({ objectKey: key }, new Date()), { redirect: "error", signal: AbortSignal.timeout(10000) });
  assert([200, 404].includes(response.status), "ACTUAL_S3_READBACK_UNAVAILABLE");
  return response.status === 200 ? { present: true, sha256: createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex") }
    : (await response.body?.cancel(), { present: false });
}
async function edgeRequest(f, path, options = {}) {
  const response = await fetch(f.edge.endpoint + path, { ...options, headers: { authorization: "Bearer " + f.edge.adminToken,
    ...options.headers }, signal: AbortSignal.timeout(15000), redirect: "error" });
  const value = await response.json(); assert([200, 202].includes(response.status), "ACTUAL_EDGE_REQUEST_FAILED"); return value;
}
async function enrollClosure(f, binding) {
  check(f);
  const media = f.media, proof = media.providerEvidence;
  for (const flag of ["legacySlowBodyTerminated", "oldSignatureDenied", "newCredentialWorks", "secondAccountPreserved", "otherIdentityAndBucketPreserved"])
    assert.equal(proof[flag], true, "ACTUAL_PROVIDER_DRAIN_EVIDENCE_REQUIRED");
  assert.equal(proof.productionChanged, false);
  assert.equal(mediaCredentialFingerprint(media.current.accessKeyId, media.current.secretAccessKey), media.credentialFingerprint);
  assert.equal(mediaCredentialFingerprint(media.legacy.accessKeyId, media.legacy.secretAccessKey), media.previousCredentialFingerprint);
  // Fresh, still unexpired old-key signature: expiry never supplies this proof.
  const old = storage(f, "legacy"), current = storage(f), other = storage(f, "other", "other-fixture-bucket");
  const deniedSlot = await old.createUploadSlot({ reportId: "fixture-old-denial", attachmentId: randomUUID(), fileName: "synthetic.txt", contentType: "text/plain", byteSize: 1 }, new Date());
  const denied = await fetch(deniedSlot.uploadUrl, { method: "PUT", body: "X", headers: { "content-type": "text/plain" }, redirect: "error", signal: AbortSignal.timeout(10000) });
  assert.equal(denied.status, 403, "ACTUAL_OLD_CREDENTIAL_REVOCATION_REQUIRED"); await denied.body?.cancel();
  const oldCredentialDeniedAt = new Date().toISOString();
  const preservedKey = "community-reports/fixture-b/attachment-b/synthetic-b.txt";
  assert.equal((await current.getObject({ objectKey: preservedKey }, new Date())).body.toString(), "SYNTHETIC_B");
  assert.equal((await other.getObject({ objectKey: preservedKey }, new Date())).body.toString(), "SYNTHETIC_OTHER");
  const target = new Pool({ connectionString: f.database.businessAdminUrl, max: 1 }), guard = new Pool({ connectionString: f.database.guardAdminUrl, max: 1 });
  try {
    const marker = (await target.query("SELECT value FROM cop_mobility_v1 WHERE key='account-safety:store-identity-v1'")).rows[0]?.value;
    assert.equal(marker?.storeId, f.database.applicationStoreId); assert.equal(marker?.incarnationId, binding.incarnationId);
    const actual = (await guard.query("SELECT store_id,incarnation_id,restore_generation FROM cop_safety_v2.dataset_replays WHERE owner='cop'")).rows[0];
    assert.equal(actual.store_id, f.database.applicationStoreId); assert.equal(actual.incarnation_id, binding.incarnationId);
    assert.equal(Number(actual.restore_generation), binding.restoreGeneration);
    assert.equal((await target.query("SELECT count(*)::int AS n FROM cop_community_media_write_leases")).rows[0].n, 0, "UNKNOWN_ACCEPTED_WRITE_MUST_STAY_PENDING");
    if (!(await guard.query("SELECT to_regclass('cop_safety_v2.media_upload_closures') AS table_name")).rows[0].table_name) {
      const sql = readFileSync("/dev/shm/cop-whole/media-upload-closure.sql", "utf8");
      assert.equal(createHash("sha256").update(sql).digest("hex"), "b72c883e418a85dee7f8aa45daa335c078b5936a16c142d882bd40c74819a089");
      await guard.query(sql.replace("TO cop_safety_v2_runtime;", "TO cop_whole_guard_runtime;"));
    }
    const evidenceDigest = digest({ providerEvidence: proof, currentBinding: binding, freshOldCredentialDeniedAt: oldCredentialDeniedAt,
      zeroDurableLeases: true, otherIdentityReadback: true, productionChanged: false });
    const existing = await guard.query("SELECT * FROM cop_safety_v2.media_upload_closures WHERE bucket=$1 AND application_store_id=$2 AND incarnation_id=$3 AND restore_generation=$4 AND credential_fingerprint=$5",
      [media.bucket, f.database.applicationStoreId, binding.incarnationId, binding.restoreGeneration, media.credentialFingerprint]);
    assert(existing.rows.length <= 1, "CLOSURE_ENROLLMENT_AMBIGUOUS");
    if (existing.rows.length) {
      const prior = existing.rows[0];
      assert.equal(prior.endpoint, media.endpoint); assert.equal(prior.previous_credential_fingerprint, media.previousCredentialFingerprint);
      assert.equal(prior.provider_image_id, proof.providerImageId);
      assert.equal(prior.provider_stopped_at.toISOString(), new Date(proof.providerStoppedAt).toISOString());
      assert.equal(prior.provider_restarted_at.toISOString(), new Date(proof.providerRestartedAt).toISOString());
      assert(prior.old_credential_denied_at >= prior.provider_restarted_at && /^[a-f0-9]{64}$/u.test(prior.evidence_digest));
    } else await guard.query(`INSERT INTO cop_safety_v2.media_upload_closures(bucket,application_store_id,incarnation_id,restore_generation,endpoint,credential_fingerprint,previous_credential_fingerprint,
      provider_image_id,provider_stopped_at,provider_restarted_at,old_credential_denied_at,evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [media.bucket, f.database.applicationStoreId, binding.incarnationId, binding.restoreGeneration, media.endpoint, media.credentialFingerprint, media.previousCredentialFingerprint,
      proof.providerImageId, proof.providerStoppedAt, proof.providerRestartedAt, oldCredentialDeniedAt, evidenceDigest]);
    const verifier = new PostgresMediaUploadSettlement(new Pool({ connectionString: f.database.guardRuntimeUrl, max: 1 }),
      new Pool({ connectionString: f.database.businessRuntimeUrl, max: 1 }), { bucket: media.bucket, endpoint: media.endpoint,
        credentialFingerprint: media.credentialFingerprint, applicationStoreId: f.database.applicationStoreId, incarnationId: binding.incarnationId });
    try { assert.equal(await verifier.ready(media.bucket, AbortSignal.timeout(10000)), true); } finally { await verifier.close(); }
    return { evidenceDigest, restoreGeneration: binding.restoreGeneration, freshOldCredentialDenied: true };
  } finally { await target.end(); await guard.end(); }
}
export async function seedMediaEdgeFixture({ manifest: f, app, headersA, headersB, environment }) {
  check(f); assert.equal(environment.COP_MEDIA_UPLOAD_TRANSPORT, "cop_api");
  const binding = { incarnationId: f.database.incarnationId, restoreGeneration: f.database.restoreGeneration };
  const closure = await enrollClosure(f, binding), result = { closure, actors: {} };
  for (const [name, headers] of [["a", headersA], ["b", headersB]]) {
    const body = Buffer.from("SYNTHETIC_OWNED_MEDIA_" + name.toUpperCase());
    const report = await app.inject({ method: "POST", url: "/api/v1/community/reports", headers, payload: {
      category: "hazard", title: "SYNTHETIC_MEDIA_" + name, visibility: "private", location: { lat: 50, lon: 14, source: "manual" } } });
    assert.equal(report.statusCode, 201, "ACTUAL_REPORT_SEED_FAILED"); const reportId = report.json().reportId; assert.match(reportId, uuid);
    const slot = await app.inject({ method: "POST", url: `/api/v1/community/reports/${reportId}/attachments`, headers,
      payload: { byteSize: body.length, contentType: "image/jpeg", fileName: "synthetic-" + name + ".jpg", kind: "photo" } });
    assert.equal(slot.statusCode, 201, "ACTUAL_ATTACHMENT_SLOT_FAILED"); const { attachment, upload } = slot.json();
    assert.equal(upload.transport, "cop_api"); assert.equal(upload.method, "POST");
    assert.equal(new URL(upload.uploadUrl).search, ""); assert.match(attachment.attachmentId, uuid);
    const uploaded = await app.inject({ method: "POST", url: `/api/v1/community/reports/${reportId}/attachments/${attachment.attachmentId}/upload`, headers,
      payload: { byteSize: body.length, dataBase64: body.toString("base64") } });
    assert.equal(uploaded.statusCode, 200, "ACTUAL_GUARDED_UPLOAD_FAILED");
    assert.equal((await storage(f).getObject({ objectKey: upload.objectKey }, new Date())).body.toString(), body.toString());
    const incident = await app.inject({ method: "POST", url: "/api/v1/incidents", headers, payload: {
      title: "SYNTHETIC_EDGE_" + name, category: "flood", severity: "warning", status: "active", location: { lat: 50, lon: 14, source: "manual" } } });
    assert.equal(incident.statusCode, 201, "ACTUAL_CENTRAL_INCIDENT_FAILED"); const incidentId = incident.json().incidentId; assert.match(incidentId, uuid);
    const drawing = await app.inject({ method: "POST", url: "/api/v1/sketch/drawings", headers, payload: {
      kind: "point", visibility: "private", label: "SYNTHETIC_DRAWING_" + name, geometry: { type: "Point", coordinates: [14, 50] } } });
    assert.equal(drawing.statusCode, 201, "ACTUAL_SKETCH_SEED_FAILED"); const drawingId = drawing.json().id; assert.match(drawingId, uuid);
    result.actors[name] = { reportId, attachmentId: attachment.attachmentId, objectKey: upload.objectKey, incidentId, drawingId };
  }
  const sync = await edgeRequest(f, "/sync", { method: "POST" });
  assert.equal(sync.result.status, "ok", "ACTUAL_EDGE_OIDC_SYNC_FAILED");
  const state = await edgeRequest(f, "/events?limit=1000");
  for (const value of Object.values(result.actors)) assert(state.recentEvents.some(row => centralIncident(row, value.incidentId)), "ACTUAL_CENTRAL_EDGE_COPY_MISSING");
  const inventory = new Pool({ connectionString: f.database.businessAdminUrl, max: 1 });
  try {
    for (const name of ["a", "b"]) {
      const subject = f.actors[name].subjectId;
      // Include previous partial seeds in the same owned fixture. A retry must
      // never make an earlier actual COP row or S3 object disappear from checks.
      result.actors[name].allObjectKeys = (await inventory.query("SELECT object_key FROM cop_community_owned_media WHERE subject_id=$1 AND issuer=$2 ORDER BY object_key", [subject, f.issuer])).rows.map(row => row.object_key);
      result.actors[name].allIncidentIds = (await inventory.query("SELECT incident_id FROM cop_incidents WHERE record#>>'{createdBy,subjectId}'=$1 ORDER BY incident_id", [subject])).rows.map(row => row.incident_id);
    }
  } finally { await inventory.end(); }
  return result;
}
function centralIncident(row, id) {
  const event = row.event ?? {};
  return (event.producerNodeId ?? event.data?.producerNodeId) === "node_central_cop" &&
    event.source === "urn:csm:node:node_central_cop" && (event.entityType ?? event.data?.entityType) === "incident" &&
    (event.entityId ?? event.data?.entityId) === id;
}
export async function readMediaEdgeFixture({ manifest: f, seed }) {
  check(f); const pg = new Pool({ connectionString: f.database.businessAdminUrl, max: 1 });
  try {
    const edge = await edgeRequest(f, "/events?limit=1000"), snapshots = {};
    for (const name of ["a", "b"]) {
      const value = seed.actors[name], subject = f.actors[name].subjectId;
      const reports = (await pg.query("SELECT * FROM cop_community_reports WHERE subject_id=$1 ORDER BY report_id", [subject])).rows;
      const attachments = (await pg.query("SELECT * FROM cop_community_report_attachments WHERE subject_id=$1 ORDER BY attachment_id", [subject])).rows;
      const owned = (await pg.query("SELECT * FROM cop_community_owned_media WHERE subject_id=$1 AND issuer=$2 ORDER BY object_key", [subject, f.issuer])).rows;
      const objectKeys = [...new Set([...value.allObjectKeys, ...owned.map(row => row.object_key)])].sort();
      const objects = [];
      for (const objectKey of objectKeys) objects.push({ objectKey, ...await actualObject(storage(f), objectKey) });
      const events = edge.recentEvents.filter(row => value.allIncidentIds.some(id => centralIncident(row, id)) || JSON.stringify(row.event).includes(subject));
      const incidents = (await pg.query("SELECT * FROM cop_incidents WHERE record#>>'{createdBy,subjectId}'=$1 ORDER BY incident_id", [subject])).rows;
      const tasks = (await pg.query("SELECT * FROM cop_incident_tasks WHERE record#>>'{createdBy,subjectId}'=$1 ORDER BY task_id", [subject])).rows;
      const drawings = (await pg.query("SELECT *,ST_AsGeoJSON(geometry) AS geometry_json FROM cop_user_drawings WHERE owner_subject_id=$1 ORDER BY drawing_id", [subject])).rows;
      const drawingAudit = (await pg.query("SELECT * FROM cop_user_drawing_audit WHERE actor_subject_id=$1 ORDER BY audit_id", [subject])).rows;
      snapshots[name] = { count: reports.length + attachments.length + owned.length + objects.filter(object => object.present).length + events.length + incidents.length + tasks.length + drawings.length + drawingAudit.length,
        state: { reports, attachments, owned, objects, events, incidents, tasks, drawings, drawingAudit } };
    }
    return { cop_content_media: { removableA: snapshots.a.count, removableB: snapshots.b.count,
      preservedBFingerprint: digest(snapshots.b.state) } };
  } finally { await pg.end(); }
}
export async function restoreMediaEdgeFixture({ manifest: f, seed, restoredBinding }) {
  assert(restoredBinding.restoreGeneration > seed.closure.restoreGeneration, "NEW_RESTORE_BINDING_REQUIRED");
  // Actual provider state remains live; this does not claim a physical S3/Edge restore.
  // The restored business snapshot is stopped and has zero acknowledged PUT leases.
  // Revalidate revoked legacy credentials and preserved objects, then explicitly
  // enroll this generation as administrator before COP is started again.
  return enrollClosure(f, restoredBinding);
}
