import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contentErasureSchema, contentOwnerKey, contentTransaction } from "./content-erasure.js";
import { communityErasureSchema } from "./community-erasure.js";
import { mediaCredentialFingerprint, PostgresMediaUploadSettlement } from "./media-upload-settlement.js";

const url = process.env.COP_MEDIA_SETTLEMENT_TEST_DATABASE_URL;
if (url) {
  const value = new URL(url);
  if (value.hostname !== "127.0.0.1" || value.username !== "cop_media_test_admin" || value.pathname !== "/cop_account_safety_guard") throw new Error("Owned media fixture required");
}
const expected = { bucket: "cop-community-media", endpoint: "http://127.0.0.1:58333", credentialFingerprint: mediaCredentialFingerprint("synthetic-new", "synthetic-new-secret-only"),
  applicationStoreId: "813a2260-ac1a-40bd-926b-3654c8ac347d", incarnationId: "064cb1d9-5da3-4b1a-8de2-fd37401dfe87" };
const owner = { issuer: "https://synthetic.test/cop", subjectId: "synthetic-media-a" };
const request = { bucket: expected.bucket, objectKey: "community-reports/r/a/synthetic.jpg" };
const operationId = "127cb1d9-5da3-4b1a-8de2-fd37401dfe87";
const signal = () => new AbortController().signal;
let guard: Pool, target: Pool, runtime: Pool, verifier: PostgresMediaUploadSettlement;
describe.skipIf(!url)("actual media settlement PostgreSQL boundaries", () => {
  beforeAll(async () => {
    guard = new Pool({ connectionString: url });
    target = new Pool({ connectionString: url!.replace("/cop_account_safety_guard", "/cop_erasure_test"), max: 3 });
    for (const pool of [guard, target]) if ((await pool.query("SHOW cluster_name")).rows[0]?.cluster_name !== "cop_media_settlement_owned_test") throw new Error("Wrong cluster");
    await guard.query("CREATE ROLE cop_safety_v2_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE");
    await guard.query(await readFile(new URL("../../../scripts/account-safety/010_database_safety_v2.sql", import.meta.url), "utf8"));
    await guard.query(await readFile(new URL("../../../scripts/account-safety/011_media_upload_closure.sql", import.meta.url), "utf8"));
    await guard.query("GRANT USAGE ON SCHEMA cop_safety_v2 TO cop_safety_v2_runtime; GRANT SELECT ON cop_safety_v2.configuration,cop_safety_v2.dataset_replays TO cop_safety_v2_runtime");
    await target.query(contentErasureSchema); await target.query(communityErasureSchema);
    await target.query("CREATE TABLE cop_mobility_v1(key text PRIMARY KEY,value jsonb NOT NULL)");
    const readUrl = new URL(url!); readUrl.username = "cop_safety_v2_runtime";
    runtime = new Pool({ connectionString: readUrl.href, max: 2 });
    verifier = new PostgresMediaUploadSettlement(runtime, target, expected);
    await guard.query("INSERT INTO cop_safety_v2.configuration(singleton,contract_version,guard_store_id,application_store_id,configuration_fingerprint,initial_digest) VALUES(true,'cop-database-safety-v2',$1,$2,$3,$3)", [randomUUID(),expected.applicationStoreId,"0".repeat(64)]);
  });
  beforeEach(async () => {
    await guard.query("TRUNCATE cop_safety_v2.dataset_replays");
    await guard.query("INSERT INTO cop_safety_v2.dataset_replays(owner,store_id,incarnation_id,restore_generation,replay_sequence,replay_digest) VALUES('cop',$1,$2,1,0,$3)", [expected.applicationStoreId,expected.incarnationId,"0".repeat(64)]);
    // Receipts are append-only, so each test uses its own fresh credential.
    expected.credentialFingerprint = mediaCredentialFingerprint(randomUUID(), "synthetic-test-secret-more-than16");
    verifier = new PostgresMediaUploadSettlement(runtime, target, expected);
    await target.query("TRUNCATE cop_content_erasure_fences CASCADE; TRUNCATE cop_community_owned_media,cop_community_media_write_leases,cop_mobility_v1");
    await target.query("INSERT INTO cop_mobility_v1 VALUES('account-safety:store-identity-v1',$1)", [{ storeId: expected.applicationStoreId,incarnationId:expected.incarnationId }]);
    await target.query("INSERT INTO cop_content_erasure_fences(owner_key,subject_key,operation_id) VALUES($1,$2,$3)", [contentOwnerKey(owner),"subject-hash",operationId]);
    await target.query("INSERT INTO cop_community_owned_media(bucket,object_key,subject_id,issuer,upload_expires_at) VALUES($1,$2,$3,$4,now())", [request.bucket,request.objectKey,owner.subjectId,owner.issuer]);
    await target.query("INSERT INTO cop_content_erasure_media_manifest(owner_key,operation_id,bucket,object_key,not_before) VALUES($1,$2,$3,$4,now())", [contentOwnerKey(owner),operationId,request.bucket,request.objectKey]);
  });
  afterAll(async () => { await runtime?.end(); await target?.end(); await guard?.end(); });
  async function enroll() {
    await guard.query(`INSERT INTO cop_safety_v2.media_upload_closures(bucket,application_store_id,incarnation_id,restore_generation,endpoint,credential_fingerprint,
      previous_credential_fingerprint,provider_image_id,provider_stopped_at,provider_restarted_at,old_credential_denied_at,evidence_digest)
      VALUES($1,$2,$3,1,$4,$5,$6,$7,'2026-10-16T00:00:00Z','2026-10-16T00:01:00Z','2026-10-16T00:02:00Z',$8)`,
    [expected.bucket,expected.applicationStoreId,expected.incarnationId,expected.endpoint,expected.credentialFingerprint,"1".repeat(64),"sha256:"+"f".repeat(64),"e".repeat(64)]);
  }
  it("does not infer closure from expiry, an empty lease table, or a fenced manifest", async () => {
    expect(await verifier.ready(expected.bucket,signal())).toBe(false);
    expect(await verifier.verify(request,signal())).toBe(false);
  });
  it("accepts only the exact enrolled dataset, server credential, object manifest, owner and operation", async () => {
    await enroll(); expect(await verifier.ready(expected.bucket,signal())).toBe(true); expect(await verifier.verify(request,signal())).toBe(true);
    expect(await verifier.verify({ ...request,objectKey:"community-reports/r/b/other.jpg" },signal())).toBe(false);
    expect(await verifier.verify({ ...request,bucket:"another-bucket" },signal())).toBe(false);
    await target.query("UPDATE cop_community_owned_media SET subject_id='synthetic-media-b'");
    expect(await verifier.verify(request,signal())).toBe(false);
  });
  it("retains an unknown admitted write across verifier restart; no time based cleanup", async () => {
    await enroll(); await target.query("INSERT INTO cop_community_media_write_leases VALUES($1,$2,$3,$4,$5)", [randomUUID(),request.bucket,request.objectKey,owner.subjectId,owner.issuer]);
    expect(await verifier.verify(request,signal())).toBe(false);
    const restart = new PostgresMediaUploadSettlement(runtime,target,expected); expect(await restart.verify(request,signal())).toBe(false);
    expect((await target.query("SELECT count(*) FROM cop_community_media_write_leases")).rows[0]?.count).toBe("1");
    await target.query("DELETE FROM cop_community_media_write_leases"); expect(await restart.verify(request,signal())).toBe(true);
  });
  it("uses the actual admission lock and waits an already admitted lease transaction", async () => {
    await enroll(); let release!:()=>void, entered!:()=>void;
    const started = new Promise<void>(resolve=>{entered=resolve;}); const hold = new Promise<void>(resolve=>{release=resolve;});
    const writer = contentTransaction(target,async client=>{ await client.query("INSERT INTO cop_community_media_write_leases VALUES($1,$2,$3,$4,$5)", [randomUUID(),request.bucket,request.objectKey,owner.subjectId,owner.issuer]); entered(); await hold; });
    await started; let completed=false; const checking=verifier.verify(request,signal()).then(value=>{completed=true; return value;});
    await new Promise(resolve=>setTimeout(resolve,40)); expect(completed).toBe(false); release(); await writer; expect(await checking).toBe(false);
  });
  it("rejects a restored local marker, a generation transition, and a changed server credential", async () => {
    await enroll(); expect(await verifier.ready(expected.bucket,signal())).toBe(true);
    await target.query("UPDATE cop_mobility_v1 SET value=$1", [{storeId:expected.applicationStoreId,incarnationId:randomUUID()}]);
    expect(await verifier.ready(expected.bucket,signal())).toBe(false);
    await target.query("UPDATE cop_mobility_v1 SET value=$1", [{storeId:expected.applicationStoreId,incarnationId:expected.incarnationId}]);
    await guard.query("UPDATE cop_safety_v2.dataset_replays SET restore_generation=2"); expect(await verifier.ready(expected.bucket,signal())).toBe(false);
    const changed = new PostgresMediaUploadSettlement(runtime,target,{...expected,credentialFingerprint:"a".repeat(64)});
    expect(await changed.ready(expected.bucket,signal())).toBe(false);
  });
  it("does not allow runtime to enroll, alter or erase a receipt, including administrator mutation of frozen evidence", async () => {
    await enroll();
    for (const sql of ["DELETE FROM cop_safety_v2.media_upload_closures","TRUNCATE cop_safety_v2.media_upload_closures","UPDATE cop_safety_v2.media_upload_closures SET evidence_digest=repeat('a',64)","INSERT INTO cop_safety_v2.media_upload_closures SELECT * FROM cop_safety_v2.media_upload_closures"])
      await expect(runtime.query(sql)).rejects.toMatchObject({code:"42501"});
    await expect(guard.query("DELETE FROM cop_safety_v2.media_upload_closures")).rejects.toMatchObject({code:"55000"});
  });
  it("rejects a mismatched operation and cancellation without provider contact", async () => {
    await enroll(); await target.query("UPDATE cop_content_erasure_media_manifest SET operation_id=$1",[randomUUID()]);
    expect(await verifier.verify(request,signal())).toBe(false); const aborted=AbortSignal.abort(); expect(await verifier.ready(expected.bucket,aborted)).toBe(false);
  });
});
