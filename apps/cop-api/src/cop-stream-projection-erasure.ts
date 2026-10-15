import type { Pool, PoolClient } from "pg";
import type { CopStreamMessage } from "./cop-stream.js";
import { contentOwnerKey } from "./content-erasure.js";
import { readObjectProvenance } from "./provenance.js";
import { runtimeAssessment, requireRuntimeOwner, type RuntimeOwner } from "./runtime-owner-erasure.js";
import { boundedProjectionJSON, canonicalProjectionReference, fenceProjectionResources, loadProjectionFences,
  projectionReferences, projectionSearchPatterns, projectionTransaction, type ProjectionEraseContext,
  type ProjectionResources, type ResourceProjectionStore } from "./resource-projection-erasure.js";

/** Each index is bound at publication to the actual source ownership row. JSON
 * fields and a text match alone never authorize modifying a retained envelope. */
export const streamProjectionOwnershipSql = `CREATE TABLE IF NOT EXISTS cop_stream_bus_projection_ownership (
  event_id uuid NOT NULL REFERENCES cop_stream_bus_events(event_id) ON DELETE CASCADE,
  change_index integer NOT NULL CHECK(change_index>=0), owner_key text NOT NULL,
  kind text NOT NULL CHECK(kind='communityReport'), resource_id text NOT NULL,
  PRIMARY KEY(event_id,change_index));`;

type Envelope = { message: CopStreamMessage; originId: string };
type Ownership = { change_index: number; owner_key: string; kind: string; resource_id: string };
type Row = { event_id: string; payload: Envelope };
const maxRows = 10_000;

export async function recordStreamProjectionOwners(client: PoolClient, eventId: string, message: CopStreamMessage): Promise<void> {
  if (message.type !== "delta" && message.type !== "snapshot") return;
  if (message.changes.length > maxRows) throw new Error("STREAM_PROJECTION_BOUND_EXCEEDED");
  for (const [index, change] of message.changes.entries()) {
    const ref = canonicalProjectionReference(change.object.objectId, readObjectProvenance(change.object)?.sourceSystemId ?? "");
    if (!ref) continue;
    // Read from the real authenticated source ledger, never from a supplied
    // subject/issuer embedded in the stream object. Historical unknowns cannot
    // be adopted here or during erasure.
    const source = await client.query<{ subject_id: string; issuer: string }>(
      "SELECT subject_id,issuer FROM cop_community_erasure_ownership WHERE kind='report' AND row_key=$1", [ref.id]);
    if (source.rows.length !== 1) throw new Error("STREAM_PROJECTION_OWNER_UNPROVEN");
    const owner = { subjectId: source.rows[0]!.subject_id, issuer: source.rows[0]!.issuer };
    requireRuntimeOwner(owner);
    await client.query(`INSERT INTO cop_stream_bus_projection_ownership(event_id,change_index,owner_key,kind,resource_id)
      VALUES($1,$2,$3,$4,$5)`, [eventId, index, contentOwnerKey(owner), ref.kind, ref.id]);
  }
}

function validateEnvelope(value: unknown): Envelope {
  boundedProjectionJSON(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("STREAM_PROJECTION_UNPROVEN");
  const envelope = value as Envelope;
  if (typeof envelope.originId !== "string" || !envelope.message || typeof envelope.message !== "object") throw new Error("STREAM_PROJECTION_UNPROVEN");
  const message = envelope.message;
  if (!["delta", "snapshot", "heartbeat", "backpressure", "reconnect_required"].includes(message.type)) throw new Error("STREAM_PROJECTION_UNPROVEN");
  if ((message.type === "delta" || message.type === "snapshot") && (!Array.isArray(message.changes) || message.changes.length > maxRows)) throw new Error("STREAM_PROJECTION_UNPROVEN");
  return envelope;
}

/** A conservative transform: preserve every unowned change, original order and
 * envelope metadata. Any unexplained occurrence remains pending. In particular
 * old rows without the separately persisted publication binding are untouched. */
export function eraseProvenStreamChanges(row: unknown, ownership: readonly Ownership[], refs: ReturnType<typeof projectionReferences>, owner: RuntimeOwner):
  { complete: boolean; envelope: Envelope; removed: number; indexes: number[] } {
  const envelope = validateEnvelope(row), wanted = new Set(refs.map(ref => `${ref.kind}:${ref.id}`)), key = contentOwnerKey(owner);
  const message = envelope.message, indexes: number[] = [];
  if (message.type !== "delta" && message.type !== "snapshot") return { complete: !contains(row, refs, owner), envelope, removed: 0, indexes };
  const changes = message.changes.filter((change, index) => {
    const proof = ownership.filter(item => item.change_index === index);
    if (proof.length !== 1 || proof[0]!.owner_key !== key) return true;
    const binding = proof[0]!, ref = canonicalProjectionReference(change.object.objectId, readObjectProvenance(change.object)?.sourceSystemId ?? "");
    if (!ref || ref.kind !== binding.kind || ref.id !== binding.resource_id || !wanted.has(`${ref.kind}:${ref.id}`)) return true;
    indexes.push(index); return false;
  });
  const next: Envelope = { ...envelope, message: { ...message, changes } };
  return { complete: !contains(next, refs, owner), envelope: next, removed: indexes.length, indexes };
}
function contains(value: unknown, refs: ReturnType<typeof projectionReferences>, owner: RuntimeOwner): boolean {
  const json = boundedProjectionJSON(value), lower = json.toLowerCase();
  return refs.some(ref => lower.includes(ref.id)) || json.includes(JSON.stringify(owner.subjectId));
}

export class PostgresStreamProjectionErasure implements ResourceProjectionStore {
  constructor(private readonly pool: Pool, private readonly admitted: () => boolean) {}
  async projectionErasureReady(): Promise<boolean> {
    if (!this.admitted()) return false;
    try {
      await this.pool.query("SELECT event_id,change_index,owner_key,kind,resource_id FROM cop_stream_bus_projection_ownership LIMIT 0");
      await this.pool.query("SELECT owner_key,operation_id,kind,row_key FROM cop_content_erasure_projection_manifest LIMIT 0");
      await this.pool.query("SELECT owner_key,operation_id FROM cop_content_erasure_fences LIMIT 0");
      return true;
    } catch { return false; }
  }
  loadProjectionFences() { return projectionTransaction(this.pool, loadProjectionFences); }
  async preflightActorProjections(owner: RuntimeOwner) {
    requireRuntimeOwner(owner);
    if (!await this.projectionErasureReady()) return { ...runtimeAssessment([]), ready: false };
    return projectionTransaction(this.pool, async client => {
      const refs = await client.query<{ row_key: string }>("SELECT row_key FROM cop_community_erasure_ownership WHERE kind='report' AND subject_id=$1 AND issuer=$2 ORDER BY row_key LIMIT 10001", [owner.subjectId, owner.issuer]);
      if (refs.rows.length > maxRows) throw new Error("STREAM_PROJECTION_BOUND_EXCEEDED");
      const resources = projectionReferences({ reportIds: refs.rows.map(row => row.row_key), groupIds: [] });
      const candidates = await this.candidates(client, resources, owner);
      let ready = true;
      for (const row of candidates) {
        const bindings = await this.bindings(client, row.event_id);
        if (!eraseProvenStreamChanges(row.payload, bindings, resources, owner).complete) ready = false;
      }
      return { ...runtimeAssessment(candidates.map(row => row.event_id)), ready };
    });
  }
  async eraseResourceProjections(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean> {
    if (!context.actor || !this.admitted()) return false;
    requireRuntimeOwner(context.actor); context.signal.throwIfAborted();
    const actor = context.actor, refs = projectionReferences(resources), ownerKey = contentOwnerKey(actor);
    if (refs.length > maxRows) throw new Error("STREAM_PROJECTION_BOUND_EXCEEDED");
    return projectionTransaction(this.pool, async client => {
      // Independently verify every requested resource against the source store's
      // durable erasure manifest and its exact account/operation fence. A forged
      // caller resource list must not install fences or alter another envelope.
      const fence = await client.query("SELECT 1 FROM cop_content_erasure_fences WHERE owner_key=$1 AND operation_id=$2", [ownerKey, context.operationId]);
      if (fence.rowCount !== 1) return false;
      const manifestKinds = { communityReport: "report", communityGroup: "group", incident: "incident", task: "task", sketchDrawing: "drawing" } as const;
      for (const ref of refs) {
        const manifest = await client.query("SELECT 1 FROM cop_content_erasure_projection_manifest WHERE owner_key=$1 AND operation_id=$2 AND kind=$3 AND row_key=$4",
          [ownerKey, context.operationId, manifestKinds[ref.kind], ref.id]);
        if (manifest.rowCount !== 1) return false;
      }
      context.signal.throwIfAborted();
      await fenceProjectionResources(client, resources, context);
      let complete = true;
      for (const row of await this.candidates(client, refs, actor)) {
        context.signal.throwIfAborted();
        const bindings = await this.bindings(client, row.event_id), result = eraseProvenStreamChanges(row.payload, bindings, refs, actor);
        if (!result.complete) complete = false;
        // If any reference remains ambiguous, retain the whole original row and
        // its binding indexes. No partial mutation can silently shift provenance.
        if (!result.complete || !result.removed) continue;
        if ((result.envelope.message.type === "delta" || result.envelope.message.type === "snapshot") && result.envelope.message.changes.length === 0) {
          await client.query("DELETE FROM cop_stream_bus_events WHERE event_id=$1", [row.event_id]);
        } else {
          await client.query("UPDATE cop_stream_bus_events SET payload=$2::jsonb WHERE event_id=$1", [row.event_id, JSON.stringify(result.envelope)]);
          await client.query("DELETE FROM cop_stream_bus_projection_ownership WHERE event_id=$1", [row.event_id]);
          for (const binding of bindings) {
            if (result.indexes.includes(binding.change_index)) continue;
            const index = binding.change_index - result.indexes.filter(removed => removed < binding.change_index).length;
            await client.query("INSERT INTO cop_stream_bus_projection_ownership(event_id,change_index,owner_key,kind,resource_id) VALUES($1,$2,$3,$4,$5)",
              [row.event_id, index, binding.owner_key, binding.kind, binding.resource_id]);
          }
        }
      }
      context.signal.throwIfAborted();
      return complete && (await this.candidates(client, refs, actor)).length === 0;
    }, true);
  }
  private async bindings(client: PoolClient, id: string): Promise<Ownership[]> {
    return (await client.query<Ownership>("SELECT change_index,owner_key,kind,resource_id FROM cop_stream_bus_projection_ownership WHERE event_id=$1 ORDER BY change_index", [id])).rows;
  }
  private async candidates(client: PoolClient, refs: ReturnType<typeof projectionReferences>, owner: RuntimeOwner): Promise<Row[]> {
    const result = await client.query<Row>("SELECT event_id,payload FROM cop_stream_bus_events WHERE lower(payload::text) LIKE ANY($1::text[]) ORDER BY event_id LIMIT 10001",
      [projectionSearchPatterns(refs, owner)]);
    if (result.rows.length > maxRows) throw new Error("STREAM_PROJECTION_BOUND_EXCEEDED");
    return result.rows;
  }
}
