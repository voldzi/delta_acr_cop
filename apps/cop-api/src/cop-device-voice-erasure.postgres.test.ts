import { randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresMobileDeviceStore, type MobileDeviceRegistrationInput } from "./mobile-device-store.js";
import { PostgresVoiceCallStore } from "./voice-call-store.js";

const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test") throw new Error("Requires an isolated loopback cop_erasure_test database");
}
const issuer = "https://identity.synthetic.test/realms/cop", now = "2026-10-14T00:00:00.000Z";
const owner = { issuer, subjectId: "synthetic-device-voice-owner" };
const registration = (subjectId = owner.subjectId, ownerIssuer: string | undefined = issuer): MobileDeviceRegistrationInput => ({ subjectId, ownerIssuer,
  appVersion: "synthetic", capabilities: ["voice"], deviceId: "synthetic-device", deviceSessionId: "synthetic-session", platform: "ios" as const,
  pushTokenRegistered: true, registeredAt: now });
async function fixture() {
  const admin = new Pool({ connectionString, max: 2 }), schema = "cop_erasure_devices_voice_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const config: PoolConfig = { connectionString, max: 3, options: `-c search_path=${schema}` };
  return { admin, schema, config, async close() { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}

describe.skipIf(!connectionString)("real PostgreSQL device/voice account erasure", () => {
  it("serializes pairing/device/mesh writers against erase across two processes and persists fences through restart", async () => {
    const f = await fixture(), first = new PostgresMobileDeviceStore(f.config), second = new PostgresMobileDeviceStore(f.config), operationId = randomUUID();
    try {
      await first.init(); await second.init();
      const actor = { subjectId: owner.subjectId, ownerIssuer: issuer, username: "Synthetic", displayName: "Synthetic" };
      const pairing = await first.createPairingSession({ actor, now, expiresAt: "2026-10-14T00:02:00.000Z" });
      await first.claimPairingSession(pairing.code, actor, registration(), now);
      await first.upsertDevice(registration("synthetic-other"), "paired", now);
      await first.ingestMeshBundle({ subjectId: owner.subjectId, ownerIssuer: issuer, envelopeId: "synthetic-envelope", receivedAt: now });
      expect((await first.preflightActorErasure(owner)).ready).toBe(true);
      const outcomes = await Promise.allSettled([first.confirmPairingSession(pairing.code, now), first.upsertDevice(registration(), "paired", now), second.purgeActor(owner, operationId, now)]);
      expect(outcomes[2]).toMatchObject({ status: "fulfilled", value: { complete: true } });
      expect(await first.listDevices(owner.subjectId)).toEqual([]);
      expect(await first.listMeshAcks(owner.subjectId, undefined, 100)).toEqual([]);
      expect(await first.getPairingSession(pairing.code, now)).toBeNull();
      expect(await first.listDevices("synthetic-other")).toHaveLength(1);
      await expect(first.ingestMeshBundle({ subjectId: owner.subjectId, ownerIssuer: issuer, envelopeId: "late", receivedAt: now })).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
      const reopened = new PostgresMobileDeviceStore(f.config);
      try { await reopened.init(); await expect(reopened.upsertDevice(registration(), "paired", now)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" }); }
      finally { await reopened.close(); }
      const storedFences = (await f.admin.query(`SELECT * FROM ${f.schema}.cop_runtime_owner_fences`)).rows;
      expect(JSON.stringify(storedFences)).not.toContain(owner.subjectId); expect(JSON.stringify(storedFences)).not.toContain(issuer);
    } finally { await first.close(); await second.close(); await f.close(); }
  });
  it("preserves unknown historical device ownership on normal renewal and rejects foreign known ownership", async () => {
    const f = await fixture(), store = new PostgresMobileDeviceStore(f.config);
    try {
      await store.init();
      const legacy = registration("synthetic-legacy"); legacy.ownerIssuer = undefined;
      await store.upsertDevice(legacy, "paired", now);
      expect((await store.upsertDevice(registration("synthetic-legacy"), "paired", now)).ownerIssuer).toBeUndefined();
      expect((await store.preflightActorErasure({ issuer, subjectId: "synthetic-legacy" })).ready).toBe(false);
      expect((await store.purgeActor({ issuer, subjectId: "synthetic-legacy" }, randomUUID(), now)).complete).toBe(false);
      await store.upsertDevice(registration("synthetic-foreign", "https://foreign.synthetic.test"), "paired", now);
      await expect(store.upsertDevice(registration("synthetic-foreign"), "paired", now)).rejects.toMatchObject({ code: "ACCOUNT_OWNERSHIP_UNRESOLVED" });
    } finally { await store.close(); await f.close(); }
  });
  it("records grant expiry durably, prevents late grants/transitions, scrubs only actor links and keeps other calls", async () => {
    const f = await fixture(), first = new PostgresVoiceCallStore(f.config), second = new PostgresVoiceCallStore(f.config), operationId = randomUUID();
    const input = { ownerIssuer: issuer, initiatorSubjectId: owner.subjectId, participantSubjectIds: ["synthetic-other"], roomId: "!synthetic:example.test", title: "Synthetic personal title", kind: "direct" as const, now, expiresAt: "2026-10-14T00:01:30.000Z" };
    try {
      await first.init(); await second.init();
      const own = await first.create(input), other = await first.create({ ...input, initiatorSubjectId: "synthetic-other", participantSubjectIds: ["synthetic-third"] });
      await first.recordMediaGrant(owner, own.callId, "2026-10-14T00:10:00.000Z", now);
      expect((await first.preflightActorErasure(owner)).ready).toBe(true);
      const outcomes = await Promise.allSettled([first.recordMediaGrant(owner, own.callId, "2026-10-14T00:20:00.000Z", now), second.fenceActor(owner, operationId, now)]);
      expect(outcomes[1]).toMatchObject({ status: "fulfilled", value: { notBefore: "2026-10-14T01:00:30.000Z" } });
      await expect(first.recordMediaGrant(owner, own.callId, "2026-10-14T00:30:00.000Z", now)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
      await expect(first.transition(own.callId, { action: "accept", actorSubjectId: "synthetic-other", endpointId: "synthetic-endpoint", now })).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
      const stored = (await f.admin.query(`SELECT * FROM ${f.schema}.cop_voice_media_grants`)).rows;
      expect(stored).toHaveLength(1); expect(JSON.stringify(stored)).not.toContain(owner.subjectId); expect(JSON.stringify(stored)).not.toContain(issuer);
      // Local cleanup only; real provider acceptance and JWT-expiry wait belong to the adapter gate.
      expect((await second.purgeActor(owner, operationId, now)).complete).toBe(true);
      expect(await first.listForSubject(owner.subjectId)).toEqual([]);
      expect((await first.get(own.callId))?.participantSubjectIds).toEqual(["synthetic-other"]);
      expect((await first.get(own.callId))?.initiatorSubjectId).toBe("erased-account");
      expect(await first.get(other.callId)).toEqual(other);
      const reopened = new PostgresVoiceCallStore(f.config);
      try { await reopened.init(); await expect(reopened.create(input)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" }); }
      finally { await reopened.close(); }
    } finally { await first.close(); await second.close(); await f.close(); }
  });
});
