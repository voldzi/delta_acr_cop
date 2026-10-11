import type { SafetyDataSourceConfig } from "./safety-data-source.js";

export const mediaNewsContractVersion = "sim-crisis-media-context-v1" as const;
const maxResponseBytes = 1024 * 1024;
const maxNewsAgeMs = 24 * 60 * 60 * 1000;
const cacheTtlMs = 300_000;
const errorBackoffMs = 60_000;
const mediaErrorCodes = new Set([
  "UPSTREAM_HTTP_ERROR",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_TOO_LARGE",
  "UPSTREAM_INVALID_XML",
  "UPSTREAM_UNAVAILABLE"
]);
const feeds = {
  "ct24-main": { regionCode: "CZ", path: "/rss" },
  "ct24-ostrava": { regionCode: "CZ080", path: "/rss/rubrika/regiony/moravskoslezsky-kraj-14" },
  "ct24-brno": { regionCode: "CZ064", path: "/rss/rubrika/regiony/jihomoravsky-kraj-26" }
} as const;

export type MediaNewsFeedId = keyof typeof feeds;
export interface MediaNewsItem {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  fetchedAt: string;
  eventAt: null;
  regionCode: "CZ" | "CZ080" | "CZ064";
  regionScope: "feed";
  location: null;
  locationStatus: "unresolved";
  informationalOnly: true;
  notificationEligible: false;
  stale: boolean;
  source: { id: "ct24"; name: "ČT24"; feedId: MediaNewsFeedId; attribution: "Česká televize / ČT24" };
}
export interface MediaNewsSourceState {
  id: MediaNewsFeedId;
  label: string;
  feedUrl: string;
  regionCode: MediaNewsItem["regionCode"];
  regionScope: "feed";
  attribution: "Česká televize / ČT24";
  status: "ok" | "stale" | "unavailable" | "disabled";
  fetchedAt: string | null;
  stale: boolean;
  errorCode: string | null;
  retryAfterSeconds: number | null;
}
export interface MediaNewsContext {
  contractVersion: typeof mediaNewsContractVersion;
  status: "ok" | "degraded" | "disabled";
  generatedAt: string;
  informationalOnly: true;
  notificationEligible: false;
  items: MediaNewsItem[];
  sources: MediaNewsSourceState[];
}

export class MediaNewsSourceError extends Error {
  readonly statusCode = 503;
  readonly code = "MEDIA_NEWS_UNAVAILABLE";
  constructor() {
    super("Zpravodajský kontext nyní není dostupný.");
    this.name = "MediaNewsSourceError";
  }
}

/** One fixed, bounded server-side request; never forwards an end-user credential. */
export class MediaNewsSourceAdapter {
  private snapshot?: { result: MediaNewsContext; fetchedAt: number };
  private inflight?: Promise<MediaNewsContext>;
  private retryAt = 0;
  constructor(
    private readonly config: SafetyDataSourceConfig,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch
  ) {}

  async fetchContext(now = new Date()): Promise<MediaNewsContext> {
    const at = now.getTime();
    if (!this.config.enabled) return disabledContext(now);
    if (this.snapshot && at - this.snapshot.fetchedAt < cacheTtlMs && at >= this.snapshot.fetchedAt) {
      return currentContext(this.snapshot.result, at);
    }
    if (this.inflight) return currentContext(await this.inflight, at);
    if (at < this.retryAt) throw new MediaNewsSourceError();
    this.inflight = this.load(now)
      .then((result) => {
        this.snapshot = { result, fetchedAt: at };
        this.retryAt = 0;
        return result;
      })
      .catch(() => {
        this.retryAt = at + errorBackoffMs;
        throw new MediaNewsSourceError();
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return structuredClone(await this.inflight);
  }

  private async load(now: Date): Promise<MediaNewsContext> {
    const base = new URL(this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new MediaNewsSourceError();
    }
    const url = new URL("context/news?limit=20", base);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(100, Math.min(30_000, this.config.timeoutMs)));
    try {
      const response = await this.fetcher(url, {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) {
        controller.abort();
        throw new MediaNewsSourceError();
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) {
        controller.abort();
        throw new MediaNewsSourceError();
      }
      const reader = response.body?.getReader();
      if (!reader) throw new MediaNewsSourceError();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxResponseBytes) {
            await reader.cancel();
            throw new MediaNewsSourceError();
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return normalizeMediaNewsContext(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
        now.getTime()
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Reject classification/location mismatches rather than inventing event geometry. */
export function normalizeMediaNewsContext(value: unknown, now: number): MediaNewsContext {
  if (
    !isRecord(value) ||
    value.contractVersion !== mediaNewsContractVersion ||
    value.informationalOnly !== true ||
    value.notificationEligible !== false ||
    !["ok", "degraded", "disabled"].includes(String(value.status)) ||
    !validTime(value.generatedAt, now, 600_000) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !Array.isArray(value.sources) ||
    value.sources.length > 3
  )
    throw new MediaNewsSourceError();
  const sources = value.sources.map((source): MediaNewsSourceState => {
    if (
      !isRecord(source) ||
      !isFeed(source.id) ||
      source.regionCode !== feeds[source.id].regionCode ||
      source.regionScope !== "feed" ||
      source.attribution !== "Česká televize / ČT24" ||
      !["ok", "stale", "unavailable", "disabled"].includes(String(source.status)) ||
      typeof source.stale !== "boolean" ||
      source.stale !== (source.status === "stale") ||
      !safeCt24Link(source.feedUrl) ||
      new URL(source.feedUrl).pathname !== feeds[source.id].path ||
      (source.fetchedAt !== null && !validTime(source.fetchedAt, now)) ||
      !plainText(source.label, 120) ||
      (source.errorCode !== null && !mediaErrorCodes.has(String(source.errorCode))) ||
      (source.retryAfterSeconds !== null &&
        (!Number.isInteger(source.retryAfterSeconds) ||
          Number(source.retryAfterSeconds) < 0 ||
          Number(source.retryAfterSeconds) > 3600))
    ) {
      throw new MediaNewsSourceError();
    }
    return {
      id: source.id,
      label: source.label,
      feedUrl: source.feedUrl,
      regionCode: feeds[source.id].regionCode,
      regionScope: "feed",
      attribution: "Česká televize / ČT24",
      status: source.status as MediaNewsSourceState["status"],
      fetchedAt: source.fetchedAt as string | null,
      stale: source.stale,
      errorCode: source.errorCode as string | null,
      retryAfterSeconds: source.retryAfterSeconds as number | null
    };
  });
  if (new Set(sources.map((source) => source.id)).size !== sources.length) throw new MediaNewsSourceError();
  const items = value.items.map((item): MediaNewsItem => {
    if (
      !isRecord(item) ||
      !plainText(item.id, 160) ||
      !plainText(item.title, 300) ||
      !safeCt24Link(item.link) ||
      !validTime(item.publishedAt, now) ||
      !validTime(item.fetchedAt, now) ||
      item.eventAt !== null ||
      item.regionScope !== "feed" ||
      item.location !== null ||
      item.locationStatus !== "unresolved" ||
      item.informationalOnly !== true ||
      item.notificationEligible !== false ||
      typeof item.stale !== "boolean" ||
      !isRecord(item.source) ||
      item.source.id !== "ct24" ||
      item.source.name !== "ČT24" ||
      !isFeed(item.source.feedId) ||
      item.source.attribution !== "Česká televize / ČT24" ||
      item.regionCode !== feeds[item.source.feedId].regionCode
    ) {
      throw new MediaNewsSourceError();
    }
    const feedId = item.source.feedId;
    const source = sources.find((source) => source.id === feedId);
    if (!source || !["ok", "stale"].includes(source.status) || item.stale !== source.stale)
      throw new MediaNewsSourceError();
    return {
      id: item.id,
      title: item.title,
      link: item.link,
      publishedAt: item.publishedAt,
      fetchedAt: item.fetchedAt,
      eventAt: null,
      regionCode: feeds[item.source.feedId].regionCode,
      regionScope: "feed",
      location: null,
      locationStatus: "unresolved",
      informationalOnly: true,
      notificationEligible: false,
      stale: item.stale,
      source: { id: "ct24", name: "ČT24", feedId: item.source.feedId, attribution: "Česká televize / ČT24" }
    };
  });
  if (value.status === "disabled" && items.length) throw new MediaNewsSourceError();
  return currentContext(
    {
      contractVersion: mediaNewsContractVersion,
      status: value.status as MediaNewsContext["status"],
      generatedAt: value.generatedAt as string,
      informationalOnly: true,
      notificationEligible: false,
      items,
      sources
    },
    now
  );
}

function currentContext(result: MediaNewsContext, now: number): MediaNewsContext {
  const copy = structuredClone(result);
  const links = new Set<string>();
  copy.items = copy.items
    .filter((item) => {
      if (now - Date.parse(item.publishedAt) > maxNewsAgeMs || links.has(item.link)) return false;
      links.add(item.link);
      return true;
    })
    .slice(0, 20);
  return copy;
}
function disabledContext(now: Date): MediaNewsContext {
  return {
    contractVersion: mediaNewsContractVersion,
    status: "disabled",
    generatedAt: now.toISOString(),
    informationalOnly: true,
    notificationEligible: false,
    items: [],
    sources: []
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFeed(value: unknown): value is MediaNewsFeedId {
  return typeof value === "string" && Object.hasOwn(feeds, value);
}
function plainText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}
function validTime(value: unknown, now: number, maxAge = Number.POSITIVE_INFINITY): value is string {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now + 60_000 && now - at <= maxAge;
}
function safeCt24Link(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "ct24.ceskatelevize.cz" &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
