import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { createCopPgPool } from "./cop-pg-pool.js";
import { databaseContinuityEndpoints } from "./account-erasure-continuity-production.js";
import { contentOwnerKey, contentTransaction } from "./content-erasure.js";
import type { MediaUploadSettlementVerifier } from "./media-storage.js";

export interface MediaClosureBinding {
  bucket: string;
  endpoint: string;
  credentialFingerprint: string;
  applicationStoreId: string;
  incarnationId: string;
}
interface ClosureRow {
  application_store_id: string; incarnation_id: string; restore_generation: string;
  credential_fingerprint: string; previous_credential_fingerprint: string;
  endpoint: string; evidence_digest: string; provider_image_id: string;
  provider_stopped_at: Date; provider_restarted_at: Date; old_credential_denied_at: Date;
}
const hex = /^[a-f0-9]{64}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const image = /^sha256:[a-f0-9]{64}$/u;
const need = (value: unknown) => { if (!value) throw new Error("MEDIA_UPLOAD_CLOSURE_UNAVAILABLE"); };

export function mediaCredentialFingerprint(accessKeyId: string, secretAccessKey: string): string {
  need(accessKeyId.length > 0 && secretAccessKey.length >= 16);
  return createHash("sha256").update("cop-media-server-credential-v1\0")
    .update(JSON.stringify([accessKeyId, secretAccessKey])).digest("hex");
}
function origin(value: string): string {
  try {
    const url = new URL(value);
    need(["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === "/");
    return url.origin;
  } catch { throw new Error("MEDIA_UPLOAD_CLOSURE_CONFIGURATION"); }
}

/** ADR0055 trusted operator model. The independent receipt is enrolled only
 * after the actual provider has stopped, the old credential has been revoked,
 * and the exact replacement has been tested. Runtime has SELECT permission
 * only. It cannot invent a receipt or age away an unknown upload outcome. */
export class PostgresMediaUploadSettlement implements MediaUploadSettlementVerifier {
  private readonly expected: MediaClosureBinding;
  constructor(private readonly guard: Pool, private readonly target: Pool, expected: MediaClosureBinding) {
    this.expected = { ...expected, endpoint: origin(expected.endpoint) };
    need(expected.bucket === "cop-community-media" && hex.test(expected.credentialFingerprint) &&
      uuid.test(expected.applicationStoreId) && uuid.test(expected.incarnationId));
  }
  async close(): Promise<void> { await Promise.all([this.guard.end(), this.target.end()]); }
  private async closure(bucket: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    if (bucket !== this.expected.bucket) return false;
    const result = await this.guard.query<ClosureRow>(`SELECT c.application_store_id,c.incarnation_id,c.restore_generation,
      c.credential_fingerprint,c.previous_credential_fingerprint,c.endpoint,c.evidence_digest,c.provider_image_id,
      c.provider_stopped_at,c.provider_restarted_at,c.old_credential_denied_at
      FROM cop_safety_v2.media_upload_closures c
      JOIN cop_safety_v2.configuration cfg ON cfg.singleton AND cfg.application_store_id=c.application_store_id
      JOIN cop_safety_v2.dataset_replays r ON r.owner='cop' AND r.store_id=c.application_store_id
        AND r.incarnation_id=c.incarnation_id AND r.restore_generation=c.restore_generation
      WHERE c.bucket=$1 AND c.credential_fingerprint=$2 AND c.application_store_id=$3 AND c.incarnation_id=$4`,
      [bucket, this.expected.credentialFingerprint, this.expected.applicationStoreId, this.expected.incarnationId]);
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row || row.endpoint !== this.expected.endpoint ||
      row.credential_fingerprint !== this.expected.credentialFingerprint || row.credential_fingerprint === row.previous_credential_fingerprint ||
      !hex.test(row.previous_credential_fingerprint) || !hex.test(row.evidence_digest) || !image.test(row.provider_image_id) ||
      !Number.isSafeInteger(Number(row.restore_generation)) || Number(row.restore_generation) < 1 ||
      ![row.provider_stopped_at, row.provider_restarted_at, row.old_credential_denied_at].every(value => value instanceof Date && Number.isFinite(value.getTime())) ||
      row.provider_restarted_at <= row.provider_stopped_at || row.old_credential_denied_at < row.provider_restarted_at) return false;
    const marker = (await this.target.query<{ value: { storeId?: string; incarnationId?: string } }>(
      "SELECT value FROM cop_mobility_v1 WHERE key='account-safety:store-identity-v1'")).rows[0]?.value;
    signal.throwIfAborted();
    return marker?.storeId === this.expected.applicationStoreId && marker.incarnationId === this.expected.incarnationId;
  }
  async ready(bucket: string, signal: AbortSignal): Promise<boolean> {
    try { return await this.closure(bucket, signal); } catch { return false; }
  }
  async verify(request: { bucket: string; objectKey: string }, signal: AbortSignal): Promise<boolean> {
    try {
      if (!await this.closure(request.bucket, signal)) return false;
      const valid = await contentTransaction(this.target, async client => {
        signal.throwIfAborted();
        // The same writer lock used for admitting a network PUT is held here.
        // A committed owner fence rejects every later admission; an earlier
        // accepted PUT retains a durable lease until its real acknowledgement.
        const result = await client.query<{ owner_key: string; subject_id: string; issuer: string; operation_id: string; manifest_operation: string; leased: boolean }>(
          `SELECT f.owner_key,o.subject_id,o.issuer,f.operation_id,m.operation_id AS manifest_operation,
            EXISTS(SELECT 1 FROM cop_community_media_write_leases w WHERE w.bucket=o.bucket AND w.object_key=o.object_key) AS leased
          FROM cop_community_owned_media o
          JOIN cop_content_erasure_media_manifest m ON m.bucket=o.bucket AND m.object_key=o.object_key
          JOIN cop_content_erasure_fences f ON f.owner_key=m.owner_key
          WHERE o.bucket=$1 AND o.object_key=$2`, [request.bucket, request.objectKey]);
        const row = result.rows[0];
        signal.throwIfAborted();
        return result.rows.length === 1 && !!row?.issuer && row.owner_key === contentOwnerKey({ subjectId: row.subject_id, issuer: row.issuer }) &&
          row.operation_id === row.manifest_operation && uuid.test(row.operation_id) && row.leased === false;
      });
      // Recheck the independent binding after the local transaction. A restore
      // transition cannot reuse a receipt belonging to a different generation.
      return valid && await this.closure(request.bucket, signal);
    } catch { return false; }
  }
}

/** Production uses exactly the existing verified session route and CA. An
 * unsupported authority/transport has no presigned or positive fallback. */
export function createMediaUploadSettlementFromEnv(env: Record<string, string | undefined> = process.env): PostgresMediaUploadSettlement | undefined {
  if (env.COP_ACCOUNT_SAFETY_AUTHORITY_MODE !== "database_v2" || env.COP_MEDIA_UPLOAD_TRANSPORT !== "cop_api") return undefined;
  const { guardUrl, targetUrl } = databaseContinuityEndpoints(env);
  const ca = readFileSync("/etc/vcode-cop-pgbouncer/postgres-ca.crt", "utf8");
  need(ca.includes("-----BEGIN CERTIFICATE-----"));
  const expected = { bucket: env.COP_MEDIA_S3_BUCKET ?? "", endpoint: env.COP_MEDIA_S3_ENDPOINT ?? "",
    credentialFingerprint: mediaCredentialFingerprint(env.COP_MEDIA_S3_ACCESS_KEY_ID ?? "", env.COP_MEDIA_S3_SECRET_ACCESS_KEY ?? ""),
    applicationStoreId: env.COP_ACCOUNT_SAFETY_STORE_ID ?? "", incarnationId: env.COP_ACCOUNT_SAFETY_INCARNATION_ID ?? "" };
  const config = { max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000, ssl: { rejectUnauthorized: true, ca }, application_name: "cop-media-settlement-v1" };
  const guard = createCopPgPool("media-settlement-guard", { ...config, connectionString: guardUrl });
  const target = createCopPgPool("media-settlement-target", { ...config, connectionString: targetUrl });
  guard.on("error", () => undefined); target.on("error", () => undefined);
  try { return new PostgresMediaUploadSettlement(guard, target, expected); }
  catch { void guard.end(); void target.end(); throw new Error("MEDIA_UPLOAD_CLOSURE_CONFIGURATION"); }
}
