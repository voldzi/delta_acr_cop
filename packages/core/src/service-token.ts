export type ServiceAuthMode = "static" | "oidc";

export interface ServiceTokenOptions {
  mode: ServiceAuthMode;
  staticToken?: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
  refreshAt: number;
}

const unavailableMessage = "Service authentication is unavailable.";
const maxResponseBytes = 64 * 1024;
const maxTokenLength = 8192;
const maxLifetimeSeconds = 3600;

/** Server-only client credentials. Tokens remain in RAM and failures never fall back to static auth. */
export class ServiceTokenProvider {
  private readonly options: Readonly<ServiceTokenOptions>;
  private cached?: CachedToken;
  private inFlight?: Promise<string>;

  constructor(
    options: ServiceTokenOptions,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {
    this.options = Object.freeze({ ...options });
  }

  async getToken(): Promise<string> {
    if (this.options.mode === "static") return this.options.staticToken ?? "";
    if (this.options.mode !== "oidc") throw unavailable();
    const currentTime = this.now();
    if (!Number.isFinite(currentTime)) throw unavailable();
    if (this.cached && currentTime < this.cached.refreshAt) return this.cached.token;
    if (this.inFlight) return this.inFlight;

    // Once renewal is required, the previous token is unavailable even if its
    // hard expiry has not arrived. An identity-provider outage must fail closed.
    this.cached = undefined;
    const pending = this.acquire();
    this.inFlight = pending;
    try {
      return await pending;
    } finally {
      if (this.inFlight === pending) this.inFlight = undefined;
    }
  }

  invalidate(token: string): void {
    if (this.cached?.token === token) this.cached = undefined;
  }

  private async acquire(): Promise<string> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const { tokenEndpoint, clientId, clientSecret, timeoutMs } = this.oidcConfiguration();
      const requestStartedAt = this.now();
      if (!Number.isFinite(requestStartedAt)) throw unavailable();
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(unavailable());
        }, timeoutMs);
      });
      const result = await Promise.race([
        this.exchange(tokenEndpoint, clientId, clientSecret, requestStartedAt, controller.signal),
        deadline
      ]);
      const receivedAt = this.now();
      if (controller.signal.aborted || !Number.isFinite(receivedAt) || receivedAt >= result.expiresAt) {
        throw unavailable();
      }
      this.cached = result;
      return result.token;
    } catch {
      // Provider bodies, errors, URLs and credentials are never included here.
      throw unavailable();
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private oidcConfiguration() {
    const { issuer, clientId, clientSecret } = this.options;
    if (typeof issuer !== "string" || !issuer.trim() || issuer.length > 2048
      || typeof clientId !== "string" || !clientId.trim() || clientId.length > 256
      || typeof clientSecret !== "string" || !clientSecret.trim() || clientSecret.length > 8192) {
      throw unavailable();
    }
    const url = new URL(issuer.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || issuer.includes("?") || issuer.includes("#")) throw unavailable();
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw unavailable();
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/protocol/openid-connect/token`;
    return { tokenEndpoint: url.href, clientId, clientSecret, timeoutMs };
  }

  private async exchange(
    tokenEndpoint: string, clientId: string, clientSecret: string,
    requestStartedAt: number, signal: AbortSignal
  ): Promise<CachedToken> {
    const response = await this.fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
      redirect: "error",
      signal
    });
    if (signal.aborted || !response.ok || response.redirected) {
      void response.body?.cancel().catch(() => undefined);
      throw unavailable();
    }
    const payload: unknown = JSON.parse(await boundedResponseText(response, signal));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw unavailable();
    const values = payload as Record<string, unknown>;
    const token = values.access_token;
    const lifetime = values.expires_in;
    if (typeof token !== "string" || !token || token.length > maxTokenLength
      || !/^[A-Za-z0-9._~+/-]+=*$/u.test(token)
      || typeof values.token_type !== "string" || values.token_type.toLowerCase() !== "bearer"
      || typeof lifetime !== "number" || !Number.isFinite(lifetime)
      || lifetime <= 0 || lifetime > maxLifetimeSeconds) throw unavailable();
    const lifetimeMs = lifetime * 1000;
    return {
      token,
      expiresAt: requestStartedAt + lifetimeMs,
      refreshAt: requestStartedAt + lifetimeMs - Math.min(30_000, lifetimeMs * 0.2)
    };
  }
}

async function boundedResponseText(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maxResponseBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw unavailable();
  }
  if (!response.body || signal.aborted) throw unavailable();
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let finished = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw unavailable();
      if (chunk.done) {
        finished = true;
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxResponseBytes) throw unavailable();
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } finally {
    signal.removeEventListener("abort", abort);
    if (!finished) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function unavailable(): Error {
  return new Error(unavailableMessage);
}
