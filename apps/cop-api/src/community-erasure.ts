import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedActor } from "./security.js";
import type { AccountErasureAssessment, AccountErasureProof } from "./account-erasure.js";
import type { MediaStorage } from "./media-storage.js";
import { assertContentWriter, contentOwnerKey, contentTransaction, ContentErasureStoreError,
  assertGlobalContentWriter, ContentSerialLock, ContentWriterGuardBinding, contentSubjectKey, fenceContentOwner, requireContentActor, type ContentErasureComponent } from "./content-erasure.js";
import type { CommunityGroupRecord, CommunityReportAttachmentRecord, CommunityReportRecord } from "./community-report-store.js";

type Witness = { subjectId: string; issuer?: string };
type ObjectValue = Record<string, unknown>;
const writes = ["createReport", "createGroup", "createAttachment", "completeAttachment", "deleteGroup", "deleteGroupForDemoScenario",
  "deleteReport", "deleteReportForDemoScenario", "leaveGroup", "removeGroupMember", "requestGroupMembership", "resolveReport", "submitReport",
  "updateAttachmentMetadata", "updateGroupMetadata", "updateReport", "upsertReportConfirmation", "upsertGroupMember", "withdrawReport"] as const;
const actors = new AsyncLocalStorage<AuthenticatedActor>();
export interface CommunityProjectionEraser {
  /** Must fence writers, remove every configured projection/cache/outbox/history,
   * and verify absence before returning true. A send/202 is insufficient. */
  preflight?(actor: { issuer: string; subjectId: string }, signal: AbortSignal): Promise<AccountErasureAssessment>;
  erase(resources: { reportIds: string[]; groupIds: string[]; incidentIds?: string[]; taskIds?: string[]; drawingIds?: string[] }, context: { operationId: string; signal: AbortSignal; actor?: { issuer: string; subjectId: string } }): Promise<boolean>;
}
export function withVerifiedCommunityActor<T>(actor: AuthenticatedActor, run: () => T): T { requireContentActor(actor); return actors.run(actor, run); }
/** Legacy compatibility only: no current-login provenance is assigned to an
 * old username/email subject. Accepted erasure writers must use exact subjects. */
export function withoutVerifiedCommunityActor<T>(run: () => T): T { return actors.exit(run); }
function object(value: unknown): ObjectValue { return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {}; }
function witness(value: unknown): Witness | undefined {
  const v = object(value); if (typeof v.subjectId !== "string" || !v.subjectId) return undefined;
  return { subjectId: v.subjectId, ...(typeof v.issuer === "string" && v.issuer ? { issuer: v.issuer } : {}) };
}
function writer(method: string, args: unknown[]): Witness | undefined {
  const input = object(args[0]), explicit = witness(input.createdBy ?? input.actor) ?? witness(args[1]);
  const fallback = typeof input.subjectId === "string" ? { subjectId: input.subjectId, ...(typeof input.issuer === "string" ? { issuer: input.issuer } : {}) }
    : typeof args[1] === "string" && !method.endsWith("ForDemoScenario") ? { subjectId: args[1] } : undefined;
  const value = explicit ?? fallback, verified = actors.getStore();
  if (value && verified) {
    if (value.subjectId !== verified.subjectId) throw new ContentErasureStoreError(401, "COMMUNITY_WRITER_IDENTITY_MISMATCH");
    if (value.issuer && value.issuer !== verified.issuer) throw new ContentErasureStoreError(401, "COMMUNITY_WRITER_IDENTITY_MISMATCH");
    return { subjectId: verified.subjectId, issuer: verified.issuer };
  }
  return value;
}
function ownerAuthorizedTarget(method: string, args: unknown[], owner?: Witness): { kind: string; rowKey: string } | undefined {
  const input = object(args[0]);
  if (method === "createReport" && typeof input.reportId === "string") return { kind: "report", rowKey: input.reportId };
  if (["updateReport", "deleteReport", "submitReport", "resolveReport", "withdrawReport"].includes(method)) return { kind: "report", rowKey: String(args[0]) };
  if (method === "createAttachment") return { kind: "report", rowKey: String(input.reportId) };
  if (method === "completeAttachment") return { kind: "attachment", rowKey: String(input.attachmentId) };
  if (["leaveGroup", "removeGroupMember", "deleteGroup"].includes(method) && owner) return { kind: "membership", rowKey: String(args[0]) + ":" + owner.subjectId };
  if (["upsertGroupMember", "updateGroupMetadata"].includes(method) && owner) return { kind: "membership", rowKey: String(input.groupId) + ":" + owner.subjectId };
  if (method === "upsertReportConfirmation" && owner) return { kind: "confirmation", rowKey: String(args[0]) + ":" + owner.subjectId };
  return undefined;
}

/** All existing writes use one guarded transaction, including their dependent
 * reads and audit/ownership records. The wrapper is internal; no request can
 * select its identity, SQL connection or policy. */
export class PostgresCommunityErasureBoundary {
  private readonly context = new AsyncLocalStorage<PoolClient>();
  private readonly writerBinding = new ContentWriterGuardBinding();
  constructor(private readonly pool: Pool) {}
  get database(): Pick<Pool, "query"> { return this.context.getStore() ?? this.pool; }
  get client(): PoolClient | undefined { return this.context.getStore(); }
  /** Read only the immutable insertion witness while the authoritative row
   * still exists. A public DTO/current login is never a provenance substitute. */
  async readVerifiedProjectionOwner(kind: "report", id: string): Promise<{ issuer: string; subjectId: string } | undefined> {
    return (await this.readVerifiedProjectionOwners(kind, [id])).get(id.toLowerCase());
  }
  async readVerifiedProjectionOwners(kind: "report", ids: readonly string[]): Promise<Map<string, { issuer: string; subjectId: string }>> {
    if (ids.length > 1000) throw new ContentErasureStoreError(503, "COMMUNITY_PROJECTION_OWNER_BOUND_EXCEEDED");
    const requested = [...new Set(ids.filter(id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id)).map(id => id.toLowerCase()))];
    if (kind !== "report" || requested.length === 0) return new Map();
    return contentTransaction(this.pool, async client => {
      const result = await client.query<{ row_key: string; issuer: string; subject_id: string }>(`SELECT o.row_key,o.issuer,o.subject_id
        FROM cop_community_erasure_ownership o JOIN cop_community_reports r ON o.kind='report' AND o.row_key=r.report_id::text AND o.subject_id=r.subject_id
        WHERE o.row_key=ANY($1::text[]) AND o.issuer IS NOT NULL`, [requested]);
      return new Map(result.rows.filter(row => row.issuer).map(row => [row.row_key, { issuer: row.issuer, subjectId: row.subject_id }]));
    });
  }
  async extendOwnedMediaUpload(input: { reportId: string; attachmentId: string; objectKey: string; subjectId: string; issuer: string; expiresAt: string }): Promise<void> {
    if (!Number.isFinite(Date.parse(input.expiresAt))) throw new ContentErasureStoreError(400, "COMMUNITY_MEDIA_EXPIRY_INVALID");
    await contentTransaction(this.pool, async client => {
      await assertContentWriter(client, input, this.writerBinding.guard);
      const row = await client.query<{ bucket: string; object_key: string; subject_id: string; issuer: string | null }>(`SELECT a.bucket,a.object_key,a.subject_id,o.issuer
        FROM cop_community_report_attachments a JOIN cop_community_erasure_ownership o ON o.kind='attachment' AND o.row_key=a.attachment_id::text
        WHERE a.attachment_id=$1 AND a.report_id=$2`, [input.attachmentId, input.reportId]);
      const owner = row.rows[0];
      if (!owner?.issuer || owner.issuer !== input.issuer || owner.subject_id !== input.subjectId || owner.object_key !== input.objectKey) throw new ContentErasureStoreError(403, "COMMUNITY_MEDIA_OWNER_MISMATCH");
      await client.query("UPDATE cop_community_report_attachments SET upload_expires_at=GREATEST(upload_expires_at,$3::timestamptz) WHERE attachment_id=$1 AND report_id=$2", [input.attachmentId, input.reportId, input.expiresAt]);
      await client.query("UPDATE cop_community_owned_media SET upload_expires_at=GREATEST(upload_expires_at,$5::timestamptz) WHERE bucket=$1 AND object_key=$2 AND subject_id=$3 AND issuer=$4", [owner.bucket, input.objectKey, input.subjectId, input.issuer, input.expiresAt]);
      const verified = await client.query<{ valid: boolean }>("SELECT upload_expires_at >= $5::timestamptz AS valid FROM cop_community_owned_media WHERE bucket=$1 AND object_key=$2 AND subject_id=$3 AND issuer=$4", [owner.bucket, input.objectKey, input.subjectId, input.issuer, input.expiresAt]);
      if (verified.rows[0]?.valid !== true) throw new ContentErasureStoreError(503, "COMMUNITY_MEDIA_EXPIRY_UNVERIFIED");
    });
  }
  async withOwnedMediaWrite<T>(input: { reportId: string; attachmentId: string; objectKey: string }, run: () => Promise<T>): Promise<T> {
    const leaseId = randomUUID();
    await contentTransaction(this.pool, async client => {
      const row = await client.query<{ bucket: string; subject_id: string; issuer: string | null }>(`SELECT a.bucket,a.subject_id,o.issuer
        FROM cop_community_report_attachments a JOIN cop_community_erasure_ownership o ON o.kind='attachment' AND o.row_key=a.attachment_id::text
        WHERE a.attachment_id=$1 AND a.report_id=$2`, [input.attachmentId, input.reportId]);
      const owner = row.rows[0]; if (!owner?.issuer) throw new ContentErasureStoreError(503, "COMMUNITY_MEDIA_OWNER_UNVERIFIED");
      const original = `community-reports/${input.reportId}/${input.attachmentId}/`;
      if (!input.objectKey.startsWith(original) || input.objectKey.split("/").some(segment => segment === "." || segment === "..")) throw new ContentErasureStoreError(400, "COMMUNITY_MEDIA_OBJECT_MISMATCH");
      await assertContentWriter(client, { subjectId: owner.subject_id, issuer: owner.issuer }, this.writerBinding.guard);
      await client.query(`INSERT INTO cop_community_owned_media(bucket,object_key,subject_id,issuer,upload_expires_at)
        VALUES($1,$2,$3,$4,now()) ON CONFLICT(bucket,object_key) DO NOTHING`, [owner.bucket, input.objectKey, owner.subject_id, owner.issuer]);
      const actual = await client.query<{ subject_id: string; issuer: string | null }>("SELECT subject_id,issuer FROM cop_community_owned_media WHERE bucket=$1 AND object_key=$2", [owner.bucket, input.objectKey]);
      if (actual.rows[0]?.subject_id !== owner.subject_id || actual.rows[0].issuer !== owner.issuer) throw new ContentErasureStoreError(409, "COMMUNITY_MEDIA_OWNER_CONFLICT");
      await client.query("INSERT INTO cop_community_media_write_leases(lease_id,bucket,object_key,subject_id,issuer) VALUES($1,$2,$3,$4,$5)", [leaseId, owner.bucket, input.objectKey, owner.subject_id, owner.issuer]);
    });
    // No long-lived database transaction spans the network. A thrown provider
    // result has unknown completion and keeps its durable lease pending; it is
    // never cleared automatically based on age or a process restart.
    const result = await run();
    await contentTransaction(this.pool, client => client.query("DELETE FROM cop_community_media_write_leases WHERE lease_id=$1", [leaseId]).then(() => undefined));
    return result;
  }
  install(target: object): void {
    const store = target as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const method of writes) {
      const original = store[method]!.bind(target);
      Object.defineProperty(target, method, { configurable: false, value: (...args: unknown[]) => this.write(method, args, () => original(...args)) });
    }
  }
  private async write(method: string, args: unknown[], run: () => Promise<unknown>): Promise<unknown> {
    if (this.client) return run();
    return contentTransaction(this.pool, client => this.context.run(client, async () => {
      const owner = writer(method, args), input = object(args[0]);
      if (owner) await assertContentWriter(client, owner, this.writerBinding.guard);
      const ownedTarget = ownerAuthorizedTarget(method, args, owner);
      if (ownedTarget && owner) {
        const existingOwner = await client.query<{ subject_id: string; issuer: string | null }>("SELECT subject_id,issuer FROM cop_community_erasure_ownership WHERE kind=$1 AND row_key=$2", [ownedTarget.kind, ownedTarget.rowKey]);
        const existing = existingOwner.rows[0];
        if (existing?.issuer && (existing.subject_id !== owner.subjectId || existing.issuer !== owner.issuer)) throw new ContentErasureStoreError(404, "COMMUNITY_RESOURCE_NOT_FOUND");
        if (ownedTarget.kind === "report") {
          const current = await client.query<{ subject_id: string }>("SELECT subject_id FROM cop_community_reports WHERE report_id=$1", [ownedTarget.rowKey]);
          if (current.rows[0] && current.rows[0].subject_id !== owner.subjectId) throw new ContentErasureStoreError(404, "COMMUNITY_RESOURCE_NOT_FOUND");
        }
      }
      const member = witness(input.member);
      if (member && method === "upsertGroupMember" && input.status !== "left") await assertContentWriter(client, member, this.writerBinding.guard);
      // System conversion/completion uses the immutable stored attachment owner.
      if (method === "updateAttachmentMetadata") {
        const attachment = await client.query<{ subject_id: string; issuer: string | null }>(`SELECT a.subject_id,o.issuer
          FROM cop_community_report_attachments a LEFT JOIN cop_community_erasure_ownership o ON o.kind='attachment' AND o.row_key=a.attachment_id::text
          WHERE a.attachment_id=$1 AND a.report_id=$2`, [input.attachmentId, input.reportId]);
        if (attachment.rows[0]) await assertContentWriter(client, { subjectId: attachment.rows[0].subject_id, issuer: attachment.rows[0].issuer ?? undefined }, this.writerBinding.guard);
      }
      const key = this.createdResourceKey(method, args, member);
      const prior = key ? await this.resourceExists(client, key.kind, key.rowKey) : true;
      const result = await run();
      if (result && key && !prior && key.owner) await this.recordOwner(client, key.kind, key.rowKey || String(object(result).groupId), key.owner);
      if (result && method === "createReport" && !input.reportId && owner) await this.recordOwner(client, "report", String(object(result).reportId), owner);
      if (result && method === "createGroup" && owner) {
        const groupId = String(object(result).groupId); await this.recordOwner(client, "group", groupId, owner);
        await this.recordOwner(client, "membership", groupId + ":" + owner.subjectId, owner);
        for (const field of Object.keys(object(input.metadata))) await client.query("INSERT INTO cop_community_metadata_owners(group_id,field_name,subject_id,issuer) VALUES($1,$2,$3,$4) ON CONFLICT(group_id,field_name) DO NOTHING", [groupId, field, owner.subjectId, owner.issuer ?? null]);
      }
      if (result && method === "createAttachment" && owner) {
        // Keep the exact object/expiry even after ordinary draft deletion cascades
        // attachment rows. No GPS, filename, excerpt or full request is copied.
        await client.query(`INSERT INTO cop_community_owned_media(bucket,object_key,subject_id,issuer,upload_expires_at)
          VALUES($1,$2,$3,$4,$5::timestamptz) ON CONFLICT(bucket,object_key) DO NOTHING`,
          [input.bucket, input.objectKey, owner.subjectId, owner.issuer ?? null, input.uploadExpiresAt]);
        const owned = await client.query<{ subject_id: string; issuer: string | null }>("SELECT subject_id,issuer FROM cop_community_owned_media WHERE bucket=$1 AND object_key=$2", [input.bucket, input.objectKey]);
        if (owned.rows[0]?.subject_id !== owner.subjectId || owned.rows[0].issuer !== (owner.issuer ?? null)) throw new ContentErasureStoreError(409, "COMMUNITY_MEDIA_OWNER_CONFLICT");
      }
      if (result && method === "updateGroupMetadata" && owner) {
        for (const name of Object.keys(object(input.metadata))) {
          await client.query(`INSERT INTO cop_community_metadata_owners(group_id,field_name,subject_id,issuer) VALUES($1,$2,$3,$4)
            ON CONFLICT(group_id,field_name) DO UPDATE SET subject_id=excluded.subject_id,issuer=excluded.issuer`,
            [input.groupId, name, owner.subjectId, owner.issuer ?? null]);
        }
      }
      return result;
    }));
  }
  private createdResourceKey(method: string, args: unknown[], member?: Witness): { kind: string; rowKey: string; owner?: Witness } | undefined {
    const input = object(args[0]), owner = writer(method, args);
    if (method === "createReport" && typeof input.reportId === "string") return { kind: "report", rowKey: input.reportId, owner };
    if (method === "createAttachment") return { kind: "attachment", rowKey: String(input.attachmentId), owner };
    if (method === "requestGroupMembership" && owner) return { kind: "membership", rowKey: String(args[0]) + ":" + owner.subjectId, owner };
    if (method === "upsertGroupMember" && member) return { kind: "membership", rowKey: String(input.groupId) + ":" + member.subjectId, owner: member };
    if (method === "upsertReportConfirmation" && owner) return { kind: "confirmation", rowKey: String(args[0]) + ":" + owner.subjectId, owner };
    return undefined;
  }
  private async resourceExists(client: PoolClient, kind: string, key: string): Promise<boolean> {
    const tables: Record<string, [string, string]> = {
      report: ["cop_community_reports", "report_id::text"], attachment: ["cop_community_report_attachments", "attachment_id::text"],
      membership: ["cop_community_group_members", "group_id::text || ':' || subject_id"], confirmation: ["cop_community_report_confirmations", "report_id::text || ':' || subject_id"]
    };
    const entry = tables[kind]; if (!entry) return true;
    return !!(await client.query(`SELECT 1 FROM ${entry[0]} WHERE ${entry[1]}=$1`, [key])).rowCount;
  }
  private async recordOwner(client: PoolClient, kind: string, rowKey: string, owner: Witness): Promise<void> {
    await client.query(`INSERT INTO cop_community_erasure_ownership(kind,row_key,subject_id,issuer) VALUES($1,$2,$3,$4)
      ON CONFLICT(kind,row_key) DO NOTHING`, [kind, rowKey, owner.subjectId, owner.issuer ?? null]);
  }
  component(options: { media?: MediaStorage; projections?: CommunityProjectionEraser; now?: () => Date } = {}): ContentErasureComponent {
    return { component: "community_reports:postgres", ready: async () => {
      try { return await contentTransaction(this.pool, async client => {
        if ((await client.query("SELECT 1 FROM cop_community_erasure_ownership WHERE issuer IS NULL UNION ALL SELECT 1 FROM cop_community_owned_media WHERE issuer IS NULL UNION ALL SELECT 1 FROM cop_community_metadata_owners WHERE issuer IS NULL LIMIT 1")).rowCount) return false;
        for (const [kind, table, key] of [["report", "cop_community_reports", "r.report_id::text"], ["attachment", "cop_community_report_attachments", "r.attachment_id::text"], ["group", "cop_community_groups", "r.group_id::text"], ["membership", "cop_community_group_members", "r.group_id::text||':'||r.subject_id"], ["confirmation", "cop_community_report_confirmations", "r.report_id::text||':'||r.subject_id"]]) {
          if ((await client.query(`SELECT 1 FROM ${table} r LEFT JOIN cop_community_erasure_ownership o ON o.kind=$1 AND o.row_key=${key} WHERE o.issuer IS NULL LIMIT 1`, [kind])).rowCount) return false;
        }
        return true;
      }); } catch { return false; }
    }, bindWriterGuard: guard => this.writerBinding.bind(guard), writerGuardMatches: guard => this.writerBinding.matches(guard),
    withAdmission: run => contentTransaction(this.pool, async () => run()),
    preflight: (actor, signal) => this.preflight(actor, signal), erase: (actor, context) => this.erase(actor, context, options) };
  }
  private async unknown(client: PoolClient, actor: AuthenticatedActor): Promise<boolean> {
    if ((await client.query("SELECT 1 FROM cop_community_erasure_ownership WHERE subject_id=$1 AND issuer IS NULL LIMIT 1", [actor.subjectId])).rowCount) return true;
    for (const [kind, table, key, subject] of [
      ["report", "cop_community_reports", "report_id::text", "subject_id"],
      ["attachment", "cop_community_report_attachments", "attachment_id::text", "subject_id"],
      ["group", "cop_community_groups", "group_id::text", "owner_subject_id"],
      ["membership", "cop_community_group_members", "group_id::text || ':' || subject_id", "subject_id"],
      ["confirmation", "cop_community_report_confirmations", "report_id::text || ':' || subject_id", "subject_id"]
    ]) {
      const rows = await client.query(`SELECT 1 FROM ${table} r LEFT JOIN cop_community_erasure_ownership o
        ON o.kind=$2 AND o.row_key=(${key!.replaceAll("subject_id", "r.subject_id").replaceAll("report_id", "r.report_id").replaceAll("attachment_id", "r.attachment_id").replaceAll("group_id", "r.group_id")})
        WHERE r.${subject}=$1 AND (o.issuer IS NULL OR o.subject_id<>r.${subject}) LIMIT 1`, [actor.subjectId, kind]);
      if (rows.rowCount) return true;
    }
    return !!(await client.query(`SELECT 1 FROM cop_community_owned_media WHERE subject_id=$1 AND issuer IS NULL
      UNION ALL SELECT 1 FROM cop_community_metadata_owners WHERE subject_id=$1 AND issuer IS NULL LIMIT 1`, [actor.subjectId])).rowCount;
  }
  private async ownedGroup(client: PoolClient, actor: AuthenticatedActor): Promise<boolean> {
    return !!(await client.query(`SELECT 1 FROM cop_community_groups g JOIN cop_community_erasure_ownership o
      ON o.kind='group' AND o.row_key=g.group_id::text WHERE o.subject_id=$1 AND o.issuer=$2 LIMIT 1`, [actor.subjectId, actor.issuer])).rowCount;
  }
  private async foreignAttachmentOnOwnReport(client: PoolClient, actor: AuthenticatedActor): Promise<boolean> {
    // A shared attachment must be moved/handled explicitly before deleting its
    // parent. Never rely on the FK cascade as permission to delete another author.
    return !!(await client.query(`SELECT 1 FROM cop_community_report_attachments a
      JOIN cop_community_erasure_ownership r ON r.kind='report' AND r.row_key=a.report_id::text
      LEFT JOIN cop_community_erasure_ownership o ON o.kind='attachment' AND o.row_key=a.attachment_id::text
      WHERE r.subject_id=$1 AND r.issuer=$2 AND (o.subject_id IS DISTINCT FROM $1 OR o.issuer IS DISTINCT FROM $2) LIMIT 1`, [actor.subjectId, actor.issuer])).rowCount;
  }
  private async preflight(actor: AuthenticatedActor, signal: AbortSignal): Promise<AccountErasureAssessment> {
    requireContentActor(actor); signal.throwIfAborted();
    return contentTransaction(this.pool, async client => {
      if (await this.unknown(client, actor) || await this.foreignAttachmentOnOwnReport(client, actor)) return { ready: false, reason: "ownership_unresolved" };
      if (await this.ownedGroup(client, actor)) return { ready: false, reason: "choice_required" };
      signal.throwIfAborted(); return { ready: true, version: "cop-community-erasure-v1" };
    });
  }
  private async erase(actor: AuthenticatedActor, context: { operationId: string; signal: AbortSignal }, options: { media?: MediaStorage; projections?: CommunityProjectionEraser; now?: () => Date }): Promise<AccountErasureProof> {
    requireContentActor(actor); context.signal.throwIfAborted(); const ownerKey = contentOwnerKey(actor);
    const local = await contentTransaction(this.pool, async client => {
      await fenceContentOwner(client, actor, context.operationId);
      if (await this.unknown(client, actor) || await this.ownedGroup(client, actor) || await this.foreignAttachmentOnOwnReport(client, actor)) return false;
      // Capture every exact owned object before any attachment/report row deletion.
      await client.query(`INSERT INTO cop_community_owned_media(bucket,object_key,subject_id,issuer,upload_expires_at)
        SELECT a.bucket,a.object_key,a.subject_id,o.issuer,a.upload_expires_at FROM cop_community_report_attachments a
        JOIN cop_community_erasure_ownership o ON o.kind='attachment' AND o.row_key=a.attachment_id::text
        WHERE o.subject_id=$1 AND o.issuer=$2 ON CONFLICT(bucket,object_key) DO NOTHING`, [actor.subjectId, actor.issuer]);
      await client.query(`INSERT INTO cop_content_erasure_media_manifest(owner_key,operation_id,bucket,object_key,not_before)
        SELECT $1,$2,bucket,object_key,upload_expires_at+interval '30 seconds' FROM cop_community_owned_media
        WHERE subject_id=$3 AND issuer=$4 ON CONFLICT(owner_key,bucket,object_key) DO NOTHING`, [ownerKey, context.operationId, actor.subjectId, actor.issuer]);
      await client.query(`INSERT INTO cop_content_erasure_projection_manifest(owner_key,operation_id,kind,row_key)
        SELECT $1,$2,kind,row_key FROM cop_community_erasure_ownership WHERE subject_id=$3 AND issuer=$4 AND kind IN ('report','group')
        ON CONFLICT(owner_key,kind,row_key) DO NOTHING`, [ownerKey, context.operationId, actor.subjectId, actor.issuer]);
      // No shared group is deleted. Own membership/confirmations and fields are
      // removed, while current fields authored by another member are preserved.
      await client.query(`UPDATE cop_community_groups g SET metadata=g.metadata-m.fields FROM
        (SELECT group_id,array_agg(field_name) AS fields FROM cop_community_metadata_owners WHERE subject_id=$1 AND issuer=$2 GROUP BY group_id) m
        WHERE m.group_id=g.group_id`, [actor.subjectId, actor.issuer]);
      await client.query("DELETE FROM cop_community_metadata_owners WHERE subject_id=$1 AND issuer=$2", [actor.subjectId, actor.issuer]);
      await client.query(`DELETE FROM cop_community_group_members m USING cop_community_erasure_ownership o
        WHERE o.kind='membership' AND o.row_key=m.group_id::text||':'||m.subject_id AND o.subject_id=$1 AND o.issuer=$2`, [actor.subjectId, actor.issuer]);
      await client.query(`DELETE FROM cop_community_report_confirmations c USING cop_community_erasure_ownership o
        WHERE o.kind='confirmation' AND o.row_key=c.report_id::text||':'||c.subject_id AND o.subject_id=$1 AND o.issuer=$2`, [actor.subjectId, actor.issuer]);
      await client.query(`DELETE FROM cop_community_report_attachments a USING cop_community_erasure_ownership o
        WHERE o.kind='attachment' AND o.row_key=a.attachment_id::text AND o.subject_id=$1 AND o.issuer=$2`, [actor.subjectId, actor.issuer]);
      await client.query(`DELETE FROM cop_community_reports r USING cop_community_erasure_ownership o
        WHERE o.kind='report' AND o.row_key=r.report_id::text AND o.subject_id=$1 AND o.issuer=$2`, [actor.subjectId, actor.issuer]);
      await client.query("DELETE FROM cop_community_erasure_ownership WHERE subject_id=$1 AND issuer=$2", [actor.subjectId, actor.issuer]);
      context.signal.throwIfAborted(); return true;
    });
    if (!local) return { status: "pending", remaining: "cleanup_pending" };
    const activeWrites = await this.pool.query("SELECT 1 FROM cop_community_media_write_leases WHERE subject_id=$1 AND issuer=$2 LIMIT 1", [actor.subjectId, actor.issuer]);
    if (activeWrites.rowCount) return { status: "pending", remaining: "cleanup_pending" };
    const now = options.now?.() ?? new Date();
    const manifest = await this.pool.query<{ bucket: string; object_key: string; not_before: Date }>(
      "SELECT bucket,object_key,not_before FROM cop_content_erasure_media_manifest WHERE owner_key=$1 AND operation_id=$2 ORDER BY bucket,object_key", [ownerKey, context.operationId]);
    for (const row of manifest.rows) {
      context.signal.throwIfAborted();
      if (now.getTime() < new Date(row.not_before).getTime() || !options.media?.eraseVerifiedObject) continue;
      if (await options.media.eraseVerifiedObject({ bucket: row.bucket, objectKey: row.object_key }, now, context.signal) !== "absent") continue;
      await contentTransaction(this.pool, async client => {
        context.signal.throwIfAborted(); await fenceContentOwner(client, actor, context.operationId);
        await client.query("DELETE FROM cop_content_erasure_media_manifest WHERE owner_key=$1 AND operation_id=$2 AND bucket=$3 AND object_key=$4", [ownerKey, context.operationId, row.bucket, row.object_key]);
        await client.query("DELETE FROM cop_community_owned_media WHERE subject_id=$1 AND issuer=$2 AND bucket=$3 AND object_key=$4", [actor.subjectId, actor.issuer, row.bucket, row.object_key]);
      });
    }
    const projected = await this.pool.query<{ kind: string; row_key: string }>("SELECT kind,row_key FROM cop_content_erasure_projection_manifest WHERE owner_key=$1 AND operation_id=$2 ORDER BY kind,row_key", [ownerKey, context.operationId]);
    if (projected.rows.length && options.projections && await options.projections.erase({
      reportIds: projected.rows.filter(row => row.kind === "report").map(row => row.row_key),
      groupIds: projected.rows.filter(row => row.kind === "group").map(row => row.row_key)
    }, { ...context, actor: { issuer: actor.issuer!, subjectId: actor.subjectId } })) {
      await contentTransaction(this.pool, async client => {
        context.signal.throwIfAborted(); await fenceContentOwner(client, actor, context.operationId);
        for (const row of projected.rows) await client.query("DELETE FROM cop_content_erasure_projection_manifest WHERE owner_key=$1 AND operation_id=$2 AND kind=$3 AND row_key=$4", [ownerKey, context.operationId, row.kind, row.row_key]);
      });
    }
    return contentTransaction(this.pool, async client => {
      context.signal.throwIfAborted();
      const pending = await client.query(`SELECT 1 FROM cop_content_erasure_media_manifest WHERE owner_key=$1 AND operation_id=$2
        UNION ALL SELECT 1 FROM cop_content_erasure_projection_manifest WHERE owner_key=$1 AND operation_id=$2 LIMIT 1`, [ownerKey, context.operationId]);
      if (pending.rowCount || await this.unknown(client, actor)) return { status: "pending", remaining: "cleanup_pending" };
      const remaining = await client.query("SELECT 1 FROM cop_community_erasure_ownership WHERE subject_id=$1 AND issuer=$2 UNION ALL SELECT 1 FROM cop_community_owned_media WHERE subject_id=$1 AND issuer=$2 LIMIT 1", [actor.subjectId, actor.issuer]);
      if (remaining.rowCount) return { status: "pending", remaining: "cleanup_pending" };
      const prior = await client.query<{ proof_id: string }>("SELECT proof_id FROM cop_content_erasure_component_proofs WHERE owner_key=$1 AND component='community_reports:postgres'", [ownerKey]);
      const proofId = prior.rows[0]?.proof_id ?? randomUUID();
      await client.query("INSERT INTO cop_content_erasure_component_proofs(owner_key,component,operation_id,proof_id) VALUES($1,'community_reports:postgres',$2,$3) ON CONFLICT(owner_key,component) DO NOTHING", [ownerKey, context.operationId, proofId]);
      return { status: "completed", proofId };
    });
  }
}

/** Actual RAM fallback cleanup. It is never a replacement for the persistent
 * account fence, durable object manifests or the production guard binding. */
export class MemoryCommunityErasureBoundary {
  private readonly admission = new ContentSerialLock();
  private readonly writerBinding = new ContentWriterGuardBinding();
  private readonly owners = new Map<string, Witness>();
  private readonly metadataOwners = new Map<string, Witness>();
  private readonly media = new Map<string, { bucket: string; objectKey: string; expiresAt: string; owner: Witness }>();
  private readonly leases = new Map<string, Witness>();
  private readonly fences = new Map<string, { subjectKey: string; operationId: string; proofId?: string; reportIds: Set<string>; groupIds: Set<string> }>();
  constructor(private readonly maps: {
    reports: Map<string, CommunityReportRecord>; groups: Map<string, CommunityGroupRecord>; attachments: Map<string, CommunityReportAttachmentRecord>;
    confirmations: Map<string, { reportId: string; subjectId: string; updatedAt: string; value: string }>;
  }) {}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    return this.admission.run(run);
  }
  readVerifiedProjectionOwner(kind: "report", id: string): Promise<{ issuer: string; subjectId: string } | undefined> {
    return this.readVerifiedProjectionOwners(kind, [id]).then(owners => owners.get(id.toLowerCase()));
  }
  readVerifiedProjectionOwners(kind: "report", ids: readonly string[]): Promise<Map<string, { issuer: string; subjectId: string }>> {
    return this.serial(async () => {
      if (ids.length > 1000) throw new ContentErasureStoreError(503, "COMMUNITY_PROJECTION_OWNER_BOUND_EXCEEDED");
      const requested = new Set(ids.filter(id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id)).map(id => id.toLowerCase()));
      const result = new Map<string, { issuer: string; subjectId: string }>(), seen = new Set<string>();
      if (kind !== "report") return result;
      for (const [id, row] of this.maps.reports) {
        const normalized = id.toLowerCase(); if (!requested.has(normalized)) continue;
        if (seen.has(normalized)) { result.delete(normalized); continue; }
        seen.add(normalized); const owner = this.owners.get("report:" + id);
        if (owner?.issuer && owner.subjectId === row.createdBy.subjectId) result.set(normalized, { issuer: owner.issuer, subjectId: owner.subjectId });
      }
      return result;
    });
  }
  private assert(owner: Witness): void {
    const blocked = owner.issuer ? this.fences.has(contentOwnerKey(owner)) : [...this.fences.values()].some(fence => fence.subjectKey === contentSubjectKey(owner.subjectId));
    if (blocked) throw new ContentErasureStoreError(403, "ACCOUNT_ERASURE_FENCED");
  }
  extendOwnedMediaUpload(input: { reportId: string; attachmentId: string; objectKey: string; subjectId: string; issuer: string; expiresAt: string }): Promise<void> {
    return this.serial(async () => {
      if (!Number.isFinite(Date.parse(input.expiresAt))) throw new ContentErasureStoreError(400, "COMMUNITY_MEDIA_EXPIRY_INVALID");
      await assertGlobalContentWriter(input, this.writerBinding.guard); this.assert(input);
      const attachment = this.maps.attachments.get(input.attachmentId), owner = this.owners.get("attachment:" + input.attachmentId);
      if (!attachment || attachment.reportId !== input.reportId || attachment.objectKey !== input.objectKey || owner?.subjectId !== input.subjectId || owner.issuer !== input.issuer) throw new ContentErasureStoreError(403, "COMMUNITY_MEDIA_OWNER_MISMATCH");
      const media = this.media.get(attachment.bucket + "\0" + input.objectKey);
      if (!media || media.owner.subjectId !== input.subjectId || media.owner.issuer !== input.issuer) throw new ContentErasureStoreError(503, "COMMUNITY_MEDIA_EXPIRY_UNVERIFIED");
      const deadline = new Date(Math.max(Date.parse(attachment.uploadExpiresAt), Date.parse(media.expiresAt), Date.parse(input.expiresAt))).toISOString();
      attachment.uploadExpiresAt = deadline; media.expiresAt = deadline;
    });
  }
  async withOwnedMediaWrite<T>(input: { reportId: string; attachmentId: string; objectKey: string }, run: () => Promise<T>): Promise<T> {
    const leaseId = randomUUID();
    await this.serial(async () => {
      const attachment = this.maps.attachments.get(input.attachmentId), owner = this.owners.get("attachment:" + input.attachmentId);
      if (!attachment || attachment.reportId !== input.reportId || !owner?.issuer) throw new ContentErasureStoreError(503, "COMMUNITY_MEDIA_OWNER_UNVERIFIED");
      if (!input.objectKey.startsWith(`community-reports/${input.reportId}/${input.attachmentId}/`) || input.objectKey.split("/").some(segment => segment === "." || segment === "..")) throw new ContentErasureStoreError(400, "COMMUNITY_MEDIA_OBJECT_MISMATCH");
      await assertGlobalContentWriter(owner, this.writerBinding.guard); this.assert(owner); const key = attachment.bucket + "\0" + input.objectKey, existing = this.media.get(key);
      if (existing && (existing.owner.subjectId !== owner.subjectId || existing.owner.issuer !== owner.issuer)) throw new ContentErasureStoreError(409, "COMMUNITY_MEDIA_OWNER_CONFLICT");
      if (!existing) this.media.set(key, { bucket: attachment.bucket, objectKey: input.objectKey, expiresAt: new Date().toISOString(), owner });
      this.leases.set(leaseId, owner);
    });
    const result = await run(); await this.serial(async () => { this.leases.delete(leaseId); }); return result;
  }
  install(target: object): void {
    const store = target as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const method of writes) {
      const original = store[method]!.bind(target);
      Object.defineProperty(target, method, { configurable: false, value: (...args: unknown[]) => this.serial(async () => {
        const owner = writer(method, args), input = object(args[0]), member = witness(input.member);
        if (owner) { await assertGlobalContentWriter(owner, this.writerBinding.guard); this.assert(owner); }
        const ownedTarget = ownerAuthorizedTarget(method, args, owner), existingOwner = ownedTarget ? this.owners.get(ownedTarget.kind + ":" + ownedTarget.rowKey) : undefined;
        if (existingOwner?.issuer && owner && (existingOwner.subjectId !== owner.subjectId || existingOwner.issuer !== owner.issuer)) throw new ContentErasureStoreError(404, "COMMUNITY_RESOURCE_NOT_FOUND");
        if (ownedTarget?.kind === "report" && owner) {
          const existing = this.maps.reports.get(ownedTarget.rowKey);
          if (existing && existing.createdBy.subjectId !== owner.subjectId) throw new ContentErasureStoreError(404, "COMMUNITY_RESOURCE_NOT_FOUND");
        }
        if (member && method === "upsertGroupMember" && input.status !== "left") { await assertGlobalContentWriter(member, this.writerBinding.guard); this.assert(member); }
        if (method === "updateAttachmentMetadata") {
          const existing = this.owners.get("attachment:" + String(input.attachmentId));
          if (existing) { await assertGlobalContentWriter(existing, this.writerBinding.guard); this.assert(existing); }
        }
        const priorReport = typeof input.reportId === "string" && this.maps.reports.has(input.reportId);
        const priorAttachment = this.maps.attachments.has(String(input.attachmentId));
        const membershipOwner = method === "upsertGroupMember" ? member : owner;
        const groupId = method === "upsertGroupMember" ? String(input.groupId) : String(args[0]);
        const priorMembership = !!membershipOwner && !!this.maps.groups.get(groupId)?.members.some(value => value.subjectId === membershipOwner.subjectId);
        const priorConfirmation = owner && this.maps.confirmations.has(String(args[0]) + ":" + owner.subjectId);
        const result = await original(...args), value = object(result);
        if (!result) return result;
        if (method === "createReport" && !priorReport && owner) this.owners.set("report:" + String(value.reportId), owner);
        if (method === "createGroup" && owner) {
          this.owners.set("group:" + String(value.groupId), owner);
          this.owners.set("membership:" + String(value.groupId) + ":" + owner.subjectId, owner);
          for (const field of Object.keys(object(input.metadata))) this.metadataOwners.set(String(value.groupId) + "\0" + field, owner);
        }
        if ((method === "requestGroupMembership" || method === "upsertGroupMember") && membershipOwner && !priorMembership) this.owners.set("membership:" + groupId + ":" + membershipOwner.subjectId, membershipOwner);
        if (method === "upsertReportConfirmation" && owner && !priorConfirmation) this.owners.set("confirmation:" + String(args[0]) + ":" + owner.subjectId, owner);
        if (method === "createAttachment" && owner && !priorAttachment) {
          this.owners.set("attachment:" + String(input.attachmentId), owner);
          const mediaKey = String(input.bucket) + "\0" + String(input.objectKey), saved = this.media.get(mediaKey);
          if (saved && (saved.owner.subjectId !== owner.subjectId || saved.owner.issuer !== owner.issuer)) throw new ContentErasureStoreError(409, "COMMUNITY_MEDIA_OWNER_CONFLICT");
          this.media.set(mediaKey, { bucket: String(input.bucket), objectKey: String(input.objectKey), expiresAt: String(input.uploadExpiresAt), owner });
        }
        if (method === "updateGroupMetadata" && owner) for (const name of Object.keys(object(input.metadata))) this.metadataOwners.set(String(input.groupId) + "\0" + name, owner);
        return result;
      }) });
    }
  }
  private owned(value: Witness | undefined, actor: AuthenticatedActor): boolean { return value?.subjectId === actor.subjectId && value.issuer === actor.issuer; }
  private unknown(actor: AuthenticatedActor): boolean {
    if ([...this.owners.values(), ...this.metadataOwners.values(), ...[...this.media.values()].map(value => value.owner)].some(owner => owner.subjectId === actor.subjectId && !owner.issuer)) return true;
    const check = (kind: string, id: string, subjectId: string) => subjectId === actor.subjectId && !this.owners.get(kind + ":" + id)?.issuer;
    return [...this.maps.reports].some(([id, row]) => check("report", id, row.createdBy.subjectId))
      || [...this.maps.attachments].some(([id, row]) => check("attachment", id, row.subjectId))
      || [...this.maps.groups].some(([id, row]) => check("group", id, row.createdBy.subjectId) || row.members.some(member => check("membership", id + ":" + member.subjectId, member.subjectId)))
      || [...this.maps.confirmations].some(([id, row]) => check("confirmation", id, row.subjectId));
  }
  private unresolved(actor: AuthenticatedActor): "ownership_unresolved" | "choice_required" | undefined {
    if (this.unknown(actor)) return "ownership_unresolved";
    if ([...this.maps.groups].some(([id]) => this.owned(this.owners.get("group:" + id), actor))) return "choice_required";
    const reports = new Set([...this.maps.reports].filter(([id]) => this.owned(this.owners.get("report:" + id), actor)).map(([id]) => id));
    if ([...this.maps.attachments].some(([id, row]) => reports.has(row.reportId) && !this.owned(this.owners.get("attachment:" + id), actor))) return "ownership_unresolved";
    return undefined;
  }
  component(name: string, options: { media?: MediaStorage; projections?: CommunityProjectionEraser; now?: () => Date } = {}): ContentErasureComponent {
    return { component: "community_reports:" + name, ready: async () => {
      if ([...this.owners.values(), ...this.metadataOwners.values(), ...[...this.media.values()].map(value => value.owner)].some(owner => !owner.issuer)) return false;
      return [...this.maps.reports.keys()].every(id => !!this.owners.get("report:" + id)?.issuer)
        && [...this.maps.attachments.keys()].every(id => !!this.owners.get("attachment:" + id)?.issuer)
        && [...this.maps.groups].every(([id, group]) => !!this.owners.get("group:" + id)?.issuer && group.members.every(member => !!this.owners.get("membership:" + id + ":" + member.subjectId)?.issuer))
        && [...this.maps.confirmations.keys()].every(id => !!this.owners.get("confirmation:" + id)?.issuer);
    },
      bindWriterGuard: guard => this.writerBinding.bind(guard), writerGuardMatches: guard => this.writerBinding.matches(guard),
      withAdmission: run => this.admission.run(run),
      preflight: (actor, signal) => this.serial(async () => {
        requireContentActor(actor); signal.throwIfAborted(); const reason = this.unresolved(actor);
        return reason ? { ready: false, reason } : { ready: true, version: "cop-community-erasure-v1" };
      }), erase: async (actor, context) => {
        requireContentActor(actor); context.signal.throwIfAborted(); const key = contentOwnerKey(actor);
        const local = await this.serial(async () => {
          const previous = this.fences.get(key);
          if (previous && previous.operationId !== context.operationId) throw new ContentErasureStoreError(409, "CONTENT_ERASURE_OPERATION_CONFLICT");
          const fence = previous ?? { subjectKey: contentSubjectKey(actor.subjectId), operationId: context.operationId, reportIds: new Set<string>(), groupIds: new Set<string>() };
          this.fences.set(key, fence); if (this.unresolved(actor)) return false;
          const ownMemberships = new Set([...this.owners].filter(([id, owner]) => id.startsWith("membership:") && this.owned(owner, actor)).map(([id]) => id));
          for (const [id, owner] of this.owners) {
            if (!this.owned(owner, actor)) continue;
            if (id.startsWith("report:")) { const reportId = id.slice(7); this.maps.reports.delete(reportId); fence.reportIds.add(reportId);
              for (const [confirmationId, confirmation] of this.maps.confirmations) if (confirmation.reportId === reportId) this.maps.confirmations.delete(confirmationId); }
            if (id.startsWith("group:")) fence.groupIds.add(id.slice(6));
            if (id.startsWith("attachment:")) this.maps.attachments.delete(id.slice(11));
            if (id.startsWith("confirmation:")) this.maps.confirmations.delete(id.slice(13));
            this.owners.delete(id);
          }
          for (const [id, group] of this.maps.groups) group.members = group.members.filter(member => !ownMemberships.has("membership:" + id + ":" + member.subjectId));
          for (const [field, owner] of this.metadataOwners) if (this.owned(owner, actor)) {
            const [id, name] = field.split("\0"), group = this.maps.groups.get(id!); if (group) delete group.metadata[name!]; this.metadataOwners.delete(field);
          }
          return true;
        });
        if (!local) return { status: "pending", remaining: "cleanup_pending" };
        if ([...this.leases.values()].some(owner => this.owned(owner, actor))) return { status: "pending", remaining: "cleanup_pending" };
        const now = options.now?.() ?? new Date();
        for (const [id, value] of this.media) {
          if (!this.owned(value.owner, actor) || now.getTime() < Date.parse(value.expiresAt) + 30000 || !options.media?.eraseVerifiedObject) continue;
          context.signal.throwIfAborted();
          if (await options.media.eraseVerifiedObject({ bucket: value.bucket, objectKey: value.objectKey }, now, context.signal) === "absent") await this.serial(async () => { this.media.delete(id); });
        }
        const fence = this.fences.get(key)!;
        if ((fence.reportIds.size || fence.groupIds.size) && options.projections && await options.projections.erase({ reportIds: [...fence.reportIds], groupIds: [...fence.groupIds] }, { ...context, actor: { issuer: actor.issuer!, subjectId: actor.subjectId } })) {
          await this.serial(async () => { context.signal.throwIfAborted(); fence.reportIds.clear(); fence.groupIds.clear(); });
        }
        return this.serial(async () => {
          context.signal.throwIfAborted();
          if (this.unknown(actor) || fence.reportIds.size || fence.groupIds.size || [...this.media.values()].some(value => this.owned(value.owner, actor)) || [...this.leases.values()].some(owner => this.owned(owner, actor))) return { status: "pending", remaining: "cleanup_pending" };
          fence.proofId ??= randomUUID(); return { status: "completed", proofId: fence.proofId };
        });
      } };
  }
}
export const communityErasureSchema = `
CREATE TABLE IF NOT EXISTS cop_community_erasure_ownership(kind text NOT NULL,row_key text NOT NULL,subject_id text NOT NULL,issuer text,PRIMARY KEY(kind,row_key));
CREATE INDEX IF NOT EXISTS cop_community_erasure_ownership_owner_idx ON cop_community_erasure_ownership(subject_id,issuer);
CREATE TABLE IF NOT EXISTS cop_community_owned_media(bucket text NOT NULL,object_key text NOT NULL,subject_id text NOT NULL,issuer text,upload_expires_at timestamptz NOT NULL,PRIMARY KEY(bucket,object_key));
CREATE TABLE IF NOT EXISTS cop_community_metadata_owners(group_id uuid NOT NULL,field_name text NOT NULL,subject_id text NOT NULL,issuer text,PRIMARY KEY(group_id,field_name));
CREATE TABLE IF NOT EXISTS cop_community_media_write_leases(lease_id uuid PRIMARY KEY,bucket text NOT NULL,object_key text NOT NULL,subject_id text NOT NULL,issuer text NOT NULL);
CREATE TABLE IF NOT EXISTS cop_content_erasure_media_manifest(owner_key text NOT NULL REFERENCES cop_content_erasure_fences(owner_key),operation_id text NOT NULL,bucket text NOT NULL,object_key text NOT NULL,not_before timestamptz NOT NULL,PRIMARY KEY(owner_key,bucket,object_key));
CREATE TABLE IF NOT EXISTS cop_content_erasure_projection_manifest(owner_key text NOT NULL REFERENCES cop_content_erasure_fences(owner_key),operation_id text NOT NULL,kind text NOT NULL,row_key text NOT NULL,PRIMARY KEY(owner_key,kind,row_key));`;
