import { describe, expect, it, vi } from "vitest";
import { MediaNewsSourceAdapter, MediaNewsSourceError, normalizeMediaNewsContext } from "./media-news-source.js";

const now = new Date("2026-10-10T12:00:00.000Z");
const config = {
  baseUrl: "http://sim.internal/safety-data/api/v1",
  cacheTtlMs: 120_000,
  enabled: true,
  maxLimit: 250,
  timeoutMs: 1000
};

describe("COP informational media context boundary", () => {
  it("fetches only fixed SIM metadata without user credentials and strips article content", async () => {
    const payload = sample();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            ...payload,
            body: "not forwarded",
            items: [{ ...payload.items[0], body: "article body", video: "video url" }]
          })
        )
    );
    const adapter = new MediaNewsSourceAdapter(config, fetcher);
    const result = await adapter.fetchContext(now);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("http://sim.internal/safety-data/api/v1/context/news?limit=20");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", headers: { Accept: "application/json" } });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
    expect(result.items[0]).toMatchObject({
      title: "Syntetický titulek",
      location: null,
      locationStatus: "unresolved",
      notificationEligible: false,
      regionScope: "feed"
    });
    expect(result).not.toHaveProperty("body");
    expect(result.items[0]).not.toHaveProperty("body");
    expect(result.items[0]).not.toHaveProperty("video");
  });

  it.each([
    { informationalOnly: false },
    { notificationEligible: true },
    { location: { lat: 50, lon: 14 } },
    { locationStatus: "resolved" },
    { eventAt: now.toISOString() },
    { regionScope: "incident" },
    { link: "javascript:alert(1)" },
    { link: "https://ct24.ceskatelevize.cz.evil.invalid/a" },
    { link: "https://user:secret@ct24.ceskatelevize.cz/a" },
    { title: "<img src=x>" },
    { regionCode: "CZ080" }
  ])("rejects untrusted item semantics %#", (replacement) => {
    const payload = sample();
    expect(() =>
      normalizeMediaNewsContext({ ...payload, items: [{ ...payload.items[0], ...replacement }] }, now.getTime())
    ).toThrow(MediaNewsSourceError);
  });

  it("rejects contradictory top-level classification, stale generation and feed origin", () => {
    const payload = sample();
    expect(() => normalizeMediaNewsContext({ ...payload, notificationEligible: true }, now.getTime())).toThrow();
    expect(() =>
      normalizeMediaNewsContext({ ...payload, generatedAt: "2026-10-09T12:00:00Z" }, now.getTime())
    ).toThrow();
    expect(() =>
      normalizeMediaNewsContext(
        { ...payload, sources: [{ ...payload.sources[0], feedUrl: "https://evil.invalid/rss" }] },
        now.getTime()
      )
    ).toThrow();
    expect(() =>
      normalizeMediaNewsContext(
        {
          ...payload,
          sources: [{ ...payload.sources[0], feedUrl: "https://ct24.ceskatelevize.cz/rss/hlavni-zpravy" }]
        },
        now.getTime()
      )
    ).toThrow();
  });

  it("coalesces requests, expires old news at cache-read time and bounds error retries", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      )
      .mockResolvedValue(new Response("down", { status: 503 }));
    const adapter = new MediaNewsSourceAdapter(config, fetcher);
    const one = adapter.fetchContext(now);
    const two = adapter.fetchContext(now);
    const payload = sample();
    payload.items[0]!.publishedAt = "2026-10-09T12:01:00Z";
    resolve(new Response(JSON.stringify(payload)));
    await Promise.all([one, two]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await adapter.fetchContext(new Date(now.getTime() + 120_000))).items).toEqual([]);
    await expect(adapter.fetchContext(new Date(now.getTime() + 301_000))).rejects.toMatchObject({
      statusCode: 503,
      code: "MEDIA_NEWS_UNAVAILABLE"
    });
    await expect(adapter.fetchContext(new Date(now.getTime() + 310_000))).rejects.toThrow(MediaNewsSourceError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized bodies and never queries disabled sources", async () => {
    const tooLarge = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x", { headers: { "content-length": "1048577" } }));
    await expect(new MediaNewsSourceAdapter(config, tooLarge).fetchContext(now)).rejects.toThrow(MediaNewsSourceError);
    const streamed = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(1048577)));
    await expect(new MediaNewsSourceAdapter(config, streamed).fetchContext(now)).rejects.toThrow(MediaNewsSourceError);
    const disabledFetch = vi.fn<typeof fetch>();
    expect(
      await new MediaNewsSourceAdapter({ ...config, enabled: false }, disabledFetch).fetchContext(now)
    ).toMatchObject({ status: "disabled", items: [] });
    expect(disabledFetch).not.toHaveBeenCalled();
  });

  it("aborts stalled SIM requests and reports a retryable service failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
            once: true
          });
        })
    );
    await expect(
      new MediaNewsSourceAdapter({ ...config, timeoutMs: 100 }, fetcher).fetchContext(now)
    ).rejects.toMatchObject({ statusCode: 503, code: "MEDIA_NEWS_UNAVAILABLE" });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

function sample() {
  return {
    contractVersion: "sim-crisis-media-context-v1",
    status: "ok",
    generatedAt: now.toISOString(),
    informationalOnly: true,
    notificationEligible: false,
    items: [
      {
        id: "ct24-synthetic",
        title: "Syntetický titulek",
        link: "https://ct24.ceskatelevize.cz/clanek/test",
        publishedAt: "2026-10-10T11:30:00Z",
        fetchedAt: now.toISOString(),
        eventAt: null,
        regionCode: "CZ",
        regionScope: "feed",
        location: null,
        locationStatus: "unresolved",
        informationalOnly: true,
        notificationEligible: false,
        stale: false,
        source: { id: "ct24", name: "ČT24", feedId: "ct24-main", attribution: "Česká televize / ČT24" }
      }
    ],
    sources: [
      {
        id: "ct24-main",
        label: "ČT24 – zpravodajství",
        feedUrl: "https://ct24.ceskatelevize.cz/rss",
        regionCode: "CZ",
        regionScope: "feed",
        attribution: "Česká televize / ČT24",
        status: "ok",
        fetchedAt: now.toISOString(),
        stale: false,
        errorCode: null,
        retryAfterSeconds: null
      }
    ]
  };
}
