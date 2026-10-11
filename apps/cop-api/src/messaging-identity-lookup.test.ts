import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { CsmMessagingProvider } from "./messaging-provider.js";
import { validateIdentityLookup } from "./messaging-identity-lookup.js";
const now = new Date("2026-10-05T20:00:00Z");
const valid = () => ({contractVersion: "csm-messaging-identity-lookup-v1", providerId: "csm.messaging", status: "ready", warnings: [], actorUserId: "lab", conversationId: "room-1", matrixRoomId: "!room:matrix.test", identities: [{userId: "lab", matrixUserId: "@cop_actor_hash:matrix.test"}, {userId: "peer", matrixUserId: "@cop_peer_hash:matrix.test"}], unresolvedUserIds: [] as string[]});
const provider = () => new CsmMessagingProvider({baseUrl: "http://messaging.local:4050", enabled: true, cacheTtlMs: 1000, timeoutMs: 20, token: "synthetic-service-token"});
describe("conversation-scoped read-only identity lookup", () => {
  afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs();});
  it("validates scoped one-to-one stored pairs with an explicit short expiry", () => {
    expect(validateIdentityLookup(valid(), "lab", "room-1", now)).toMatchObject({validUntil: "2026-10-05T20:00:30.000Z", identities: valid().identities});
    const partial = valid(); partial.identities.pop(); partial.unresolvedUserIds.push("peer");
    expect(validateIdentityLookup(partial, "lab", "room-1", now)?.unresolvedUserIds).toEqual(["peer"]);
  });
  it("rejects identity/room/contract conflicts, duplicates, secrets and guessed aliases", () => {
    const cases = [ {...valid(),actorUserId:"wrong"}, {...valid(),conversationId:"other"}, {...valid(),contractVersion:"cop-messaging-identities-v1"}, {...valid(),warnings:["degraded"]}, {...valid(),accessToken:"must-not-forward"}, {...valid(),unresolvedUserIds:["peer"]}, {...valid(),identities:[valid().identities[0],{userId:"peer",matrixUserId:valid().identities[0]!.matrixUserId}]}, {...valid(),identities:[{userId:"lab",matrixUserId:"cop_guess"}]} ];
    for (const value of cases) expect(validateIdentityLookup(value, "lab", "room-1", now)).toBeUndefined();
  });
  it("authenticates before forwarding and forbids browser identity overrides", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab"); vi.stubEnv("COP_LAB_TOKEN", "synthetic-lab-token");
    const fetch = vi.fn(async () => new Response(JSON.stringify(valid()), {status: 200})); vi.stubGlobal("fetch", fetch);
    const app = buildServer({messagingProvider: provider(), now: () => now});
    try {
      const url = "/api/v1/messaging/matrix/identities/lookup";
      expect((await app.inject({method:"POST",url,payload:{conversationId:"room-1"}})).statusCode).toBe(401);
      for (const payload of [{conversationId:"room-1",userIds:["other"]},{conversationId:"room-1",actorUserId:"other"},{conversationId:" room-1"},{conversationId:"room-1",content:"private"}]) expect((await app.inject({method:"POST",url,payload,headers:{authorization:"Bearer synthetic-lab-token"}})).statusCode).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
      const response = await app.inject({method:"POST",url,payload:{conversationId:"room-1"},headers:{authorization:"Bearer synthetic-lab-token","x-csm-user-id":"wrong"}});
      expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store"); expect(response.json().actorUserId).toBe("lab");
      expect(fetch).toHaveBeenCalledTimes(1);
      const [target,options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
      expect(target.pathname).toBe("/api/v1/matrix/identities/lookup"); expect(options.method).toBe("POST"); expect(JSON.parse(options.body as string)).toEqual({conversationId:"room-1"}); expect((options.headers as Record<string,string>)["x-csm-user-id"]).toBe("lab");
    } finally {await app.close();}
  });
  it("keeps nonmembership/notfound distinct from service failure without a provisioning fallback", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const status of [403,404,500,503]) {fetch.mockResolvedValueOnce(new Response("{}",{status})); expect((await provider().lookupMatrixIdentities({subjectId:"lab",displayName:"A",username:"a",authMode:"lab",roles:[]},now,"room-1")).statusCode).toBe(status===403||status===404?status:503);}
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({...valid(), actorUserId:"wrong"}),{status:200})); expect((await provider().lookupMatrixIdentities({subjectId:"lab",displayName:"A",username:"a",authMode:"lab",roles:[]},now,"room-1")).statusCode).toBe(503);
    fetch.mockRejectedValueOnce(new Error("network failure")); expect((await provider().lookupMatrixIdentities({subjectId:"lab",displayName:"A",username:"a",authMode:"lab",roles:[]},now,"room-1")).statusCode).toBe(503);
    expect(fetch.mock.calls.every(([url]) => (url as URL).pathname.endsWith("/lookup"))).toBe(true);
  });
});
