import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { JoinRequest, SignalResponse, WrappedJoinRequest, WrappedJoinRequest_Compression } from "@livekit/protocol";
import { TokenVerifier, type ClaimGrants } from "livekit-server-sdk";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { VoiceGrantError, VOICE_GRANT_IDENTITY_PREFIX, VOICE_GRANT_GATEWAY_CONFIG_KEY, type VoiceGrantLedger } from "./voice-grant-ledger.js";
import { readBoundedBody } from "./bounded-upstream.js";
import { VOICE_REVOCATION_CONTROL_ROOM } from "./voice-grant-revocation.js";
import type { VoiceCallAdmission, VoiceCallAdmissionTarget } from "./voice-call-admission.js";

export interface VoiceGatewayOwner { assertOwned(): Promise<void> }
export interface VoiceGatewayProvider {
  removeParticipant(room: string, identity: string): Promise<unknown>;
  listParticipants(room: string): Promise<readonly { identity: string }[]>;
}
export interface VoiceAdmissionGateOptions {
  ledger: VoiceGrantLedger;
  apiKey: string;
  apiSecret: string;
  backendUrl: string;
  provider: VoiceGatewayProvider;
  /** Must represent a separately held, continuously monitored, primary PG session lock. */
  owner: VoiceGatewayOwner;
  /** Mandatory current persistent call-state authority for scoped identities. */
  assertCall: VoiceCallAdmission;
  /** False until the actual only-signaling-path topology/provider tests are accepted. */
  acceptedTopology?: boolean;
  /** Explicit live evidence of signal_relay.connect_attempts=1 AND no proxy admission retry. */
  singleConnectAttemptVerified?: boolean;
  handshakeTimeoutMs?: number;
  /** Test seam; runtime uses the bounded one-second single-flight sweep. */
  callStatePollMs?: number;
}
export const VOICE_REVOCATION_CONTRACT = "cop-voice-grant-revocation-v1";
export const VOICE_GATEWAY_PENDING_PREFIX = "voice-signaling-gateway:v1:handshake:";
const configurationKey = VOICE_GRANT_GATEWAY_CONFIG_KEY;
const completedPrefix = "voice-signaling-gateway:v1:completed:";
const completedGrantPrefix = "voice-signaling-gateway:v1:grant-completed:";
const paths = ["/rtc", "/rtc/validate", "/rtc/v1", "/rtc/v1/validate"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const maxFrameBytes = 1024 * 1024;
const maxConnections = 256;
type Downstream = websocket.WebSocket;
interface Admission {
  token: string;
  claims: ClaimGrants;
  identity: string;
  room: string;
  managed: boolean;
  reconnect: boolean;
  url: URL;
  call?: VoiceCallAdmissionTarget;
}
interface HandshakeRow {
  identity: string;
  room: string;
  state: "dispatched" | "acknowledged";
  dispatchedAt: string;
  acknowledgedAt?: string;
  admissionEpoch?: string;
}
interface Connection {
  admission: Admission;
  downstream: Downstream;
  upstream?: WebSocket;
  key?: string;
  acknowledged: boolean;
  revoked: boolean;
  done: Promise<boolean>;
  settle(value: boolean): void;
  timer?: NodeJS.Timeout;
  messageFlight: Promise<void>;
  queuedFrames: number;
  queuedBytes: number;
  callBlocked: boolean;
  cleanupFlight?: Promise<void>;
}
interface RevokeBody { operationId: string; grants: Array<{ identity: string; room: string }> }

/** Sole signaling ingress for NEW scoped grants. This does not replace the RTC
 * media ports or assert an already deployed topology. Every dispatched handshake
 * is durable before forwarding. Aborted/unknown handshakes remain unresolved;
 * neither an empty inventory, restart nor elapsed time erases that uncertainty.
 * No client metadata, app header, original token hash or refreshed jti is authority.
 */
export async function buildVoiceAdmissionGate(options: VoiceAdmissionGateOptions): Promise<FastifyInstance> {
  const backend = new URL(options.backendUrl);
  if (!["http:", "https:", "ws:", "wss:"].includes(backend.protocol) || backend.username || backend.password ||
      backend.pathname !== "/" || backend.search || backend.hash || !options.apiKey || options.apiSecret.length < 32) {
    throw new Error("Voice gateway requires an internal backend origin and existing LiveKit credentials.");
  }
  const timeoutMs = options.handshakeTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) throw new Error("Invalid gateway timeout.");
  if (typeof options.assertCall !== "function") throw new Error("Persistent voice call admission is required.");
  const pollMs = options.callStatePollMs ?? 1000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 1000) throw new Error("Invalid call-state polling interval.");
  const verifier = new TokenVerifier(options.apiKey, options.apiSecret);
  const store = options.ledger.options.store;
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024, routerOptions: { maxParamLength: 32 } });
  const admissions = new WeakMap<FastifyRequest, Admission>();
  const connections = new Set<Connection>();
  const cleanupFlights = new Map<string, Promise<void>>();
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const flight = queue.then(work); queue = flight.catch(() => undefined); return flight;
  }
  function closeConnection(connection: Connection, terminate = false): void {
    try { if (terminate) connection.downstream.terminate(); else connection.downstream.close(1008, "Voice admission unavailable"); } catch { /* sanitized */ }
    try { connection.upstream?.close(1008, "Voice admission unavailable"); } catch { /* sanitized */ }
  }
  async function owned(): Promise<void> {
    if (closed) throw new VoiceGrantError(503, "VOICE_GATEWAY_UNAVAILABLE");
    try { await options.owner.assertOwned(); } catch {
      for (const connection of connections) { connection.revoked = true; closeConnection(connection, true); }
      throw new VoiceGrantError(503, "VOICE_GATEWAY_UNAVAILABLE");
    }
  }
  await store.init(); await options.ledger.init(); await owned();
  const fingerprint = createHash("sha256").update(JSON.stringify([backend.origin, options.apiKey])).digest("hex");
  const acceptedEpoch = await store.transact([configurationKey], async tx => {
    let configuration = await tx.get<{ fingerprint: string; acceptedEpoch?: string; active?: boolean }>(configurationKey);
    if (configuration && configuration.fingerprint !== fingerprint) throw new VoiceGrantError(503, "VOICE_GATEWAY_CONFIGURATION_CHANGED");
    if (configuration?.acceptedEpoch !== undefined && !uuid.test(configuration.acceptedEpoch)) throw new VoiceGrantError(503, "VOICE_GATEWAY_STATE_UNAVAILABLE");
    if (!configuration) {
      if ((await tx.scan(VOICE_GATEWAY_PENDING_PREFIX)).length) throw new VoiceGrantError(503, "VOICE_GATEWAY_CONFIGURATION_MISSING");
      configuration = { fingerprint };
    }
    const active = options.acceptedTopology === true && options.singleConnectAttemptVerified === true;
    if (active && configuration.active !== true) configuration.acceptedEpoch = randomUUID();
    configuration.active = active;
    await tx.set(configurationKey, configuration);
    return active ? configuration.acceptedEpoch : undefined;
  });
  await app.register(websocket, { options: { maxPayload: maxFrameBytes, perMessageDeflate: false } });
  app.setErrorHandler((_error, _request, reply) => { reply.code(503).send({ error: "VOICE_GATEWAY_UNAVAILABLE" }); });

  async function assertAcceptedEpoch(): Promise<void> {
    if (!acceptedEpoch) throw new VoiceGrantError(503, "VOICE_GATEWAY_NOT_ACCEPTED");
    const marker = await store.transact([configurationKey], tx => tx.get<{ fingerprint: string; acceptedEpoch?: string; active?: boolean }>(configurationKey));
    if (marker?.fingerprint !== fingerprint || marker.active !== true || marker.acceptedEpoch !== acceptedEpoch) throw new VoiceGrantError(503, "VOICE_GATEWAY_CONFIGURATION_CHANGED");
  }

  async function assertScopedCall(admission: Admission): Promise<void> {
    if (!admission.managed) return;
    await assertAcceptedEpoch();
    const grant = await options.ledger.assertAdmission(admission.identity, admission.room, new Date());
    if (grant.admissionEpoch !== acceptedEpoch) throw new VoiceGrantError(403, "VOICE_GATEWAY_DENIED");
    await options.assertCall(grant, new Date());
  }
  function blockCallConnection(connection: Connection): void {
    connection.callBlocked = true;
    try { connection.downstream.terminate(); } catch { /* sanitized */ }
    // Do not abort an uncertain dispatch before its positive response/timeout.
    // A disconnected client or ended call cannot prove that no RTC join occurred.
    if (!connection.acknowledged) return;
    closeConnection(connection, true);
    const cleanupKey = connection.admission.identity + ":" + connection.admission.room;
    if (connection.cleanupFlight) return;
    const existing = cleanupFlights.get(cleanupKey);
    if (existing) { connection.cleanupFlight = existing; return; }
    if (cleanupFlights.size >= maxConnections) return;
    const cleanup = serialize(async () => {
      await owned();
      await boundedCleanup(() => options.provider.removeParticipant(connection.admission.room, connection.admission.identity));
      const participants = await boundedCleanup(() => options.provider.listParticipants(connection.admission.room));
      if (!Array.isArray(participants) || participants.some(participant => typeof participant.identity !== "string" || participant.identity === connection.admission.identity)) throw new Error();
      await owned();
      // Operational cleanup only. No app/install receipt, completion checkpoint
      // or handshake-row deletion follows from current call state or inventory.
    }).catch(() => undefined).finally(() => { cleanupFlights.delete(cleanupKey); });
    connection.cleanupFlight = cleanup; cleanupFlights.set(cleanupKey, cleanup);
  }
  async function boundedCleanup<T>(operation: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try { return await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error()), timeoutMs); timer.unref(); })]); }
    finally { clearTimeout(timer); }
  }

  let pollFlight: Promise<void> | undefined;
  const callPoll = setInterval(() => {
    if (closed || pollFlight) return;
    pollFlight = (async () => {
      await owned();
      const groups = new Map<string, Connection[]>();
      for (const connection of connections) if (connection.admission.managed && !connection.revoked && !connection.callBlocked) {
        const key = connection.admission.call!.callId + ":" + connection.admission.room;
        const group = groups.get(key) ?? []; group.push(connection); groups.set(key, group);
      }
      const pending = [...groups.values()]; let next = 0;
      // Both the session count and concurrent authority reads are bounded.
      await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
        while (next < pending.length && !closed) {
          const group = pending[next++]!;
          try { await options.assertCall(group[0]!.admission.call!, new Date()); }
          catch { if (!closed) for (const connection of group) blockCallConnection(connection); }
        }
      }));
    })().catch(() => undefined).finally(() => { pollFlight = undefined; });
  }, pollMs);
  callPoll.unref();

  async function authenticate(request: FastifyRequest): Promise<Admission> {
    await owned();
    const rawUrl = request.raw.url ?? "";
    // Never let absolute-form/protocol-relative client targets replace the
    // configured SFU origin and receive the canonical server bearer credential.
    if (!rawUrl.startsWith("/") || rawUrl.startsWith("//")) throw new VoiceGrantError(400, "VOICE_GATEWAY_INVALID_REQUEST");
    const incoming = new URL(rawUrl, "http://gateway.invalid");
    const url = new URL(incoming.pathname + incoming.search, backend);
    if (url.href.length > 64 * 1024) throw new VoiceGrantError(400, "VOICE_GATEWAY_INVALID_REQUEST");
    const token = requestToken(request, url);
    let claims: ClaimGrants;
    try {
      // Match the upstream HS256 key and reject algorithm/key confusion ourselves.
      const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as { alg?: unknown };
      if (header.alg !== "HS256") throw new Error();
      claims = await verifier.verify(token, 0);
    } catch { throw new VoiceGrantError(401, "VOICE_GATEWAY_UNAUTHORIZED"); }
    const identity = claims.sub ?? claims.jti ?? "";
    const room = claims.video?.room ?? "";
    if (!identity || !claims.video?.roomJoin) throw new VoiceGrantError(403, "VOICE_GATEWAY_DENIED");
    // Reserve all prefixes, including malformed identities, so a legacy grant can
    // never masquerade as a managed identity through a malformed suffix.
    const managed = identity.startsWith(VOICE_GRANT_IDENTITY_PREFIX);
    let call: VoiceCallAdmissionTarget | undefined;
    let reconnect = url.searchParams.get("reconnect") === "1";
    if (managed) {
      await assertAcceptedEpoch();
      if (claims.sub !== identity || !room || url.searchParams.has("publish") ||
          ["roomAdmin", "roomCreate", "roomList", "roomRecord", "ingressAdmin", "agent"].some(key => (claims.video as Record<string, unknown>)[key] === true) ||
          claims.video.destinationRoom || url.searchParams.getAll("room").length > 1 ||
          (url.searchParams.has("room") && url.searchParams.get("room") !== room)) {
        throw new VoiceGrantError(403, "VOICE_GATEWAY_DENIED");
      }
      const encodedJoin = url.searchParams.getAll("join_request");
      if (encodedJoin.length > 1) throw new VoiceGrantError(400, "VOICE_GATEWAY_INVALID_REQUEST");
      if (encodedJoin.length === 1) {
        try {
          if (!/^[A-Za-z0-9_-]+$/u.test(encodedJoin[0]!)) throw new Error();
          const wrapper = WrappedJoinRequest.fromBinary(Buffer.from(encodedJoin[0]!, "base64url"));
          let bytes = wrapper.joinRequest;
          if (wrapper.compression === WrappedJoinRequest_Compression.GZIP) bytes = gunzipSync(bytes, { maxOutputLength: maxFrameBytes });
          else if (wrapper.compression !== WrappedJoinRequest_Compression.NONE) throw new Error();
          reconnect = JoinRequest.fromBinary(bytes).reconnect;
        } catch { throw new VoiceGrantError(400, "VOICE_GATEWAY_INVALID_REQUEST"); }
      }
      const grant = await options.ledger.assertAdmission(identity, room, new Date());
      if (grant.admissionEpoch !== acceptedEpoch) throw new VoiceGrantError(403, "VOICE_GATEWAY_DENIED");
      await options.assertCall(grant, new Date());
      call = { callId: grant.callId, room: grant.room };
      url.searchParams.set("room", room);
    }
    url.searchParams.delete("access_token");
    return { token, claims, identity, room, managed, reconnect, url, call };
  }
  const preValidation = async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    try { admissions.set(request, await authenticate(request)); }
    catch (error) { reply.code(error instanceof VoiceGrantError ? error.status : 503).send({ error: error instanceof VoiceGrantError ? error.code : "VOICE_GATEWAY_UNAVAILABLE" }); }
  };

  async function startConnection(connection: Connection): Promise<void> {
    const admission = connection.admission;
    await serialize(async () => {
      await owned();
      if (connection.revoked || connection.downstream.readyState !== 1) throw new VoiceGrantError(503, "VOICE_GATEWAY_UNAVAILABLE");
      if (admission.managed) {
        await assertAcceptedEpoch();
        const grant = await options.ledger.assertAdmission(admission.identity, admission.room, new Date());
        if (grant.admissionEpoch !== acceptedEpoch) throw new VoiceGrantError(403, "VOICE_GATEWAY_DENIED");
        await options.assertCall(grant, new Date());
        await owned();
        if (connection.revoked || connection.downstream.readyState !== 1) throw new VoiceGrantError(503, "VOICE_GATEWAY_UNAVAILABLE");
        connection.key = VOICE_GATEWAY_PENDING_PREFIX + admission.identity + ":" + randomUUID();
        await store.transact([connection.key], tx => tx.set(connection.key!, {
          identity: admission.identity, room: admission.room, state: "dispatched", dispatchedAt: new Date().toISOString(), admissionEpoch: acceptedEpoch
        } satisfies HandshakeRow));
      }
      // Every awaited authority/write may be suspended across a terminal lease
      // loss or shutdown. No dispatch may resume after that boundary.
      await owned();
      if (connection.revoked || connection.downstream.readyState !== 1) throw new VoiceGrantError(503, "VOICE_GATEWAY_UNAVAILABLE");
      await assertScopedCall(admission);
      await owned();
      if (closed || connection.revoked || connection.callBlocked || connection.downstream.readyState !== 1) throw new VoiceGrantError(503, "VOICE_GATEWAY_UNAVAILABLE");
      const url = new URL(admission.url); url.protocol = backend.protocol === "https:" || backend.protocol === "wss:" ? "wss:" : "ws:";
      // Node 24's built-in Undici WebSocket supports its WebSocketInit extension.
      // Canonical bearer goes in a header, never the upstream URL or diagnostics.
      const upstream = new WebSocket(url, { headers: { Authorization: "Bearer " + admission.token } } as unknown as string[]);
      connection.upstream = upstream; upstream.binaryType = "arraybuffer";
      connection.timer = setTimeout(() => { connection.settle(false); closeConnection(connection, true); }, timeoutMs);
      connection.timer.unref();
      let first = true;
      upstream.addEventListener("message", event => {
        const length = frame(event.data).byteLength;
        if (++connection.queuedFrames > 64 || (connection.queuedBytes += length) > maxFrameBytes) { connection.settle(false); closeConnection(connection, true); return; }
        connection.messageFlight = connection.messageFlight.then(async () => {
          if (first) {
            first = false;
            if (admission.managed) {
              if (!positiveAcknowledgement(event.data, admission) || options.singleConnectAttemptVerified !== true) {
                connection.settle(false); closeConnection(connection, true); return;
              }
              await store.transact([connection.key!], async tx => {
                const row = await tx.get<HandshakeRow>(connection.key!);
                if (!validRow(row) || row.identity !== admission.identity || row.room !== admission.room) throw new Error();
                await tx.set(connection.key!, { ...row, state: "acknowledged", acknowledgedAt: new Date().toISOString() });
              });
            }
            connection.acknowledged = true; clearTimeout(connection.timer); connection.settle(true);
          }
          await owned();
          if (admission.managed && !connection.revoked) {
            try { await assertScopedCall(admission); }
            catch (error) { if (error instanceof VoiceGrantError && error.code.startsWith("VOICE_CALL_")) blockCallConnection(connection); else closeConnection(connection, true); return; }
          }
          if (connection.callBlocked) { blockCallConnection(connection); return; }
          await owned();
          if (connection.revoked || connection.downstream.readyState !== 1) { closeConnection(connection, true); return; }
          const bytes = frame(event.data);
          if (bytes.byteLength > maxFrameBytes || connection.downstream.bufferedAmount > maxFrameBytes) throw new Error();
          connection.downstream.send(typeof event.data === "string" ? event.data : bytes);
        }).catch(() => { connection.settle(false); closeConnection(connection, true); }).finally(() => { connection.queuedFrames--; connection.queuedBytes -= length; });
      });
      upstream.addEventListener("error", () => { connection.settle(false); closeConnection(connection, true); });
      upstream.addEventListener("close", () => {
        connection.settle(connection.acknowledged); clearTimeout(connection.timer);
        try { connection.downstream.close(1011, "Voice signaling ended"); } catch { /* sanitized */ }
        connections.delete(connection);
      });
    });
  }
  for (const path of paths) {
    app.route({ method: "GET", url: path, preValidation,
      handler: async (request, reply) => {
        const admission = admissions.get(request)!;
        if (!path.endsWith("/validate")) return reply.code(400).send({ error: "VOICE_GATEWAY_WEBSOCKET_REQUIRED" });
        try {
          // Validation does not dispatch a participant and therefore has no pending row.
          await owned(); await assertScopedCall(admission); await owned();
          if (closed) throw new VoiceGrantError(503, "VOICE_GATEWAY_UNAVAILABLE");
          const url = new URL(admission.url); url.protocol = backend.protocol === "https:" || backend.protocol === "wss:" ? "https:" : "http:";
          const response = await fetch(url, { headers: { Authorization: "Bearer " + admission.token }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
          if (!response.ok) { await response.body?.cancel(); return reply.code(response.status >= 500 ? 503 : response.status).send({ error: "VOICE_GATEWAY_UPSTREAM_REJECTED" }); }
          const body = (await readBoundedBody(response, maxFrameBytes)).toString("utf8");
          await owned(); await assertScopedCall(admission); await owned();
          if (closed) throw new VoiceGrantError(503, "VOICE_GATEWAY_UNAVAILABLE");
          return reply.code(response.status).send(body);
        } catch (error) { return reply.code(error instanceof VoiceGrantError ? error.status : 503).send({ error: error instanceof VoiceGrantError ? error.code : "VOICE_GATEWAY_UNAVAILABLE" }); }
      },
      wsHandler: (downstream, request) => {
        if (path.endsWith("/validate")) { downstream.close(1008, "Invalid signaling path"); return; }
        let settled = false, resolve!: (value: boolean) => void;
        const connection: Connection = { admission: admissions.get(request)!, downstream, acknowledged: false, revoked: false, callBlocked: false,
          done: new Promise<boolean>(done => { resolve = done; }), settle: value => { if (!settled) { settled = true; resolve(value); } }, messageFlight: Promise.resolve(), queuedFrames: 0, queuedBytes: 0 };
        // Reserve and track pending sockets BEFORE queueing/awaiting PG. This cap
        // includes admissions waiting behind a stalled ledger, and preClose sees all.
        if (closed || connections.size >= maxConnections) { connection.settle(false); closeConnection(connection, true); return; }
        connections.add(connection);
        // Attach listeners before awaiting anything; client frames never enter an
        // unbounded queue and are not sent before positive provider acknowledgement.
        downstream.on("message", (data: unknown, binary: boolean) => {
          let length: number;
          try { length = frame(data).byteLength; } catch { connection.settle(false); closeConnection(connection, true); return; }
          if (++connection.queuedFrames > 64 || (connection.queuedBytes += length) > maxFrameBytes) { connection.settle(false); closeConnection(connection, true); return; }
          connection.messageFlight = connection.messageFlight.then(async () => {
            await owned();
            if (connection.admission.managed) {
              try { await assertScopedCall(connection.admission); }
              catch (error) { if (error instanceof VoiceGrantError && error.code.startsWith("VOICE_CALL_")) blockCallConnection(connection); else closeConnection(connection, true); return; }
            }
            if (connection.callBlocked) { blockCallConnection(connection); return; }
            await owned();
            if (!connection.acknowledged || connection.revoked || connection.upstream?.readyState !== WebSocket.OPEN) throw new Error();
            if (connection.upstream.bufferedAmount > maxFrameBytes) throw new Error();
            connection.upstream.send(binary ? Uint8Array.from(frame(data)) : frame(data).toString("utf8"));
          }).catch(() => { connection.settle(false); closeConnection(connection, true); }).finally(() => { connection.queuedFrames--; connection.queuedBytes -= length; });
        });
        downstream.on("error", () => { connection.settle(false); closeConnection(connection, true); });
        downstream.on("close", () => {
          // Keep the dispatched upstream alive until acknowledgement/timeout. HTTP
          // cancellation cannot prove that the remote RTC session did not join later.
          if (connection.acknowledged) closeConnection(connection);
        });
        void startConnection(connection).catch(() => { connection.settle(false); clearTimeout(connection.timer); closeConnection(connection, true); connections.delete(connection); });
      }
    });
  }

  app.post("/internal/voice-grants/revoke", async (request, reply) => {
    let body: RevokeBody;
    try {
      body = revokeBody(request.body);
      const url = new URL(request.raw.url ?? "", backend), token = requestToken(request, url);
      if (url.search || !request.headers.authorization) throw new Error();
      const claims = await verifier.verify(token, 0);
      const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as { alg?: string };
      const now = Date.now() / 1000;
      const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
      if (header.alg !== "HS256" || claims.video?.roomAdmin !== true || claims.video.room !== VOICE_REVOCATION_CONTROL_ROOM || claims.video.roomJoin === true ||
          typeof claims.exp !== "number" || claims.exp <= now || claims.exp > now + 35 || typeof claims.metadata !== "string" ||
          !sameString(claims.metadata, hash)) throw new Error();
    } catch { return reply.code(401).send({ error: "VOICE_GATEWAY_UNAUTHORIZED" }); }
    try {
      const providerVerified = await serialize(async () => {
        await owned();
        for (const grant of body.grants) if (!await options.ledger.confirmsRevoked(grant.identity, grant.room)) throw new VoiceGrantError(409, "VOICE_GATEWAY_FENCE_REQUIRED");
        const identities = new Set(body.grants.map(grant => grant.identity));
        const scoped = [...connections].filter(connection => identities.has(connection.admission.identity));
        for (const connection of scoped) {
          connection.revoked = true;
          try { connection.downstream.terminate(); } catch { /* sanitized */ }
          // Pending upstream must finish its first response before provider cleanup.
          if (connection.acknowledged) closeConnection(connection, true);
        }
        await Promise.all(scoped.map(connection => connection.done));
        const rows = await store.transact([], tx => tx.scan<HandshakeRow>(VOICE_GATEWAY_PENDING_PREFIX));
        for (const { value } of rows) {
          if (!validRow(value)) throw new VoiceGrantError(503, "VOICE_GATEWAY_STATE_UNAVAILABLE");
          if (identities.has(value.identity) && (value.state !== "acknowledged" || !body.grants.some(grant => grant.identity === value.identity && grant.room === value.room))) return false;
        }
        if (options.acceptedTopology !== true || options.singleConnectAttemptVerified !== true) return false;
        await assertAcceptedEpoch();
        for (const grant of body.grants) {
          const canonical = await options.ledger.readRevokedGrant(grant.identity, grant.room);
          if (!canonical || canonical.admissionEpoch !== acceptedEpoch || rows.some(row => row.value.identity === grant.identity && row.value.admissionEpoch !== acceptedEpoch)) return false;
        }
        const bodyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex"), completedKey = completedPrefix + acceptedEpoch + ":" + body.operationId + ":" + bodyHash;
        const saved = await store.transact([completedKey], tx => tx.get<{ fingerprint: string; bodyHash: string; completedAt: string; activeEpoch: string }>(completedKey));
        if (saved) {
          if (saved.fingerprint !== fingerprint || saved.bodyHash !== bodyHash || saved.activeEpoch !== acceptedEpoch || !Number.isFinite(Date.parse(saved.completedAt))) throw new VoiceGrantError(503, "VOICE_GATEWAY_STATE_UNAVAILABLE");
          return true;
        }
        for (const grant of body.grants) {
          await owned();
          const grantProofKey = completedGrantPrefix + acceptedEpoch + ":" + createHash("sha256").update(JSON.stringify([grant.identity, grant.room])).digest("hex");
          const proof = await store.transact([grantProofKey], tx => tx.get<{ identity: string; room: string; fingerprint: string; completedAt: string; activeEpoch: string }>(grantProofKey));
          if (proof) {
            if (proof.identity !== grant.identity || proof.room !== grant.room || proof.fingerprint !== fingerprint || proof.activeEpoch !== acceptedEpoch || !Number.isFinite(Date.parse(proof.completedAt))) throw new VoiceGrantError(503, "VOICE_GATEWAY_STATE_UNAVAILABLE");
            continue;
          }
          const hasDispatch = rows.some(row => row.value.identity === grant.identity);
          const canonical = !hasDispatch ? await options.ledger.readRevokedGrant(grant.identity, grant.room) : undefined;
          if (!hasDispatch && acceptedEpoch && canonical?.admissionEpoch === acceptedEpoch) {
            // A fresh immutable identity issued after the accepted sole-ingress
            // epoch has no possible untracked legacy admission. No dispatch rows
            // plus authoritative absence is a never-connected proof, not remove404.
            const participants = await options.provider.listParticipants(grant.room);
            if (!Array.isArray(participants) || participants.some(participant => typeof participant.identity !== "string" || participant.identity === grant.identity)) return false;
            await owned();
            await store.transact([grantProofKey], tx => tx.set(grantProofKey, { identity: grant.identity, room: grant.room, fingerprint, activeEpoch: acceptedEpoch, completedAt: new Date().toISOString() }));
            continue;
          }
          // ANY failed remove (including404) is not proof. JoinResponse precedes
          // participant RPC registration, and inventory can still be initially empty.
          await options.provider.removeParticipant(grant.room, grant.identity);
          const participants = await options.provider.listParticipants(grant.room);
          if (!Array.isArray(participants) || participants.some(participant => typeof participant.identity !== "string" || participant.identity === grant.identity)) return false;
          await owned();
          // Persist each exact provider success BEFORE attempting the next grant;
          // partial failure/retry must not turn a completed A into remove404 doubt.
          await store.transact([grantProofKey], tx => tx.set(grantProofKey, { identity: grant.identity, room: grant.room, fingerprint, activeEpoch: acceptedEpoch, completedAt: new Date().toISOString() }));
        }
        await owned();
        await store.transact([completedKey], tx => tx.set(completedKey, { fingerprint, bodyHash, activeEpoch: acceptedEpoch, completedAt: new Date().toISOString() }));
        return true;
      });
      return reply.send({ contractVersion: VOICE_REVOCATION_CONTRACT, operationId: body.operationId, providerVerified });
    } catch (error) { return reply.code(error instanceof VoiceGrantError ? error.status : 503).send({ error: error instanceof VoiceGrantError ? error.code : "VOICE_GATEWAY_UNAVAILABLE" }); }
  });
  app.addHook("preClose", async () => {
    closed = true;
    clearInterval(callPoll);
    for (const connection of connections) { connection.settle(false); clearTimeout(connection.timer); closeConnection(connection, true); }
  });
  return app;
}

function requestToken(request: FastifyRequest, url: URL): string {
  let authorizationCount = 0;
  const rawHeaders = request.raw.rawHeaders ?? [];
  for (let index = 0; index < rawHeaders.length; index += 2) if (rawHeaders[index]?.toLowerCase() === "authorization") authorizationCount++;
  const header = request.headers.authorization, query = url.searchParams.getAll("access_token");
  if (authorizationCount > 1 || query.length > 1 || (header && query.length) || (header !== undefined && !/^Bearer [A-Za-z0-9_.-]+$/u.test(header))) {
    throw new VoiceGrantError(401, "VOICE_GATEWAY_UNAUTHORIZED");
  }
  const token = header?.slice(7) ?? query[0];
  if (!token || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)) throw new VoiceGrantError(401, "VOICE_GATEWAY_UNAUTHORIZED");
  return token;
}
function frame(data: unknown): Buffer {
  if (typeof data === "string") return Buffer.from(data, "utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data) && data.every(Buffer.isBuffer)) return Buffer.concat(data);
  throw new Error("Invalid signaling frame.");
}
function positiveAcknowledgement(data: unknown, admission: Admission): boolean {
  try {
    const bytes = frame(data); if (bytes.length > maxFrameBytes) return false;
    const response = typeof data === "string" ? SignalResponse.fromJsonString(data) : SignalResponse.fromBinary(bytes);
    if (response.message.case === "join") return response.message.value.room?.name === admission.room && response.message.value.participant?.identity === admission.identity;
    return admission.reconnect && response.message.case === "reconnect";
  } catch { return false; }
}
function validRow(value: HandshakeRow | undefined): value is HandshakeRow {
  return !!value && typeof value.identity === "string" && value.identity.startsWith(VOICE_GRANT_IDENTITY_PREFIX) &&
    uuid.test(value.identity.slice(VOICE_GRANT_IDENTITY_PREFIX.length)) && typeof value.room === "string" && !!value.room &&
    ["dispatched", "acknowledged"].includes(value.state) && Number.isFinite(Date.parse(value.dispatchedAt)) &&
    (value.admissionEpoch === undefined || uuid.test(value.admissionEpoch)) &&
    (value.state !== "acknowledged" || Number.isFinite(Date.parse(value.acknowledgedAt ?? "")));
}
function revokeBody(value: unknown): RevokeBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const body = value as RevokeBody;
  if (Object.keys(body).sort().join(",") !== "grants,operationId" || !uuid.test(body.operationId) || !Array.isArray(body.grants) || body.grants.length > 256) throw new Error();
  const identities = new Set<string>();
  for (const grant of body.grants) {
    if (!grant || typeof grant !== "object" || Object.keys(grant).sort().join(",") !== "identity,room" ||
        !grant.identity.startsWith(VOICE_GRANT_IDENTITY_PREFIX) || !uuid.test(grant.identity.slice(VOICE_GRANT_IDENTITY_PREFIX.length)) ||
        !/^cop-call-[0-9a-f-]{36}$/iu.test(grant.room) || identities.has(grant.identity)) throw new Error();
    identities.add(grant.identity);
  }
  return body;
}
function sameString(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8"), b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
