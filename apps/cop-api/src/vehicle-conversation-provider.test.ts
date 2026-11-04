import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpVehicleConversationProvider, type ManagedVehiclePlan } from "./vehicle-conversation-provider.js";

const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
const vehicleId = "00000000-0000-4000-8000-000000000003", operationId = "00000000-0000-4000-8000-000000000004";
const actor = { authMode: "oidc" as const, issuer: "https://synthetic.example/realms/cop", subjectId: a, username: "synthetic", displayName: "Syntetický A", roles: [] };
const config = { enabled: true, authorityMode: "database_v2" as const, token: "isolated-service-token", baseUrl: "https://messaging.synthetic.test", cacheTtlMs: 0, timeoutMs: 1000 };
const plan: ManagedVehiclePlan = { operationId, expectedMembershipRevision: 1, membershipRevision: 2, recipientEpoch: 2, phase: "reconcile" };
const members = [{ accountId: a, userId: a }, { accountId: b, userId: b }];
const now = () => new Date("2026-11-04T10:00:00.000Z");
function proof() { return { contractVersion: "csm-managed-vehicle-conversation-v1", state: "ready", vehicleId,
  membershipRevision: 2, recipientEpoch: 2, operationId, conversationId: `conv_vehicle_${vehicleId}`, roomId: "!current:synthetic.test", roomGeneration: 2,
  memberAccountIds: [a, b], joinedAccountIds: [a], retiredRoomIds: ["!old:synthetic.test"], retirementVerified: true,
  encrypted: true, historyPolicy: "from_membership", membershipAuthority: "cop_vehicle", roomMembershipVerified: true,
  notificationAudienceVerified: true, clientMembershipChangesDenied: true, revocation: "server_enforced" }; }
afterEach(() => vi.unstubAllGlobals());
describe("internal managed vehicle provider", () => {
  it("uses only the fixed internal service path, server token and derived actor/roster", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(proof()))); vi.stubGlobal("fetch", fetcher);
    const provider = new HttpVehicleConversationProvider(config, now);
    const result = await provider.synchronize(actor, vehicleId, { ...plan, ignoredContext: "never forwarded" } as ManagedVehiclePlan,
      [...members].reverse().map(m => ({ ...m, ignoredPrivateText: "never forwarded" })));
    expect(result.state).toBe("ready");
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url.toString()).toBe(`https://messaging.synthetic.test/api/v1/managed-vehicle-conversations/${vehicleId}/membership`);
    expect(request.method).toBe("PUT"); expect(request.redirect).toBe("error");
    expect(request.headers).toMatchObject({ Authorization: "Bearer isolated-service-token", "x-csm-user-id": a, "x-csm-oidc-issuer": actor.issuer });
    const body = JSON.parse(request.body);
    expect(body).toEqual({ contractVersion: "csm-managed-vehicle-membership-v1", ...plan, members });
    expect(request.body).not.toContain("ignored"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a non-session identity before any request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(new HttpVehicleConversationProvider(config, now).snapshot({ ...actor, subjectId: "chosen-client-identity" }, vehicleId)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500, 503])("treats internal HTTP %s as unavailable without a fallback", async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "internal-only" } }), { status })); vi.stubGlobal("fetch", fetcher);
    await expect(new HttpVehicleConversationProvider(config, now).synchronize(actor, vehicleId, plan, members)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not confuse pending provider work with joined membership or a receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ contractVersion: "csm-managed-vehicle-conversation-v1", state: "pending", confirmed: false }), { status: 202 })));
    expect(await new HttpVehicleConversationProvider(config, now).synchronize(actor, vehicleId, plan, members)).toEqual({ state: "pending" });
  });
  it.each([
    { memberAccountIds: [a] }, { joinedAccountIds: [vehicleId] }, { notificationAudienceVerified: false },
    { membershipRevision: 1 }, { recipientEpoch: 1 }, { operationId: vehicleId }, { vehicleId: operationId },
    { state: "revocation_enforced" }, { contractVersion: "legacy" }, { roomId: "unbound" }
  ])("rejects mismatched or incomplete server evidence %j", async change => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...proof(), ...change }))));
    await expect(new HttpVehicleConversationProvider(config, now).synchronize(actor, vehicleId, plan, members)).rejects.toMatchObject({ status: 503 });
  });
  it("bounds the response body even when its Content-Length is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(256 * 1024 + 1))));
    await expect(new HttpVehicleConversationProvider(config, now).snapshot(actor, vehicleId)).rejects.toMatchObject({ status: 503 });
  });
  it("never treats a wrong-token capability or an old contract as ready", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true, ready: true, contractVersion: "legacy" }))));
    expect(await new HttpVehicleConversationProvider(config, now).ready(actor)).toBe(false);
  });
  it("closes only an existing server-selected vehicle purpose without impersonating a human", async () => {
    const closed = { contractVersion: "csm-managed-vehicle-closed-v1", state: "closed", confirmed: true,
      vehicleId, operationId, membershipRevision: 2, recipientEpoch: 2, conversationId: `conv_vehicle_${vehicleId}`,
      roomId: "!current:synthetic.test", roomMembershipVerified: true, notificationAudienceVerified: true };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(closed))); vi.stubGlobal("fetch", fetcher);
    expect(await new HttpVehicleConversationProvider(config, now, actor.issuer).close(vehicleId, { ...plan, phase: "remove_only" })).toMatchObject({ operationId });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url.toString()).toBe(`https://messaging.synthetic.test/api/v1/managed-vehicle-conversations/${vehicleId}/close`);
    expect(request.headers["x-csm-managed-purpose"]).toBe("closed_vehicle");
    expect(request.headers["x-csm-oidc-issuer"]).toBe(actor.issuer);
    expect(request.headers["x-csm-user-id"]).toBeUndefined();
    expect(JSON.parse(request.body)).toEqual({ contractVersion: "csm-managed-vehicle-close-v1", operationId,
      expectedMembershipRevision: 1, membershipRevision: 2, recipientEpoch: 2 });
  });
  it("cannot use closure as a new grant or without pinned machine issuer", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(new HttpVehicleConversationProvider(config, now, actor.issuer).close(vehicleId, plan)).rejects.toMatchObject({ status: 503 });
    await expect(new HttpVehicleConversationProvider(config, now).close(vehicleId, { ...plan, phase: "remove_only" })).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

});
