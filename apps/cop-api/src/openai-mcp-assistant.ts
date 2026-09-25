import { createHash } from "node:crypto";
import pg, { type Pool as PgPool } from "pg";

const { Pool } = pg;
const model = "gpt-6-luna";
const maxOutputTokens = 512;
const maxInputBytes = 12_000;
const requestTimeoutMs = 20_000;

export interface OpenAiMcpAssistantConfig {
  enabled: boolean;
  apiKey: string;
  connectionString: string;
  dailyUsdMicros: number;
  monthlyUsdMicros: number;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  userDailyRequests: number;
  ssl?: pg.PoolConfig["ssl"];
}

export interface OpenAiUsageSnapshot {
  enabled: boolean;
  model: string;
  daily: { committedUsd: number; limitUsd: number; committedTokens: number; tokenLimit: number; requests: number; inputTokens: number; outputTokens: number };
  monthly: { committedUsd: number; limitUsd: number; committedTokens: number; tokenLimit: number; requests: number; inputTokens: number; outputTokens: number };
}

export function openAiMcpAssistantConfig(env: NodeJS.ProcessEnv = process.env): OpenAiMcpAssistantConfig {
  const enabled = env.COP_OPENAI_MCP_ENABLED === "true";
  const config = {
    enabled,
    apiKey: env.OPENAI_API_KEY?.trim() ?? "",
    connectionString: env.COP_DATABASE_URL?.trim() ?? "",
    dailyUsdMicros: dollarsToMicros(env.COP_OPENAI_MCP_DAILY_USD, 1),
    monthlyUsdMicros: dollarsToMicros(env.COP_OPENAI_MCP_MONTHLY_USD, 10),
    dailyTokenLimit: boundedInt(env.COP_OPENAI_MCP_DAILY_TOKENS, 100_000, 1_000, 100_000_000),
    monthlyTokenLimit: boundedInt(env.COP_OPENAI_MCP_MONTHLY_TOKENS, 1_000_000, 1_000, 1_000_000_000),
    userDailyRequests: boundedInt(env.COP_OPENAI_MCP_USER_DAILY_REQUESTS, 10, 1, 100),
    ssl: env.COP_DATABASE_SSL === "true"
      ? { rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
      : undefined
  };
  if (enabled && (!config.apiKey || !config.connectionString)) {
    throw new Error("COP_OPENAI_MCP_ENABLED requires OPENAI_API_KEY and COP_DATABASE_URL.");
  }
  return config;
}

export function safeSourceHealthContext(result: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(result.items) ? result.items : [];
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const health = (item as Record<string, unknown>).health;
    if (typeof health !== "string" || !/^[A-Z_]{2,24}$/.test(health)) continue;
    counts[health] = (counts[health] ?? 0) + 1;
  }
  return { sourceCount: items.length, healthCounts: counts };
}

export function reservedUsdMicros(inputBytes: number): number {
  if (!Number.isInteger(inputBytes) || inputBytes < 0 || inputBytes > maxInputBytes) {
    throw new Error("OpenAI MCP input size limit exceeded.");
  }
  // A 2x reserve covers tokenization overhead and the configured output ceiling.
  return Math.ceil((inputBytes + 2_048) * 0.2 + maxOutputTokens * 1);
}

export function actualUsdMicros(inputTokens: number, outputTokens: number): number {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
      !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
    throw new Error("Invalid OpenAI token usage.");
  }
  // Standard GPT-6 Luna rates: $0.10 input and $0.50 output per million tokens.
  // Cached input is conservatively charged at the full input rate.
  return Math.ceil(inputTokens * 0.1 + outputTokens * 0.5);
}

export function extractResponseText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.output)) throw new Error("Invalid OpenAI response.");
  const parts: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  const text = parts.join("\n").trim();
  if (!text || text.length > 8_000) throw new Error("Empty or oversized OpenAI response.");
  return text;
}

export class OpenAiMcpAssistant {
  private readonly pool: PgPool;

  constructor(private readonly config: OpenAiMcpAssistantConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      connectionTimeoutMillis: 5_000,
      max: 2,
      ssl: config.ssl
    });
  }

  async close(): Promise<void> { await this.pool.end(); }

  async init(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS cop_openai_mcp_usage (
      scope text NOT NULL,
      period text NOT NULL,
      requests integer NOT NULL DEFAULT 0,
      committed_usd_micros bigint NOT NULL DEFAULT 0,
      committed_tokens bigint NOT NULL DEFAULT 0,
      actual_input_tokens bigint NOT NULL DEFAULT 0,
      actual_output_tokens bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, period)
    )`);
  }

  async usage(now = new Date()): Promise<OpenAiUsageSnapshot> {
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const result = await this.pool.query<{ scope: string; requests: number; committed_usd_micros: string; committed_tokens: string;
      actual_input_tokens: string; actual_output_tokens: string }>(
      "SELECT scope, requests, committed_usd_micros, committed_tokens, actual_input_tokens, actual_output_tokens FROM cop_openai_mcp_usage WHERE (scope = 'global-day' AND period = $1) OR (scope = 'global-month' AND period = $2)",
      [day, month]
    );
    const daily = result.rows.find((row) => row.scope === "global-day");
    const monthly = result.rows.find((row) => row.scope === "global-month");
    return {
      enabled: this.config.enabled,
      model,
      daily: { committedUsd: Number(daily?.committed_usd_micros ?? 0) / 1_000_000,
        limitUsd: this.config.dailyUsdMicros / 1_000_000, committedTokens: Number(daily?.committed_tokens ?? 0),
        tokenLimit: this.config.dailyTokenLimit, requests: daily?.requests ?? 0,
        inputTokens: Number(daily?.actual_input_tokens ?? 0), outputTokens: Number(daily?.actual_output_tokens ?? 0) },
      monthly: { committedUsd: Number(monthly?.committed_usd_micros ?? 0) / 1_000_000,
        limitUsd: this.config.monthlyUsdMicros / 1_000_000, committedTokens: Number(monthly?.committed_tokens ?? 0),
        tokenLimit: this.config.monthlyTokenLimit, requests: monthly?.requests ?? 0,
        inputTokens: Number(monthly?.actual_input_tokens ?? 0), outputTokens: Number(monthly?.actual_output_tokens ?? 0) }
    };
  }

  async summarize(sourceHealth: Record<string, unknown>, actorSubjectId: string, now = new Date()): Promise<{
    summary: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    usage: OpenAiUsageSnapshot;
  }> {
    if (!this.config.enabled) throw new Error("OpenAI MCP assistant is disabled.");
    const input = JSON.stringify(safeSourceHealthContext(sourceHealth));
    const inputBytes = Buffer.byteLength(input);
    const reservation = reservedUsdMicros(inputBytes);
    const tokenReservation = inputBytes + 2_048 + maxOutputTokens;
    const scopes = this.scopes(actorSubjectId, now);
    await this.reserve(scopes, reservation, tokenReservation);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let body: unknown;
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          store: false,
          max_output_tokens: maxOutputTokens,
          reasoning: { effort: "none" },
          instructions: "Jsi asistivní nástroj pro kvalitu dat COP. Odpověz stručně česky pouze z agregovaných počtů stavů zdrojů. Nepředstírej ověřené krizové události ani živost dat. Nedoporučuj operační zásahy. Pokud jsou zdroje nedostupné, označ nejistotu.",
          input
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`OpenAI response HTTP ${response.status}.`);
      body = await response.json();
    } finally {
      clearTimeout(timer);
    }
    const summary = extractResponseText(body);
    const usage = isRecord(body) && isRecord(body.usage) ? body.usage : null;
    const inputTokens = usage?.input_tokens;
    const outputTokens = usage?.output_tokens;
    if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
      throw new Error("OpenAI response did not include valid token usage; reservation retained.");
    }
    const actual = actualUsdMicros(inputTokens, outputTokens);
    if (actual > reservation || inputTokens + outputTokens > tokenReservation) {
      throw new Error("OpenAI usage exceeded reservation; reservation retained.");
    }
    await this.settle(scopes, reservation, actual, tokenReservation, inputTokens, outputTokens);
    return { summary, model, inputTokens, outputTokens, estimatedUsd: actual / 1_000_000,
      usage: await this.usage(now) };
  }

  private scopes(actorSubjectId: string, now: Date) {
    const day = now.toISOString().slice(0, 10);
    const actorHash = createHash("sha256").update(actorSubjectId).digest("hex").slice(0, 32);
    return [
      { scope: "global-day", period: day, limit: this.config.dailyUsdMicros,
        tokenLimit: this.config.dailyTokenLimit, maxRequests: Number.MAX_SAFE_INTEGER },
      { scope: "global-month", period: day.slice(0, 7), limit: this.config.monthlyUsdMicros,
        tokenLimit: this.config.monthlyTokenLimit, maxRequests: Number.MAX_SAFE_INTEGER },
      { scope: `user:${actorHash}`, period: day, limit: this.config.dailyUsdMicros,
        tokenLimit: this.config.dailyTokenLimit, maxRequests: this.config.userDailyRequests }
    ];
  }

  private async reserve(scopes: ReturnType<OpenAiMcpAssistant["scopes"]>, amount: number,
    tokens: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of scopes) {
        await client.query("INSERT INTO cop_openai_mcp_usage (scope, period) VALUES ($1, $2) ON CONFLICT DO NOTHING", [item.scope, item.period]);
        const result = await client.query<{ requests: number; committed_usd_micros: string; committed_tokens: string }>(
          "SELECT requests, committed_usd_micros, committed_tokens FROM cop_openai_mcp_usage WHERE scope = $1 AND period = $2 FOR UPDATE",
          [item.scope, item.period]
        );
        const row = result.rows[0];
        if (!row || row.requests >= item.maxRequests || Number(row.committed_usd_micros) + amount > item.limit ||
            Number(row.committed_tokens) + tokens > item.tokenLimit) {
          throw new Error("OpenAI MCP usage limit reached.");
        }
        await client.query("UPDATE cop_openai_mcp_usage SET requests = requests + 1, committed_usd_micros = committed_usd_micros + $3, committed_tokens = committed_tokens + $4, updated_at = now() WHERE scope = $1 AND period = $2", [item.scope, item.period, amount, tokens]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async settle(scopes: ReturnType<OpenAiMcpAssistant["scopes"]>, reserved: number,
    actual: number, reservedTokens: number, inputTokens: number, outputTokens: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of scopes) {
        await client.query(`UPDATE cop_openai_mcp_usage SET
          committed_usd_micros = committed_usd_micros - $3 + $4,
          committed_tokens = committed_tokens - $5 + $6 + $7,
          actual_input_tokens = actual_input_tokens + $6,
          actual_output_tokens = actual_output_tokens + $7,
          updated_at = now() WHERE scope = $1 AND period = $2`,
        [item.scope, item.period, reserved, actual, reservedTokens, inputTokens, outputTokens]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

function dollarsToMicros(value: string | undefined, fallback: number): number {
  const amount = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000) throw new Error("Invalid OpenAI budget configuration.");
  return Math.floor(amount * 1_000_000);
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error("Invalid OpenAI request limit configuration.");
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
