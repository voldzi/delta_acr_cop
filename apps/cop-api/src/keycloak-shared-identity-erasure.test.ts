import { afterEach, describe, expect, it, vi } from "vitest";
import { createSharedIdentityErasureAdapter } from "./keycloak-shared-identity-erasure.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
const issuer = "https://keycloak.synthetic.invalid/realms/cop";
const a: AuthenticatedActor = { authMode: "oidc", issuer, subjectId: "10000000-0000-4000-8000-000000000001", username: "", displayName: "" };
const b: AuthenticatedActor = { ...a, subjectId: "10000000-0000-4000-8000-000000000002" };
const context = { accountKey: "opaque-owner-a", operationId: "20000000-0000-4000-8000-000000000001", requestedAt: "2026-10-17T00:00:00.000Z", signal: new AbortController().signal };
function fixture(options: { accepted?: boolean; fenced?: boolean; falseAck?: boolean; absent?: boolean; service?: boolean; timeoutAfterDelete?: boolean; forbidden?: boolean } = {}) {
  const store = new MemoryMobilityStore();
  const users = new Map([a, b].map(actor => [actor.subjectId, { id: actor.subjectId, createdTimestamp: 10,
    ...(options.service && actor === a ? { serviceAccountClientId: "synthetic-service" } : {}) }]));
  if (options.absent) users.delete(a.subjectId);
  let failed = false;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); expect(url.origin).toBe("https://keycloak.synthetic.invalid"); expect(init?.redirect).toBe("error");
    if (url.pathname.endsWith("/token")) return Response.json({ access_token: "synthetic-service-token", token_type: "Bearer" });
    const id = url.pathname.split("/").at(-1)!;
    expect([a.subjectId, b.subjectId]).toContain(id);
    if (init?.method === "DELETE") {
      if (options.forbidden) return new Response(null, { status: 403 });
      if (!options.falseAck) users.delete(id);
      if (options.timeoutAfterDelete && !failed) { failed = true; throw Error("synthetic lost reply"); }
      return new Response(null, { status: 204 });
    }
    return users.has(id) ? Response.json(users.get(id)) : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  const config = { issuer, clientId: "cop-account-erasure-worker", clientSecret: "synthetic-only", authorityAccepted: options.accepted !== false,
    assertCopAccessFenced: async () => options.fenced !== false };
  return { store, users, fetcher, config, adapter: createSharedIdentityErasureAdapter(config, store) };
}
afterEach(() => vi.unstubAllGlobals());
describe("explicit shared COP/SIM identity deletion", () => {
  it("removes only A including the identity itself; B is unchanged", async () => {
    const f = fixture(), before = structuredClone(f.users.get(b.subjectId));
    expect((await f.adapter.preflight!(a, context)).ready).toBe(true);
    expect((await f.adapter.erase(a, context)).status).toBe("completed");
    expect(f.users.has(a.subjectId)).toBe(false); expect(f.users.get(b.subjectId)).toEqual(before);
    expect((await f.adapter.erase(a, context)).status).toBe("completed");
    expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });
  it.each([{ accepted: false }, { fenced: false }])("requires explicit authority and durable user fence %j", async options => {
    const f = fixture(options); expect((await f.adapter.erase(a, context)).status).toBe("pending"); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("does not accept a204 while the identity still exists", async () => {
    const f = fixture({ falseAck: true }); expect((await f.adapter.erase(a, context)).status).toBe("pending"); expect(f.users.has(a.subjectId)).toBe(true);
  });
  it("does not turn an unexplained first404 into completion", async () => {
    const f = fixture({ absent: true }); expect((await f.adapter.erase(a, context)).status).toBe("pending");
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
  it("recovers a lostDELETE response using the original durable checkpoint after restart", async () => {
    const f = fixture({ timeoutAfterDelete: true }); await expect(f.adapter.erase(a, context)).rejects.toThrow("synthetic lost reply");
    const restarted = createSharedIdentityErasureAdapter(f.config, f.store);
    expect((await restarted.erase(a, context)).status).toBe("completed"); expect(f.users.has(b.subjectId)).toBe(true);
  });
  it("refuses service identities", async () => {
    const f = fixture({ service: true }); expect((await f.adapter.preflight!(a, context)).ready).toBe(false);
    await expect(f.adapter.erase(a, context)).rejects.toThrow("IDENTITY_BINDING_UNPROVEN");
  });
  it("refuses a foreign issuer before contacting the provider", async () => {
    const f = fixture(); await expect(f.adapter.erase({ ...a, issuer: "https://foreign.invalid/realms/cop" }, context)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("retains a pending operation on permission failure", async () => {
    const f = fixture({ forbidden: true }); expect((await f.adapter.erase(a, context)).status).toBe("pending"); expect(f.users.has(a.subjectId)).toBe(true);
  });
  it("binds retry to the original operation and refuses an identity recreated with another timestamp", async () => {
    const f = fixture({ falseAck: true }); await f.adapter.erase(a, context);
    await expect(f.adapter.erase(a, { ...context, operationId: "20000000-0000-4000-8000-000000000002" })).rejects.toThrow("IDENTITY_OPERATION_CONFLICT");
    f.users.set(a.subjectId, { id: a.subjectId, createdTimestamp: 99 });
    await expect(f.adapter.erase(a, context)).rejects.toThrow("IDENTITY_CHANGED");
  });
  it("recovers absent provider identity after local checkpoint loss using the accepted original witness", async () => {
    const f = fixture(); const assessment = await f.adapter.preflight!(a, context);
    if (!assessment.ready) throw Error("synthetic preflight failed");
    expect(assessment.ready).toBe(true); f.users.delete(a.subjectId);
    expect((await f.adapter.erase(a, { ...context, identityPreflightVersion: assessment.version })).status).toBe("completed");
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(f.users.has(b.subjectId)).toBe(true);
  });
  it("refuses recreation between preflight and first deletion before issuingDELETE", async () => {
    const f = fixture(); const assessment = await f.adapter.preflight!(a, context);
    if (!assessment.ready) throw Error("synthetic preflight failed");
    f.users.set(a.subjectId, { id: a.subjectId, createdTimestamp: 99 });
    await expect(f.adapter.erase(a, { ...context, identityPreflightVersion: assessment.version })).rejects.toThrow("IDENTITY_CHANGED");
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

});
