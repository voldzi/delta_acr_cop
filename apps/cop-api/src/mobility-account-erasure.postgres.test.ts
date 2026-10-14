import { createHmac, randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureError, AccountErasureService } from "./account-erasure.js";
import { MobilityAccountErasureAdapter, type MobilityProviderEffects } from "./mobility-account-erasure.js";
import { SharedMobilityService } from "./mobility-invitations.js";
import { MobilityFailure } from "./mobility-service.js";
import { PostgresMobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test") throw new Error("Requires isolated loopback cop_erasure_test PostgreSQL.");
}
const issuer = "https://synthetic-mobility-pg.test/issuer", identitySecret = "synthetic-mobility-pg-guard-secret-minimum-32-characters";
const owner = (id: string): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId: id, displayName: `Synthetic ${id}`,
  username: id, email: `${id}@example.test`, emailVerified: true, roles: [] });
const jobKey = (actor: AuthenticatedActor) => "account-erasure:job:" + createHmac("sha256", identitySecret)
  .update("cop-account-erasure-identity-v1\0").update(JSON.stringify([actor.issuer, actor.subjectId])).digest("hex");
const context = () => ({ operationId: randomUUID(), requestedAt: new Date().toISOString(), accountKey: "synthetic-owner", signal: new AbortController().signal });
const effects: MobilityProviderEffects = { ready: async () => true, preflight: async () => ({ ready: true, version: "synthetic-provider" }),
  erase: async () => ({ status: "completed", proofId: "synthetic-provider-readback" }) };
async function fixture() {
  const admin = new Pool({ connectionString, max: 2 }), schema = "cop_mobility_erasure_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const config: PoolConfig = { connectionString, max: 3, options: `-c search_path=${schema}` };
  const first = new PostgresMobilityStore(config, {}, undefined, true), second = new PostgresMobilityStore(config, {}, undefined, true);
  await first.init(); await second.init();
  const central = new AccountErasureService({ store: first, identitySecret, issuer, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS,
    adapters: [], accepted: false, allowUnboundSyntheticStore: true });
  await central.init();
  const guard = async (transaction: Parameters<AccountErasureService["assertAllowedWithin"]>[0], actor: AuthenticatedActor) => {
    try { await central.assertAllowedWithin(transaction, actor); }
    catch (error) { if (error instanceof AccountErasureError) throw new MobilityFailure(error.status, error.code, "Synthetic central guard"); throw error; }
  };
  const service = new SharedMobilityService(first, undefined, guard), other = new SharedMobilityService(second, undefined, guard);
  const aa = owner("a"), ba = owner("b"), a = await service.account(aa), b = await service.account(ba);
  const adapter = new MobilityAccountErasureAdapter({ service, issuer, providerEffects: effects });
  return { admin, schema, config, first, second, service, other, central, aa, ba, a, b, adapter,
    async close() { service.closeDispatch(); other.closeDispatch(); await first.close(); await second.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}

describe.skipIf(!connectionString)("actual PostgreSQL Mobility erasure transactions", () => {
  it("rejects a writer admitted before the central fence from another connection without creating an owned resource", async () => {
    const f = await fixture();
    try {
      let release!: () => void, entered!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { entered = resolve; });
      const original = f.second.transact.bind(f.second);
      f.second.transact = async (keys, work) => { entered(); await held; return original(keys, work); };
      const late = f.other.createVehicle(f.a, { operationId: randomUUID(), details: { name: "Late synthetic owner" } });
      const rejected = expect(late).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
      await seen;
      await f.first.transact([], tx => tx.set(jobKey(f.aa), { operationId: randomUUID() }));
      release(); await rejected; f.second.transact = original;
      expect((await f.admin.query(`SELECT count(*)::int AS n FROM ${f.schema}.cop_mobility_v1 WHERE key LIKE 'vehicle:%'`)).rows[0].n).toBe(0);
      expect(await f.first.transact([], tx => tx.scan("mobility-erasure:"))).toHaveLength(0);
      expect((await f.other.account(f.ba)).accountId).toBe(f.b.accountId);
    } finally { await f.close(); }
  });
  it("holds local impact validation and the global fence under the same advisory transaction lock", async () => {
    const f = await fixture();
    try {
      const assessed = await f.adapter.preflight(f.aa, { signal: context().signal });
      expect(assessed.ready).toBe(true);
      let enter!: () => void, release!: () => void;
      const seen = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
      const commit = f.first.transact([], async transaction => {
        const final = await f.adapter.preflightWithin(f.aa, { transaction, signal: context().signal });
        expect(final).toMatchObject({ ready: true, version: (assessed as { transactionVersion: string }).transactionVersion });
        enter(); await held;
        await transaction.set(jobKey(f.aa), { operationId: randomUUID() });
      });
      await seen;
      const late = f.other.createGroup(f.a, { operationId: randomUUID(), name: "Late group" });
      const rejected = expect(late).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
      release(); await commit; await rejected;
      expect(await f.first.transact([], tx => tx.scan("group:"))).toHaveLength(0);
    } finally { await f.close(); }
  });
  it("detects a new owned group before commitment and writes no global or local fence", async () => {
    const f = await fixture();
    try {
      expect(await f.adapter.preflight(f.aa, { signal: context().signal })).toMatchObject({ ready: true });
      await f.other.createGroup(f.a, { operationId: randomUUID(), name: "Requires explicit owner resolution" });
      expect(await f.first.transact([], transaction => f.adapter.preflightWithin(f.aa, { transaction, signal: context().signal })))
        .toEqual({ ready: false, reason: "ownership_unresolved" });
      expect(await f.first.transact([], tx => tx.get(jobKey(f.aa)))).toBeUndefined();
      expect(await f.first.transact([], tx => tx.scan("mobility-erasure:"))).toHaveLength(0);
    } finally { await f.close(); }
  });
  it("physically deletes known rows, preserves B, and keeps fences plus cleanup proof after another process starts", async () => {
    const f = await fixture();
    let reopened: PostgresMobilityStore | undefined;
    try {
      const bBefore = await f.first.transact([], tx => tx.get(`account:${f.b.accountId}`)), deletion = context();
      await f.first.transact([], tx => tx.set(jobKey(f.aa), { operationId: deletion.operationId }));
      expect(await f.adapter.erase(f.aa, deletion)).toMatchObject({ status: "completed" });
      expect((await f.admin.query(`SELECT count(*)::int AS n FROM ${f.schema}.cop_mobility_v1 WHERE key=$1 OR key=$2`,
        [`account:${f.a.accountId}`, `account-provenance:${f.a.accountId}`])).rows[0].n).toBe(0);
      expect(await f.first.transact([], tx => tx.get(`account:${f.b.accountId}`))).toEqual(bBefore);
      reopened = new PostgresMobilityStore(f.config, {}, undefined, true); await reopened.init();
      const restarted = new SharedMobilityService(reopened);
      await expect(restarted.account(f.aa)).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
      expect(await new MobilityAccountErasureAdapter({ service: restarted, issuer, providerEffects: effects }).erase(f.aa, deletion)).toMatchObject({ status: "completed" });
      expect((await restarted.account(f.ba)).accountId).toBe(f.b.accountId);
    } finally { await reopened?.close(); await f.close(); }
  });
});
