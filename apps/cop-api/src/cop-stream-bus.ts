import { randomUUID } from "node:crypto";
import pg, { type Client as PgClient, type Pool as PgPool, type PoolConfig } from "pg";
import { createCopPgPool } from "./cop-pg-pool.js";
import { resolveCopSessionDatabaseUrl } from "./cop-session-database.js";
import type { CopStreamMessage } from "./cop-stream.js";
import { PostgresStreamProjectionErasure, recordStreamProjectionOwners, streamProjectionOwnershipSql } from "./cop-stream-projection-erasure.js";
import { assertProjectionPayloadAllowed, projectionTransaction, resourceProjectionFenceTableSql, type ResourceProjectionStore } from "./resource-projection-erasure.js";

const { Client } = pg;
const defaultChannel = "cop_stream_events";

export interface CopStreamBusMetrics {
  lastError?: string;
  lastLocalDeliveryAt?: string;
  lastPublishedAt?: string;
  lastReceivedAt?: string;
  localDeliveriesTotal: number;
  mode: string;
  publishedMessagesTotal: number;
  ready: boolean;
  receivedMessagesTotal: number;
}

export interface CopStreamBus {
  readonly name: string;
  readonly metrics: CopStreamBusMetrics;
  close(): Promise<void>;
  diagnostics(): string;
  diagnosticCounters?(): {
    ownedListenerCount: 0 | 1;
    listenerConnected: boolean;
    poolHealthy: boolean;
    closed: boolean;
  };
  init(): Promise<void>;
  projectionErasureStore?(): ResourceProjectionStore | undefined;
  publish(message: CopStreamMessage): Promise<void>;
  subscribe(subscriber: (message: CopStreamMessage) => void): () => void;
}

interface CopStreamBusEnvelope {
  message: CopStreamMessage;
  originId: string;
}

export class MemoryCopStreamBus implements CopStreamBus {
  readonly name = "memory";
  private lastLocalDeliveryAt: string | undefined;
  private localDeliveriesTotal = 0;
  private publishedMessagesTotal = 0;
  private readonly subscribers = new Set<(message: CopStreamMessage) => void>();

  get metrics(): CopStreamBusMetrics {
    return {
      ...(this.lastLocalDeliveryAt ? { lastLocalDeliveryAt: this.lastLocalDeliveryAt } : {}),
      localDeliveriesTotal: this.localDeliveriesTotal,
      mode: this.name,
      publishedMessagesTotal: this.publishedMessagesTotal,
      ready: true,
      receivedMessagesTotal: 0
    };
  }

  async init(): Promise<void> {}

  async close(): Promise<void> {
    this.subscribers.clear();
  }

  diagnostics(): string {
    return `${this.name}: ready; local deliveries ${this.localDeliveriesTotal}`;
  }

  async publish(message: CopStreamMessage): Promise<void> {
    this.publishedMessagesTotal += 1;
    this.emit(message);
  }

  subscribe(subscriber: (message: CopStreamMessage) => void): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private emit(message: CopStreamMessage): void {
    this.localDeliveriesTotal += 1;
    this.lastLocalDeliveryAt = message.serverTimestamp;
    for (const subscriber of Array.from(this.subscribers)) {
      subscriber(message);
    }
  }
}

export class PostgresCopStreamBus implements CopStreamBus {
  readonly name = "postgres";
  private readonly channel: string;
  private readonly clientConfig: PoolConfig;
  private readonly instanceId: string;
  private lastError: string | undefined;
  private lastLocalDeliveryAt: string | undefined;
  private lastPublishedAt: string | undefined;
  private lastReceivedAt: string | undefined;
  private listener: PgClient | undefined;
  private provisionalListener: PgClient | undefined;
  private readonly ownedListeners = new Set<PgClient>();
  private readonly listenerClosures = new WeakMap<PgClient, Promise<void>>();
  private readonly listenerCancellations = new WeakMap<PgClient, () => void>();
  private listenerReady = false;
  private initializing: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  private recoveryEnabled = false;
  private recoveryTimer: NodeJS.Timeout | undefined;
  private recoveryAttempts = 0;
  private localDeliveriesTotal = 0;
  private readonly pool: PgPool;
  private readonly projectionGuard: boolean;
  private readonly projectionOwner: PostgresStreamProjectionErasure;
  private poolReady = false;
  private publishedMessagesTotal = 0;
  private receivedMessagesTotal = 0;
  private readonly subscribers = new Set<(message: CopStreamMessage) => void>();

  constructor(config: PoolConfig, options: { channel?: string; instanceId?: string; projectionGuard?: boolean } = {}) {
    this.clientConfig = {
      ...config,
      application_name: config.application_name ?? "cop-api:stream-listener",
      fallback_application_name: config.fallback_application_name ?? "cop-api:stream-listener"
    };
    this.channel = normalizePostgresChannel(options.channel ?? defaultChannel);
    this.instanceId = options.instanceId?.trim() || randomUUID();
    this.pool = createCopPgPool("stream", config);
    this.projectionGuard = options.projectionGuard === true;
    this.projectionOwner = new PostgresStreamProjectionErasure(this.pool, () => this.projectionGuard && this.metrics.ready);
    this.pool.on("error", () => {
      this.lastError = "STREAM_POOL_UNAVAILABLE";
      this.poolReady = false;
      this.scheduleRecovery();
    });
  }

  get metrics(): CopStreamBusMetrics {
    return {
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.lastLocalDeliveryAt ? { lastLocalDeliveryAt: this.lastLocalDeliveryAt } : {}),
      ...(this.lastPublishedAt ? { lastPublishedAt: this.lastPublishedAt } : {}),
      ...(this.lastReceivedAt ? { lastReceivedAt: this.lastReceivedAt } : {}),
      localDeliveriesTotal: this.localDeliveriesTotal,
      mode: this.name,
      publishedMessagesTotal: this.publishedMessagesTotal,
      ready: !this.closed && this.listenerReady && this.poolReady,
      receivedMessagesTotal: this.receivedMessagesTotal
    };
  }

  async init(): Promise<void> {
    if (this.closed) throw new Error("STREAM_BUS_CLOSED");
    if (this.listenerReady && this.poolReady) return;
    if (this.initializing) return this.initializing;
    const initializing = this.initialize();
    this.initializing = initializing;
    try {
      await initializing;
      this.recoveryEnabled = true;
      this.recoveryAttempts = 0;
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;
    } finally {
      if (this.initializing === initializing) this.initializing = undefined;
    }
  }

  private scheduleRecovery(): void {
    if (this.closed || !this.recoveryEnabled || this.recoveryTimer) return;
    const base = Math.min(10000, 500 * 2 ** Math.min(this.recoveryAttempts++, 5));
    const delay = Math.min(10000, base + Math.floor(Math.random() * base * 0.1));
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      // Re-establish transport only. Never replay publications or transactions.
      void this.init().catch(() => this.scheduleRecovery());
    }, delay);
    this.recoveryTimer.unref();
  }

  private async initialize(): Promise<void> {
    const previousListener = this.listener;
    this.listener = undefined;
    this.listenerReady = false;
    if (previousListener) await this.closeListener(previousListener);
    if (this.closed) throw new Error("STREAM_BUS_CLOSED");
    if (this.ownedListeners.size > 0) {
      this.lastError = "STREAM_LISTENER_CLOSE_UNAVAILABLE";
      throw new Error(this.lastError);
    }
    try {
      await this.pool.query(createStreamBusEventsSql);
      if (this.projectionGuard) await this.pool.query(resourceProjectionFenceTableSql + streamProjectionOwnershipSql);
      this.poolReady = true;
    } catch {
      this.poolReady = false;
      this.lastError = "STREAM_SCHEMA_UNAVAILABLE";
      throw new Error(this.lastError);
    }
    if (this.closed) throw new Error("STREAM_BUS_CLOSED");
    const listener = new Client(this.clientConfig);
    this.ownedListeners.add(listener);
    this.provisionalListener = listener;
    let listenerFailed = false;
    let cancelListener!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancelListener = () => reject(new Error("STREAM_LISTENER_UNAVAILABLE"));
    });
    listener.on("notification", (notification) => {
      if (
        this.closed ||
        !this.listenerReady ||
        this.listener !== listener ||
        notification.channel !== this.channel ||
        !notification.payload
      ) {
        return;
      }
      void this.handleNotification(notification.payload);
    });
    const lost = () => {
      if (listenerFailed) return;
      listenerFailed = true;
      cancelListener();
      if (this.listener === listener) {
        this.lastError = "STREAM_LISTENER_UNAVAILABLE";
        this.listenerReady = false;
        this.scheduleRecovery();
      }
    };
    this.listenerCancellations.set(listener, lost);
    listener.on("error", lost);
    listener.on("end", lost);
    try {
      await Promise.race([listener.connect(), interrupted]);
      if (this.closed || listenerFailed) throw new Error("STREAM_LISTENER_UNAVAILABLE");
      await Promise.race([listener.query(`LISTEN ${quoteIdentifier(this.channel)}`), interrupted]);
      if (this.closed || listenerFailed) throw new Error("STREAM_LISTENER_UNAVAILABLE");
      this.provisionalListener = undefined;
      this.listener = listener;
      this.listenerReady = true;
      if (this.poolReady) this.lastError = undefined;
    } catch {
      if (this.provisionalListener === listener) this.provisionalListener = undefined;
      this.lastError = this.closed ? "STREAM_BUS_CLOSED" : "STREAM_LISTENER_UNAVAILABLE";
      await this.closeListener(listener);
      throw new Error(this.lastError);
    }
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.subscribers.clear();
    this.listenerReady = false;
    this.poolReady = false;
    const closing = (async () => {
      // End the owned provisional connection first; this cancels an unfinished
      // non-pipelined LISTEN instead of waiting for it to complete by itself.
      if (this.provisionalListener) await this.closeListener(this.provisionalListener);
      await this.initializing?.catch(() => undefined);
      if (this.listener) {
        const listener = this.listener;
        this.listener = undefined;
        // Closing the session also removes its LISTEN subscription.
        await this.closeListener(listener);
      }
      await this.pool.end().catch(() => undefined);
    })();
    this.closing = closing;
    return closing;
  }

  private closeListener(listener: PgClient): Promise<void> {
    const existing = this.listenerClosures.get(listener);
    if (existing) return existing;
    this.listenerCancellations.get(listener)?.();
    const closing = listener.end().then(
      () => {
        this.ownedListeners.delete(listener);
      },
      () => {
        this.lastError = "STREAM_LISTENER_CLOSE_UNAVAILABLE";
      }
    );
    this.listenerClosures.set(listener, closing);
    return closing;
  }

  diagnosticCounters(): {
    ownedListenerCount: 0 | 1;
    listenerConnected: boolean;
    poolHealthy: boolean;
    closed: boolean;
  } {
    return {
      ownedListenerCount: this.ownedListeners.size > 0 ? 1 : 0,
      listenerConnected: this.listenerReady && !this.closed,
      poolHealthy: this.poolReady && !this.closed,
      closed: this.closed
    };
  }

  private markPoolAvailable(): void {
    this.poolReady = true;
    if (this.listenerReady && !this.closed) this.lastError = undefined;
  }

  diagnostics(): string {
    const metrics = this.metrics;
    const status = metrics.ready ? "ready" : "degraded";
    const lastError = metrics.lastError ? `; last error ${metrics.lastError}` : "";
    return `${this.name}: ${status}; channel ${this.channel}; published ${metrics.publishedMessagesTotal}; received ${metrics.receivedMessagesTotal}${lastError}`;
  }

  async publish(message: CopStreamMessage): Promise<void> {
    this.publishedMessagesTotal += 1;
    this.lastPublishedAt = message.serverTimestamp;
    const eventId = randomUUID();
    const envelope: CopStreamBusEnvelope = {
      message,
      originId: this.instanceId
    };
    if (this.projectionGuard) {
      // Admission, actual source ownership, persistence and synchronous local
      // delivery share the erasure barrier. A database failure never emits a
      // local-only copy in this mode.
      try {
        await projectionTransaction(this.pool, async client => {
          await assertProjectionPayloadAllowed(client, message);
          await client.query("INSERT INTO cop_stream_bus_events(event_id,origin_id,payload) VALUES($1,$2,$3::jsonb)",
            [eventId, this.instanceId, JSON.stringify(envelope)]);
          await recordStreamProjectionOwners(client, eventId, message);
          await client.query("SELECT pg_notify($1,$2)", [this.channel, eventId]);
          this.emit(message);
        });
        this.markPoolAvailable();
      } catch {
        this.lastError = "STREAM_PUBLISH_UNAVAILABLE"; this.poolReady = false;
        throw new Error(this.lastError);
      }
      return;
    }
    try {
      await this.pool.query(
        `INSERT INTO cop_stream_bus_events (event_id, origin_id, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [eventId, this.instanceId, JSON.stringify(envelope)]
      );
      await this.pool.query("SELECT pg_notify($1, $2)", [this.channel, eventId]);
      this.markPoolAvailable();
    } catch {
      this.lastError = "STREAM_PUBLISH_UNAVAILABLE";
      this.poolReady = false;
    }
    this.emit(message);
  }

  subscribe(subscriber: (message: CopStreamMessage) => void): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  projectionErasureStore(): ResourceProjectionStore | undefined {
    return this.projectionGuard ? this.projectionOwner : undefined;
  }

  private async handleNotification(eventId: string): Promise<void> {
    try {
      if (this.projectionGuard) {
        await projectionTransaction(this.pool, async client => {
          const result = await client.query<StreamBusEventRow>("SELECT origin_id,payload FROM cop_stream_bus_events WHERE event_id=$1", [eventId]);
          const row = result.rows[0];
          if (!row || row.origin_id === this.instanceId) return;
          const envelope = parseEnvelope(row.payload);
          if (!envelope || envelope.originId === this.instanceId) return;
          await assertProjectionPayloadAllowed(client, envelope.message);
          this.receivedMessagesTotal += 1;
          this.lastReceivedAt = envelope.message.serverTimestamp;
          this.emit(envelope.message);
        });
        this.markPoolAvailable(); return;
      }
      const result = await this.pool.query<StreamBusEventRow>(
        `SELECT origin_id, payload
         FROM cop_stream_bus_events
         WHERE event_id = $1`,
        [eventId]
      );
      const row = result.rows[0];
      if (!row || row.origin_id === this.instanceId) {
        return;
      }
      const envelope = parseEnvelope(row.payload);
      if (!envelope || envelope.originId === this.instanceId) {
        return;
      }
      this.receivedMessagesTotal += 1;
      this.lastReceivedAt = envelope.message.serverTimestamp;
      this.markPoolAvailable();
      this.emit(envelope.message);
    } catch {
      this.lastError = "STREAM_RECEIVE_UNAVAILABLE";
      this.poolReady = false;
    }
  }

  private emit(message: CopStreamMessage): void {
    this.localDeliveriesTotal += 1;
    this.lastLocalDeliveryAt = message.serverTimestamp;
    for (const subscriber of Array.from(this.subscribers)) {
      subscriber(message);
    }
  }
}

export function createCopStreamBusFromEnv(env: Record<string, string | undefined> = process.env): CopStreamBus {
  const mode = (env.COP_STREAM_BUS ?? "memory").trim().toLowerCase();
  if (mode === "memory" || mode === "disabled" || mode === "off") {
    return new MemoryCopStreamBus();
  }

  const connectionString = resolveCopSessionDatabaseUrl(env, "COP_STREAM_BUS_DATABASE_URL");
  if ((mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresCopStreamBus(
      {
        connectionString,
        connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
        idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
        max: readPositiveInteger(env.COP_STREAM_BUS_POOL_MAX, 2),
        ssl: readSslConfig(env)
      },
      {
        channel: env.COP_STREAM_BUS_CHANNEL,
        instanceId: env.COP_STREAM_BUS_INSTANCE_ID,
        projectionGuard: !!env.COP_ACCOUNT_ERASURE_SECRET?.trim()
      }
    );
  }

  throw new Error(`Unsupported COP_STREAM_BUS value or missing database URL: ${mode}`);
}

interface StreamBusEventRow {
  origin_id: string;
  payload: CopStreamBusEnvelope | string;
}

const createStreamBusEventsSql = `
CREATE TABLE IF NOT EXISTS cop_stream_bus_events (
  event_id uuid PRIMARY KEY,
  origin_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cop_stream_bus_events_created_at
  ON cop_stream_bus_events (created_at);
`;

function parseEnvelope(value: CopStreamBusEnvelope | string): CopStreamBusEnvelope | undefined {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const envelope = parsed as Partial<CopStreamBusEnvelope>;
  if (!envelope.message || !envelope.originId) {
    return undefined;
  }
  return {
    message: envelope.message,
    originId: envelope.originId
  };
}

function normalizePostgresChannel(channel: string): string {
  const normalized = channel.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(normalized)) {
    throw new Error("COP_STREAM_BUS_CHANNEL must be a PostgreSQL identifier up to 63 characters.");
  }
  return normalized;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  const value = env.COP_DATABASE_SSL?.trim().toLowerCase();
  if (value !== "true" && value !== "1" && value !== "require") {
    return false;
  }
  return {
    rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
  };
}
