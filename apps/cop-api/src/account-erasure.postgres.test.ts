import { randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureProof } from "./account-erasure.js";
import { PostgresMobilityStore } from "./mobility-store.js";
import { PostgresUserProfileStore, userAvatarRevision } from "./user-profile-store.js";
import { PostgresWebSessionStore, type WebSessionTokens } from "./web-session-store.js";

const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test") throw new Error("Requires an isolated loopback cop_erasure_test database.");
}
const issuer = "https://identity.test/realms/cop";
const secret = "synthetic-test-only-web-session-secret-32-characters";
const owner = { issuer, subjectId: "synthetic-owner" };
const other = { issuer, subjectId: "synthetic-other" };
const profile = (principal = owner) => ({ ...principal, displayName: "Synthetic", username: "Synthetic", preferences: {}, alertPreferences: {} });
const tokens = (principal: { issuer?: string; subjectId: string } = owner): WebSessionTokens => ({
  accessToken: "synthetic-test-only-access-token", refreshToken: "synthetic-test-only-refresh-token",
  accessTokenExpiresAt: new Date(Date.now() + 60_000), profile: { ...principal, name: "Synthetic", username: "Synthetic" }
});
async function fixture() {
  const admin = new Pool({ connectionString, max: 2 });
  const schema = "cop_erasure_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const config: PoolConfig = { connectionString, max: 3, options: `-c search_path=${schema}` };
  return { admin, schema, config, async close() { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}

describe.skipIf(!connectionString)("real PostgreSQL account erasure boundaries", () => {
  it("deletes exact-owner sessions, handles legacy expiry, and persists fences through restart and key-rotation refusal", async () => {
    const f = await fixture();
    const first = new PostgresWebSessionStore({ ...f.config, encryptionSecret: secret });
    const second = new PostgresWebSessionStore({ ...f.config, encryptionSecret: secret });
    const changed = new PostgresWebSessionStore({ ...f.config, encryptionSecret: secret + "-changed" });
    try {
      await first.init(); await second.init();
      const expiry = new Date(Date.now() + 60_000);
      const one = await first.create(tokens(), expiry), two = await first.create(tokens(other), expiry);
      const anotherIssuer = await first.create(tokens({ ...owner, issuer: "https://other.test" }), expiry);
      const legacy = await first.create(tokens({ subjectId: "unattributable-legacy" }), expiry);
      expect(await second.update(legacy.sessionId, tokens({ issuer, subjectId: "unattributable-legacy" }))).toBeNull();
      expect(await second.revokeActor(owner)).toEqual({ complete: false });
      expect(await first.get(one.sessionId)).toBeNull(); expect(await first.get(two.sessionId)).not.toBeNull();
      expect(await first.get(anotherIssuer.sessionId)).not.toBeNull();
      await expect(first.create(tokens(), expiry)).rejects.toThrow("WEB_SESSION_ACCOUNT_ERASURE_FENCED");
      await expect(first.update(one.sessionId, tokens())).rejects.toThrow("WEB_SESSION_ACCOUNT_ERASURE_FENCED");
      await f.admin.query(`UPDATE ${f.schema}.cop_web_sessions SET session_expires_at=now()-interval '1 second' WHERE session_id=$1`, [legacy.sessionId]);
      expect(await first.revokeActor(owner)).toEqual({ complete: true });
      expect((await f.admin.query(`SELECT count(*) AS n FROM ${f.schema}.cop_web_sessions WHERE session_id=$1`, [legacy.sessionId])).rows[0].n).toBe("0");
      const reopened = new PostgresWebSessionStore({ ...f.config, encryptionSecret: secret });
      try { await reopened.init(); await expect(reopened.create(tokens(), expiry)).rejects.toThrow("WEB_SESSION_ACCOUNT_ERASURE_FENCED"); }
      finally { await reopened.close(); }
      const racing = { issuer, subjectId: "synthetic-racing-session" };
      const outcomes = await Promise.allSettled([first.create(tokens(racing), expiry), second.revokeActor(racing)]);
      expect(outcomes[1]).toMatchObject({ status: "fulfilled", value: { complete: true } });
      expect((await f.admin.query(`SELECT count(*) AS n FROM ${f.schema}.cop_web_sessions s JOIN ${f.schema}.cop_web_session_erasure_fences f ON s.owner_hash=f.owner_hash`)).rows[0].n).toBe("0");
      await expect(changed.init()).rejects.toThrow("WEB_SESSION_OWNER_KEY_CHANGED");
    } finally { await first.close(); await second.close(); await changed.close(); await f.close(); }
  });

  it("serializes profile/ack cleanup with the dispatch lease and blocks late writes after restart", async () => {
    const f = await fixture(); const first = new PostgresUserProfileStore(f.config), second = new PostgresUserProfileStore(f.config);
    try {
      await first.init(); await second.init();
      await first.upsertProfile(profile()); await first.upsertProfile(profile(other));
      await first.acknowledgeAlert(owner.subjectId, { alertId: "synthetic-alert", acknowledgedAt: new Date().toISOString() });
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
      const dispatch = first.withSafetyNotificationProfile(owner.subjectId, async () => { enter(); await released; });
      await entered;
      let removed = false;
      const cleanup = second.purgeActor(owner).then(result => { removed = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 50)); expect(removed).toBe(false);
      release(); await dispatch; expect(await cleanup).toEqual({ complete: true });
      expect(await first.getProfile(owner.subjectId)).toBeNull(); expect(await first.getAlertAcknowledgements(owner.subjectId)).toEqual(new Map());
      expect(await first.getProfile(other.subjectId)).not.toBeNull();
      const reopened = new PostgresUserProfileStore(f.config);
      try {
        await reopened.init();
        await expect(reopened.upsertProfile(profile())).rejects.toThrow("PROFILE_ACCOUNT_ERASURE_FENCED");
        await expect(reopened.acknowledgeAlert(owner.subjectId, { alertId: "late", acknowledgedAt: new Date().toISOString() })).rejects.toThrow("PROFILE_ACCOUNT_ERASURE_FENCED");
        await expect(reopened.updateAvatar(profile(), null, userAvatarRevision(owner.subjectId, null))).rejects.toThrow("PROFILE_ACCOUNT_ERASURE_FENCED");
      } finally { await reopened.close(); }
      const legacy = { ...profile(), subjectId: "synthetic-legacy", issuer: undefined };
      await first.upsertProfile(legacy); await second.upsertProfile({ ...legacy, issuer });
      expect((await first.getProfile(legacy.subjectId))?.issuer).toBeUndefined();
      expect(await first.purgeActor({ issuer, subjectId: legacy.subjectId })).toEqual({ complete: false });
      expect((await first.searchProfiles("Synthetic")).map(value => value.subjectId)).not.toContain(legacy.subjectId);
      expect((await f.admin.query(`SELECT count(*) AS n FROM ${f.schema}.cop_user_profiles WHERE subject_id=$1 AND erasure_fenced=true`, [legacy.subjectId])).rows[0].n).toBe("1");
    } finally { await first.close(); await second.close(); await f.close(); }
  });

  it("persists opaque global jobs/checkpoints and recovers only unfinished providers with a second process store", async () => {
    const f = await fixture(); const first = new PostgresMobilityStore(f.config), second = new PostgresMobilityStore(f.config);
    let closed = false;
    const complete = (): AccountErasureProof => ({ status: "completed", proofId: "synthetic-provider-proof-v1" });
    const adapters = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true, erase: vi.fn(async () => complete()) }));
    const operationId = randomUUID(), now = () => new Date();
    const actor = { ...owner, authMode: "oidc" as const, username: "Synthetic", displayName: "Synthetic", authTime: Math.floor(Date.now() / 1000) };
    const config = { issuer, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters, accepted: true,
      identitySecret: "synthetic-dedicated-erasure-secret-32-characters", now };
    try {
      await first.init(); await second.init();
      const service = new AccountErasureService({ ...config, store: first });
      adapters[3]!.erase.mockResolvedValueOnce({ status: "pending", remaining: "cleanup_pending" });
      expect(await service.request(actor, operationId, { confirmAccountDeletion: true })).toMatchObject({ accountDeleted: false, remaining: ["messaging_matrix"] });
      const saved = await first.transact([], tx => tx.scan("account-erasure:job:"));
      expect(JSON.stringify(saved)).not.toContain(owner.subjectId); expect(JSON.stringify(saved)).not.toContain(issuer);
      expect(JSON.stringify(saved)).toContain("sealedPrincipal");
      await first.close(); closed = true;
      const restarted = new AccountErasureService({ ...config, store: second });
      await expect(restarted.assertAllowed(actor)).rejects.toMatchObject({ status: 403 });
      await restarted.assertAllowed({ ...actor, ...other });
      await expect(restarted.read({ ...actor, ...other }, operationId)).rejects.toMatchObject({ status: 404 });
      await restarted.resumePending();
      expect(await restarted.read(actor, operationId)).toMatchObject({ accountDeleted: true, status: "deleted", remaining: [] });
      expect(JSON.stringify(await second.transact([], tx => tx.scan("account-erasure:job:")))).not.toContain("sealedPrincipal");
      for (const adapter of adapters) expect(adapter.erase).toHaveBeenCalledTimes(adapter.id === "messaging_matrix" ? 2 : 1);
    } finally { if (!closed) await first.close(); await second.close(); await f.close(); }
  });

  it("allows only one provider handoff for concurrent requests through two real store instances", async () => {
    const f = await fixture(), first = new PostgresMobilityStore(f.config), second = new PostgresMobilityStore(f.config);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    const adapters = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true,
      erase: vi.fn(async (): Promise<AccountErasureProof> => { if (id === "keycloak") { enter(); await released; } return { status: "completed", proofId: "synthetic-provider-proof-v1" }; }) }));
    const actor = { ...owner, authMode: "oidc" as const, username: "Synthetic", displayName: "Synthetic", authTime: Math.floor(Date.now() / 1000) };
    const options = { issuer, identitySecret: "synthetic-dedicated-erasure-secret-32-characters", requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters, accepted: true };
    try {
      await first.init(); await second.init();
      const a = new AccountErasureService({ ...options, store: first }), b = new AccountErasureService({ ...options, store: second });
      const operation = randomUUID(), ongoing = a.request(actor, operation, { confirmAccountDeletion: true });
      await entered;
      expect(await b.request(actor, operation, { confirmAccountDeletion: true })).toMatchObject({ status: "deleting", accountDeleted: false });
      expect(adapters[0]!.erase).toHaveBeenCalledTimes(1);
      release(); expect((await ongoing).accountDeleted).toBe(true);
      for (const adapter of adapters) expect(adapter.erase).toHaveBeenCalledTimes(1);
    } finally { release(); await first.close(); await second.close(); await f.close(); }
  });
});
