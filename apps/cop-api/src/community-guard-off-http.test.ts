import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { PostgresCommunityReportStore } from "./community-report-store.js";
import { clearJwksCacheForTests } from "./security.js";

const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test") throw new Error("Requires isolated loopback cop_erasure_test database");
}
const issuer = "https://identity.community-guard-off.synthetic.test/realms/cop";
const author = "synthetic-community-author-a", other = "synthetic-community-author-b";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-community-guard-off", alg: "RS256", use: "sig" };
function headers(sub = author) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"), timestamp = Math.floor(Date.now() / 1000);
  const content = encode({ alg: "RS256", kid: jwk.kid }) + "." + encode({ iss: issuer, sub, azp: "csm-mobile", exp: timestamp + 300, auth_time: timestamp,
    preferred_username: "synthetic-login-" + sub, email: sub + "@synthetic.test", realm_access: { roles: ["COP_OPERATOR"] } });
  return { authorization: "Bearer " + content + "." + createSign("RSA-SHA256").update(content).end().sign(privateKey).toString("base64url") };
}
function reportPayload() {
  return { category: "hazard", title: "Synthetic private report", observedAt: new Date().toISOString(), visibility: "private", location: { lat: 50, lon: 14, source: "manual" as const } };
}
async function fixture() {
  for (const [key, value] of Object.entries({ NODE_ENV: "test", COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_ALLOWED_CLIENTS: "csm-mobile,cop-web", COP_OIDC_REQUIRED_ROLE: "",
    COP_ALLOW_LAB_TOKEN: "false", COP_DATABASE_URL: "", COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false", COP_ACCOUNT_SAFETY_STORE_ID: "",
    COP_WEB_BFF_SESSION_ENABLED: "false", COP_FLIGHT_DATA_ENABLED: "false", COP_SITUATION_DATA_ENABLED: "false", COP_SAFETY_DATA_ENABLED: "false", COP_TAK_GATEWAY_ENABLED: "false",
    COP_SIM_SEARCH_DATA_ENABLED: "false", COP_CSM_MESSAGING_ENABLED: "false", COP_AI_CONTEXT_INDEX_ENABLED: "false", COP_AI_SEMANTIC_RETRIEVAL_ENABLED: "false",
    COP_SAFETY_NOTIFICATIONS_ENABLED: "false", COP_ROAD_ENRICHMENT_ENABLED: "false" })) vi.stubEnv(key, value);
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith("/protocol/openid-connect/certs")) return Response.json({ keys: [jwk] });
    throw new Error("Unexpected external access in synthetic community guard-off HTTP fixture");
  }));
  const admin = new Pool({ connectionString, max: 2 }), schema = "cop_community_http_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const store = new PostgresCommunityReportStore({ connectionString, max: 3, options: `-c search_path=${schema},public` });
  // No AccountErasureService is provided or enabled. This is the existing
  // signed-user path with the real PostgreSQL community store.
  const app = buildServer({ communityReportStore: store });
  try { await app.ready(); }
  catch (error) { try { await app.close(); } finally { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } throw error; }
  return { app, store, admin, schema, async close() { try { await app.close(); } finally { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

describe.skipIf(!connectionString)("signed community operations with account erasure disabled", () => {
  it("lets each author update, submit, confirm and delete drafts while preserving immutable origin and private account isolation", async () => {
    const f = await fixture();
    try {
      const created = await f.app.inject({ method: "POST", url: "/api/v1/community/reports", headers: headers(), payload: reportPayload() });
      const otherCreated = await f.app.inject({ method: "POST", url: "/api/v1/community/reports", headers: headers(other), payload: reportPayload() });
      expect(created.statusCode, created.body).toBe(201); expect(otherCreated.statusCode, otherCreated.body).toBe(201);
      const id = created.json().reportId, otherId = otherCreated.json().reportId;
      expect(created.json().createdBy).not.toHaveProperty("issuer");
      expect(await f.store.readVerifiedProjectionOwner("report", id)).toEqual({ issuer, subjectId: author });
      expect(await f.store.readVerifiedProjectionOwner("report", otherId)).toEqual({ issuer, subjectId: other });
      expect((await f.app.inject({ url: `/api/v1/community/reports/${id}`, headers: headers(other) })).statusCode).toBe(404);
      expect((await f.app.inject({ method: "PATCH", url: `/api/v1/community/reports/${id}`, headers: headers(other), payload: { title: "Forbidden edit" } })).statusCode).toBe(404);
      expect((await f.app.inject({ method: "POST", url: `/api/v1/community/reports/${id}/submit`, headers: headers(other), payload: {} })).statusCode).toBe(409);
      expect((await f.app.inject({ method: "DELETE", url: `/api/v1/community/reports/${id}`, headers: headers(other) })).statusCode).toBe(404);
      const update = await f.app.inject({ method: "PATCH", url: `/api/v1/community/reports/${id}`, headers: headers(), payload: { title: "Synthetic edited report" } });
      expect(update.statusCode, update.body).toBe(200);
      const submit = await f.app.inject({ method: "POST", url: `/api/v1/community/reports/${id}/submit`, headers: headers(), payload: {} });
      expect(submit.statusCode, submit.body).toBe(200);
      expect((await f.app.inject({ method: "PUT", url: `/api/v1/community/reports/${id}/confirmation`, headers: headers(other), payload: { value: "still_there" } })).statusCode).toBe(409);
      for (const value of ["still_there", "not_there"]) {
        const confirmation = await f.app.inject({ method: "PUT", url: `/api/v1/community/reports/${id}/confirmation`, headers: headers(), payload: { value } });
        expect(confirmation.statusCode, confirmation.body).toBe(200);
        expect(confirmation.json().confirmations.currentActorValue).toBe(value);
      }
      const ledger = await f.admin.query(`SELECT kind,row_key,subject_id,issuer FROM ${f.schema}.cop_community_erasure_ownership WHERE kind='report' OR kind='confirmation' ORDER BY kind,row_key`);
      expect(ledger.rows).toEqual(expect.arrayContaining([
        { kind: "report", row_key: id, subject_id: author, issuer }, { kind: "report", row_key: otherId, subject_id: other, issuer },
        { kind: "confirmation", row_key: `${id}:${author}`, subject_id: author, issuer }
      ]));
      expect((await f.app.inject({ method: "DELETE", url: `/api/v1/community/reports/${otherId}`, headers: headers() })).statusCode).toBe(404);
      expect((await f.app.inject({ method: "DELETE", url: `/api/v1/community/reports/${otherId}`, headers: headers(other) })).statusCode).toBe(204);
      const draft = await f.app.inject({ method: "POST", url: "/api/v1/community/reports", headers: headers(), payload: reportPayload() });
      expect(draft.statusCode, draft.body).toBe(201);
      expect((await f.app.inject({ method: "DELETE", url: `/api/v1/community/reports/${draft.json().reportId}`, headers: headers() })).statusCode).toBe(204);
      expect((await f.app.inject({ method: "DELETE", url: `/api/v1/community/reports/${id}`, headers: headers() })).statusCode).toBe(409);
      expect(await f.store.readVerifiedProjectionOwner("report", id)).toEqual({ issuer, subjectId: author });
    } finally { await f.close(); }
  });

  it("keeps signed group management available after an unrelated user's denial without adopting username or email aliases", async () => {
    const f = await fixture();
    try {
      const created = await f.app.inject({ method: "POST", url: "/api/v1/community/groups", headers: headers(), payload: { name: "Synthetic private group", visibility: "private" } });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().groupId;
      const denied = await f.app.inject({ method: "DELETE", url: `/api/v1/community/groups/${id}`, headers: headers(other) });
      expect(denied.statusCode, denied.body).toBe(404);
      const updated = await f.app.inject({ method: "PATCH", url: `/api/v1/community/groups/${id}/metadata`, headers: headers(), payload: { metadata: { synthetic: "retained" } } });
      expect(updated.statusCode, updated.body).toBe(200);
      const ownership = await f.admin.query(`SELECT kind,row_key,subject_id,issuer FROM ${f.schema}.cop_community_erasure_ownership WHERE kind='membership' AND row_key LIKE $1`, [id + ":%"]);
      expect(ownership.rows).toEqual([{ kind: "membership", row_key: `${id}:${author}`, subject_id: author, issuer }]);
      const deleted = await f.app.inject({ method: "DELETE", url: `/api/v1/community/groups/${id}`, headers: headers() });
      expect(deleted.statusCode, deleted.body).toBe(204);
    } finally { await f.close(); }
  });

  it("allows the legacy author's ordinary edit while preserving the original unknown provenance", async () => {
    const f = await fixture();
    try {
      const legacy = await f.store.createReport({ ...reportPayload(), category: "hazard", visibility: "private", createdBy: { subjectId: author, displayName: "Legacy synthetic", username: "legacy" } }, new Date());
      const before = (await f.admin.query(`SELECT subject_id,issuer FROM ${f.schema}.cop_community_erasure_ownership WHERE kind='report' AND row_key=$1`, [legacy.reportId])).rows;
      expect(before).toEqual([{ subject_id: author, issuer: null }]);
      const updated = await f.app.inject({ method: "PATCH", url: `/api/v1/community/reports/${legacy.reportId}`, headers: headers(), payload: { title: "Synthetic legacy ordinary edit" } });
      expect(updated.statusCode, updated.body).toBe(200);
      expect((await f.admin.query(`SELECT subject_id,issuer FROM ${f.schema}.cop_community_erasure_ownership WHERE kind='report' AND row_key=$1`, [legacy.reportId])).rows).toEqual(before);
      expect(await f.store.readVerifiedProjectionOwner("report", legacy.reportId)).toBeUndefined();
      expect(await f.store.accountErasureComponent().preflight({ authMode: "oidc", issuer, subjectId: author, displayName: "Synthetic", username: "synthetic" }, new AbortController().signal)).toMatchObject({ ready: false, reason: "ownership_unresolved" });
    } finally { await f.close(); }
  });

  it("preserves the existing legacy group alias operation without upgrading the alias to the signed user's issuer", async () => {
    const f = await fixture();
    try {
      const alias = "synthetic-login-" + author;
      const group = await f.store.createGroup({ name: "Synthetic legacy alias group", visibility: "private", createdBy: { subjectId: alias, username: alias, displayName: "Legacy synthetic" } }, new Date());
      const before = (await f.admin.query(`SELECT kind,row_key,subject_id,issuer FROM ${f.schema}.cop_community_erasure_ownership WHERE row_key=$1 OR row_key LIKE $2 ORDER BY kind,row_key`, [group.groupId, group.groupId + ":%"])).rows;
      expect(before).toEqual([
        { kind: "group", row_key: group.groupId, subject_id: alias, issuer: null },
        { kind: "membership", row_key: `${group.groupId}:${alias}`, subject_id: alias, issuer: null }
      ]);
      const deleted = await f.app.inject({ method: "DELETE", url: `/api/v1/community/groups/${group.groupId}`, headers: headers() });
      expect(deleted.statusCode, deleted.body).toBe(204);
      expect(await f.store.getGroup(group.groupId)).toBeNull();
      expect((await f.admin.query(`SELECT kind,row_key,subject_id,issuer FROM ${f.schema}.cop_community_erasure_ownership WHERE row_key=$1 OR row_key LIKE $2 ORDER BY kind,row_key`, [group.groupId, group.groupId + ":%"])).rows).toEqual(before);
    } finally { await f.close(); }
  });
});
