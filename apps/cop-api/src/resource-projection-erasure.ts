import type { Pool, PoolClient } from "pg";
import type { RuntimeOwner, RuntimeOwnerAssessment } from "./runtime-owner-erasure.js";
import { requireRuntimeOwner, runtimeAssessment, runtimeOwnerHash, runtimeSubjectHash } from "./runtime-owner-erasure.js";

export interface ProjectionResources {
  reportIds: string[]; groupIds: string[];
  incidentIds?: string[]; taskIds?: string[]; drawingIds?: string[];
}
export interface ProjectionEraseContext { operationId: string; signal: AbortSignal; actor?: RuntimeOwner }
export type ProjectionKind = "communityReport" | "communityGroup" | "incident" | "task" | "sketchDrawing";
export interface ProjectionReference { kind: ProjectionKind; id: string }
export interface ProjectionFenceSnapshot { resources: ProjectionReference[]; ownerHashes: string[]; subjectHashes: string[]; version: string }
export interface ResourceProjectionStore {
  projectionErasureReady(): Promise<boolean>;
  preflightActorProjections(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment>;
  eraseResourceProjections(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean>;
  loadProjectionFences?(): Promise<ProjectionFenceSnapshot>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const kinds = new Set<ProjectionKind>(["communityReport", "communityGroup", "incident", "task", "sketchDrawing"]);
export function projectionReferences(resources: ProjectionResources): ProjectionReference[] {
  const result: ProjectionReference[] = [];
  for (const [kind, ids] of [["communityReport", resources.reportIds], ["communityGroup", resources.groupIds], ["incident", resources.incidentIds ?? []],
    ["task", resources.taskIds ?? []], ["sketchDrawing", resources.drawingIds ?? []]] as Array<[ProjectionKind, string[]]>) {
    for (const id of ids) {
      if (!uuid.test(id)) throw new Error("Unproven projection resource ID");
      result.push({ kind, id: id.toLowerCase() });
    }
  }
  return [...new Map(result.map(ref => [`${ref.kind}:${ref.id}`, ref])).values()];
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function canonicalProjectionReference(objectId: string, sourceSystemId: string): ProjectionReference | undefined {
  // Actual COP map producer: sourceId community_reports; layer user.community.reports;
  // feature id <UUID>, featureId community:<UUID>.
  if (!["community_reports", "user.community.reports"].includes(sourceSystemId)) return undefined;
  const id = objectId.startsWith("community:") ? objectId.slice(10) : objectId;
  return uuid.test(id) ? { kind: "communityReport", id: id.toLowerCase() } : undefined;
}
export function projectionPayloadMatch(value: unknown, refs: readonly ProjectionReference[], actor?: RuntimeOwner): "owned" | "unknown" | "none" {
  const v = record(value), data = record(v.data);
  const kind = v.entityType ?? data.entityType, id = v.entityId ?? data.entityId;
  const producer = v.producerNodeId ?? data.producerNodeId;
  const localProducer = producer === "node_central_cop" && (v.source === undefined || v.source === "urn:csm:node:node_central_cop");
  if (localProducer && typeof kind === "string" && typeof id === "string" && kinds.has(kind as ProjectionKind) && refs.some(ref => ref.kind === kind && ref.id === id.toLowerCase())) return "owned";
  const properties = record(v.properties);
  if (properties.sourceId === "community_reports" && typeof properties.reportId === "string" &&
      v.id === properties.reportId && properties.featureId === `community:${properties.reportId}` &&
      refs.some(ref => ref.kind === "communityReport" && ref.id === properties.reportId!.toString().toLowerCase())) return "owned";
  const serialized = boundedProjectionJSON(value);
  if (refs.some(ref => serialized.toLowerCase().includes(ref.id))) return "unknown";
  if (actor && (containsActorReference(value, actor.subjectId) || serialized.includes(JSON.stringify(actor.subjectId)) || (actor.subjectId.length >= 16 && serialized.includes(actor.subjectId)))) {
    // JSON from an edge/dead letter can forge issuer fields. Actor ownership must
    // come from the store's separately persisted, server-verified owner columns.
    return "unknown";
  }
  return "none";
}
function containsActorReference(value: unknown, subjectId: string, depth = 0): boolean {
  if (depth > 30) throw new Error("Projection structure exceeds verified bound");
  if (typeof value === "string") return value === subjectId;
  if (Array.isArray(value)) return value.some(item => containsActorReference(item, subjectId, depth + 1));
  const object = record(value);
  return Object.values(object).some(item => containsActorReference(item, subjectId, depth + 1));
}
export function boundedProjectionJSON(value: unknown): string {
  const serialized = JSON.stringify(value) ?? "null";
  if (Buffer.byteLength(serialized) > 1_048_576) throw new Error("Projection payload exceeds verified bound");
  return serialized;
}
export function projectionSearchPatterns(refs: readonly ProjectionReference[], actor?: RuntimeOwner): string[] {
  return [...new Set([...refs.map(ref => ref.id), ...(actor ? [actor.subjectId] : [])])].map(value => `%${value.toLowerCase().replace(/[\\%_]/gu, match => "\\" + match)}%`);
}
export const resourceProjectionFenceTableSql = `CREATE TABLE IF NOT EXISTS cop_content_projection_fences (
  kind text NOT NULL, resource_id text NOT NULL, operation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind,resource_id));`;
export async function loadProjectionFences(client: Pick<PoolClient, "query">): Promise<ProjectionFenceSnapshot> {
  const result = await client.query<{ kind: string; resource_id: string }>("SELECT kind,resource_id FROM cop_content_projection_fences ORDER BY kind,resource_id LIMIT 100001");
  if (result.rows.length > 100000) throw new Error("Projection fence frontier exceeds verified bound");
  const resources: ProjectionReference[] = [], ownerHashes: string[] = [], subjectHashes: string[] = [];
  for (const row of result.rows) {
    if (row.kind === "actor" || row.kind === "actorSubject") {
      if (!/^[a-f0-9]{64}$/u.test(row.resource_id)) throw new Error("Unknown projection actor fence");
      (row.kind === "actor" ? ownerHashes : subjectHashes).push(row.resource_id);
    } else if (kinds.has(row.kind as ProjectionKind) && uuid.test(row.resource_id)) resources.push({ kind: row.kind as ProjectionKind, id: row.resource_id.toLowerCase() });
    else throw new Error("Unknown projection resource fence");
  }
  return { resources, ownerHashes, subjectHashes, version: runtimeAssessment(result.rows).version };
}
export async function projectionTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>, exclusive = false): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(exclusive ? "SELECT pg_advisory_xact_lock(hashtextextended($1,0))" : "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))", ["cop-content-projection-admission-v1"]);
    const result = await run(client); await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function fenceProjectionResources(client: PoolClient, resources: ProjectionResources, context: ProjectionEraseContext): Promise<void> {
  context.signal.throwIfAborted();
  for (const ref of projectionReferences(resources)) await client.query("INSERT INTO cop_content_projection_fences(kind,resource_id,operation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [ref.kind, ref.id, context.operationId]);
  if (context.actor) {
    requireRuntimeOwner(context.actor);
    await client.query("INSERT INTO cop_content_projection_fences(kind,resource_id,operation_id) VALUES('actor',$1,$2) ON CONFLICT DO NOTHING", [runtimeOwnerHash(context.actor), context.operationId]);
    await client.query("INSERT INTO cop_content_projection_fences(kind,resource_id,operation_id) VALUES('actorSubject',$1,$2) ON CONFLICT DO NOTHING", [runtimeSubjectHash(context.actor.subjectId), context.operationId]);
  }
}
export async function assertProjectionPayloadAllowed(client: PoolClient, value: unknown, owner?: RuntimeOwner): Promise<void> {
  if (owner) requireRuntimeOwner(owner);
  const serialized = boundedProjectionJSON(value);
  const ids = [...new Set((serialized.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/giu) ?? []).map(id => id.toLowerCase()))];
  const scalarStrings = serialized.match(/"(?:[^"\\]|\\.)*"/gu)?.map(item => JSON.parse(item) as string) ?? [];
  if (scalarStrings.length > 30_000) throw new Error("Projection references exceed verified bound");
  const hashes = [...new Set([...scalarStrings, ...ids])].map(runtimeSubjectHash);
  const rows = await client.query("SELECT 1 FROM cop_content_projection_fences WHERE resource_id=ANY($1::text[]) LIMIT 1", [[...ids, ...hashes, ...(owner ? [runtimeOwnerHash(owner)] : [])]]);
  if (rows.rowCount) throw new Error("CONTENT_PROJECTION_FENCED");
}

export interface ProjectionStateOwner {
  ready(): Promise<boolean>;
  preflight(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment>;
  /** Actual state, caches, queued writes, audit, history, layers and replay cleanup/readback. */
  erase(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean>;
}
export interface ProjectionRemoteOwner { ready(): Promise<boolean>; erase(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean> }
export function createCommunityProjectionEraser(options: {
  stores: readonly ResourceProjectionStore[];
  state: ProjectionStateOwner;
  /** Must reflect actual configured external stream/edge subscribers. */
  remoteRequired: boolean;
  remote?: ProjectionRemoteOwner;
  /** Compare actual producer/controller guard pointer, not an environment label. */
  producerFenceInstalled(): boolean;
}) {
  return {
    async ready(): Promise<boolean> {
      try {
        if (!options.producerFenceInstalled() || !await options.state.ready() || (options.remoteRequired && (!options.remote || !await options.remote.ready()))) return false;
        for (const store of options.stores) if (!await store.projectionErasureReady()) return false;
        return true;
      } catch { return false; }
    },
    async preflight(actor: RuntimeOwner, signal: AbortSignal): Promise<RuntimeOwnerAssessment> {
      requireRuntimeOwner(actor); signal.throwIfAborted();
      const results = [await options.state.preflight(actor)];
      for (const store of options.stores) { signal.throwIfAborted(); results.push(await store.preflightActorProjections(actor)); }
      signal.throwIfAborted();
      return { ...runtimeAssessment(results.map(result => result.version)), ready: results.every(result => result.ready) };
    },
    async erase(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean> {
      projectionReferences(resources);
      if (!context.actor || !options.producerFenceInstalled()) return false;
      requireRuntimeOwner(context.actor); context.signal.throwIfAborted();
      let complete = await options.state.erase(resources, context);
      for (const store of options.stores) { context.signal.throwIfAborted(); if (!await store.eraseResourceProjections(resources, context)) complete = false; }
      if (options.remoteRequired && (!options.remote || !await options.remote.erase(resources, context))) complete = false;
      context.signal.throwIfAborted();
      return complete;
    }
  };
}
