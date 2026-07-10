import { afterEach, describe, expect, it, vi } from "vitest";
import { NominatimPlaceGeocoder } from "./place-geocoder.js";

describe("NominatimPlaceGeocoder performance guards", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("coalesces concurrent identical searches into one upstream request", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const geocoder = new NominatimPlaceGeocoder(config());
    const now = new Date("2026-07-11T00:00:00Z");

    const first = geocoder.search({ query: "Praha" }, now);
    const second = geocoder.search({ query: "Praha" }, now);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(nominatimResponse("Praha"));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.cache.status).toBe("miss");
    expect(secondResult.cache.status).toBe("hit");
    expect(firstResult.items[0]?.displayName).toBe("Praha");
  });

  it("evicts least recently used searches when the bounded cache is full", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const query = new URL(String(input)).searchParams.get("q") ?? "unknown";
      return nominatimResponse(query);
    });
    vi.stubGlobal("fetch", fetchMock);
    const geocoder = new NominatimPlaceGeocoder(config({ cacheMaxEntries: 2 }));

    await geocoder.search({ query: "Praha" }, new Date("2026-07-11T00:00:00Z"));
    await geocoder.search({ query: "Bratislava" }, new Date("2026-07-11T00:00:01Z"));
    await geocoder.search({ query: "Ostrava" }, new Date("2026-07-11T00:00:02Z"));
    expect(geocoder.diagnostics()).toContain("cache=2/2");

    await geocoder.search({ query: "Praha" }, new Date("2026-07-11T00:00:03Z"));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("aborts a stalled upstream search within the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          })
      )
    );
    const geocoder = new NominatimPlaceGeocoder(config({ timeoutMs: 250 }));
    const search = expect(
      geocoder.search({ query: "Nedostupné místo" }, new Date("2026-07-11T00:00:00Z"))
    ).rejects.toThrow("Nominatim timed out after 250 ms.");

    await vi.advanceTimersByTimeAsync(250);
    await search;
  });
});

function config(overrides: { cacheMaxEntries?: number; timeoutMs?: number } = {}) {
  return {
    baseUrl: "https://nominatim.example.test/search",
    cacheTtlSeconds: 60,
    userAgent: "COP test",
    ...overrides
  };
}

function nominatimResponse(displayName: string): Response {
  return new Response(
    JSON.stringify([
      {
        display_name: displayName,
        lat: "50.0755",
        lon: "14.4378",
        place_id: 1,
        type: "city"
      }
    ]),
    { headers: { "content-type": "application/json" }, status: 200 }
  );
}
