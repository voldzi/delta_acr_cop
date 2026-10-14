import { randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresDriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";
import { composeCOPDriverConsentErasureAdapter } from "./cop-driver-consent-erasure.js";
import type { AccountErasureAdapter } from "./account-erasure.js";

const socket = process.env.COP_DRIVER_CONSENT_ERASURE_TEST_SOCKET;
if (socket && !/^\/private\/tmp\/cop-driver-consent-pg18-20261014\.[A-Za-z0-9_]+\/socket$/u.test(socket)) throw new Error("Requires the dedicated private Unix-only consent test cluster");
const config: PoolConfig = { host: socket, port: 56567, database: "cop_driver_consent_test", user: "cop_driver_test", max: 3 };
const issuer = "https://identity.consent-pg.test/realms/cop", secret = "synthetic-driver-consent-pg-secret-32-plus";
const owner = { issuer, subjectId: "synthetic-owner-a" }, other = { issuer, subjectId: "synthetic-owner-b" };
const now = new Date("2026-10-14T12:00:00Z"), op = "a8a00553-1f02-4829-8c80-82a6c6334c2e";
async function fixture() {
  const admin = new Pool(config), schema = "consent_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const options = { ...config, options: `-c search_path=${schema}` };
  const first = new PostgresDriverMeasurementConsentStore(options), second = new PostgresDriverMeasurementConsentStore(options);
  await first.init(secret); await second.init(secret);
  return { admin, schema, options, first, second, async close() { await first.close(); await second.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}
describe.skipIf(!socket)("actual PostgreSQL consent erasure, Unix-only isolated cluster", () => {
  it("binds new consent to the verified owner without adopting unknown historical rows", async () => {
    const f = await fixture();
    try {
      await f.first.grant(owner.subjectId, now, owner); await f.first.grant(other.subjectId, now, other);
      expect(await f.second.preflightActorErasure(owner)).toMatchObject({ ready: true, present: true });
      expect(await f.second.preflightActorErasure({ ...owner, issuer: "https://foreign.test" })).toMatchObject({ ready: false });
      await f.first.grant("legacy", now); await f.second.grant("legacy", now, { issuer, subjectId: "legacy" });
      expect(await f.second.preflightActorErasure({ issuer, subjectId: "legacy" })).toMatchObject({ ready: false });
      const legacy = { issuer, subjectId: "legacy" };
      expect(await f.second.fenceActorErasure(legacy, op, "reviewed_inventory_v1", (await f.second.preflightActorErasure(legacy)).version)).toBe(false);
      expect((await f.admin.query(`SELECT owner_issuer FROM ${f.schema}.cop_driver_measurement_consents WHERE subject_id='legacy'`)).rows[0].owner_issuer).toBeNull();
      await expect(f.second.grant(owner.subjectId, now, { ...owner, issuer: "https://foreign.test" })).rejects.toThrow("OWNER_UNPROVEN");
    } finally { await f.close(); }
  });
  it("serializes admitted uploads and erase, permanently fences every later writer and survives restart", async () => {
    const f = await fixture();
    try {
      await f.first.grant(owner.subjectId, now, owner); await f.first.grant(other.subjectId, now, other);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
      const send = f.first.withActive(owner.subjectId, async () => { enter(); await held; return "admitted"; }, owner);
      await entered;
      let fenced = false;
      const erasure = f.second.fenceActorErasure(owner, op, "immutable_inventory_v1", (await f.second.preflightActorErasure(owner)).version).then(result => { fenced = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 30)); expect(fenced).toBe(false);
      release(); expect(await send).toBe("admitted"); expect(await erasure).toBe(true);
      await expect(f.first.grant(owner.subjectId, now, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
      await expect(f.first.revoke(owner.subjectId, now, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
      await expect(f.first.withActive(owner.subjectId, async () => true, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
      await expect(f.first.markDeleted(owner.subjectId, "2026-10-14")).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
      expect(await f.first.purgeActorErasure(owner, op, "completed_sim_readback_v1")).toBe(true);
      const reopened = new PostgresDriverMeasurementConsentStore(f.options);
      try {
        await reopened.init(secret); expect(await reopened.erasureCheckpoint(owner, op)).toMatchObject({ completed: true });
        expect((await reopened.get(owner.subjectId)).grantedAt).toBeNull();
        await expect(reopened.grant(owner.subjectId, now, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
        expect((await reopened.get(other.subjectId)).grantedAt).not.toBeNull();
      } finally { await reopened.close(); }
      const changed = new PostgresDriverMeasurementConsentStore(f.options);
      try { await expect(changed.init(secret + "changed")).rejects.toThrow("HMAC secret changed"); } finally { await changed.close(); }
    } finally { await f.close(); }
  });
  it("preserves pending dates until SIM completion and verifies durable absence instead of treating202 as deleted", async () => {
    const f = await fixture();
    try {
      await f.first.grant(owner.subjectId, now, owner); await f.first.revoke(owner.subjectId, now, owner);
      const consent = await f.first.get(owner.subjectId); let complete = false;
      const remote: AccountErasureAdapter & { verifiedCompletedOperationProof: AccountErasureAdapter["erase"] } = { id: "sim_measurements", ready: async () => true,
        preflight: async () => ({ ready: true, version: "actual_fixture_inventory_v1" }),
        erase: async () => complete ? { status: "completed", proofId: "fixture_sim_manifest_readback_v1" } : { status: "pending", remaining: "cleanup_pending" },
        verifiedCompletedOperationProof: async () => complete ? { status: "completed", proofId: "fixture_sim_manifest_readback_v1" } : { status: "pending", remaining: "cleanup_pending" } };
      const adapter = composeCOPDriverConsentErasureAdapter(remote, f.first, issuer);
      const actor = { ...owner, authMode: "oidc" as const, username: "", displayName: "" };
      const context = { operationId: op, requestedAt: now.toISOString(), accountKey: "synthetic-key", signal: new AbortController().signal };
      expect((await adapter.erase(actor, context)).status).toBe("pending");
      expect(await f.second.get(owner.subjectId)).toEqual(consent);
      complete = true;
      expect((await composeCOPDriverConsentErasureAdapter(remote, f.second, issuer).erase(actor, context)).status).toBe("completed");
      expect((await f.admin.query(`SELECT count(*) AS n FROM ${f.schema}.cop_driver_measurement_consents WHERE subject_id=$1`, [owner.subjectId])).rows[0].n).toBe("0");
      expect((await f.second.erasureCheckpoint(owner, op))?.pendingDays).toEqual([]);
      expect(await f.second.purgeActorErasure(owner, op, "changed_remote_proof_v2")).toBe(false);
      await expect(f.second.erasureCheckpoint(owner, "d5187f6c-d6a7-4f11-b1a9-af843ef24f80")).rejects.toThrow("CONFLICT");
    } finally { await f.close(); }
  });
  it("settles an already admitted ordinary delete, rejects its stale preflight version, then denies a stale snapshot before another handoff", async () => {
    const f = await fixture();
    try {
      await f.first.grant(owner.subjectId, now, owner); await f.first.revoke(owner.subjectId, now, owner);
      const old = await f.first.preflightActorErasure(owner), snapshot = (await f.first.pending())[0]!;
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
      let calls = 0;
      const ordinary = f.first.withPendingDeletion(owner.subjectId, snapshot.days[0]!, async () => { calls++; enter(); await held; });
      await entered;
      let finished = false;
      const fence = f.second.fenceActorErasure(owner, op, "actual_inventory_v1", old.version).then(result => { finished = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 30)); expect(finished).toBe(false);
      release(); expect(await ordinary).toBe(true); expect(await fence).toBe(false);
      expect(await f.second.erasureCheckpoint(owner, op)).toBeNull();
      const current = await f.second.preflightActorErasure(owner);
      expect(await f.second.fenceActorErasure(owner, op, "actual_inventory_v2", current.version)).toBe(true);
      expect(await f.second.pending()).toEqual([]);
      await expect(f.second.withPendingDeletion(snapshot.subjectId, snapshot.days[1]!, async () => { calls++; })).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
      expect(calls).toBe(1);
    } finally { await f.close(); }
  });
});
