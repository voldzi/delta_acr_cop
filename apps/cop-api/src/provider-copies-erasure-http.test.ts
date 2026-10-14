import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService } from "./account-erasure.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { PostgresTrackHistoryStore } from "./track-history-store.js";
import { PostgresFederationRuntimeStore } from "./federation-runtime-store.js";
import { SituationDataSourceAdapter } from "./situation-data-source.js";
import { SafetyDataSourceAdapter } from "./safety-data-source.js";
import { TakGatewaySourceAdapter } from "./tak-gateway-source.js";
import { SimSearchDataSourceAdapter } from "./sim-search-data-source.js";
import { getCopStateProjectionOwner } from "./cop-state-erasure.js";
import { clearJwksCacheForTests } from "./security.js";
import { buildServer } from "./server.js";
import type { CopState } from "./types.js";

const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) { const url = new URL(connectionString); if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test") throw new Error("Requires isolated loopback cop_erasure_test database"); }
const issuer = "https://identity.provider-http.synthetic.test/realms/cop", subjectId = "synthetic-provider-reader";
const resourceId = "bc7f3d8d-d39b-475e-8c32-4ba6b3024db5";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-provider-http", alg: "RS256", use: "sig" };
function headers() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"), timestamp = Math.floor(Date.now() / 1000);
  const content = encode({ alg: "RS256", kid: jwk.kid }) + "." + encode({ iss: issuer, sub: subjectId, azp: "csm-mobile", exp: timestamp + 300, auth_time: timestamp,
    preferred_username: "synthetic-provider-reader", realm_access: { roles: ["COP_OPERATOR"] } });
  return { authorization: "Bearer " + content + "." + createSign("RSA-SHA256").update(content).end().sign(privateKey).toString("base64url"), "x-correlation-id": randomUUID() };
}
async function fixture() {
  for (const [key, value] of Object.entries({ NODE_ENV: "test", COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_ALLOWED_CLIENTS: "csm-mobile,cop-web", COP_OIDC_REQUIRED_ROLE: "",
    COP_ALLOW_LAB_TOKEN: "false", COP_DATABASE_URL: "", COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false", COP_ACCOUNT_SAFETY_STORE_ID: "",
    COP_WEB_BFF_SESSION_ENABLED: "false", COP_FLIGHT_DATA_ENABLED: "false", COP_SITUATION_DATA_ENABLED: "false", COP_SAFETY_DATA_ENABLED: "false", COP_TAK_GATEWAY_ENABLED: "false",
    COP_SIM_SEARCH_DATA_ENABLED: "false", COP_CSM_MESSAGING_ENABLED: "false", COP_AI_CONTEXT_INDEX_ENABLED: "false", COP_AI_SEMANTIC_RETRIEVAL_ENABLED: "false", COP_SAFETY_NOTIFICATIONS_ENABLED: "false" })) vi.stubEnv(key, value);
  clearJwksCacheForTests();
  let blocked = false;
  const upstream = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/protocol/openid-connect/certs")) return Response.json({ keys: [jwk] });
    if (url.startsWith("https://provider.synthetic.test/search/")) return Response.json({ contractVersion: "synthetic-search", results: [], warnings: [] });
    if (url === "https://provider.synthetic.test/situation/radio/profiles") return Response.json({ profiles: [], warnings: blocked ? [`Pending erased reference ${resourceId}`] : [] });
    throw new Error("Unexpected external access in synthetic provider HTTP fixture");
  });
  vi.stubGlobal("fetch", upstream);
  const config = { enabled: true, cacheTtlMs: 20000, maxLimit: 250, timeoutMs: 1000 };
  const situation = new SituationDataSourceAdapter({ ...config, baseUrl: "https://provider.synthetic.test/situation" });
  const safety = new SafetyDataSourceAdapter({ ...config, baseUrl: "https://provider.synthetic.test/safety" });
  const tak = new TakGatewaySourceAdapter({ ...config, baseUrl: "https://provider.synthetic.test/tak" });
  const search = new SimSearchDataSourceAdapter({ enabled: true, baseUrl: "https://provider.synthetic.test/search", indexLimit: 50, maxLimit: 25, timeoutMs: 1000 });
  const sources = [situation, safety, tak, search];
  expect(sources.map(source => source.providerCopiesBoundary().ready())).toEqual([false, false, false, false]);
  const admin = new Pool({ connectionString, max: 2 }), schema = "cop_provider_http_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pg = { connectionString, max: 3, options: `-c search_path=${schema}` };
  const history = new PostgresTrackHistoryStore(pg), federation = new PostgresFederationRuntimeStore(pg), store = new MemoryMobilityStore();
  await history.init();
  await admin.query(`INSERT INTO ${schema}.cop_content_projection_fences(kind,resource_id,operation_id) VALUES('communityReport',$1,$2)`, [resourceId, randomUUID()]);
  const service = new AccountErasureService({ store, allowUnboundSyntheticStore: true, issuer, identitySecret: "synthetic-provider-http-erasure-secret-32-plus", requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS,
    accepted: true, adapters: ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true, preflight: async () => ({ ready: true, version: "synthetic-provider-fixture" }),
      erase: async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }) })) });
  const app = buildServer({ accountErasure: service, mobilityStore: store, trackHistoryStore: history, federationRuntimeStore: federation,
    situationDataSource: situation, safetyDataSource: safety, takGatewaySource: tak, simSearchDataSource: search });
  try { await app.ready(); }
  catch (error) { try { await app.close(); } finally { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } throw error; }
  return { app, sources, upstream, state: app.getDecorator<CopState>("copState"), block: () => { blocked = true; },
    async close() { try { await app.close(); } finally { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

describe.skipIf(!connectionString)("actual COP provider copy initialization and HTTP boundary", () => {
  it("binds all four actual configured instances before producers and hydrates the real SQL frontier", async () => {
    const f = await fixture();
    try {
      expect(getCopStateProjectionOwner(f.state)?.producerBindingInstalled()).toBe(true);
      for (const source of f.sources) {
        const boundary = source.providerCopiesBoundary();
        expect(boundary.owns(source)).toBe(true); expect(boundary.installed()).toBe(true); expect(boundary.ready()).toBe(true);
      }
      const response = await f.app.inject({ url: "/api/v1/radio/profiles", headers: headers() });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().profiles).toEqual([]);
      expect(response.body).not.toContain("ownerIssuer"); expect(response.body).not.toContain("owner_subject_hash");
    } finally { await f.close(); }
  });

  it("returns the existing COP 503 envelope when an actual provider response references a fenced resource", async () => {
    const f = await fixture();
    try {
      f.block();
      const requestHeaders = headers(), response = await f.app.inject({ url: "/api/v1/radio/profiles", headers: requestHeaders });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: "PROVIDER_COPY_ERASURE_PENDING", correlationId: requestHeaders["x-correlation-id"] } });
      expect(response.body).not.toContain(resourceId); expect(response.body).not.toContain(issuer);
      expect(f.upstream.mock.calls.some(([url]) => String(url).endsWith("/situation/radio/profiles"))).toBe(true);
    } finally { await f.close(); }
  });
});
