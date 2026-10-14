import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresWebSessionStore, type WebSessionTokens } from "./web-session-store.js";

const socket = process.env.COP_LEGACY_BFF_TEST_SOCKET;
if (socket && !/^\/private\/tmp\/cop-legacy-bff-pg18-20261014\.[A-Za-z0-9_]+\/socket$/u.test(socket)) throw new Error("Requires the dedicated private Unix-only legacy BFF cluster");
const config: PoolConfig = { host: socket, port: 56641, database: "cop_legacy_bff_test", user: "cop_legacy_test", max: 3 };
const issuer = "https://identity.legacy-pg.test/realms/cop", owner = { issuer, subjectId: "synthetic-a" };
const secret = "synthetic-b13-style-cookie-secret-32-plus";
const input = (known = true): WebSessionTokens => ({ accessToken: "synthetic-rotated-access", refreshToken: "synthetic-rotated-refresh", accessTokenExpiresAt: new Date(Date.now() + 300000),
  profile: { subjectId: owner.subjectId, username: "Synthetic", name: "Synthetic", ...(known ? { issuer } : {}) } });
function encryptedB13(value: WebSessionTokens): string {
  // Actual b13 wire/storage layout: SHA256 key, AES256GCM, IV.tag.ciphertext;
  // profile has no issuer and the original SQL table has no owner_hash column.
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${bytes.toString("base64url")}`;
}
async function fixture() {
  const admin = new Pool(config), schema = "legacy_" + randomUUID().replaceAll("-", ""), id = randomUUID();
  const createdAt = new Date(Date.now() - 3600000), expiresAt = new Date(Date.now() + 3600000), original = { ...input(false), refreshToken: "synthetic-b13-refresh" };
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE TABLE ${schema}.cop_web_sessions (
    session_id uuid PRIMARY KEY,token_payload text NOT NULL,access_expires_at timestamptz NOT NULL,
    session_expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL)`);
  await admin.query(`INSERT INTO ${schema}.cop_web_sessions VALUES($1,$2,$3,$4,$5,$5)`, [id, encryptedB13(original), original.accessTokenExpiresAt, expiresAt, createdAt]);
  const options = { ...config, options: `-c search_path=${schema}`, encryptionSecret: secret };
  const first = new PostgresWebSessionStore(options), second = new PostgresWebSessionStore(options);
  await first.init(); await second.init();
  return { admin, schema, id, createdAt, expiresAt, first, second, options,
    async close() { await first.close(); await second.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}
describe.skipIf(!socket)("actual PostgreSQL legacy BFF migration and refresh", () => {
  it("rotates a b13 encrypted legacy row while preserving NULL, identity and original lifetime across restart", async () => {
    const f = await fixture();
    try {
      expect((await f.first.get(f.id))?.profile.issuer).toBeUndefined();
      const refreshed = await f.first.update(f.id, input());
      expect(refreshed).toMatchObject({ sessionId: f.id, createdAt: f.createdAt, expiresAt: f.expiresAt, refreshToken: "synthetic-rotated-refresh" });
      expect(refreshed?.profile.issuer).toBeUndefined();
      const row = (await f.admin.query(`SELECT owner_hash,created_at,session_expires_at FROM ${f.schema}.cop_web_sessions WHERE session_id=$1`, [f.id])).rows[0];
      expect(row.owner_hash).toBeNull(); expect(row.created_at).toEqual(f.createdAt); expect(row.session_expires_at).toEqual(f.expiresAt);
      expect((await f.second.preflightActorErasure(owner)).ready).toBe(false);
      const reopened = new PostgresWebSessionStore(f.options);
      try { await reopened.init(); expect((await reopened.get(f.id))?.refreshToken).toBe("synthetic-rotated-refresh"); expect((await reopened.get(f.id))?.profile.issuer).toBeUndefined(); }
      finally { await reopened.close(); }
      await f.second.revoke(f.id); expect(await f.first.update(f.id, input())).toBeNull();
      expect((await f.admin.query(`SELECT count(*) AS n FROM ${f.schema}.cop_web_sessions WHERE session_id=$1`, [f.id])).rows[0].n).toBe("0");
    } finally { await f.close(); }
  });
  it("rejects any-fence refresh, changed known ownership and inconsistent SQL/profile metadata", async () => {
    const f = await fixture();
    try {
      const known = await f.first.create(input(), new Date(Date.now() + 3600000));
      expect(await f.first.update(known.sessionId, { ...input(), profile: { ...input().profile, issuer: "https://wrong.test" } })).toBeNull();
      expect(await f.first.update(f.id, { ...input(), profile: { ...input().profile, subjectId: "synthetic-other" } })).toBeNull();
      await f.admin.query(`UPDATE ${f.schema}.cop_web_sessions SET owner_hash=$2 WHERE session_id=$1`, [f.id, "f".repeat(64)]);
      expect(await f.first.update(f.id, input())).toBeNull();
      await f.admin.query(`UPDATE ${f.schema}.cop_web_sessions SET owner_hash=NULL WHERE session_id=$1`, [f.id]);
      await f.second.revokeActor({ issuer, subjectId: "synthetic-other" });
      await expect(f.first.update(f.id, input())).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
      expect((await f.first.get(f.id))?.refreshToken).toBe("synthetic-b13-refresh");
      expect((await f.second.get(known.sessionId))?.profile.issuer).toBe(issuer);
    } finally { await f.close(); }
  });
  it("waits for the legacy lock and sees a different owner's newly committed fence before updating", async () => {
    const f = await fixture(), blocker = await f.admin.connect();
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(18101203, hashtext($1))", ["legacy-owner"]);
      let done = false; const updating = f.first.update(f.id, input()).then(value => { done = true; return value; });
      // Attach rejection immediately; the expected rejection follows blocker COMMIT.
      const rejected = expect(updating).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        const locks = await blocker.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory'
          AND classid=18101203 AND objid=(hashtext('legacy-owner')::bigint & 4294967295)::oid AND NOT granted) AS waiting`);
        waiting = locks.rows[0].waiting === true;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true); expect(done).toBe(false);
      // The refresh must wait for legacy admission BEFORE taking the row lock.
      // Otherwise expired-row cleanup holding the legacy lock could deadlock.
      expect((await blocker.query(`SELECT session_id FROM ${f.schema}.cop_web_sessions WHERE session_id=$1 FOR UPDATE NOWAIT`, [f.id])).rowCount).toBe(1);
      await blocker.query(`INSERT INTO ${f.schema}.cop_web_session_erasure_fences(owner_hash) VALUES($1)`, ["e".repeat(64)]);
      await blocker.query("COMMIT"); await rejected;
      expect((await f.second.get(f.id))?.refreshToken).toBe("synthetic-b13-refresh");
      expect((await f.admin.query(`SELECT owner_hash FROM ${f.schema}.cop_web_sessions WHERE session_id=$1`, [f.id])).rows[0].owner_hash).toBeNull();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await f.close(); }
  });
  it("late rotation cannot resurrect a concurrently revoked row", async () => {
    const f = await fixture();
    try {
      const outcomes = await Promise.allSettled([f.first.update(f.id, input()), f.second.revoke(f.id)]);
      expect(outcomes.every(value => value.status === "fulfilled")).toBe(true);
      expect(await f.first.get(f.id)).toBeNull(); expect(await f.second.update(f.id, input())).toBeNull();
      expect((await f.admin.query(`SELECT count(*) AS n FROM ${f.schema}.cop_web_sessions WHERE session_id=$1`, [f.id])).rows[0].n).toBe("0");
    } finally { await f.close(); }
  });
  it("does not rotate a legacy session that expires while waiting for its admission lock", async () => {
    const f = await fixture(), blocker = await f.admin.connect();
    try {
      const expiresAt = new Date(Date.now() + 500);
      await f.admin.query(`UPDATE ${f.schema}.cop_web_sessions SET session_expires_at=$2 WHERE session_id=$1`, [f.id, expiresAt]);
      const originalPayload = (await f.admin.query(`SELECT token_payload FROM ${f.schema}.cop_web_sessions WHERE session_id=$1`, [f.id])).rows[0].token_payload;
      await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(18101203, hashtext($1))", ["legacy-owner"]);
      const updating = f.first.update(f.id, input());
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        const locks = await blocker.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory'
          AND classid=18101203 AND objid=(hashtext('legacy-owner')::bigint & 4294967295)::oid AND NOT granted) AS waiting`);
        waiting = locks.rows[0].waiting === true;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now()) + 20));
      await blocker.query("COMMIT");
      expect(await updating).toBeNull();
      const row = (await f.admin.query(`SELECT owner_hash,token_payload FROM ${f.schema}.cop_web_sessions WHERE session_id=$1`, [f.id])).rows[0];
      expect(row.owner_hash).toBeNull();
      // Old encrypted credentials were retained, rather than refreshing an expired row.
      expect(row.token_payload).toBe(originalPayload);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await f.close(); }
  });
});
