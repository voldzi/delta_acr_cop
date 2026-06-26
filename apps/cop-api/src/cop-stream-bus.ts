import { randomUUID } from "node:crypto";
import pg, { type Client as PgClient, type Pool as PgPool, type PoolConfig } from "pg";
import type { CopStreamMessage } from "./cop-stream.js";

const { Client, Pool } = pg;
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
  init(): Promise<void>;
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
  private localDeliveriesTotal = 0;
  private readonly pool: PgPool;
  private publishedMessagesTotal = 0;
  private ready = false;
  private receivedMessagesTotal = 0;
  private readonly subscribers = new Set<(message: CopStreamMessage) => void>();

  constructor(config: PoolConfig, options: { channel?: string; instanceId?: string } = {}) {
    this.clientConfig = config;
    this.channel = normalizePostgresChannel(options.channel ?? defaultChannel);
    this.instanceId = options.instanceId?.trim() || randomUUID();
    this.pool = new Pool(config);
    this.pool.on("error", (error) => {
      this.lastError = errorMessage(error);
      this.ready = false;
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
      ready: this.ready,
      receivedMessagesTotal: this.receivedMessagesTotal
    };
  }

  async init(): Promise<void> {
    await this.pool.query(createStreamBusEventsSql);
    const listener = new Client(this.clientConfig);
    listener.on("notification", (notification) => {
      if (notification.channel !== this.channel || !notification.payload) {
        return;
      }
      void this.handleNotification(notification.payload);
    });
    listener.on("error", (error) => {
      this.lastError = errorMessage(error);
      this.ready = false;
    });
    await listener.connect();
    await listener.query(`LISTEN ${quoteIdentifier(this.channel)}`);
    this.listener = listener;
    this.ready = true;
  }

  async close(): Promise<void> {
    this.subscribers.clear();
    this.ready = false;
    if (this.listener) {
      await this.listener.query(`UNLISTEN ${quoteIdentifier(this.channel)}`).catch(() => undefined);
      await this.listener.end().catch(() => undefined);
      this.listener = undefined;
    }
    await this.pool.end().catch(() => undefined);
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
    try {
      await this.pool.query(
        `INSERT INTO cop_stream_bus_events (event_id, origin_id, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [eventId, this.instanceId, JSON.stringify(envelope)]
      );
      await this.pool.query("SELECT pg_notify($1, $2)", [this.channel, eventId]);
      this.lastError = undefined;
      this.ready = true;
    } catch (error) {
      this.lastError = errorMessage(error);
      this.ready = false;
    }
    this.emit(message);
  }

  subscribe(subscriber: (message: CopStreamMessage) => void): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private async handleNotification(eventId: string): Promise<void> {
    try {
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
      this.lastError = undefined;
      this.ready = true;
      this.emit(envelope.message);
    } catch (error) {
      this.lastError = errorMessage(error);
      this.ready = false;
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

  const connectionString = env.COP_STREAM_BUS_DATABASE_URL?.trim() || env.COP_DATABASE_URL?.trim();
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
        instanceId: env.COP_STREAM_BUS_INSTANCE_ID
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
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
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
  return `"${value.replaceAll("\"", "\"\"")}"`;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
