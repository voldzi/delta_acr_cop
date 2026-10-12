import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceTokenProvider, type ServiceTokenOptions } from "./service-token.js";

const options: ServiceTokenOptions = {
  mode: "oidc", issuer: "https://identity.example.test/realms/cop/",
  clientId: "synthetic-service", clientSecret: "synthetic-client-secret"
};
const errorMessage = "Service authentication is unavailable.";
const payload = (token = "synthetic-access-token", expiresIn = 60) => ({
  access_token: token, token_type: "Bearer", expires_in: expiresIn
});
const response = (token = "synthetic-access-token", expiresIn = 60) =>
  Response.json(payload(token, expiresIn));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("server service token provider", () => {
  it.each([undefined, "", "synthetic-static-token", " static compatibility "])(
    "preserves explicit static compatibility (%s)", async (staticToken) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const provider = new ServiceTokenProvider({ mode: "static", staticToken }, fetchImpl);
      expect(await provider.getToken()).toBe(staticToken ?? "");
      provider.invalidate(staticToken ?? "");
      expect(await provider.getToken()).toBe(staticToken ?? "");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it("uses the fixed HTTPS token endpoint and never uses a refresh token", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      ...payload(), refresh_token: "synthetic-unused-refresh-token"
    })).mockResolvedValueOnce(response("synthetic-second-token"));
    const provider = new ServiceTokenProvider(options, fetchImpl, () => now);
    expect(await provider.getToken()).toBe("synthetic-access-token");
    now = 48_000;
    expect(await provider.getToken()).toBe("synthetic-second-token");
    for (const [url, request] of fetchImpl.mock.calls) {
      expect(url).toBe("https://identity.example.test/realms/cop/protocol/openid-connect/token");
      expect(request).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) });
      expect(request?.headers).toEqual({ accept: "application/json", "content-type": "application/x-www-form-urlencoded" });
      expect(Object.fromEntries(request?.body as URLSearchParams)).toEqual({
        grant_type: "client_credentials", client_id: "synthetic-service", client_secret: "synthetic-client-secret"
      });
    }
  });

  it("renews before expiry and never returns the old token after a renewal failure", async () => {
    let now = 1000;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response("synthetic-first", 100))
      .mockRejectedValueOnce(new Error("synthetic-provider-secret"))
      .mockResolvedValueOnce(response("synthetic-next", 100));
    const provider = new ServiceTokenProvider({ ...options, staticToken: "forbidden-fallback" }, fetchImpl, () => now);
    expect(await provider.getToken()).toBe("synthetic-first");
    now = 80_999;
    expect(await provider.getToken()).toBe("synthetic-first");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 81_000;
    await expect(provider.getToken()).rejects.toThrow(errorMessage);
    expect(await provider.getToken()).toBe("synthetic-next");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("caps the renewal margin at 30 seconds for a one-hour token", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response("synthetic-first", 3600))
      .mockResolvedValueOnce(response("synthetic-next", 3600));
    const provider = new ServiceTokenProvider(options, fetchImpl, () => now);
    await provider.getToken();
    now = 3_569_999;
    expect(await provider.getToken()).toBe("synthetic-first");
    now = 3_570_000;
    expect(await provider.getToken()).toBe("synthetic-next");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent exchanges", async () => {
    let finish!: (value: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const provider = new ServiceTokenProvider(options, fetchImpl, () => 0);
    const requests = Array.from({ length: 20 }, () => provider.getToken());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    finish(response());
    expect(await Promise.all(requests)).toEqual(Array(20).fill("synthetic-access-token"));
  });

  it("an old unauthorized request cannot invalidate a newer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response("synthetic-old"))
      .mockResolvedValueOnce(response("synthetic-new"));
    const provider = new ServiceTokenProvider(options, fetchImpl, () => 0);
    expect(await provider.getToken()).toBe("synthetic-old");
    provider.invalidate("unrelated-token");
    expect(await provider.getToken()).toBe("synthetic-old");
    provider.invalidate("synthetic-old");
    expect(await provider.getToken()).toBe("synthetic-new");
    provider.invalidate("synthetic-old");
    expect(await provider.getToken()).toBe("synthetic-new");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a token that expired while the exchange was pending", async () => {
    let now = 0;
    let finish!: (value: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(response("synthetic-fresh"));
    const provider = new ServiceTokenProvider(options, fetchImpl, () => now);
    const request = provider.getToken();
    now = 60_000;
    finish(response());
    await expect(request).rejects.toThrow(errorMessage);
    expect(await provider.getToken()).toBe("synthetic-fresh");
  });

  it.each([
    { issuer: undefined }, { clientId: undefined }, { clientSecret: undefined },
    { issuer: "http://identity.example.test/realms/cop" },
    { issuer: "https://user:password@identity.example.test/realms/cop" },
    { issuer: "https://identity.example.test/realms/cop?query=value" },
    { issuer: "https://identity.example.test/realms/cop?" },
    { issuer: "https://identity.example.test/realms/cop#fragment" },
    { issuer: "not-a-url" }, { clientId: " " }, { clientSecret: " " },
    { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 30_001 }
  ])("rejects incomplete or unsafe OIDC configuration without calling the provider: %j", async (change) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new ServiceTokenProvider({ ...options, ...change, staticToken: "forbidden-fallback" }, fetchImpl);
    await expect(provider.getToken()).rejects.toThrow(errorMessage);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { access_token: undefined }, { access_token: "" }, { access_token: "contains whitespace" },
    { access_token: "contains\u0000control" }, { access_token: "a".repeat(8193) },
    { token_type: undefined }, { token_type: "Basic" },
    { expires_in: undefined }, { expires_in: "60" }, { expires_in: 0 },
    { expires_in: -1 }, { expires_in: Infinity }, { expires_in: 3601 }
  ])("rejects invalid token response fields: %j", async (change) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...payload(), ...change }));
    const provider = new ServiceTokenProvider(options, fetchImpl, () => 0);
    await expect(provider.getToken()).rejects.toThrow(errorMessage);
  });

  it.each(["{not-json", "[]", "null"])("rejects malformed or non-object JSON (%s)", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(new ServiceTokenProvider(options, fetchImpl).getToken()).rejects.toThrow(errorMessage);
  });

  it("bounds streamed response bytes and cancels oversized bodies", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024));
        controller.enqueue(new Uint8Array(32 * 1024));
        controller.enqueue(new Uint8Array(1));
      }, cancel
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(new ServiceTokenProvider(options, fetchImpl).getToken()).rejects.toThrow(errorMessage);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized declared body before reading it", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": String(64 * 1024 + 1) }
    }));
    await expect(new ServiceTokenProvider(options, fetchImpl).getToken()).rejects.toThrow(errorMessage);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid UTF-8 and stream failures without leaking provider content", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
      .mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) { controller.error(new Error("synthetic-private-provider-content")); }
      })));
    const provider = new ServiceTokenProvider(options, fetchImpl);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(provider.getToken()).rejects.toThrow(errorMessage);
    }
  });

  it.each([302, 401, 429, 503])("rejects provider HTTP %s without reflecting response bodies", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("synthetic-private-error", { status }));
    const provider = new ServiceTokenProvider({ ...options, staticToken: "forbidden-fallback" }, fetchImpl);
    await expect(provider.getToken()).rejects.toThrow(errorMessage);
  });

  it("rejects an already-followed redirect even if the token response looks valid", async () => {
    const redirected = response();
    Object.defineProperty(redirected, "redirected", { value: true });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(redirected);
    await expect(new ServiceTokenProvider(options, fetchImpl).getToken()).rejects.toThrow(errorMessage);
  });

  it("bounds a hung fetch, aborts it, and never caches a late response", async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(response("synthetic-fresh"));
    const provider = new ServiceTokenProvider({ ...options, timeoutMs: 20 }, fetchImpl, () => 0);
    const request = provider.getToken();
    const rejection = expect(request).rejects.toThrow(errorMessage);
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish(response("synthetic-late"));
    await Promise.resolve();
    expect(await provider.getToken()).toBe("synthetic-fresh");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bounds body reading as well as the initial fetch", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel
    })));
    const provider = new ServiceTokenProvider({ ...options, timeoutMs: 20 }, fetchImpl, () => 0);
    const rejection = expect(provider.getToken()).rejects.toThrow(errorMessage);
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
