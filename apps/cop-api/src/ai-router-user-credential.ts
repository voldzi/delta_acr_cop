import { opaqueUserId, type CopRouterChatConfig } from "./ai-router-chat.js";

export class RouterCredentialError extends Error {
  constructor(public readonly code: "invalid_key" | "router_unavailable") {
    super(code);
  }
}

/** COP relays a user-provided key once; only SIM Router persists it. */
export class CopRouterUserCredentialClient {
  private readonly baseUrl: URL;

  constructor(private readonly config: CopRouterChatConfig) {
    try {
      this.baseUrl = new URL(config.baseUrl);
    } catch {
      throw new RouterCredentialError("router_unavailable");
    }
    if (!["http:", "https:"].includes(this.baseUrl.protocol) || this.baseUrl.pathname !== "/" ||
      this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash ||
      config.token.length < 32 || config.userIdSecret.length < 32) {
      throw new RouterCredentialError("router_unavailable");
    }
  }

  async status(actorSubjectId: string): Promise<{ configured: boolean; provider: "openai" }> {
    const response = await this.call("status", actorSubjectId);
    if (typeof response.configured !== "boolean" || response.provider !== "openai") {
      throw new RouterCredentialError("router_unavailable");
    }
    return { configured: response.configured, provider: "openai" };
  }

  async register(actorSubjectId: string, apiKey: unknown): Promise<{ configured: true; provider: "openai" }> {
    if (typeof apiKey !== "string" || !/^sk-[A-Za-z0-9_-]{20,512}$/u.test(apiKey)) {
      throw new RouterCredentialError("invalid_key");
    }
    const response = await this.call("register", actorSubjectId, { apiKey });
    if (response.configured !== true || response.provider !== "openai") {
      throw new RouterCredentialError("router_unavailable");
    }
    return { configured: true, provider: "openai" };
  }

  async remove(actorSubjectId: string): Promise<{ configured: false; provider: "openai" }> {
    const response = await this.call("remove", actorSubjectId);
    if (response.configured !== false || response.provider !== "openai") {
      throw new RouterCredentialError("router_unavailable");
    }
    return { configured: false, provider: "openai" };
  }

  private async call(action: "status" | "register" | "remove", actorSubjectId: string,
    extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const userId = opaqueUserId(this.config.userIdSecret, actorSubjectId);
    try {
      const response = await fetch(new URL(`/api/v1/ai-router/cop-chat-credentials/${action}`, this.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
          "cache-control": "no-store"
        },
        body: JSON.stringify({ userId, provider: "openai", ...extra }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new RouterCredentialError("router_unavailable");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new RouterCredentialError("router_unavailable");
      }
      return result as Record<string, unknown>;
    } catch {
      throw new RouterCredentialError("router_unavailable");
    }
  }
}
