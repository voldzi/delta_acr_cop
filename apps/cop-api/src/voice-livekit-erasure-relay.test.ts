import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import { MessagingLiveKitErasureProvider } from "./voice-livekit-erasure-relay.js";

const a = "af004565-6cbe-46c3-9ab1-cd9f9884de19", b = "bf004565-6cbe-46c3-9ab1-cd9f9884de19";
const operationId = "df004565-6cbe-46c3-9ab1-cd9f9884de19", issuer = "https://identity.synthetic.test/realms/cop";
const room = "cop-call-cf004565-6cbe-46c3-9ab1-cd9f9884de19", signal = new AbortController().signal;
const options = { baseUrl: "https://messaging.synthetic.test", serviceToken: "synthetic-service-only", issuer, apiKey: "synthetic-livekit-key", apiSecret: "synthetic-livekit-secret-not-real" };
afterEach(() => vi.restoreAllMocks());
function upstream() {
  const members = new Set([a,b]), calls: Array<{ action: string; owner: string | null; operationId?: string }> = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (resource, init) => {
    expect(String(resource)).toBe("https://messaging.synthetic.test/api/v1/communication/voice-erasure");
    const headers = new Headers(init?.headers), body = JSON.parse(String(init?.body)) as Record<string, string>;
    expect(headers.get("authorization")).toBe("Bearer synthetic-service-only");
    expect(body.contractVersion).toBe("cop-livekit-erasure-v1");
    expect(init?.redirect).toBe("error");
    // Verify the real SDK signature/expiry/grants without storing any token.
    const claims = await new TokenVerifier(options.apiKey,options.apiSecret).verify(headers.get("x-cop-livekit-grant")!);
    expect(Number(claims.exp)-Number(claims.nbf)).toBeLessThanOrEqual(30);
    expect(Number(claims.exp)-Math.floor(Date.now()/1000)).toBeGreaterThanOrEqual(29);
    if (["probe","list_rooms","room_exists"].includes(body.action!)) {
      expect(claims.video?.roomList).toBe(true); expect(claims.video?.roomAdmin).toBeUndefined();
    } else { expect(claims.video?.roomAdmin).toBe(true); expect(claims.video?.room).toBe(room); }
    const owner = headers.get("x-csm-user-id");
    calls.push({ action: body.action!, owner, ...(body.operationId ? { operationId: body.operationId } : {}) });
    expect(String(init?.body)).not.toContain(options.apiSecret); expect(String(init?.body)).not.toContain(options.serviceToken);
    if (body.action === "probe") return Response.json({ contractVersion: body.contractVersion, ready: true });
    expect(body.operationId).toBe(operationId); expect(headers.get("x-csm-oidc-issuer")).toBe(issuer);
    if (body.action === "list_rooms" || body.action === "room_exists") return Response.json({ contractVersion: body.contractVersion, roomNames: [room] });
    expect(body.roomName).toBe(room);
    if (body.action === "remove_self") members.delete(owner!);
    return Response.json({ contractVersion: body.contractVersion, subjectPresent: members.has(owner!) });
  });
  return { members, calls, spy, provider: new MessagingLiveKitErasureProvider(options) };
}
describe("server-only scoped LiveKit erasure relay", () => {
  it("uses signed thirty-second grants and preserves the other account", async () => {
    const fixture = upstream();
    expect(await fixture.provider.ready(signal)).toBe(true);
    expect(await fixture.provider.removeAndVerify(a,[room],signal,{ issuer,operationId })).toBe(true);
    expect(fixture.members).toEqual(new Set([b]));
    expect(fixture.calls.filter(call => call.action === "remove_self")).toEqual([{ action: "remove_self", owner: a, operationId }]);
    expect(fixture.calls[0]).toEqual({ action: "probe", owner: null });
  });
  it("derives B independently instead of reusing A's actor", async () => {
    const fixture = upstream();
    expect(await fixture.provider.removeAndVerify(b,[room],signal,{ issuer,operationId })).toBe(true);
    expect(fixture.members).toEqual(new Set([a]));
    expect(fixture.calls.filter(call => call.action === "remove_self")).toEqual([{ action: "remove_self", owner: b, operationId }]);
  });
  it("rejects missing/foreign actor binding and foreign rooms before contacting any provider", async () => {
    const { provider,spy } = upstream();
    await expect(provider.removeAndVerify(a,[room],signal)).rejects.toThrow("Bound voice");
    await expect(provider.removeAndVerify(a,[room],signal,{ issuer: "https://foreign.test",operationId })).rejects.toThrow("Bound voice");
    await expect(provider.removeAndVerify("not-a-verified-uuid",[room],signal,{ issuer,operationId })).rejects.toThrow("Bound voice");
    await expect(provider.removeAndVerify(a,["foreign-room"],signal,{ issuer,operationId })).rejects.toThrow("Unproven COP room");
    expect(spy).not.toHaveBeenCalled();
  });
  it.each([401,409,429,503])("fails closed on HTTP %s, with no direct admin fallback", async status => {
    const spy = vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({ error: { code: "SYNTHETIC" } },{ status }));
    const provider = new MessagingLiveKitErasureProvider(options);
    expect(await provider.ready(signal)).toBe(false);
    await expect(provider.removeAndVerify(a,[room],signal,{ issuer,operationId })).rejects.toThrow("VOICE_RELAY_UNAVAILABLE");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.every(([url]) => String(url) === "https://messaging.synthetic.test/api/v1/communication/voice-erasure")).toBe(true);
  });
  it("rejects ambiguous or foreign response content and cancellation", async () => {
    const spy = vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({ contractVersion: "cop-livekit-erasure-v1", ready: true, privateContext: "forbidden" }));
    const provider = new MessagingLiveKitErasureProvider(options);
    expect(await provider.ready(signal)).toBe(false);
    spy.mockResolvedValue(Response.json({ contractVersion: "cop-livekit-erasure-v1", roomNames: ["foreign-room"] }));
    await expect(provider.removeAndVerify(a,[room],signal,{ issuer,operationId })).rejects.toThrow("RESPONSE_UNPROVEN");
    spy.mockClear(); const controller = new AbortController(); controller.abort();
    expect(await provider.ready(controller.signal)).toBe(false); expect(spy).not.toHaveBeenCalled();
  });
  it("requires explicit HTTPS and server-owned credentials", () => {
    expect(() => new MessagingLiveKitErasureProvider({ ...options,baseUrl: "http://messaging.synthetic.test" })).toThrow("Trusted HTTPS");
    expect(() => new MessagingLiveKitErasureProvider({ ...options,baseUrl: "https://messaging.synthetic.test/arbitrary" })).toThrow("Trusted HTTPS");
    expect(() => new MessagingLiveKitErasureProvider({ ...options,serviceToken: "" })).toThrow("Trusted HTTPS");
  });
});
