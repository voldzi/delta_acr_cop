import { safeSourceHealthContext, type OpenAiUsageSnapshot } from "./openai-mcp-assistant.js";

export interface AiRouterMcpConfig {
  enabled: boolean;
  baseUrl: string;
  token: string;
}

export function aiRouterMcpConfig(env: NodeJS.ProcessEnv = process.env): AiRouterMcpConfig {
  const enabled = env.COP_AI_ROUTER_ENABLED === "true";
  const baseUrl = env.COP_AI_ROUTER_URL?.trim() ?? "";
  const token = env.COP_AI_ROUTER_TOKEN?.trim() ?? "";
  if (enabled) {
    let url: URL;
    try { url = new URL(baseUrl); } catch { throw new Error("COP_AI_ROUTER_URL is invalid."); }
    if (!token || token.length < 32 || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("COP_AI_ROUTER_ENABLED requires an internal URL and dedicated token.");
    }
  }
  return { enabled, baseUrl, token };
}

interface RouterUsage {
  dailyMicrousd: number;
  monthlyMicrousd: number;
  dailyRequests: number;
  monthlyRequests: number;
  dailyInputTokens: number;
  dailyOutputTokens: number;
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  limits: { dailyMicrousd: number; monthlyMicrousd: number; perUserDailyRequests: number };
}

export class AiRouterMcpAssistant {
  constructor(private readonly config: AiRouterMcpConfig) {}

  async init(): Promise<void> {
    const response = await this.call("/health/ready");
    if (!response.ok) throw new Error("AI Router is not ready.");
  }

  async close(): Promise<void> {}

  async usage(): Promise<OpenAiUsageSnapshot> {
    const response = await this.call("/api/v1/ai-router/usage");
    if (!response.ok) throw new Error("AI Router usage is unavailable.");
    const data = (await response.json()) as RouterUsage;
    for (const value of [data.dailyMicrousd, data.monthlyMicrousd, data.dailyRequests, data.monthlyRequests,
      data.dailyInputTokens, data.dailyOutputTokens, data.monthlyInputTokens, data.monthlyOutputTokens,
      data.limits?.dailyMicrousd, data.limits?.monthlyMicrousd]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid AI Router usage response.");
    }
    return {
      enabled: true,
      model: "shared-ai-router",
      daily: {
        committedUsd: data.dailyMicrousd / 1_000_000,
        limitUsd: data.limits.dailyMicrousd / 1_000_000,
        committedTokens: data.dailyInputTokens + data.dailyOutputTokens,
        tokenLimit: 0,
        requests: data.dailyRequests,
        inputTokens: data.dailyInputTokens,
        outputTokens: data.dailyOutputTokens
      },
      monthly: {
        committedUsd: data.monthlyMicrousd / 1_000_000,
        limitUsd: data.limits.monthlyMicrousd / 1_000_000,
        committedTokens: data.monthlyInputTokens + data.monthlyOutputTokens,
        tokenLimit: 0,
        requests: data.monthlyRequests,
        inputTokens: data.monthlyInputTokens,
        outputTokens: data.monthlyOutputTokens
      }
    };
  }

  async summarize(sourceHealth: Record<string, unknown>, actorSubjectId: string, _now?: Date): Promise<{
    summary: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    usage: OpenAiUsageSnapshot;
  }> {
    const aggregate = safeSourceHealthContext(sourceHealth);
    const prompt = `Shrň stručně česky pouze agregované počty zdraví datových zdrojů COP. Nevydávej je za ověřené krizové události ani nedávej operační pokyny. Uveď nejistotu a potřebu lidské kontroly. Data: ${JSON.stringify(aggregate)}`;
    const response = await this.call("/api/v1/ai-router/generate", {
      method: "POST",
      body: JSON.stringify({ taskType: "source_health", dataClass: "public_aggregate", preference: "auto", prompt,
        userId: actorSubjectId, allowExternal: true, allowPaidEscalation: false, maxOutputTokens: 320 })
    });
    if (response.status === 429) throw new Error("OpenAI MCP usage limit reached.");
    if (!response.ok) throw new Error("AI Router generation is unavailable.");
    const result = (await response.json()) as { output?: unknown; model?: unknown; usage?: { inputTokens?: unknown; outputTokens?: unknown; estimatedMicrousd?: unknown }; requiresHumanReview?: unknown };
    if (typeof result.output !== "string" || !result.output.trim() || result.output.length > 8_000 ||
      typeof result.model !== "string" || result.requiresHumanReview !== true ||
      !Number.isSafeInteger(result.usage?.inputTokens) || !Number.isSafeInteger(result.usage?.outputTokens) ||
      !Number.isSafeInteger(result.usage?.estimatedMicrousd)) {
      throw new Error("Invalid AI Router generation response.");
    }
    return { summary: result.output, model: result.model,
      inputTokens: result.usage!.inputTokens as number, outputTokens: result.usage!.outputTokens as number,
      estimatedUsd: (result.usage!.estimatedMicrousd as number) / 1_000_000,
      usage: await this.usage() };
  }

  private call(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(new URL(path, this.config.baseUrl), {
      ...options,
      headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(30_000)
    });
  }
}
