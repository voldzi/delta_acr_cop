import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresWebSessionStore } from "./web-session-store.js";
interface LegacySignedSessionFixtureModule {
 enrollLegacyErasureProvenanceFixture(options: { mode: "apply"; business: Pool; guard: Pool; plan: unknown; reviewedPlanSha256: string; issuer: string; sessionSecret: string }): Promise<{ legacySessions: { activeCount: number } }>;
 legacySourcePins: Readonly<Record<string, string>>;
}
const { enrollLegacyErasureProvenanceFixture, legacySourcePins } = await import(new URL("../../../scripts/account-safety/enroll-legacy-erasure-provenance.mjs", import.meta.url).href) as LegacySignedSessionFixtureModule;
const connectionString = process.env.COP_LEGACY_PROVENANCE_TEST_URL;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
describe.skipIf(!connectionString)("actual signed legacy enrollment interoperates with the production BFF store", () => {
 it("uses actual store AES/HMAC and preserves B when the production store later revokes A", async () => {
  const issuer = "https://legacy-provenance.synthetic.invalid/realms/cop", a = randomUUID(), b = randomUUID(), secret = randomBytes(48).toString("base64url"),
   { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }), jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "synthetic-actual-bff", alg: "RS256", use: "sig" }] };
  const server = createServer((req, res) => { if (req.method !== "GET" || req.url !== "/jwks" || req.headers.authorization) { res.writeHead(400); res.end(); return; } res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(jwks)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const pool = new Pool({ connectionString, max: 2 }), guardUrl = new URL(connectionString!); guardUrl.pathname = "/cop_legacy_provenance_guard_test";
  const guard = new Pool({ connectionString: guardUrl.href, max: 2 }), store = new PostgresWebSessionStore({ connectionString, max: 2, encryptionSecret: secret });
  try {
   await pool.query("TRUNCATE cop_web_sessions,cop_web_session_erasure_fences,cop_web_session_erasure_metadata"); await store.init();
   const iat = Math.floor(Date.now() / 1000) - 1, claims = { iss: issuer, sub: a, azp: "cop-web", iat, exp: iat + 300 }, parts = [Buffer.from(JSON.stringify({ alg: "RS256", kid: "synthetic-actual-bff" })).toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url")], accessToken = parts.join(".") + "." + sign("RSA-SHA256", Buffer.from(parts.join(".")), privateKey).toString("base64url");
   const legacy = await store.create({ accessToken, refreshToken: "synthetic-refresh", accessTokenExpiresAt: new Date(claims.exp * 1000), profile: { subjectId: a, name: "Synthetic", username: "Synthetic" } }, new Date(Date.now() + 86_400_000));
   const other = await store.create({ accessToken: "synthetic-b-preserved", accessTokenExpiresAt: new Date(claims.exp * 1000), profile: { subjectId: b, issuer, name: "Synthetic B", username: "Synthetic B" } }, new Date(Date.now() + 86_400_000));
   const row = (await pool.query("SELECT to_jsonb(s)::text t FROM cop_web_sessions s WHERE session_id=$1", [legacy.sessionId])).rows[0].t;
   const plan = { contractVersion: "cop-legacy-erasure-provenance-enrollment-v1", planId: randomUUID(), binding: { guardStoreId: "b9182625-596a-4df1-aabc-c152c1aabecf", applicationStoreId: "8c21c20c-c899-4a24-a50e-b91c749ffce4", incarnationId: "eb4c4f53-bde5-4bc4-b9a8-6fa1a1d99cd2", restoreGeneration: 1, configurationFingerprint: "a".repeat(64) }, writer: { containerId: process.env.COP_LEGACY_PROVENANCE_WRITER_ID, imageId: process.env.COP_LEGACY_PROVENANCE_IMAGE_ID }, issuer,
    evidence: [{ id: randomUUID(), authentication: "verified_oidc_sub", issuer, sourcePins: legacySourcePins, authConfigSha256: "b".repeat(64), writersInventorySha256: "c".repeat(64), validFrom: "2020-01-01T00:00:00Z", validUntil: "2030-01-01T00:00:00Z" }], rows: [] as any[],
    signedSessionPolicy: { contractVersion: "cop-legacy-original-signed-session-policy-v1", issuer, authorizedParty: "cop-web", jwksUri: "http://127.0.0.1:" + (server.address() as any).port + "/jwks", jwksSha256: hash(canonical(jwks)), encryptionKeyFingerprint: createHash("sha256").update("cop-web-session-owner-key-v1\0").update(createHash("sha256").update(secret).digest()).digest("hex") } };
   plan.rows.push({ kind: "session", key: { session_id: legacy.sessionId }, fullRowSha256: createHash("sha256").update(row).digest("hex"), ownershipBeforeSha256: null, originalSubjects: [a], evidenceId: plan.evidence[0]!.id });
   const result = await enrollLegacyErasureProvenanceFixture({ mode: "apply", business: pool, guard, plan, reviewedPlanSha256: hash(plan), issuer, sessionSecret: secret });
   expect(result.legacySessions.activeCount).toBe(0); expect((await store.get(legacy.sessionId))?.profile.issuer).toBe(issuer);
   expect((await store.preflightActorErasure({ issuer, subjectId: a })).ready).toBe(true); expect(await store.revokeActor({ issuer, subjectId: a })).toEqual({ complete: true });
   expect(await store.get(legacy.sessionId)).toBeNull(); expect(await store.get(other.sessionId)).toEqual(other);
  } finally { await store.close(); await pool.end(); await guard.end(); await new Promise<void>(resolve => server.close(() => resolve())); }
 });
});
