import { Pool, type PoolClient } from "pg";
import { RoomServiceClient } from "livekit-server-sdk";
import { pathToFileURL } from "node:url";
import { PostgresMobilityStore } from "./mobility-store.js";
import { VoiceGrantLedger } from "./voice-grant-ledger.js";
import { buildVoiceAdmissionGate, type VoiceGatewayOwner } from "./voice-admission-gate.js";

/** Dedicated gateway lock, separate from the existing Dispatch singleton. Loss is
 * terminal for this process: never reconnect/adopt old in-memory WS ownership.
 * A restarted owner must reconcile the persistent dispatched-handshake evidence.
 */
export class PostgresVoiceGatewayOwner implements VoiceGatewayOwner {
  private connection?: PoolClient;
  private heartbeat?: NodeJS.Timeout;
  private stopped = false;
  private flight?: Promise<void>;
  constructor(private readonly pool: Pick<Pool, "connect" | "end">, private readonly lost: () => void) {}
  async claim(): Promise<void> {
    if (this.connection || this.stopped) throw new Error("Voice gateway lease unavailable.");
    const connection = await this.pool.connect(); this.connection = connection;
    connection.on("error", () => this.lose()); connection.on("end", () => this.lose());
    try {
      const result = await connection.query<{ acquired: boolean }>("SELECT NOT pg_is_in_recovery() AND pg_try_advisory_lock(731031,2) AS acquired");
      if (!result.rows[0]?.acquired) throw new Error();
      await this.assertOwned();
      this.heartbeat = setInterval(() => {
        if (!this.flight) { this.flight = this.assertOwned().catch(() => undefined).finally(() => { this.flight = undefined; }); }
      }, 1000);
      this.heartbeat.unref();
    } catch { this.lose(); throw new Error("Voice gateway lease unavailable."); }
  }
  async assertOwned(): Promise<void> {
    const connection = this.connection;
    if (!connection || this.stopped) throw new Error("Voice gateway lease unavailable.");
    try {
      const result = await connection.query<{ owned: boolean }>("SELECT NOT pg_is_in_recovery() AND EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=731031 AND objid=2 AND pid=pg_backend_pid() AND granted) AS owned");
      if (this.stopped || this.connection !== connection || !result.rows[0]?.owned) throw new Error();
    } catch { this.lose(); throw new Error("Voice gateway lease unavailable."); }
  }
  private lose(): void {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.heartbeat);
    const connection = this.connection; this.connection = undefined;
    connection?.release(true); this.lost();
  }
  async close(): Promise<void> { this.lose(); await this.flight; await this.pool.end(); }
}

/** Source-only runtime. Deployment must independently put this listener in front
 * of every signaling route and close all direct/alternative SFU admission paths.
 * It never starts from the ordinary COP API process or enables itself by default.
 */
export async function startVoiceAdmissionGateway(env: NodeJS.ProcessEnv = process.env) {
  if (env.COP_VOICE_SIGNAL_GATEWAY_ENABLED !== "true") throw new Error("Voice signaling gateway is disabled.");
  const apiKey = required(env, "COP_LIVEKIT_API_KEY"), apiSecret = required(env, "COP_LIVEKIT_API_SECRET");
  const connectionString = required(env, "COP_DATABASE_URL");
  const sslMode = env.COP_DATABASE_SSL?.trim().toLowerCase();
  if (sslMode && !["false", "0", "true", "1", "require"].includes(sslMode)) throw new Error("Unsupported PostgreSQL TLS configuration.");
  const config = { connectionString, connectionTimeoutMillis: 5000, query_timeout: 5000,
    ssl: ["true", "1", "require"].includes(sslMode ?? "") ? { rejectUnauthorized: true } : false };
  const store = new PostgresMobilityStore({ ...config, max: 3, application_name: "cop-voice-signaling-store" });
  const backendUrl = required(env, "COP_VOICE_SIGNAL_GATEWAY_BACKEND_URL");
  const providerUrl = new URL(backendUrl);
  if (providerUrl.protocol === "ws:") providerUrl.protocol = "http:";
  if (providerUrl.protocol === "wss:") providerUrl.protocol = "https:";
  const provider = new RoomServiceClient(providerUrl.origin, apiKey, apiSecret);
  let app: Awaited<ReturnType<typeof buildVoiceAdmissionGate>> | undefined;
  const owner = new PostgresVoiceGatewayOwner(new Pool({ ...config, max: 1, application_name: "cop-voice-signaling-owner",
    keepAlive: true, keepAliveInitialDelayMillis: 1000 }), () => { void app?.close(); });
  try {
    await owner.claim();
    const maxGrantAgeSeconds = Number(env.COP_VOICE_SCOPED_GRANT_MAX_AGE_SECONDS ?? 86_400);
    if (!Number.isInteger(maxGrantAgeSeconds) || maxGrantAgeSeconds < 60 || maxGrantAgeSeconds > 86_400) throw new Error("Invalid scoped voice grant maximum age.");
    const ledger = new VoiceGrantLedger({ store, issuer: required(env, "COP_OIDC_ISSUER"), clientId: required(env, "COP_JIZDA_OIDC_CLIENT_ID"),
      identitySecret: apiSecret, intakeEnabled: env.COP_VOICE_SCOPED_GRANTS_ENABLED === "true", maxGrantAgeMs: maxGrantAgeSeconds * 1000 });
    app = await buildVoiceAdmissionGate({ ledger, apiKey, apiSecret, backendUrl, provider, owner,
      acceptedTopology: env.COP_VOICE_SIGNAL_GATEWAY_ACCEPTED === "true",
      singleConnectAttemptVerified: env.COP_VOICE_SIGNAL_SINGLE_ATTEMPT_VERIFIED === "true" });
    app.addHook("onClose", async () => { await owner.close(); await store.close(); });
    const port = Number(env.COP_VOICE_SIGNAL_GATEWAY_PORT ?? "7884");
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid voice gateway port.");
    await app.listen({ port, host: env.COP_VOICE_SIGNAL_GATEWAY_HOST ?? "127.0.0.1" });
    return app;
  } catch {
    await app?.close().catch(() => undefined); await owner.close().catch(() => undefined); await store.close().catch(() => undefined);
    // Database URLs, JWTs and provider errors are never written to stdout/stderr.
    throw new Error("Voice signaling gateway unavailable.");
  }
}
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]; if (!value || value !== value.trim()) throw new Error("Voice gateway configuration incomplete."); return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startVoiceAdmissionGateway().then(app => {
    const shutdown = () => { void app.close().then(() => { process.exitCode = 0; }); };
    process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  }).catch(() => { process.stderr.write("Voice signaling gateway unavailable.\n"); process.exitCode = 1; });
}
