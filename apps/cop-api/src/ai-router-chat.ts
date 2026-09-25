import { createHmac } from "node:crypto";

const CONTEXT_VERSION = "cop-chat-context-v1";
const ATTESTATION = "cop-policy-reviewed-v1";
const CODE = /^[A-Za-z0-9_.-]{1,64}$/u;
const REGION = /^CZ(?:\d{3})?$/u;
const UNITS = new Set(["count", "percent", "minutes", "km", "index"]);

export interface CopRouterChatConfig {
  baseUrl: string;
  token: string;
  userIdSecret: string;
}

export interface ReviewedSyntheticScenario {
  scenarioId: string;
  facts: string[];
}

export interface ReviewedPublicAggregate {
  sourceId: string;
  metricId: string;
  regionCode: string;
  periodStart: string;
  periodEnd: string;
  value: number;
  unit: "count" | "percent" | "minutes" | "km" | "index";
  sampleSize: number;
}

export interface ReviewedInternalItem {
  kind: "chat_message" | "alert" | "community_report" | "map_result" | "source_health";
  text: string;
}

/** Server-reviewed, non-personal facts. Free text and message bodies are excluded. */
export type ReviewedMinimizedItem =
  | { kind: "source_health"; sourceId: string; status: "up" | "degraded" | "down" }
  | { kind: "operational_metric"; metricId: string; regionCode: string; value: number; unit: "count" | "percent" | "minutes" | "km" | "index"; sampleSize: number };

export type CopRouterChatRequest =
  | { kind: "internal"; actorSubjectId: string; question: string; items?: ReviewedInternalItem[] }
  | { kind: "internal_minimized"; actorSubjectId: string; reviewedQuestion: string; externalApproval: true; items?: ReviewedMinimizedItem[] }
  | { kind: "synthetic"; actorSubjectId: string; scenario: ReviewedSyntheticScenario; intent: "summarize" | "explain" }
  | {
      kind: "public_aggregate";
      actorSubjectId: string;
      aggregates: ReviewedPublicAggregate[];
      intent: "summarize" | "compare";
    };

export interface CopRouterChatResult {
  requestId: string;
  model: string;
  tier: "local_fast" | "external_economy";
  output: string;
  usage: { inputTokens: number; outputTokens: number; estimatedMicrousd: number };
  requiresHumanReview: true;
}

export class CopRouterChatError extends Error {
  constructor(public readonly code: "invalid_input" | "limit_reached" | "router_unavailable" | "invalid_response") {
    super(code);
  }
}

function fail(): never {
  throw new CopRouterChatError("invalid_input");
}

function exactKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validQuestion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 1200 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
  );
}

function validScenario(value: unknown): value is ReviewedSyntheticScenario {
  if (!exactKeys(value, ["scenarioId", "facts"])) return false;
  const scenario = value as ReviewedSyntheticScenario;
  return (
    typeof scenario.scenarioId === "string" &&
    CODE.test(scenario.scenarioId) &&
    Array.isArray(scenario.facts) &&
    scenario.facts.length >= 1 &&
    scenario.facts.length <= 12 &&
    scenario.facts.every((fact) => typeof fact === "string" && fact.trim().length > 0 && fact.length <= 240)
  );
}

function validAggregate(value: unknown): value is ReviewedPublicAggregate {
  if (
    !exactKeys(value, ["sourceId", "metricId", "regionCode", "periodStart", "periodEnd", "value", "unit", "sampleSize"])
  )
    return false;
  const item = value as ReviewedPublicAggregate;
  if (
    typeof item.sourceId !== "string" ||
    typeof item.metricId !== "string" ||
    typeof item.regionCode !== "string" ||
    typeof item.periodStart !== "string" ||
    typeof item.periodEnd !== "string" ||
    typeof item.unit !== "string"
  )
    return false;
  const start = Date.parse(item.periodStart);
  const end = Date.parse(item.periodEnd);
  return (
    CODE.test(item.sourceId) &&
    CODE.test(item.metricId) &&
    REGION.test(item.regionCode) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(item.periodStart) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(item.periodEnd) &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end - start >= 3_600_000 &&
    Number.isFinite(item.value) &&
    UNITS.has(item.unit) &&
    Number.isSafeInteger(item.sampleSize) &&
    item.sampleSize >= 10
  );
}

function validInternalItem(value: unknown): value is ReviewedInternalItem {
  if (!exactKeys(value, ["kind", "text"])) return false;
  const item = value as ReviewedInternalItem;
  return ["chat_message", "alert", "community_report", "map_result", "source_health"].includes(item.kind) &&
    typeof item.text === "string" && item.text.trim().length > 0 && item.text.length <= 600 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(item.text);
}

function validMinimizedItem(value: unknown): value is ReviewedMinimizedItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.kind === "source_health") return exactKeys(value, ["kind", "sourceId", "status"]) &&
    typeof item.sourceId === "string" && CODE.test(item.sourceId) &&
    ["up", "degraded", "down"].includes(item.status as string);
  if (item.kind === "operational_metric") return exactKeys(value, ["kind", "metricId", "regionCode", "value", "unit", "sampleSize"]) &&
    typeof item.metricId === "string" && CODE.test(item.metricId) &&
    typeof item.regionCode === "string" && REGION.test(item.regionCode) &&
    typeof item.value === "number" && Number.isFinite(item.value) &&
    typeof item.unit === "string" && UNITS.has(item.unit) &&
    Number.isSafeInteger(item.sampleSize) && Number(item.sampleSize) >= 10;
  return false;
}

function checkedConfig(config: CopRouterChatConfig): URL {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    return fail();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    config.token.length < 32 ||
    config.userIdSecret.length < 32
  )
    fail();
  return url;
}

function opaqueUserId(secret: string, subjectId: string): string {
  if (!subjectId || subjectId.length > 512) fail();
  return `cop_${createHmac("sha256", secret).update("cop-router-chat-v1\0").update(subjectId).digest("base64url")}`;
}

function requestBody(input: CopRouterChatRequest, userId: string): Record<string, unknown> {
  const common = { taskType: "cop_chat", userId, allowPaidEscalation: false, maxOutputTokens: 512 };
  if (input.kind === "internal") {
    if (!validQuestion(input.question)) fail();
    if (input.items !== undefined && (!Array.isArray(input.items) || input.items.length < 1 ||
      input.items.length > 16 || !input.items.every(validInternalItem))) fail();
    return {
      ...common,
      dataClass: "internal",
      preference: "local",
      prompt: input.question.trim(),
      allowExternal: false,
      copContext: input.items
        ? { contractVersion: CONTEXT_VERSION, dataClass: "internal", attestation: "cop-internal-reviewed-v1", items: input.items }
        : { contractVersion: CONTEXT_VERSION, dataClass: "internal" }
    };
  }
  if (input.kind === "internal_minimized") {
    const keys = input.items === undefined
      ? ["kind", "actorSubjectId", "reviewedQuestion", "externalApproval"]
      : ["kind", "actorSubjectId", "reviewedQuestion", "externalApproval", "items"];
    if (!exactKeys(input, keys) || input.externalApproval !== true || !validQuestion(input.reviewedQuestion) ||
      (input.items !== undefined && (!Array.isArray(input.items) || input.items.length < 1 ||
        input.items.length > 12 || !input.items.every(validMinimizedItem)))) fail();
    return {
      ...common,
      dataClass: "internal_minimized",
      preference: "external",
      prompt: input.reviewedQuestion.trim(),
      allowExternal: true,
      copContext: {
        contractVersion: CONTEXT_VERSION,
        dataClass: "internal_minimized",
        attestation: "cop-internal-minimized-reviewed-v1",
        items: input.items ?? []
      }
    };
  }
  if (input.kind === "synthetic") {
    if (!validScenario(input.scenario) || !["summarize", "explain"].includes(input.intent)) fail();
    return {
      ...common,
      dataClass: "synthetic",
      preference: "external",
      allowExternal: true,
      prompt:
        input.intent === "summarize"
          ? "Stručně česky shrň výhradně tyto fiktivní body. Uveď, že jde o cvičení."
          : "Vysvětli česky tyto fiktivní body a jejich nejistotu. Uveď, že jde o cvičení.",
      copContext: {
        contractVersion: CONTEXT_VERSION,
        dataClass: "synthetic",
        attestation: ATTESTATION,
        scenarioId: input.scenario.scenarioId,
        facts: input.scenario.facts
      }
    };
  }
  if (input.kind === "public_aggregate") {
    if (
      !Array.isArray(input.aggregates) ||
      input.aggregates.length < 1 ||
      input.aggregates.length > 20 ||
      !input.aggregates.every(validAggregate) ||
      !["summarize", "compare"].includes(input.intent)
    )
      fail();
    return {
      ...common,
      dataClass: "public_aggregate",
      preference: "external",
      allowExternal: true,
      prompt:
        input.intent === "summarize"
          ? "Stručně česky shrň pouze tyto veřejné agregované hodnoty, jejich období a nejistotu."
          : "Česky porovnej pouze tyto veřejné agregované hodnoty a jejich období. Nepopisuj jednotlivce ani incidenty.",
      copContext: {
        contractVersion: CONTEXT_VERSION,
        dataClass: "public_aggregate",
        attestation: ATTESTATION,
        aggregates: input.aggregates
      }
    };
  }
  return fail();
}

function validResult(value: unknown, expectedTier: CopRouterChatResult["tier"]): value is CopRouterChatResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<CopRouterChatResult>;
  return (
    typeof result.requestId === "string" &&
    result.requestId.length > 0 &&
    typeof result.model === "string" &&
    result.model.length > 0 &&
    result.tier === expectedTier &&
    (expectedTier !== "external_economy" || result.model === "gpt-6-luna") &&
    typeof result.output === "string" &&
    result.output.trim().length > 0 &&
    result.output.length <= 8_000 &&
    result.requiresHumanReview === true &&
    Boolean(result.usage) &&
    [result.usage?.inputTokens, result.usage?.outputTokens, result.usage?.estimatedMicrousd].every(
      (value) => Number.isSafeInteger(value) && Number(value) >= 0
    )
  );
}

/** Staged boundary: only a trusted COP server-side caller may attest source-owned context. */
export class CopAiRouterChatAdapter {
  private readonly url: URL;

  constructor(private readonly config: CopRouterChatConfig) {
    this.url = checkedConfig(config);
  }

  async generate(input: CopRouterChatRequest): Promise<CopRouterChatResult> {
    const userId = opaqueUserId(this.config.userIdSecret, input.actorSubjectId);
    const body = requestBody(input, userId);
    let response: Response;
    try {
      response = await fetch(new URL("/api/v1/ai-router/generate", this.url), {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(input.kind === "internal" ? 100_000 : 30_000)
      });
    } catch {
      throw new CopRouterChatError("router_unavailable");
    }
    if (response.status === 429) throw new CopRouterChatError("limit_reached");
    if (!response.ok) throw new CopRouterChatError("router_unavailable");
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new CopRouterChatError("invalid_response");
    }
    const expectedTier = input.kind === "internal" ? "local_fast" : "external_economy";
    if (!validResult(data, expectedTier)) throw new CopRouterChatError("invalid_response");
    return data;
  }
}
