import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { JoinRequest, JoinResponse, LeaveRequest, ParticipantInfo, ReconnectResponse, Room, SignalResponse, WrappedJoinRequest, WrappedJoinRequest_Compression } from "@livekit/protocol";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { request as httpRequest } from "node:http";
import { MemoryMobilityStore, type MobilityTransaction } from "./mobility-store.js";
import { VoiceGrantLedger, VOICE_GRANT_IDENTITY_PREFIX, type VoiceScopedGrant } from "./voice-grant-ledger.js";
import { buildVoiceAdmissionGate, VOICE_GATEWAY_PENDING_PREFIX, type VoiceAdmissionGateOptions, type VoiceGatewayProvider } from "./voice-admission-gate.js";
import type { AuthenticatedActor } from "./security.js";
import { PostgresVoiceGatewayOwner } from "./voice-admission-main.js";
import { VOICE_REVOCATION_CONTROL_ROOM } from "./voice-grant-revocation.js";

const apiKey = "synthetic-livekit-key", apiSecret = "synthetic-livekit-secret-over-32-characters";
const issuer = "https://identity.synthetic.test/realms/cop", clientId = "jizda-mobile";
const actor = (subjectId = "synthetic-user-A"): AuthenticatedActor => ({ authMode: "oidc", subjectId, username: subjectId,
  displayName: subjectId, roles: [], issuer, authorizedParty: clientId });
const apps = new Set<FastifyInstance>();
afterEach(async () => { for (const app of apps) await app.close(); apps.clear(); });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(options: Partial<VoiceAdmissionGateOptions> & { first?: "join" | "leave" | "reconnect" | "wrongIdentity" | "wrongRoom" | "none";
  delay?: Promise<void>; store?: MemoryMobilityStore } = {}) {
  const store = options.store ?? new MemoryMobilityStore();
  const ledger = new VoiceGrantLedger({ store, issuer, clientId, identitySecret: apiSecret });
  const owner = actor(), install = randomUUID(), callId = randomUUID(), room = "cop-call-" + callId;
  await ledger.attestInstallation(owner, install, new Date());
  const backend = Fastify({ logger: false }); apps.add(backend); await backend.register(websocket);
  const observed: Array<{ url: string; authorization: string | undefined; clientHeader: unknown }> = [];
  const dispatched = deferred<void>();
  for (const path of ["/rtc", "/rtc/v1", "/rtc/validate", "/rtc/v1/validate"]) backend.route({ method: "GET", url: path,
    handler: (request, reply) => { observed.push({ url: request.url, authorization: request.headers.authorization, clientHeader: request.headers["x-client-owned"] }); return reply.send("ok"); },
    wsHandler: (socket, request) => {
      observed.push({ url: request.url, authorization: request.headers.authorization, clientHeader: request.headers["x-client-owned"] });
      dispatched.resolve();
      socket.on("error", () => undefined);
      void (async () => {
        const claims = await new TokenVerifier(apiKey, apiSecret).verify(request.headers.authorization!.slice(7));
        await options.delay;
        if (options.first === "none" || socket.readyState !== 1) return;
        let response: SignalResponse;
        if (options.first === "leave") response = new SignalResponse({ message: { case: "leave", value: new LeaveRequest() } });
        else if (options.first === "reconnect") response = new SignalResponse({ message: { case: "reconnect", value: new ReconnectResponse() } });
        else response = new SignalResponse({ message: { case: "join", value: new JoinResponse({
          room: new Room({ name: options.first === "wrongRoom" ? "other-room" : claims.video!.room }),
          participant: new ParticipantInfo({ identity: options.first === "wrongIdentity" ? "other-identity" : claims.sub! }) }) } });
        socket.send(response.toBinary());
      })().catch(() => socket.terminate());
    }
  });
  const backendUrl = await backend.listen({ host: "127.0.0.1", port: 0 });
  const provider: VoiceGatewayProvider = options.provider ?? { removeParticipant: vi.fn(async () => undefined), listParticipants: vi.fn(async () => []) };
  const gateOptions = { ledger, apiKey, apiSecret, backendUrl, provider, owner: { assertOwned: async () => undefined },
    acceptedTopology: true, singleConnectAttemptVerified: true, handshakeTimeoutMs: 150, ...options };
  const gate = await buildVoiceAdmissionGate(gateOptions); apps.add(gate); await gate.ready();
  const grant = await ledger.issueGrant(owner, install, callId, room, new Date());
  async function token(identity = grant.identity, tokenRoom = room, secret = apiSecret) {
    const access = new AccessToken(apiKey, secret, { identity, ttl: 600 }); access.addGrant({ roomJoin: true, room: tokenRoom }); return access.toJwt();
  }
  async function connect(path = "/rtc", params = "", bearer?: string) {
    const first = deferred<SignalResponse>();
    const socket = await gate.injectWS(path + "?access_token=" + (bearer ?? await token()) + params, {}, { onInit: socket => {
      socket.on("message", (data: Buffer) => { first.resolve(SignalResponse.fromBinary(data)); }); socket.on("error", () => undefined);
    } });
    return { socket, first: first.promise };
  }
  async function revoke(input?: { operationId: string; grants: Array<{ identity: string; room: string }> }, hashBody?: unknown) {
    const body = input ?? { operationId: randomUUID(), grants: [{ identity: grant.identity, room }] };
    const access = new AccessToken(apiKey, apiSecret, { ttl: 30, metadata: createHash("sha256").update(JSON.stringify(hashBody ?? body)).digest("hex") });
    access.addGrant({ roomAdmin: true, room: VOICE_REVOCATION_CONTROL_ROOM });
    return gate.inject({ method: "POST", url: "/internal/voice-grants/revoke", headers: { authorization: "Bearer " + await access.toJwt() }, payload: body });
  }
  return { store, ledger, owner, install, room, grant, token, gate, connect, revoke, observed, dispatched, provider, gateOptions };
}

describe("LiveKit scoped signaling admission", () => {
  it("guards all four routes with signed authority and removes query credentials before backend forwarding", async () => {
    const f = await fixture();
    for (const path of ["/rtc", "/rtc/v1", "/rtc/validate", "/rtc/v1/validate"]) {
      const missing = await f.gate.inject({ url: path }); expect(missing.statusCode).toBe(401);
      const invalid = await f.gate.inject({ url: path + "?access_token=" + await f.token(f.grant.identity, f.room, "synthetic-wrong-secret-32-characters") }); expect(invalid.statusCode).toBe(401);
    }
    for (const path of ["/rtc/validate", "/rtc/v1/validate"]) {
      const response = await f.gate.inject({ url: path + "?access_token=" + await f.token(), headers: { "x-client-owned": "fake-owner" } }); expect(response.statusCode).toBe(200);
    }
    for (const path of ["/rtc", "/rtc/v1"]) { const c = await f.connect(path); await c.first; c.socket.terminate(); }
    expect(f.observed).toHaveLength(4);
    for (const request of f.observed) { expect(request.url).not.toContain("access_token"); expect(request.authorization).toMatch(/^Bearer /u); expect(request.clientHeader).toBeUndefined(); }
    expect((await f.gate.inject({ url: "/whip/v1?access_token=" + await f.token() })).statusCode).toBe(404);
  });
  it("treats original and server-refreshed JWTs as the same immutable ledger grant", async () => {
    const f = await fixture();
    const original = await f.token(), refreshed = new AccessToken(apiKey, apiSecret, { identity: f.grant.identity, ttl: 3600, metadata: "server-refreshed-metadata" });
    refreshed.addGrant({ roomJoin: true, room: f.room }); const refreshedJwt = await refreshed.toJwt(); expect(refreshedJwt).not.toBe(original);
    for (const bearer of [original, refreshedJwt]) { const c = await f.connect("/rtc", "", bearer); expect((await c.first).message.case).toBe("join"); c.socket.terminate(); }
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date());
    for (const bearer of [original, refreshedJwt]) expect((await f.gate.inject({ url: "/rtc/validate?access_token=" + bearer })).statusCode).toBe(403);
  });
  it("never forwards an absolute-form target or protocol-relative origin with the bearer", async () => {
    const f = await fixture(), address = new URL(await f.gate.listen({ host: "127.0.0.1", port: 0 }));
    for (const path of ["http://attacker.synthetic.test/rtc/validate", "//attacker.synthetic.test/rtc/validate"]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest({ hostname: address.hostname, port: address.port, method: "GET", path: path + "?access_token=" + "synthetic-untrusted-token" }, response => { response.resume(); resolve(response.statusCode); });
        request.on("error", reject); request.end();
      });
      expect([400, 404]).toContain(status);
    }
    expect(f.observed).toHaveLength(0);
  });
  it("rejects forged scoped subject, wrong room, changed query room and publish suffixes", async () => {
    const f = await fixture();
    for (const query of ["?access_token=" + await f.token(VOICE_GRANT_IDENTITY_PREFIX + randomUUID()), "?access_token=" + await f.token(f.grant.identity, "other-room"),
      "?access_token=" + await f.token() + "&room=other-room", "?access_token=" + await f.token() + "&publish=evil", "?access_token=" + await f.token() + "&publish="]) {
      expect((await f.gate.inject({ url: "/rtc/validate" + query })).statusCode).toBe(403);
    }
    expect(f.observed).toHaveLength(0);
  });
  it("rejects ambiguous token sources, duplicate room and malformed compressed v1 requests", async () => {
    const f = await fixture(), token = await f.token();
    for (const query of ["?access_token=" + token + "&access_token=" + token, "?access_token=" + token + "&room=" + f.room + "&room=" + f.room,
      "?access_token=" + token + "&join_request=not_valid-protobuf", "?access_token=" + token + "&join_request=A&join_request=B"]) {
      expect([400, 401, 403]).toContain((await f.gate.inject({ url: "/rtc/v1/validate" + query })).statusCode);
    }
    expect((await f.gate.inject({ url: "/rtc/validate?access_token=" + token, headers: { authorization: "Bearer " + token } })).statusCode).toBe(401);
    expect(f.observed).toHaveLength(0);
  });
  it("accepts bounded compressed modern reconnect only with positively acknowledged ReconnectResponse", async () => {
    const f = await fixture({ first: "reconnect" });
    const join = new WrappedJoinRequest({ compression: WrappedJoinRequest_Compression.GZIP, joinRequest: gzipSync(new JoinRequest({ reconnect: true }).toBinary()) });
    const c = await f.connect("/rtc/v1", "&join_request=" + Buffer.from(join.toBinary()).toString("base64url"));
    expect((await c.first).message.case).toBe("reconnect");
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date());
    const response = await f.revoke(); expect(response.statusCode).toBe(200); expect(response.json().providerVerified).toBe(true);
  });
  it.each(["leave", "wrongIdentity", "wrongRoom", "reconnect"] as const)("never treats 101/%s first frame as a successful fresh join", async first => {
    const f = await fixture({ first }); const c = await f.connect(); const closed = deferred<void>(); c.socket.on("close", () => closed.resolve()); await closed.promise;
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date());
    const response = await f.revoke(); expect(response.statusCode).toBe(200); expect(response.json().providerVerified).toBe(false);
    expect(f.provider.removeParticipant).not.toHaveBeenCalled();
  });
  it("does not disturb signed nonreserved legacy identities or manufacture their scoped ownership", async () => {
    const f = await fixture(); const c = await f.connect("/rtc", "&publish=legacy", await f.token("legacy-shared-subject"));
    expect((await c.first).message.case).toBe("join");
    expect(await f.store.transact([], tx => tx.scan(VOICE_GATEWAY_PENDING_PREFIX))).toHaveLength(0);
    expect(f.observed[0]?.url).toContain("publish=legacy"); c.socket.terminate();
  });
  it("denies new joins on owner/store outage using sanitized 503", async () => {
    let unavailable = false;
    const f = await fixture({ owner: { assertOwned: async () => { if (unavailable) throw new Error("raw-secret-dsn"); } } }); unavailable = true;
    const response = await f.gate.inject({ url: "/rtc/validate?access_token=" + await f.token() });
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain("raw-secret"); expect(f.observed).toHaveLength(0);
  });
  it("does not dispatch after shutdown while ledger admission is suspended", async () => {
    const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
    const original = f.ledger.assertAdmission.bind(f.ledger); let calls = 0;
    vi.spyOn(f.ledger, "assertAdmission").mockImplementation(async (...args) => { if (++calls === 2) { entered.resolve(); await release.promise; } return original(...args); });
    const c = await f.connect(); await entered.promise;
    await f.gate.close(); apps.delete(f.gate); release.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.observed).toHaveLength(0); expect(c.socket.readyState).toBe(3);
    expect(await f.store.transact([], tx => tx.scan(VOICE_GATEWAY_PENDING_PREFIX))).toHaveLength(0);
  });
  it("bounds all waiting websocket admissions while the first ledger request is suspended", async () => {
    const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
    const original = f.ledger.assertAdmission.bind(f.ledger); let calls = 0;
    vi.spyOn(f.ledger, "assertAdmission").mockImplementation(async (...args) => { if (++calls === 2) { entered.resolve(); await release.promise; } return original(...args); });
    const bearer = await f.token(), connections = [await f.connect("/rtc", "", bearer)]; await entered.promise;
    for (let index = 1; index <= 256; index++) connections.push(await f.connect("/rtc", "", bearer));
    await vi.waitFor(() => expect(connections[256]!.socket.readyState).toBe(3));
    expect(connections.slice(0, 256).every(connection => connection.socket.readyState === 1)).toBe(true);
    await f.gate.close(); apps.delete(f.gate); release.resolve(); await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.observed).toHaveLength(0); expect(connections.every(connection => connection.socket.readyState === 3)).toBe(true);
  });
});

describe("scoped provider revocation evidence", () => {
  it("requires durable fence and body-bound short-lived service JWT before provider deletion", async () => {
    const f = await fixture(); expect((await f.revoke()).statusCode).toBe(409);
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date());
    expect((await f.revoke(undefined, { different: "body" })).statusCode).toBe(401);
    expect((await f.revoke({ operationId: randomUUID(), grants: [{ identity: f.grant.identity, room: "cop-call-" + randomUUID() }] })).statusCode).toBe(409);
    expect(f.provider.removeParticipant).not.toHaveBeenCalled();
  });
  it("drains an in-flight late successful join after fence, selectively evicts and denies all rejoin routes", async () => {
    const delay = deferred<void>(), f = await fixture({ delay: delay.promise, handshakeTimeoutMs: 1500 });
    const c = await f.connect(); await f.dispatched.promise;
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date());
    const closed = deferred<void>(); c.socket.on("close", () => closed.resolve());
    const response = f.revoke(); await closed.promise; expect(f.provider.removeParticipant).not.toHaveBeenCalled(); delay.resolve();
    const result = await response; expect(result.statusCode).toBe(200); expect(result.json().providerVerified).toBe(true);
    expect(f.provider.removeParticipant).toHaveBeenCalledExactlyOnceWith(f.room, f.grant.identity);
    expect(f.provider.listParticipants).toHaveBeenCalledExactlyOnceWith(f.room);
    for (const path of ["/rtc", "/rtc/v1", "/rtc/validate", "/rtc/v1/validate"]) expect((await f.gate.inject({ url: path + "?access_token=" + await f.token() })).statusCode).toBe(403);
    c.socket.terminate();
  });
  it("keeps timed-out dispatched admission unresolved across restart despite empty provider inventory", async () => {
    const f = await fixture({ first: "none", handshakeTimeoutMs: 30 }); const c = await f.connect();
    const closed = deferred<void>(); c.socket.on("close", () => closed.resolve()); await closed.promise;
    await f.gate.close(); apps.delete(f.gate);
    const restarted = await buildVoiceAdmissionGate(f.gateOptions); apps.add(restarted); await restarted.ready();
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date());
    // Use the restarted control endpoint; original gate's helper only mints the request.
    const body = { operationId: randomUUID(), grants: [{ identity: f.grant.identity, room: f.room }] };
    const access = new AccessToken(apiKey, apiSecret, { ttl: 30, metadata: createHash("sha256").update(JSON.stringify(body)).digest("hex") }); access.addGrant({ roomAdmin: true, room: VOICE_REVOCATION_CONTROL_ROOM });
    const response = await restarted.inject({ method: "POST", url: "/internal/voice-grants/revoke", payload: body, headers: { authorization: "Bearer " + await access.toJwt() } });
    expect(response.statusCode).toBe(200); expect(response.json().providerVerified).toBe(false); expect(f.provider.removeParticipant).not.toHaveBeenCalled();
    const rows = await f.store.transact([], tx => tx.scan<{ state: string }>(VOICE_GATEWAY_PENDING_PREFIX)); expect(rows[0]?.value.state).toBe("dispatched");
  });
  it("cannot clear pending uncertainty when acknowledgement persistence fails", async () => {
    class AckFailStore extends MemoryMobilityStore {
      override transact<T>(keys: string[], action: (tx: MobilityTransaction) => Promise<T>): Promise<T> {
        return super.transact(keys, tx => action({ ...tx, set: async (key, value) => {
          if (key.startsWith(VOICE_GATEWAY_PENDING_PREFIX) && (value as { state?: string }).state === "acknowledged") throw new Error("synthetic-ack-write-failure");
          await tx.set(key, value);
        } }));
      }
    }
    const f = await fixture({ store: new AckFailStore() }); const c = await f.connect(); const closed = deferred<void>(); c.socket.on("close", () => closed.resolve()); await closed.promise;
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date()); expect((await f.revoke()).json().providerVerified).toBe(false);
    expect(f.provider.removeParticipant).not.toHaveBeenCalled();
  });
  it.each([false, true])("does not prove deletion with unaccepted topology/single-attempt=%s", async accepted => {
    const f = await fixture({ acceptedTopology: accepted, singleConnectAttemptVerified: !accepted });
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date()); const response = await f.revoke();
    expect(response.json().providerVerified).toBe(false); expect(f.provider.removeParticipant).not.toHaveBeenCalled();
  });
  it("returns503 for failed removal, including404, rather than converting empty readback to completion", async () => {
    const removeParticipant = vi.fn(async () => { throw Object.assign(new Error("raw-provider-secret"), { status: 404 }); });
    const f = await fixture({ provider: { removeParticipant, listParticipants: vi.fn(async () => []) } });
    const c = await f.connect(); await c.first; c.socket.terminate();
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date()); const response = await f.revoke();
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain("raw-provider-secret"); expect(f.provider.listParticipants).not.toHaveBeenCalled();
  });
  it("checks actual participant absence and preserves unrelated participants/accounts", async () => {
    let stillPresent = true;
    const removeParticipant = vi.fn(async (_room: string, _identity: string) => undefined), listParticipants = vi.fn(async () => [
      { identity: "legacy-shared-user" }, ...(stillPresent ? [{ identity: f.grant.identity }] : [])]);
    const f = await fixture({ provider: { removeParticipant, listParticipants } });
    const c = await f.connect(); await c.first; c.socket.terminate();
    const second = actor("synthetic-user-B"), secondInstall = randomUUID();
    await f.ledger.attestInstallation(second, secondInstall, new Date()); const secondGrant = await f.ledger.issueGrant(second, secondInstall, randomUUID(), f.room, new Date());
    await f.ledger.revokeInstallation(f.owner, f.install, randomUUID(), new Date()); expect((await f.revoke()).json().providerVerified).toBe(false);
    stillPresent = false; expect((await f.revoke()).json().providerVerified).toBe(true);
    expect(await f.ledger.assertAdmission(secondGrant.identity, f.room, new Date())).toMatchObject({ identity: secondGrant.identity });
    expect(removeParticipant.mock.calls.every(args => args[1] === f.grant.identity)).toBe(true);
  });
  it("reuses only persisted per-grant provider proof after partial failure, preserving idempotent cleanup", async () => {
    const removed = new Set<string>(); let failing = true; let second: VoiceScopedGrant;
    const removeParticipant = vi.fn(async (_room: string, identity: string) => {
      if (removed.has(identity)) throw Object.assign(new Error("already removed"), { status: 404 });
      if (identity === second.identity && failing) throw new Error("synthetic-provider-outage");
      removed.add(identity);
    });
    const f = await fixture({ provider: { removeParticipant, listParticipants: async () => [] } });
    second = await f.ledger.issueGrant(f.owner, f.install, randomUUID(), "cop-call-" + randomUUID(), new Date());
    const firstConnection = await f.connect(); await firstConnection.first;
    const secondConnection = await f.connect("/rtc", "", await f.token(second.identity, second.room)); await secondConnection.first;
    firstConnection.socket.terminate(); secondConnection.socket.terminate();
    const operationId = randomUUID(); await f.ledger.revokeInstallation(f.owner, f.install, operationId, new Date());
    const body = { operationId, grants: [{ identity: f.grant.identity, room: f.room }, { identity: second.identity, room: second.room }] };
    expect((await f.revoke(body)).statusCode).toBe(503); expect(removed.has(f.grant.identity)).toBe(true); expect(removed.has(second.identity)).toBe(false);
    failing = false; const retry = await f.revoke(body); expect(retry.statusCode).toBe(200); expect(retry.json().providerVerified).toBe(true);
    expect(removeParticipant.mock.calls.filter(args => args[1] === f.grant.identity)).toHaveLength(1);
    expect((await f.revoke(body)).json().providerVerified).toBe(true); expect(removeParticipant).toHaveBeenCalledTimes(3);
  });
  it("proves never-connected only for canonical grants issued within the current accepted ingress epoch", async () => {
    const removeParticipant = vi.fn(async () => { throw Object.assign(new Error("not-found"), { status: 404 }); });
    const listParticipants = vi.fn(async () => []), f = await fixture({ provider: { removeParticipant, listParticipants } });
    const fresh = await f.ledger.issueGrant(f.owner, f.install, randomUUID(), "cop-call-" + randomUUID(), new Date());
    const operationId = randomUUID(); await f.ledger.revokeInstallation(f.owner, f.install, operationId, new Date());
    const freshBody = { operationId, grants: [{ identity: fresh.identity, room: fresh.room }] };
    const response = await f.revoke(freshBody); expect(response.statusCode).toBe(200); expect(response.json().providerVerified).toBe(true);
    expect(removeParticipant).not.toHaveBeenCalled(); expect(listParticipants).toHaveBeenCalledExactlyOnceWith(fresh.room);
    expect(removeParticipant).not.toHaveBeenCalled();
  });
  it("does not reuse old proof/epoch or tag grants issued during an unaccepted gateway interval", async () => {
    const f = await fixture(); const operationId = randomUUID();
    await f.ledger.revokeInstallation(f.owner, f.install, operationId, new Date());
    const body = { operationId, grants: [{ identity: f.grant.identity, room: f.room }] };
    expect((await f.revoke(body)).json().providerVerified).toBe(true); // Durable current-epoch proof exists.
    const firstEpoch = f.grant.admissionEpoch; expect(firstEpoch).toBeDefined();
    await f.gate.close(); apps.delete(f.gate);
    const unaccepted = await buildVoiceAdmissionGate({ ...f.gateOptions, acceptedTopology: false }); apps.add(unaccepted); await unaccepted.ready();
    const secondOwner = actor("synthetic-interval-owner"), secondInstall = randomUUID();
    await f.ledger.attestInstallation(secondOwner, secondInstall, new Date());
    const intervalGrant = await f.ledger.issueGrant(secondOwner, secondInstall, randomUUID(), "cop-call-" + randomUUID(), new Date());
    expect(intervalGrant.admissionEpoch).toBeUndefined();
    const secondOperation = randomUUID(); await f.ledger.revokeInstallation(secondOwner, secondInstall, secondOperation, new Date());
    await unaccepted.close(); apps.delete(unaccepted);
    const accepted = await buildVoiceAdmissionGate(f.gateOptions); apps.add(accepted); await accepted.ready();
    const secondBody = { operationId: secondOperation, grants: [{ identity: intervalGrant.identity, room: intervalGrant.room }] };
    for (const input of [body, secondBody]) {
      const token = new AccessToken(apiKey, apiSecret, { ttl: 30, metadata: createHash("sha256").update(JSON.stringify(input)).digest("hex") }); token.addGrant({ roomAdmin: true, room: VOICE_REVOCATION_CONTROL_ROOM });
      const response = await accepted.inject({ method: "POST", url: "/internal/voice-grants/revoke", payload: input, headers: { authorization: "Bearer " + await token.toJwt() } });
      expect(response.statusCode).toBe(200); expect(response.json().providerVerified).toBe(false);
    }
    expect(f.provider.removeParticipant).not.toHaveBeenCalled();
  });
});

describe("gateway exclusive PG authority", () => {
  it("holds a distinct gateway lock and permanently fails closed after lease loss", async () => {
    let owned = true; const queries: string[] = [], lost = vi.fn(), release = vi.fn();
    const connection = { on: vi.fn(), release, query: vi.fn(async (sql: string) => { queries.push(sql); return { rows: [{ acquired: true, owned }] }; }) };
    const owner = new PostgresVoiceGatewayOwner({ connect: async () => connection as never, end: async () => undefined }, lost);
    await owner.claim(); expect(queries.some(query => query.includes("731031,2"))).toBe(true);
    owned = false; await expect(owner.assertOwned()).rejects.toThrow("Voice gateway lease unavailable");
    owned = true; await expect(owner.assertOwned()).rejects.toThrow("Voice gateway lease unavailable"); expect(lost).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledWith(true); await owner.close();
  });
});
