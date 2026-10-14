import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { IncidentActor, IncidentRecord, IncidentTaskRecord } from "./incident-store.js";
import type { AuthenticatedActor } from "./security.js";
import type { CommunityProjectionEraser } from "./community-erasure.js";
import type { AccountErasureAssessment, AccountErasureProof } from "./account-erasure.js";
import { assertContentWriter, assertGlobalContentWriter, contentOwnerKey, contentSubjectKey, contentTransaction,
  ContentErasureStoreError, ContentSerialLock, ContentWriterGuardBinding, fenceContentOwner, requireContentActor, type ContentErasureComponent } from "./content-erasure.js";

type Witness = { subjectId: string; issuer?: string };
interface Ownership { kind: "incident" | "task"; id: string; creator: Witness; updater?: Witness; assignee?: Witness; contributors: Witness[] }
const methods = ["createIncident", "createTask", "updateIncident", "updateTask"] as const;
const identity = (owner: Witness) => createHash("sha256").update(JSON.stringify([owner.issuer ?? null, owner.subjectId])).digest("hex");
const matches = (owner: Witness | undefined, actor: AuthenticatedActor) => owner?.subjectId === actor.subjectId && owner.issuer === actor.issuer;
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function writer(method: string, args: unknown[]): Witness {
  const input = method.startsWith("create") ? object(args[0]).createdBy : args[1], actor = object(input);
  if (typeof actor.subjectId !== "string" || !actor.subjectId) throw new ContentErasureStoreError(401, "INCIDENT_WRITER_IDENTITY_REQUIRED");
  return { subjectId: actor.subjectId, ...(typeof actor.issuer === "string" && actor.issuer ? { issuer: actor.issuer } : {}) };
}
function assignee(method: string, args: unknown[]): Witness | undefined {
  const input = object(args[method.startsWith("create") ? 0 : 2]);
  const actor = writer(method, args);
  return typeof input.assigneeSubjectId === "string" && input.assigneeSubjectId ? { subjectId: input.assigneeSubjectId,
    ...(typeof input.assigneeIssuer === "string" ? { issuer: input.assigneeIssuer } : input.assigneeSubjectId === actor.subjectId && actor.issuer ? { issuer: actor.issuer } : {}) } : undefined;
}
function assessment(actor: AuthenticatedActor, incidents: IncidentRecord[], tasks: IncidentTaskRecord[], owners: Map<string, Ownership>): AccountErasureAssessment {
  const records: Array<{ kind: "incident" | "task"; id: string; record: IncidentRecord | IncidentTaskRecord }> = [
    ...incidents.map(record => ({ kind: "incident" as const, id: record.incidentId, record })),
    ...tasks.map(record => ({ kind: "task" as const, id: record.taskId, record }))
  ];
  for (const { kind, id, record } of records) {
    const known = owners.get(kind + ":" + id);
    if (record.createdBy.subjectId === actor.subjectId && (!known?.creator.issuer || known.creator.subjectId !== record.createdBy.subjectId)) return { ready: false, reason: "ownership_unresolved" };
    if (record.updatedBy?.subjectId === actor.subjectId && (!known?.updater?.issuer || known.updater.subjectId !== record.updatedBy.subjectId)) return { ready: false, reason: "ownership_unresolved" };
    if (kind === "task" && (record as IncidentTaskRecord).assigneeSubjectId === actor.subjectId && !known?.assignee?.issuer) return { ready: false, reason: "ownership_unresolved" };
    if (!known) continue;
    if (known.contributors.some(owner => owner.subjectId === actor.subjectId && !owner.issuer)) return { ready: false, reason: "ownership_unresolved" };
    const own = matches(known.creator, actor), contributes = known.contributors.some(owner => matches(owner, actor));
    if (matches(known.assignee, actor) && !own) return { ready: false, reason: "choice_required" };
    // Whole shared edits cannot be truthfully separated from arbitrary JSON and
    // prose without an explicit field/history policy. Do not erase other authors.
    if ((own && known.contributors.some(owner => !matches(owner, actor))) || (!own && contributes)) return { ready: false, reason: "ownership_unresolved" };
    if (kind === "incident" && own && tasks.some(task => task.incidentId === id && !matches(owners.get("task:" + task.taskId)?.creator, actor))) return { ready: false, reason: "ownership_unresolved" };
  }
  return { ready: true, version: "cop-incident-erasure-v1" };
}
function install(target: object, guard: (method: string, args: unknown[], run: () => Promise<unknown>) => Promise<unknown>): void {
  const store = target as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const method of methods) { const original = store[method]!.bind(target); Object.defineProperty(target, method, { value: (...args: unknown[]) => guard(method, args, () => original(...args)) }); }
}
export class MemoryIncidentErasureBoundary {
  private readonly admission = new ContentSerialLock();
  private readonly writerBinding = new ContentWriterGuardBinding();
  private readonly owners = new Map<string, Ownership>();
  private readonly fences = new Map<string, { subjectKey: string; operationId: string; proofId?: string; incidents: Set<string>; tasks: Set<string> }>();
  constructor(private readonly records: { incidents: Map<string, IncidentRecord>; tasks: Map<string, IncidentTaskRecord> }) {}
  readVerifiedProjectionOwner(kind: "incident", id: string): Promise<{ issuer: string; subjectId: string } | undefined> {
    return this.readVerifiedProjectionOwners(kind, [id]).then(owners => owners.get(id.toLowerCase()));
  }
  readVerifiedProjectionOwners(kind: "incident", ids: readonly string[]): Promise<Map<string, { issuer: string; subjectId: string }>> {
    return this.admission.run(async () => {
      if (ids.length > 1000) throw new ContentErasureStoreError(503, "INCIDENT_PROJECTION_OWNER_BOUND_EXCEEDED");
      const requested = new Set(ids.filter(id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id)).map(id => id.toLowerCase()));
      const result = new Map<string, { issuer: string; subjectId: string }>(), seen = new Set<string>();
      if (kind !== "incident") return result;
      for (const [id, row] of this.records.incidents) {
        const normalized = id.toLowerCase(); if (!requested.has(normalized)) continue;
        if (seen.has(normalized)) { result.delete(normalized); continue; }
        seen.add(normalized); const owner = this.owners.get("incident:" + id)?.creator;
        if (owner?.issuer && owner.subjectId === row.createdBy.subjectId) result.set(normalized, { issuer: owner.issuer, subjectId: owner.subjectId });
      }
      return result;
    });
  }
  private assert(owner: Witness): void {
    const forbidden = owner.issuer ? this.fences.has(contentOwnerKey(owner)) : [...this.fences.values()].some(fence => fence.subjectKey === contentSubjectKey(owner.subjectId));
    if (forbidden) throw new ContentErasureStoreError(403, "ACCOUNT_ERASURE_FENCED");
  }
  install(target: object): void { install(target, (method, args, run) => this.admission.run(async () => {
    const actor = writer(method, args), assigned = assignee(method, args);
    await assertGlobalContentWriter(actor, this.writerBinding.guard); this.assert(actor);
    if (assigned) { await assertGlobalContentWriter(assigned, this.writerBinding.guard); this.assert(assigned); }
    if (method === "createTask" && !this.records.incidents.has(String(object(args[0]).incidentId))) throw new ContentErasureStoreError(404, "INCIDENT_NOT_FOUND");
    const result = await run(); if (!result) return result;
    const value = object(result), kind = method.endsWith("Incident") ? "incident" as const : "task" as const, id = String(kind === "incident" ? value.incidentId : value.taskId);
    const key = kind + ":" + id, existing = this.owners.get(key);
    if (method.startsWith("create")) this.owners.set(key, { kind, id, creator: actor, contributors: [actor], ...(assigned ? { assignee: assigned } : {}) });
    else if (existing) {
      existing.updater = actor; if (!existing.contributors.some(owner => identity(owner) === identity(actor))) existing.contributors.push(actor);
      const input = object(args[2]); if (assigned) existing.assignee = assigned; if (input.assigneeSubjectId === null) delete existing.assignee;
    }
    return result;
  })); }
  component(name: string, projections?: CommunityProjectionEraser): ContentErasureComponent {
    return { component: "incidents:" + name, ready: async () => [...this.owners.values()].every(owner => !!owner.creator.issuer && (!owner.updater || !!owner.updater.issuer) && (!owner.assignee || !!owner.assignee.issuer) && owner.contributors.every(value => !!value.issuer))
      && [...this.records.incidents.keys()].every(id => this.owners.has("incident:" + id)) && [...this.records.tasks.keys()].every(id => this.owners.has("task:" + id)), withAdmission: run => this.admission.run(run),
      bindWriterGuard: guard => this.writerBinding.bind(guard), writerGuardMatches: guard => this.writerBinding.matches(guard),
      preflight: (actor, signal) => this.admission.run(async () => { requireContentActor(actor); signal.throwIfAborted(); return assessment(actor, [...this.records.incidents.values()], [...this.records.tasks.values()], this.owners); }),
      erase: async (actor, context) => {
        requireContentActor(actor); context.signal.throwIfAborted(); const key = contentOwnerKey(actor);
        const local = await this.admission.run(async () => {
          const previous = this.fences.get(key); if (previous && previous.operationId !== context.operationId) throw new ContentErasureStoreError(409, "CONTENT_ERASURE_OPERATION_CONFLICT");
          const fence = previous ?? { subjectKey: contentSubjectKey(actor.subjectId), operationId: context.operationId, incidents: new Set<string>(), tasks: new Set<string>() }; this.fences.set(key, fence);
          if (!assessment(actor, [...this.records.incidents.values()], [...this.records.tasks.values()], this.owners).ready) return false;
          for (const [id, owner] of this.owners) {
            if (matches(owner.creator, actor)) {
              if (owner.kind === "incident") { this.records.incidents.delete(owner.id); fence.incidents.add(owner.id); }
              else { this.records.tasks.delete(owner.id); fence.tasks.add(owner.id); }
              this.owners.delete(id);
            } else if (matches(owner.assignee, actor)) {
              const record = this.records.tasks.get(owner.id); if (record) delete record.assigneeSubjectId; delete owner.assignee;
            }
          }
          return true;
        });
        if (!local) return { status: "pending", remaining: "cleanup_pending" };
        const fence = this.fences.get(key)!;
        if ((fence.incidents.size || fence.tasks.size) && projections && await projections.erase({ reportIds: [], groupIds: [], incidentIds: [...fence.incidents], taskIds: [...fence.tasks] }, { ...context, actor: { issuer: actor.issuer!, subjectId: actor.subjectId } })) await this.admission.run(async () => { context.signal.throwIfAborted(); fence.incidents.clear(); fence.tasks.clear(); });
        return this.admission.run(async () => { context.signal.throwIfAborted();
          if (fence.incidents.size || fence.tasks.size || [...this.owners.values()].some(owner => matches(owner.creator, actor) || matches(owner.assignee, actor) || owner.contributors.some(contributor => matches(contributor, actor)))) return { status: "pending", remaining: "cleanup_pending" };
          fence.proofId ??= randomUUID(); return { status: "completed", proofId: fence.proofId }; });
      } };
  }
}

export class PostgresIncidentErasureBoundary {
  private readonly context = new AsyncLocalStorage<PoolClient>();
  private readonly writerBinding = new ContentWriterGuardBinding();
  constructor(private readonly pool: Pool) {}
  get database(): Pick<Pool, "query"> { return this.context.getStore() ?? this.pool; }
  async readVerifiedProjectionOwner(kind: "incident", id: string): Promise<{ issuer: string; subjectId: string } | undefined> {
    return (await this.readVerifiedProjectionOwners(kind, [id])).get(id.toLowerCase());
  }
  async readVerifiedProjectionOwners(kind: "incident", ids: readonly string[]): Promise<Map<string, { issuer: string; subjectId: string }>> {
    if (ids.length > 1000) throw new ContentErasureStoreError(503, "INCIDENT_PROJECTION_OWNER_BOUND_EXCEEDED");
    const requested = [...new Set(ids.filter(id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id)).map(id => id.toLowerCase()))];
    if (kind !== "incident" || requested.length === 0) return new Map();
    return contentTransaction(this.pool, async client => {
      const result = await client.query<{ row_key: string; creator_issuer: string; creator_subject: string }>(`SELECT o.row_key,o.creator_issuer,o.creator_subject
        FROM cop_incident_erasure_owners o JOIN cop_incidents r ON o.kind='incident' AND o.row_key=r.incident_id AND o.creator_subject=r.record->'createdBy'->>'subjectId'
        WHERE o.row_key=ANY($1::text[]) AND o.creator_issuer IS NOT NULL`, [requested]);
      return new Map(result.rows.filter(row => row.creator_issuer).map(row => [row.row_key, { issuer: row.creator_issuer, subjectId: row.creator_subject }]));
    });
  }
  install(target: object): void { install(target, (method, args, run) => contentTransaction(this.pool, client => this.context.run(client, async () => {
    const actor = writer(method, args), assigned = assignee(method, args); await assertContentWriter(client, actor, this.writerBinding.guard);
    if (assigned) await assertContentWriter(client, assigned, this.writerBinding.guard);
    const result = await run(); if (!result) return result;
    const value = object(result), kind = method.endsWith("Incident") ? "incident" : "task", id = String(kind === "incident" ? value.incidentId : value.taskId);
    if (method.startsWith("create")) {
      await client.query(`INSERT INTO cop_incident_erasure_owners(kind,row_key,creator_subject,creator_issuer,creator_key) VALUES($1,$2,$3,$4,$5)`, [kind, id, actor.subjectId, actor.issuer ?? null, identity(actor)]);
    } else {
      // A legacy creator is never adopted from an authenticated update.
      await client.query("UPDATE cop_incident_erasure_owners SET updater_subject=$3,updater_issuer=$4 WHERE kind=$1 AND row_key=$2", [kind, id, actor.subjectId, actor.issuer ?? null]);
    }
    await client.query("INSERT INTO cop_incident_erasure_contributors(kind,row_key,owner_key,subject_id,issuer) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,row_key,owner_key) DO NOTHING", [kind, id, identity(actor), actor.subjectId, actor.issuer ?? null]);
    const input = object(args[method.startsWith("create") ? 0 : 2]);
    if (assigned || input.assigneeSubjectId === null) await client.query("UPDATE cop_incident_erasure_owners SET assignee_subject=$3,assignee_issuer=$4 WHERE kind=$1 AND row_key=$2", [kind, id, assigned?.subjectId ?? null, assigned?.issuer ?? null]);
    return result;
  }))); }
  private async impact(client: PoolClient, actor: AuthenticatedActor) {
    const ids = identity(actor);
    const rows = await client.query<{ kind: "incident" | "task"; row_key: string; record: IncidentRecord | IncidentTaskRecord }>(`SELECT 'incident' AS kind,incident_id AS row_key,record FROM cop_incidents r WHERE
      record->'createdBy'->>'subjectId'=$1 OR record->'updatedBy'->>'subjectId'=$1 OR EXISTS(SELECT 1 FROM cop_incident_erasure_contributors c WHERE c.kind='incident' AND c.row_key=r.incident_id AND (c.owner_key=$2 OR (c.subject_id=$1 AND c.issuer IS NULL)))
      UNION ALL SELECT 'task',task_id,record FROM cop_incident_tasks t WHERE record->'createdBy'->>'subjectId'=$1 OR record->'updatedBy'->>'subjectId'=$1 OR record->>'assigneeSubjectId'=$1
      OR EXISTS(SELECT 1 FROM cop_incident_erasure_contributors c WHERE c.kind='task' AND c.row_key=t.task_id AND (c.owner_key=$2 OR (c.subject_id=$1 AND c.issuer IS NULL)))
      OR incident_id IN(SELECT row_key FROM cop_incident_erasure_owners WHERE kind='incident' AND creator_key=$2)`, [actor.subjectId, ids]);
    const owners = new Map<string, Ownership>();
    for (const row of rows.rows) {
      const result = await client.query<{ creator_subject: string; creator_issuer: string | null; updater_subject: string | null; updater_issuer: string | null; assignee_subject: string | null; assignee_issuer: string | null }>("SELECT * FROM cop_incident_erasure_owners WHERE kind=$1 AND row_key=$2", [row.kind, row.row_key]);
      const owner = result.rows[0]; if (!owner) continue;
      const contributors = await client.query<{ subject_id: string; issuer: string | null }>("SELECT subject_id,issuer FROM cop_incident_erasure_contributors WHERE kind=$1 AND row_key=$2", [row.kind, row.row_key]);
      owners.set(row.kind + ":" + row.row_key, { kind: row.kind, id: row.row_key, creator: { subjectId: owner.creator_subject, issuer: owner.creator_issuer ?? undefined },
        ...(owner.updater_subject ? { updater: { subjectId: owner.updater_subject, issuer: owner.updater_issuer ?? undefined } } : {}),
        ...(owner.assignee_subject ? { assignee: { subjectId: owner.assignee_subject, issuer: owner.assignee_issuer ?? undefined } } : {}),
        contributors: contributors.rows.map(value => ({ subjectId: value.subject_id, issuer: value.issuer ?? undefined })) });
    }
    return { incidents: rows.rows.filter(row => row.kind === "incident").map(row => row.record as IncidentRecord),
      tasks: rows.rows.filter(row => row.kind === "task").map(row => row.record as IncidentTaskRecord), owners };
  }
  component(projections?: CommunityProjectionEraser): ContentErasureComponent {
    return { component: "incidents:postgres", ready: async () => { try { return await contentTransaction(this.pool, async client => {
      const unresolved = await client.query(`SELECT 1 FROM cop_incident_erasure_owners WHERE creator_issuer IS NULL OR (updater_subject IS NOT NULL AND updater_issuer IS NULL) OR (assignee_subject IS NOT NULL AND assignee_issuer IS NULL)
        UNION ALL SELECT 1 FROM cop_incident_erasure_contributors WHERE issuer IS NULL
        UNION ALL SELECT 1 FROM cop_incidents r LEFT JOIN cop_incident_erasure_owners o ON o.kind='incident' AND o.row_key=r.incident_id WHERE o.creator_issuer IS NULL
        UNION ALL SELECT 1 FROM cop_incident_tasks t LEFT JOIN cop_incident_erasure_owners o ON o.kind='task' AND o.row_key=t.task_id WHERE o.creator_issuer IS NULL LIMIT 1`); return unresolved.rowCount === 0;
    }); } catch { return false; } },
      bindWriterGuard: guard => this.writerBinding.bind(guard), writerGuardMatches: guard => this.writerBinding.matches(guard),
      withAdmission: run => contentTransaction(this.pool, async () => run()),
      preflight: (actor, signal) => contentTransaction(this.pool, async client => { requireContentActor(actor); signal.throwIfAborted(); const impact = await this.impact(client, actor); return assessment(actor, impact.incidents, impact.tasks, impact.owners); }),
      erase: (actor, context) => this.erase(actor, context, projections) };
  }
  private async erase(actor: AuthenticatedActor, context: { operationId: string; signal: AbortSignal }, projections?: CommunityProjectionEraser): Promise<AccountErasureProof> {
    requireContentActor(actor); context.signal.throwIfAborted(); const key = contentOwnerKey(actor);
    const local = await contentTransaction(this.pool, async client => {
      await fenceContentOwner(client, actor, context.operationId); const impact = await this.impact(client, actor);
      if (!assessment(actor, impact.incidents, impact.tasks, impact.owners).ready) return false;
      for (const owner of impact.owners.values()) {
        if (matches(owner.creator, actor)) {
          await client.query("INSERT INTO cop_content_erasure_projection_manifest(owner_key,operation_id,kind,row_key) VALUES($1,$2,$3,$4) ON CONFLICT(owner_key,kind,row_key) DO NOTHING", [key, context.operationId, owner.kind, owner.id]);
          await client.query(owner.kind === "task" ? "DELETE FROM cop_incident_tasks WHERE task_id=$1" : "DELETE FROM cop_incidents WHERE incident_id=$1", [owner.id]);
          await client.query("DELETE FROM cop_incident_erasure_contributors WHERE kind=$1 AND row_key=$2", [owner.kind, owner.id]);
          await client.query("DELETE FROM cop_incident_erasure_owners WHERE kind=$1 AND row_key=$2", [owner.kind, owner.id]);
        } else if (matches(owner.assignee, actor)) {
          await client.query("UPDATE cop_incident_tasks SET record=record-'assigneeSubjectId' WHERE task_id=$1", [owner.id]);
          await client.query("UPDATE cop_incident_erasure_owners SET assignee_subject=NULL,assignee_issuer=NULL WHERE kind='task' AND row_key=$1", [owner.id]);
        }
      }
      context.signal.throwIfAborted(); return true;
    });
    if (!local) return { status: "pending", remaining: "cleanup_pending" };
    const manifest = await this.pool.query<{ kind: string; row_key: string }>("SELECT kind,row_key FROM cop_content_erasure_projection_manifest WHERE owner_key=$1 AND operation_id=$2 AND kind IN('incident','task')", [key, context.operationId]);
    if (manifest.rows.length && projections && await projections.erase({ reportIds: [], groupIds: [], incidentIds: manifest.rows.filter(row => row.kind === "incident").map(row => row.row_key), taskIds: manifest.rows.filter(row => row.kind === "task").map(row => row.row_key) }, { ...context, actor: { issuer: actor.issuer!, subjectId: actor.subjectId } })) {
      await contentTransaction(this.pool, async client => { context.signal.throwIfAborted(); for (const row of manifest.rows) await client.query("DELETE FROM cop_content_erasure_projection_manifest WHERE owner_key=$1 AND operation_id=$2 AND kind=$3 AND row_key=$4", [key, context.operationId, row.kind, row.row_key]); });
    }
    return contentTransaction(this.pool, async client => {
      context.signal.throwIfAborted(); const impact = await this.impact(client, actor);
      if (!assessment(actor, impact.incidents, impact.tasks, impact.owners).ready || [...impact.owners.values()].some(owner => matches(owner.creator, actor) || matches(owner.assignee, actor) || owner.contributors.some(value => matches(value, actor)))) return { status: "pending", remaining: "cleanup_pending" };
      if ((await client.query("SELECT 1 FROM cop_content_erasure_projection_manifest WHERE owner_key=$1 AND operation_id=$2 AND kind IN('incident','task') LIMIT 1", [key, context.operationId])).rowCount) return { status: "pending", remaining: "cleanup_pending" };
      const previous = await client.query<{ proof_id: string }>("SELECT proof_id FROM cop_content_erasure_component_proofs WHERE owner_key=$1 AND component='incidents:postgres'", [key]);
      const proofId = previous.rows[0]?.proof_id ?? randomUUID(); await client.query("INSERT INTO cop_content_erasure_component_proofs(owner_key,component,operation_id,proof_id) VALUES($1,'incidents:postgres',$2,$3) ON CONFLICT(owner_key,component) DO NOTHING", [key, context.operationId, proofId]);
      return { status: "completed", proofId };
    });
  }
}
export const incidentErasureSchema = `
CREATE TABLE IF NOT EXISTS cop_incident_erasure_owners(kind text NOT NULL,row_key text NOT NULL,creator_subject text NOT NULL,creator_issuer text,creator_key text NOT NULL,updater_subject text,updater_issuer text,assignee_subject text,assignee_issuer text,PRIMARY KEY(kind,row_key));
CREATE TABLE IF NOT EXISTS cop_incident_erasure_contributors(kind text NOT NULL,row_key text NOT NULL,owner_key text NOT NULL,subject_id text NOT NULL,issuer text,PRIMARY KEY(kind,row_key,owner_key));
CREATE INDEX IF NOT EXISTS cop_incident_erasure_contributors_owner_idx ON cop_incident_erasure_contributors(owner_key);
CREATE TABLE IF NOT EXISTS cop_content_erasure_projection_manifest(owner_key text NOT NULL REFERENCES cop_content_erasure_fences(owner_key),operation_id text NOT NULL,kind text NOT NULL,row_key text NOT NULL,PRIMARY KEY(owner_key,kind,row_key));`;
