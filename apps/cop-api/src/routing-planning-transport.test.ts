import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanningOriginTransport, PlanningTransportError } from "./routing-planning-transport.js";

const secret = "synthetic-service-credential";
const context = { actor: "a".repeat(64), correlationId: "11111111-2222-4333-8444-555555555555" };
const source = () => new PlanningOriginTransport("https://sim.example.test/api/v1", secret);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("separate server-only planning transport", () => {
  it.each(["candidates", "preview"] as const)("sends one %s with only explicit service context", async operation => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ purpose: "planning_preview" }));
    vi.stubGlobal("fetch", fetch);
    const body = { context: { contextId: "synthetic-context" } };
    await source().request(operation, body, context);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://sim.example.test/api/v1/routing/planning-origin/${operation}`);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers)).toEqual(new Headers({ Accept: "application/json", "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`, "X-COP-Planning-Actor": context.actor, "X-Correlation-ID": context.correlationId }));
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(JSON.stringify(source())).not.toContain(secret);
  });
  it.each([401, 403, 409, 422, 429, 500, 503])("does not retry or fall back after HTTP %s", async status => {
    const fetch = vi.fn(async () => new Response("PRIVATE_PROVIDER_TEXT", { status, headers: { "Retry-After": "30" } }));
    vi.stubGlobal("fetch", fetch);
    const result = source().request("preview", {}, context);
    const expected = [401, 403].includes(status) ? 503 : status === 500 ? 502 : status;
    await expect(result).rejects.toMatchObject({ statusCode: expected, retryAfter: status === 429 ? "30" : undefined });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("sanitizes transport exceptions and keeps credentials out of errors", async () => {
    const fetch = vi.fn(async () => { throw new Error(`${secret}: PRIVATE_LOCATION`); }); vi.stubGlobal("fetch", fetch);
    try { await source().request("preview", {}, context); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(PlanningTransportError);
      expect(String(error)).not.toContain(secret); expect(String(error)).not.toContain("PRIVATE_LOCATION");
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed actor context before any upstream request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(source().request("preview", {}, { ...context, actor: "forged\r\nheader" })).rejects.toMatchObject({ statusCode: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds streamed responses and rejects malformed JSON", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1)))
      .mockResolvedValueOnce(new Response("not-json")); vi.stubGlobal("fetch", fetch);
    await expect(source().request("preview", {}, context)).rejects.toMatchObject({ statusCode: 503 });
    await expect(source().request("preview", {}, context)).rejects.toMatchObject({ statusCode: 503 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
