import { afterEach, describe, expect, it, vi } from "vitest";
import { saveUserProfile } from "./cop-data";

describe("abortable account profile writes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cancels an in-flight BFF profile write when its account scope ends", async () => {
    const request = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Account changed", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", request);
    const controller = new AbortController();
    const pending = saveUserProfile("https://cop.example", "cop-bff-session", {
      alertPreferences: { aoiRules: [{ id: "synthetic-zone", name: "Synthetic zone", enabled: true, lat: 50, lon: 14, radiusKm: 1 }] }
    }, controller.signal);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]![1]).toMatchObject({ method: "PUT", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves the existing three-argument caller and exact authenticated endpoint", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ alertPreferences: {}, preferences: {}, updatedAt: "2026-10-10T12:00:00Z" })));
    vi.stubGlobal("fetch", request);
    await expect(saveUserProfile("https://cop.example", "synthetic-token", { preferences: { language: "cs" } })).resolves.toMatchObject({ preferences: {} });
    expect(request).toHaveBeenCalledWith("https://cop.example/api/v1/me/preferences", {
      body: JSON.stringify({ preferences: { language: "cs" } }),
      headers: { Authorization: "Bearer synthetic-token", "Content-Type": "application/json" }, method: "PUT", signal: undefined
    });
  });
});
