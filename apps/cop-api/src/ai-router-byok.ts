import { createHmac } from "node:crypto";
import { opaqueUserId, type CopRouterChatConfig } from "./ai-router-chat.js";

export interface CopByokConfig extends CopRouterChatConfig {
  actorSecret: string;
}

export class CopByokError extends Error {
  constructor(public readonly code: "invalid_input" | "invalid_key" | "key_unavailable" | "limit_reached" | "router_unavailable" | "invalid_response") {
    super(code);
  }
}

function routerUrl(config: CopByokConfig): URL {
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { throw new CopByokError("router_unavailable"); }
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.username ||
      url.password || url.search || url.hash || config.token.length < 32 ||
      config.userIdSecret.length < 32 || config.actorSecret.length < 32) {
    throw new CopByokError("router_unavailable");
  }
  return url;
}

export function signedCopActor(config: CopByokConfig, subjectId: string, issuedAt = Math.floor(Date.now() / 1000)) {
  if (!subjectId || subjectId.length > 512) throw new CopByokError("invalid_input");
  const sub = opaqueUserId(config.userIdSecret, subjectId);
  const actor = Buffer.from(JSON.stringify({ sub, aud: "sim-ai-router", iat: issuedAt, exp: issuedAt + 60 })).toString("base64url");
  const signature = createHmac("sha256", config.actorSecret).update(actor).digest("hex");
  return { "x-cop-actor": actor, "x-cop-actor-signature": signature };
}

function validQuestion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1200 && value.trim().length > 0 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
}

/** Only the signed-in user's authored question crosses this boundary. No caller-supplied context is attested. */
export class CopByokRouterClient {
  private readonly url: URL;
  constructor(private readonly config: CopByokConfig) { this.url = routerUrl(config); }

  async status(subjectId: string): Promise<{ configured: boolean }> {
    const response = await this.call("GET", "/api/v1/ai-router/cop/users/me/openai-key", subjectId);
    const data = await this.json(response);
    if (typeof data.configured !== "boolean") throw new CopByokError("invalid_response");
    return { configured: data.configured };
  }

  async putKey(subjectId: string, apiKey: unknown): Promise<{ configured: true }> {
    if (typeof apiKey !== "string" || !/^sk-[A-Za-z0-9_-]{17,509}$/u.test(apiKey) || apiKey.length > 512) {
      throw new CopByokError("invalid_input");
    }
    const response = await this.call("PUT", "/api/v1/ai-router/cop/users/me/openai-key", subjectId, { apiKey });
    const data = await this.json(response);
    if (data.configured !== true) throw new CopByokError("invalid_response");
    return { configured: true };
  }

  async deleteKey(subjectId: string): Promise<{ configured: false }> {
    const response = await this.call("DELETE", "/api/v1/ai-router/cop/users/me/openai-key", subjectId);
    if (response.status !== 204) throw new CopByokError("invalid_response");
    return { configured: false };
  }

  async chat(subjectId: string, question: unknown, automaticContext?: unknown) {
    if (!validQuestion(question) || automaticContext !== undefined) throw new CopByokError("invalid_input");
    const response = await this.call("POST", "/api/v1/ai-router/cop/chat", subjectId, {
      contractVersion: "cop-chat-byok-v1", billingSource: "user_openai_key", question, allowExternal: true
    });
    const data = await this.json(response);
    const usage = data.usage && typeof data.usage === "object" && !Array.isArray(data.usage)
      ? data.usage as Record<string, unknown> : null;
    if (data.billingSource !== "user_openai_key" || data.model !== "gpt-6-luna" ||
        typeof data.requestId !== "string" || typeof data.output !== "string" || !data.output.trim() ||
        data.requiresHumanReview !== true || !usage || usage.actualProviderChargesVerified !== false ||
        ![usage.inputTokens, usage.outputTokens, usage.estimatedMicrousd].every((value) =>
          Number.isSafeInteger(value) && Number(value) >= 0)) {
      throw new CopByokError("invalid_response");
    }
    return data as { requestId: string; model: string; output: string; billingSource: "user_openai_key";
      usage: { inputTokens: number; outputTokens: number; estimatedMicrousd: number; actualProviderChargesVerified: false } };
  }

  private async call(method: string, path: string, subjectId: string, body?: object): Promise<Response> {
    const actorHeaders = signedCopActor(this.config, subjectId);
    let response: Response;
    try {
      response = await fetch(new URL(path, this.url), {
        method,
        headers: { authorization: `Bearer ${this.config.token}`, ...actorHeaders,
          ...(body ? { "content-type": "application/json" } : {}), "cache-control": "no-store" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(60_000)
      });
    } catch { throw new CopByokError("router_unavailable"); }
    if (response.status === 400) throw new CopByokError("invalid_input");
    if (response.status === 422) throw new CopByokError(method === "PUT" ? "invalid_key" : "key_unavailable");
    if (response.status === 429) throw new CopByokError("limit_reached");
    if (!response.ok) throw new CopByokError("router_unavailable");
    return response;
  }

  private async json(response: Response): Promise<Record<string, unknown>> {
    let data: unknown;
    try { data = await response.json(); } catch { throw new CopByokError("invalid_response"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new CopByokError("invalid_response");
    return data as Record<string, unknown>;
  }
}
