import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
import type { CanonicalEventEnvelope, ObservedObject } from "@cop/canonical-model";
import { PostgresFederationRuntimeStore } from "./federation-runtime-store.js";
import { PostgresTrackHistoryStore } from "./track-history-store.js";
import { PostgresSafetyNotificationStore } from "./safety-notification-store.js";
import type { DomainEventPublishInput } from "./federation.js";
import type { TrackHistoryPoint } from "./types.js";
import type { ProjectionResources } from "./resource-projection-erasure.js";
import { installCopStateProjectionOwner } from "./cop-state-erasure.js";
import { createInitialState } from "./state.js";

const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test") throw new Error("Requires isolated loopback cop_erasure_test database");
}
const actor = { issuer: "https://identity.synthetic.test/realms/cop", subjectId: "synthetic-projection-actor" };
const other = { ...actor, subjectId: "synthetic-projection-other" };
const now = new Date("2026-10-14T00:00:00Z");
const context = () => ({ operationId: randomUUID(), actor, signal: new AbortController().signal });
const key = (value: string) => `cop.safety:${createHash("sha256").update(value).digest("hex")}`;
const expiry = new Date(now.getTime() + 60_000);
function track(id: string, source = "community_reports"): { object: ObservedObject; event: CanonicalEventEnvelope; point: TrackHistoryPoint } {
  const object: ObservedObject = { objectId: id, objectType: "REPORT", affiliation: "NEUTRAL", domain: "LAND", status: "ACTIVE", position: { lat: 50, lon: 14 }, synthetic: true };
  const event: CanonicalEventEnvelope = { eventId: randomUUID(), eventType: "track.created", contractVersion: "cop-ingest-v1", source: { sourceSystemId: source, adapterId: "synthetic", adapterVersion: "1" },
    correlationId: "synthetic", producerTimestamp: now.toISOString(), classification: { level: "UNCLASSIFIED", releasability: [], handlingCaveats: [] }, geo: object.position!, payload: object,
    quality: { confidence: 1, sourceReliability: "A", informationCredibility: "1" } };
  const point: TrackHistoryPoint = { objectId: id, eventId: event.eventId, objectType: object.objectType, affiliation: object.affiliation, status: object.status,
    lat: 50, lon: 14, sourceSystemId: source, producerTimestamp: now.toISOString(), timestamp: now.toISOString(), synthetic: true };
  return { object, event, point };
}
function domain(id: string, producerNodeId = "node_central_cop"): DomainEventPublishInput {
  return { entityType: "communityReport", entityId: id, producerNodeId, correlationId: "synthetic", type: "report.created", payload: { reportId: id } };
}
async function fixture() {
  const admin = new Pool({ connectionString, max: 2 }), schema = "cop_projection_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const config: PoolConfig = { connectionString, max: 3, options: `-c search_path=${schema}`, application_name: schema };
  const sql = new Pool(config);
  return { admin, sql, schema, config, async close() { await sql.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}
async function waitForLocks(f: Awaited<ReturnType<typeof fixture>>, count: number) {
  const deadline = Date.now() + 3000;
  do {
    const rows = await f.admin.query<{ count: string }>("SELECT count(*)::text FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'", [f.schema]);
    if (Number(rows.rows[0]?.count) >= count) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  throw new Error("Expected actual projection lock contention was not observed");
}

describe.skipIf(!connectionString)("real PostgreSQL projection erasure", () => {
  it("cleans current/history/replay/dead letters/recipient ledger and preserves other actors and cursor offsets", async () => {
    const f = await fixture(), history = new PostgresTrackHistoryStore(f.config), federation = new PostgresFederationRuntimeStore(f.config), safety = new PostgresSafetyNotificationStore(f.config);
    const ownedId = randomUUID(), otherId = randomUUID(), resources: ProjectionResources = { reportIds: [ownedId], groupIds: [] };
    try {
      await history.init(); await federation.init([]); await safety.init();
      for (const [id, owner] of [[ownedId, actor], [otherId, other]] as const) {
        const value = track(id); await history.upsertCurrent(value.object, value.event, owner); await history.append(value.point, owner);
        await federation.publishEvent({ ...domain(id), subject: owner.subjectId }, now, owner);
        await federation.appendDeadLetter({ body: domain(id), owner, correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic" });
        await safety.setWebDeviceEligibility(owner.subjectId, "synthetic-device", true, owner);
        const claim = await safety.claim(key(id), expiry, now, 1000, { key: `cop.safety.cooldown:${createHash("sha256").update(id).digest("hex")}`, durationMs: 60_000 }, owner);
        await safety.markAccepted(claim!, "synthetic-notification", now);
      }
      await federation.updateEdgeCursor({ nodeId: "synthetic-edge", lastAckedOffset: 50, updatedBy: actor.subjectId, owner: actor });
      expect((await history.preflightActorProjections(actor)).ready).toBe(true);
      expect((await federation.preflightActorProjections(actor)).ready).toBe(true);
      expect((await safety.preflightActorProjections(actor)).ready).toBe(true);
      const erase = context();
      expect(await history.eraseResourceProjections(resources, erase)).toBe(true);
      expect(await federation.eraseResourceProjections(resources, erase)).toBe(true);
      expect(await safety.eraseResourceProjections(resources, erase)).toBe(true);
      expect(await history.count()).toBe(1); expect((await history.loadCurrent()).map(row => row.objectId)).toEqual([otherId]);
      expect(await federation.countEvents()).toBe(1); expect(await federation.countDeadLetters()).toBe(1);
      expect(await federation.getEdgeCursor("synthetic-edge")).toMatchObject({ lastAckedOffset: 50 });
      expect((await federation.getEdgeCursor("synthetic-edge"))?.updatedBy).toBeUndefined();
      expect(await safety.hasEligibleWebDevice(actor.subjectId)).toBe(false); expect(await safety.hasEligibleWebDevice(other.subjectId)).toBe(true);
      expect((await f.sql.query("SELECT 1 FROM cop_safety_notification_deliveries")).rowCount).toBe(1);
      expect((await f.sql.query("SELECT 1 FROM cop_safety_notification_cooldowns")).rowCount).toBe(1);
      const reopened = new PostgresTrackHistoryStore(f.config);
      try { await reopened.init(); await expect(reopened.append(track(ownedId).point, actor)).rejects.toThrow("CONTENT_PROJECTION_FENCED"); }
      finally { await reopened.close(); }
      await expect(federation.publishEvent(domain(ownedId), now)).rejects.toThrow("CONTENT_PROJECTION_FENCED");
      await expect(safety.claim(key("late"), expiry, now, 1000, undefined, actor)).rejects.toThrow("CONTENT_PROJECTION_FENCED");
      await expect(safety.claim(key("unproved"), expiry, now, 1000)).rejects.toThrow("Unproven");
      const fences = (await f.sql.query("SELECT * FROM cop_content_projection_fences")).rows;
      expect(JSON.stringify(fences)).not.toContain(actor.subjectId); expect(JSON.stringify(fences)).not.toContain(actor.issuer);
      const restoredState = createInitialState();
      const restored = installCopStateProjectionOwner(restoredState, { issuer: actor.issuer, cachedGuard: { ready: () => true, assertActorAllowed() {} },
        loadFences: () => history.loadProjectionFences(), retainedCopies: { ready: async () => true, preflight: async () => ({ ready: true, version: "synthetic-empty" }), erase: async () => true } });
      await restored.init();
      expect(() => restoredState.objects.set(ownedId, track(ownedId).object)).toThrow("CONTENT_PROJECTION_FENCED");
    } finally { await history.close(); await federation.close(); await safety.close(); await f.close(); }
  });

  it("preserves foreign producer namespaces, conflicting issuers and ambiguous dead letters as pending", async () => {
    const f = await fixture(), federation = new PostgresFederationRuntimeStore(f.config), history = new PostgresTrackHistoryStore(f.config), id = randomUUID();
    const resources = { reportIds: [id], groupIds: [] };
    try {
      await federation.init([]); await history.init();
      await federation.publishEvent(domain(id, "foreign_edge"), now);
      await federation.appendDeadLetter({ body: { note: id, subjectId: actor.subjectId, ownerIssuer: actor.issuer }, correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic" });
      await federation.appendDeadLetter({ body: domain(id), correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic" });
      await federation.publishEvent(domain(id), now, { ...actor, issuer: "https://foreign.synthetic.test" });
      const value = track(id); await history.upsertCurrent(value.object, value.event, { ...actor, issuer: "https://foreign.synthetic.test" });
      expect((await federation.preflightActorProjections(actor)).ready).toBe(false);
      expect(await federation.eraseResourceProjections(resources, context())).toBe(false);
      expect(await history.eraseResourceProjections(resources, context())).toBe(false);
      expect(await federation.countEvents()).toBe(2); expect(await federation.countDeadLetters()).toBe(2); expect(await history.countCurrent()).toBe(1);
    } finally { await federation.close(); await history.close(); await f.close(); }
  });

  it("keeps legacy unknown ownership unknown on renewal and blocks orphaned opaque cooldowns", async () => {
    const f = await fixture(), safety = new PostgresSafetyNotificationStore(f.config), history = new PostgresTrackHistoryStore(f.config), id = randomUUID();
    try {
      await safety.init(); await history.init();
      await safety.setWebDeviceEligibility(actor.subjectId, "legacy-device", true);
      await safety.setWebDeviceEligibility(actor.subjectId, "legacy-device", false, actor);
      await safety.claim(key("legacy"), expiry, now, 1000);
      await safety.claim(key("legacy"), expiry, new Date(now.getTime() + 2000), 1000, undefined, actor);
      expect((await f.sql.query("SELECT owner_issuer FROM cop_safety_notification_web_devices")).rows[0].owner_issuer).toBeNull();
      expect((await f.sql.query("SELECT owner_subject_hash FROM cop_safety_notification_deliveries")).rows[0].owner_subject_hash).toBeNull();
      const value = track(id); value.object.attributes = { subjectId: actor.subjectId };
      await history.upsertCurrent(value.object, value.event); await history.upsertCurrent(value.object, value.event, actor);
      expect((await history.preflightActorProjections(actor)).ready).toBe(false);
      expect((await safety.preflightActorProjections(actor)).ready).toBe(false);
      expect(await safety.eraseResourceProjections({ reportIds: [], groupIds: [] }, context())).toBe(false);
      await f.sql.query("DELETE FROM cop_safety_notification_deliveries; DELETE FROM cop_safety_notification_web_devices");
      await f.sql.query("INSERT INTO cop_safety_notification_cooldowns VALUES($1,$2)", [`cop.safety.cooldown:${"a".repeat(64)}`, now.toISOString()]);
      expect((await safety.preflightActorProjections(actor)).ready).toBe(false);
      expect(await safety.eraseResourceProjections({ reportIds: [], groupIds: [] }, context())).toBe(false);
      expect((await f.sql.query("SELECT 1 FROM cop_safety_notification_cooldowns")).rowCount).toBe(1);
    } finally { await safety.close(); await history.close(); await f.close(); }
  });

  it("serializes erasure against a queued producer in another instance and prevents late resurrection", async () => {
    const f = await fixture(), first = new PostgresTrackHistoryStore(f.config), second = new PostgresTrackHistoryStore(f.config), id = randomUUID();
    const held = await f.sql.connect();
    try {
      await first.init(); await second.init(); const value = track(id); await first.append(value.point, actor);
      await held.query("BEGIN"); await held.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))", ["cop-content-projection-admission-v1"]);
      const erased = first.eraseResourceProjections({ reportIds: [id], groupIds: [] }, context());
      await waitForLocks(f, 1);
      const late = second.append({ ...value.point, eventId: randomUUID() }, actor).then(() => ({ succeeded: true }), error => ({ succeeded: false, message: (error as Error).message }));
      await waitForLocks(f, 2); await held.query("COMMIT");
      expect(await erased).toBe(true); expect(await late).toEqual({ succeeded: false, message: "CONTENT_PROJECTION_FENCED" });
      expect(await second.count()).toBe(0);
    } finally { await held.query("ROLLBACK"); held.release(); await first.close(); await second.close(); await f.close(); }
  });

  it("clears only the verified resolver association from another author's dead letter", async () => {
    const f = await fixture(), federation = new PostgresFederationRuntimeStore(f.config);
    try {
      await federation.init([]);
      const record = await federation.appendDeadLetter({ body: { note: "other author's synthetic data" }, owner: other, correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic" });
      await federation.resolveDeadLetter(record.deadLetterId, { resolvedBy: actor.subjectId, owner: actor });
      expect((await federation.preflightActorProjections(actor)).ready).toBe(true);
      expect(await federation.eraseResourceProjections({ reportIds: [], groupIds: [] }, context())).toBe(true);
      const retained = await federation.getDeadLetter(record.deadLetterId);
      expect(retained?.body).toEqual(record.body); expect(retained?.status).toBe("resolved"); expect(retained?.resolvedBy).toBeUndefined();
      expect(JSON.stringify(retained)).not.toContain("resolved_by_issuer");
      await expect(federation.resolveDeadLetter(record.deadLetterId, { resolvedBy: actor.subjectId, owner: actor })).rejects.toThrow("CONTENT_PROJECTION_FENCED");
    } finally { await federation.close(); await f.close(); }
  });

  it("detects legacy actor aliases in history, messages and resolver metadata and preserves unresolved ownership", async () => {
    const f = await fixture(), federation = new PostgresFederationRuntimeStore(f.config), history = new PostgresTrackHistoryStore(f.config);
    try {
      await federation.init([]); await history.init();
      await history.append(track(actor.subjectId, "foreign_source").point);
      const record = await federation.appendDeadLetter({ body: {}, correlationId: "synthetic", errorCode: "SYNTHETIC", message: `legacy ${actor.subjectId}` });
      await federation.resolveDeadLetter(record.deadLetterId, { resolvedBy: actor.subjectId });
      expect((await federation.preflightActorProjections(actor)).ready).toBe(false);
      expect((await history.preflightActorProjections(actor)).ready).toBe(false);
      expect(await federation.eraseResourceProjections({ reportIds: [], groupIds: [] }, context())).toBe(false);
      expect(await history.eraseResourceProjections({ reportIds: [], groupIds: [] }, context())).toBe(false);
      expect((await federation.getDeadLetter(record.deadLetterId))?.resolvedBy).toBe(actor.subjectId);
      expect(await history.count()).toBe(1);
    } finally { await federation.close(); await history.close(); await f.close(); }
  });

  it("requires the original immutable origin for a duplicate after reopening and never adopts legacy or foreign rows", async () => {
    const f = await fixture(), first = new PostgresFederationRuntimeStore(f.config), reopened = new PostgresFederationRuntimeStore(f.config);
    let firstClosed = false;
    const values = [actor, other, undefined, { ...actor, issuer: "https://foreign-origin.synthetic.test" }].map((owner) => ({ input: { ...domain(randomUUID()), eventId: randomUUID() }, owner }));
    try {
      await first.init([]);
      for (const { input, owner } of values) await first.publishEvent(input, now, owner);
      const original = (await f.sql.query("SELECT event_id,event_json,owner_issuer,owner_subject_hash FROM cop_domain_events ORDER BY replay_offset")).rows;
      await first.close(); firstClosed = true;
      await reopened.init([]);
      const retry = await reopened.publishEvent(values[0]!.input, now, actor);
      expect(retry.duplicate).toBe(true); expect(retry.event.id).toBe(values[0]!.input.eventId);
      expect(retry.event.subject).toBe(values[0]!.input.entityId);
      for (const { input } of values.slice(1)) {
        await expect(reopened.publishEvent(input, now, actor)).rejects.toMatchObject({ status: 503, code: "CONTENT_PROJECTION_UNAVAILABLE" });
      }
      expect((await f.sql.query("SELECT event_id,event_json,owner_issuer,owner_subject_hash FROM cop_domain_events ORDER BY replay_offset")).rows).toEqual(original);
      expect(await reopened.countEvents()).toBe(4);
    } finally { if (!firstClosed) await first.close(); await reopened.close(); await f.close(); }
  });
});
