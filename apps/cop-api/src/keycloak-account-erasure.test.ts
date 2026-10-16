import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeycloakAccountErasureAdapter, KEYCLOAK_COP_ERASURE_SCOPE } from "./keycloak-account-erasure.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

const issuer = "https://synthetic-keycloak.test/auth/realms/cop";
const actor: AuthenticatedActor = { authMode: "oidc", issuer, subjectId: "3d4b0e2c-7f30-4f13-9109-6dc8c6620fb2", username: "", displayName: "" };
const actorB: AuthenticatedActor = { ...actor, subjectId: "115d85df-4c91-406d-a641-c1664c3c1147" };
const operationId = "2b62f4ec-f67c-431f-9661-d6e033b7845e";
const context = (other = false) => ({ operationId: other ? "52ad8361-3809-436e-9c2f-6a2b7272a6de" : operationId,
  accountKey: other ? "synthetic_opaque_owner_b" : "synthetic_opaque_owner", requestedAt: "2026-10-14T00:00:00Z", signal: new AbortController().signal });
const ids = { "cop-web": "405890a3-f1e3-4884-81ed-57c2405137c1", "csm-mobile": "8f334350-f939-4ff7-ab20-1e1998daed3d" };
type Target = keyof typeof ids;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const role = (target: Target) => ({ id: target === "cop-web" ? "b3d3a6e9-a715-4768-88b7-9437735c286c" : "6d1292d2-0ba3-4487-8135-6156cab7da97",
  name: target === "cop-web" ? "cop-user" : "mobile-user", composite: false, clientRole: true, containerId: ids[target] });
function fixture(options: { authority?: boolean; fenced?: boolean; noFencePort?: boolean; falseConsentAck?: boolean; falseRoleAck?: boolean;
  mismatch?: boolean; serviceAccount?: boolean; inherited?: boolean; composite?: boolean; outage?: boolean; duplicateClient?: boolean; revokeForbidden?: boolean } = {}) {
  const store = new MemoryMobilityStore();
  const bindings = { ...ids };
  const state = new Map([actor, actorB].map(owner => [owner.subjectId, {
    timestamp: 1000, present: true,
    consents: new Map<string, object>([["cop-web", { clientId: "cop-web", createdDate: 10, lastUpdatedDate: 20, grantedClientScopes: ["profile"] }],
      ["csm-mobile", { clientId: "csm-mobile", createdDate: 11, lastUpdatedDate: 21, grantedClientScopes: ["profile"] }],
      ["sim-web", { clientId: "sim-web", grantedClientScopes: ["sim-access"] }]]),
    roles: { "cop-web": [role("cop-web")], "csm-mobile": [role("csm-mobile")] },
    offline: { "cop-web": ["offline-cop-web"], "csm-mobile": ["offline-csm-mobile"] },
    // Retained objects are intentionally outside the adapter's target API. A
    // forbidden user logout/session/realm/SIM operation fails the fixture.
    simRoles: ["sim-operator"], simSession: { id: "shared-sso", sim: true, active: true }, profile: { name: "retained-shared-name" }
  }]));
  const preserved = () => [...state.entries()].map(([subject, user]) => [subject, user.present, user.simRoles, user.simSession, user.profile]);
  const initialPreserved = JSON.stringify(preserved());
  const calls: Array<{ path: string; method: string; query: string; body?: unknown }> = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    expect(url.origin).toBe("https://synthetic-keycloak.test"); expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
    calls.push({ path: url.pathname, method, query: url.search, ...(init?.body ? { body: String(init.body) } : {}) });
    if (options.outage) return json({ error: "Synthetic unavailable" }, 503);
    if (url.pathname.endsWith("/protocol/openid-connect/token")) {
      expect(method).toBe("POST");
      expect(new URLSearchParams(String(init?.body))).toEqual(new URLSearchParams({ grant_type: "client_credentials", client_id: "synthetic-erasure-worker", client_secret: "synthetic-client-secret" }));
      return json({ access_token: "synthetic-private-admin-bearer", token_type: "Bearer" });
    }
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-private-admin-bearer");
    if (url.pathname === "/auth/admin/realms/cop/clients") {
      expect(method).toBe("GET"); expect(url.searchParams.get("search")).toBe("false");
      expect(url.searchParams.get("max")).toBe("2"); const target = url.searchParams.get("clientId") as Target;
      expect(["cop-web", "csm-mobile"]).toContain(target);
      const client = { id: bindings[target], clientId: target, protocol: "openid-connect" };
      return json(options.duplicateClient ? [client, client] : [client]);
    }
    const match = url.pathname.match(/^\/auth\/admin\/realms\/cop\/users\/([^/]+)(.*)$/u);
    if (!match) throw new Error("Forbidden synthetic target");
    const subject = match[1]!, tail = match[2]!, user = state.get(subject)!;
    if (!user || !user.present) return json({ error: "User not found" }, 404);
    if (tail === "") {
      expect(method).toBe("GET");
      return json({ id: options.mismatch ? "different-owner" : subject, createdTimestamp: user.timestamp, username: "not-retained",
        ...(options.serviceAccount ? { serviceAccountClientId: "privileged-worker" } : {}) });
    }
    if (tail === "/consents" && method === "GET") return json([...user.consents.values()]);
    const consent = tail.match(/^\/consents\/(cop-web|csm-mobile)$/u);
    if (consent && method === "DELETE") {
      const target = consent[1] as Target;
      expect(init?.body).toBeUndefined();
      if (options.revokeForbidden) return new Response(null, { status: 403 });
      if (!options.falseConsentAck) { user.consents.delete(target); user.offline[target] = []; }
      return new Response(null, { status: 204 });
    }
    const offline = tail.match(/^\/offline-sessions\/([^/]+)$/u);
    if (offline && method === "GET") {
      const target = Object.entries(bindings).find(([, id]) => id === offline[1])?.[0] as Target;
      expect(target).toBeTruthy();
      return json(user.offline[target].map(id => ({ id, userId: subject, start: 10, clients: { [bindings[target]]: target } })));
    }
    const roles = tail.match(/^\/role-mappings\/clients\/([^/]+)(\/composite)?$/u);
    if (roles) {
      const target = Object.entries(bindings).find(([, id]) => id === roles[1])?.[0] as Target;
      expect(target).toBeTruthy();
      if (method === "GET") return json(user.roles[target].map(value => ({ ...value, containerId: bindings[target], ...(options.composite ? { composite: true } : {}) })).concat(
        roles[2] && options.inherited ? [{ ...role(target), id: "eb2a411f-376e-45f6-902e-2e0724d1bc7d", name: "inherited" }] : []));
      if (method === "DELETE" && !roles[2]) {
        expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
        const supplied = JSON.parse(String(init?.body));
        expect(supplied).toEqual(user.roles[target].map(({ id, name }) => ({ id, name })));
        if (!options.falseRoleAck) user.roles[target] = [];
        return new Response(null, { status: 204 });
      }
    }
    throw new Error("Forbidden synthetic global/SIM/session/realm/group operation: " + method + " " + tail);
  });
  vi.stubGlobal("fetch", fetcher);
  const fence = vi.fn(async (owner: AuthenticatedActor, value: { accountKey: string; operationId: string }) => {
    expect([actor.subjectId, actorB.subjectId]).toContain(owner.subjectId);
    expect(value.accountKey).toBe(owner.subjectId === actor.subjectId ? context().accountKey : context(true).accountKey);
    return options.fenced !== false;
  });
  const adapter = createKeycloakAccountErasureAdapter({ issuer, clientId: "synthetic-erasure-worker", clientSecret: "synthetic-client-secret",
    authorityAccepted: options.authority !== false, ...(options.noFencePort ? {} : { assertCopAccessFenced: fence }) }, store);
  return { store, adapter, calls, fetcher, fence, state, changeClient: () => { bindings["cop-web"] = "7f1f6db8-a461-4fa2-9143-ea3acbb20984"; },
    preserved: () => expect(JSON.stringify(preserved())).toBe(initialPreserved) };
}
afterEach(() => vi.unstubAllGlobals());

describe("server-owned scoped COP/Jízda Keycloak revocation preserving shared identity and SIM", () => {
  it.each([{ authority: false }, { noFencePort: true }])("keeps readiness and mutations disabled without scoped authority and real COP fence port: %j", async options => {
    const f = fixture(options);
    expect(await f.adapter.ready()).toBe(false);
    expect(await f.adapter.preflight!(actor, context())).toEqual({ ready: false, reason: "adapter_unavailable" });
    expect(await f.adapter.erase(actor, context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("never starts provider mutation before the durable operation-bound COP fence", async () => {
    const f = fixture({ fenced: false });
    expect(await f.adapter.erase(actor, context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("revokes only exact A COP consent/offline grants and explicit direct-role bodies, preserving user B and all SIM identity state", async () => {
    const f = fixture(); expect(await f.adapter.ready()).toBe(true);
    expect(await f.adapter.preflight!(actor, context())).toMatchObject({ ready: true });
    const beforeB = JSON.stringify(f.state.get(actorB.subjectId));
    const result = await f.adapter.erase(actor, context());
    expect(result).toMatchObject({ status: "completed", proofId: expect.any(String) }); f.preserved();
    expect(JSON.stringify(f.state.get(actorB.subjectId))).toBe(beforeB);
    const deletions = f.calls.filter(call => call.method === "DELETE");
    expect(deletions.map(call => call.path)).toEqual(["/auth/admin/realms/cop/users/" + actor.subjectId + "/consents/cop-web",
      "/auth/admin/realms/cop/users/" + actor.subjectId + "/role-mappings/clients/" + ids["cop-web"],
      "/auth/admin/realms/cop/users/" + actor.subjectId + "/consents/csm-mobile",
      "/auth/admin/realms/cop/users/" + actor.subjectId + "/role-mappings/clients/" + ids["csm-mobile"]]);
    const saved = JSON.stringify(await f.store.transact([], tx => tx.scan("keycloak-cop-erasure:")));
    expect(saved).toContain(KEYCLOAK_COP_ERASURE_SCOPE);
    for (const forbidden of [actor.subjectId, "not-retained", "synthetic-private-admin-bearer", "synthetic-client-secret", "cop-user", "sim-operator", "shared-sso"]) expect(saved).not.toContain(forbidden);
    expect(await f.adapter.erase(actor, context())).toEqual(result);
    expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(4);
    expect(await f.adapter.erase(actorB, context(true))).toMatchObject({ status: "completed" }); f.preserved();
  });
  it.each([{ inherited: true }, { composite: true }])("blocks shared inherited/composite entitlements without touching realm/groups/SIM: %j", async options => {
    const f = fixture(options);
    expect(await f.adapter.preflight!(actor, context())).toEqual({ ready: false, reason: "ownership_unresolved" });
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("SHARED_ENTITLEMENT");
    expect(f.calls.some(call => call.method === "DELETE")).toBe(false); f.preserved();
  });
  it("rejects foreign issuer and normalizing subjects before any provider call", async () => {
    const f = fixture();
    await expect(f.adapter.erase({ ...actor, issuer: "https://other.test/realms/cop" }, context())).rejects.toThrow("Verified owner");
    for (const subjectId of [".", "..", "invalid\nsubject"]) await expect(f.adapter.erase({ ...actor, subjectId }, context())).rejects.toThrow("Verified owner");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each([{ mismatch: true }, { serviceAccount: true }])("rejects wrong/privileged identity without mutation: %j", async options => {
    const f = fixture(options);
    expect(await f.adapter.preflight!(actor, context())).toEqual({ ready: false, reason: "adapter_unavailable" });
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("IDENTITY_UNPROVEN");
    expect(f.calls.some(call => call.method === "DELETE")).toBe(false);
  });
  it.each([{ falseConsentAck: true }, { falseRoleAck: true }])("cannot complete on false revocation acknowledgement while exact grant readback remains: %j", async options => {
    const f = fixture(options);
    expect(await f.adapter.erase(actor, context())).toEqual({ status: "pending", remaining: "cleanup_pending" }); f.preserved();
    const saved = await f.store.transact([], tx => tx.scan<{ completed?: boolean }>("keycloak-cop-erasure:"));
    expect(saved).toHaveLength(1); expect(saved[0]?.value.completed).not.toBe(true);
  });
  it("keeps an outage or unproven exact client binding unavailable", async () => {
    const f = fixture({ outage: true }); expect(await f.adapter.ready()).toBe(false);
    expect(await f.adapter.preflight!(actor, context())).toEqual({ ready: false, reason: "adapter_unavailable" });
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("UNAVAILABLE");
    expect(f.calls.some(call => call.method === "DELETE")).toBe(false);
    const duplicate = fixture({ duplicateClient: true }); expect(await duplicate.adapter.ready()).toBe(false);
    await expect(duplicate.adapter.erase(actor, context())).rejects.toThrow("CLIENT_UNPROVEN");
    expect(duplicate.calls.some(call => call.method === "DELETE")).toBe(false);
  });
  it("does not claim preserved shared identity when the provider user disappears", async () => {
    const f = fixture(); f.state.get(actor.subjectId)!.present = false;
    expect(await f.adapter.preflight!(actor, context())).toEqual({ ready: false, reason: "adapter_unavailable" });
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("UNAVAILABLE");
    expect(f.calls.some(call => call.method === "DELETE")).toBe(false);
  });
  it("fails closed if COP fencing disappears after provider assessment and before the first mutation", async () => {
    const f = fixture(); f.fence.mockResolvedValueOnce(true).mockResolvedValue(false);
    expect(await f.adapter.erase(actor, context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(f.calls.some(call => call.method === "DELETE")).toBe(false); f.preserved();
  });
  it("does not substitute global management when scoped consent authority is insufficient", async () => {
    const f = fixture({ revokeForbidden: true });
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("REVOCATION_UNPROVEN");
    expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(1); f.preserved();
  });
  it("blocks new identity/client/grant generations after scoped completion instead of deleting a recreated grant", async () => {
    const f = fixture(); await f.adapter.erase(actor, context()); const count = f.calls.filter(call => call.method === "DELETE").length;
    f.state.get(actor.subjectId)!.consents.set("cop-web", { clientId: "cop-web", createdDate: 99 });
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("GRANTS_REAPPEARED");
    f.state.get(actor.subjectId)!.timestamp++;
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("IDENTITY_CHANGED");
    await expect(f.adapter.erase(actor, { ...context(), operationId: context(true).operationId })).rejects.toThrow("CONFLICT");
    expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(count); f.preserved();
  });
  it("rejects replacement of a reviewed target client UUID and newly granted roles on resume without further mutation", async () => {
    const f = fixture({ falseRoleAck: true }); await f.adapter.erase(actor, context());
    const count = f.calls.filter(call => call.method === "DELETE").length;
    f.state.get(actor.subjectId)!.roles["cop-web"].push({ ...role("cop-web"), id: "bd0e170f-2d48-4ef7-b2b8-9f7b1c9da973", name: "new-role" });
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("GRANTS_REAPPEARED");
    expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(count);
    f.changeClient();
    await expect(f.adapter.erase(actor, context())).rejects.toThrow("CLIENT_CHANGED");
    expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(count); f.preserved();
  });
  it("rechecks and revokes restored COP grants only after an explicitly advanced dataset binding", async () => {
    const f = fixture(), user = f.state.get(actor.subjectId)!;
    const original = { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 };
    const restored = { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 2 };
    const beforeB = structuredClone(f.state.get(actorB.subjectId));
    const initial = await f.adapter.erase(actor, { ...context(), datasetBinding: original });
    user.consents.set("cop-web", { clientId: "cop-web", createdDate: 10 });
    user.offline["cop-web"] = ["restored-offline-cop-web"];
    user.roles["cop-web"] = [role("cop-web")];
    const deletions = f.calls.filter(call => call.method === "DELETE").length;
    await expect(f.adapter.erase(actor, { ...context(), datasetBinding: original })).rejects.toThrow("GRANTS_REAPPEARED");
    expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(deletions);
    const result = await f.adapter.erase(actor, { ...context(), datasetBinding: restored });
    expect(result).toMatchObject({ status: "completed" });
    expect(result).not.toEqual(initial);
    expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(deletions + 2);
    expect(await f.adapter.erase(actor, { ...context(), datasetBinding: restored })).toEqual(result);
    expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(deletions + 2);
    expect(f.state.get(actorB.subjectId)).toEqual(beforeB);
    f.preserved();
  });
  it("denies missing, rewound or reused recovery binding before touching copied grants", async () => {
    const original = { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 };
    for (const datasetBinding of [undefined,
      { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 1 },
      { incarnationId: original.incarnationId, restoreGeneration: 2 },
      { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 0 }]) {
      const f = fixture();
      await f.adapter.erase(actor, { ...context(), datasetBinding: original });
      f.state.get(actor.subjectId)!.consents.set("cop-web", { clientId: "cop-web", createdDate: 10 });
      const count = f.calls.filter(call => call.method === "DELETE").length;
      await expect(f.adapter.erase(actor, { ...context(), datasetBinding })).rejects.toThrow("RECOVERY_BINDING_UNPROVEN");
      expect(f.calls.filter(call => call.method === "DELETE")).toHaveLength(count);
      f.preserved();
    }
  });
  it("does not adopt an unbound historical checkpoint or a replaced shared identity during restore", async () => {
    const datasetBinding = { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 2 };
    const unbound = fixture();
    await unbound.adapter.erase(actor, context());
    await expect(unbound.adapter.erase(actor, { ...context(), datasetBinding })).rejects.toThrow("RECOVERY_BINDING_UNPROVEN");
    const bound = fixture();
    await bound.adapter.erase(actor, { ...context(), datasetBinding: { ...datasetBinding, incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 } });
    bound.state.get(actor.subjectId)!.timestamp++;
    const count = bound.calls.filter(call => call.method === "DELETE").length;
    await expect(bound.adapter.erase(actor, { ...context(), datasetBinding })).rejects.toThrow("IDENTITY_CHANGED");
    expect(bound.calls.filter(call => call.method === "DELETE")).toHaveLength(count);
    unbound.preserved(); bound.preserved();
  });
  it("can prove scoped absence while keeping existing shared account, without destructive provider calls", async () => {
    const f = fixture(), user = f.state.get(actor.subjectId)!;
    user.consents.delete("cop-web"); user.consents.delete("csm-mobile");
    user.roles = { "cop-web": [], "csm-mobile": [] }; user.offline = { "cop-web": [], "csm-mobile": [] };
    expect(await f.adapter.erase(actor, context())).toMatchObject({ status: "completed" }); f.preserved();
    expect(f.calls.some(call => call.method === "DELETE")).toBe(false);
  });
});
