import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearJwksCacheForTests, verifyOidcToken } from "./security.js";

const originalEnv = { ...process.env };
const issuer = "https://identity.example.test/realms/cop";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "synthetic", alg: "RS256", use: "sig" };
let token: string;

beforeEach(() => {
  process.env = { ...originalEnv, COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_ALLOWED_CLIENTS: "cop-web" };
  clearJwksCacheForTests();
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, azp: "cop-web", sub: "synthetic-user", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  const content = `${header}.${payload}`;
  token = `${content}.${createSign("RSA-SHA256").update(content).sign(pair.privateKey).toString("base64url")}`;
});

afterEach(() => {
  process.env = { ...originalEnv };
  clearJwksCacheForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OIDC signing-key availability boundary", () => {
  it("coalesces concurrent cold-cache requests and uses verified keys for subsequent requests", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => {
      await gate;
      return Response.json({ keys: [jwk] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const requests = Array.from({ length: 20 }, () => verifyOidcToken(token));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release?.();
    expect(await Promise.all(requests)).toEqual(Array(20).fill(true));
    expect(await verifyOidcToken(token)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${issuer}/protocol/openid-connect/certs`, expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });

  it("fails closed on an outage, briefly coalesces retries and recovers after the cooldown", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ keys: [jwk] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyOidcToken(token)).toBe(false);
    expect(await verifyOidcToken(token)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await verifyOidcToken(token)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a signing-key request after five seconds without accepting the token", async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    })));
    const pending = verifyOidcToken(token);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(false);
    expect(aborted).toBe(true);
  });

  it("rejects oversized signing-key responses rather than buffering an unbounded body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(" ".repeat(256 * 1024 + 1))));
    expect(await verifyOidcToken(token)).toBe(false);
  });

  it("rejects an encryption-only or mismatched-algorithm JWK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [{ ...jwk, use: "enc" }, { ...jwk, alg: "RS512" }] })));
    expect(await verifyOidcToken(token)).toBe(false);
  });
});
