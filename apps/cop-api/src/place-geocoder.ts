export interface PlaceGeocodeResult {
  bbox?: {
    east: number;
    north: number;
    south: number;
    west: number;
  };
  center: [number, number];
  displayName: string;
  id: string;
  importance?: number;
  kind?: string;
  providerId: string;
  subtitle?: string;
  zoomHint?: number;
}

export interface PlaceGeocodeQuery {
  language?: string;
  limit?: number;
  query: string;
}

export interface PlaceGeocodeResponse {
  cache: {
    key: string;
    status: "disabled" | "hit" | "miss";
    ttlSeconds: number;
  };
  contractVersion: "cop-geocode-v1";
  items: PlaceGeocodeResult[];
  providerId: string;
  query: {
    language: string;
    limit: number;
    q: string;
  };
  serverTimestamp: string;
  warnings: string[];
}

export interface PlaceGeocoder {
  readonly providerId: string;
  diagnostics?(): string | undefined;
  search(query: PlaceGeocodeQuery, now: Date): Promise<PlaceGeocodeResponse>;
}

interface NominatimGeocoderConfig {
  baseUrl: string;
  cacheTtlSeconds: number;
  email?: string;
  userAgent: string;
}

interface CachedGeocodeResponse {
  expiresAt: number;
  response: PlaceGeocodeResponse;
}

interface NominatimSearchResult {
  addresstype?: string;
  boundingbox?: [string, string, string, string] | string[];
  category?: string;
  class?: string;
  display_name?: string;
  importance?: number;
  lat?: string;
  lon?: string;
  name?: string;
  osm_id?: number;
  osm_type?: string;
  place_id?: number;
  type?: string;
}

export function createPlaceGeocoderFromEnv(env: Record<string, string | undefined> = process.env): PlaceGeocoder | undefined {
  const provider = (env.COP_GEOCODER_PROVIDER ?? "nominatim").trim().toLowerCase();
  if (provider === "disabled" || provider === "off" || provider === "none") {
    return undefined;
  }
  if (provider !== "nominatim") {
    throw new Error(`Unsupported COP_GEOCODER_PROVIDER value: ${provider}`);
  }
  return new NominatimPlaceGeocoder({
    baseUrl: env.COP_GEOCODER_NOMINATIM_URL?.trim() || "https://nominatim.openstreetmap.org/search",
    cacheTtlSeconds: readPositiveInteger(env.COP_GEOCODER_CACHE_TTL_SECONDS, 7 * 24 * 60 * 60),
    ...(env.COP_GEOCODER_EMAIL?.trim() ? { email: env.COP_GEOCODER_EMAIL.trim() } : {}),
    userAgent: env.COP_GEOCODER_USER_AGENT?.trim() || "COP Civil Situation Map/0.1 (https://cop.zeleznalady.cz)"
  });
}

export class NominatimPlaceGeocoder implements PlaceGeocoder {
  readonly providerId = "nominatim";
  private readonly cache = new Map<string, CachedGeocodeResponse>();

  constructor(private readonly config: NominatimGeocoderConfig) {}

  diagnostics(): string {
    return `provider=nominatim; cache=${this.cache.size}; ttl=${this.config.cacheTtlSeconds}s`;
  }

  async search(query: PlaceGeocodeQuery, now: Date): Promise<PlaceGeocodeResponse> {
    const normalizedQuery = normalizeQuery(query.query);
    const limit = clampInteger(query.limit, 1, 8, 5);
    const language = normalizeLanguage(query.language);
    const cacheKey = `${language}:${limit}:${normalizedQuery.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now.getTime()) {
      return {
        ...cached.response,
        cache: { ...cached.response.cache, status: "hit" },
        serverTimestamp: now.toISOString()
      };
    }

    if (normalizedQuery.length < 3) {
      return this.response(normalizedQuery, language, limit, [], now, cacheKey, "disabled");
    }

    const url = new URL(this.config.baseUrl);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", language);
    if (this.config.email) {
      url.searchParams.set("email", this.config.email);
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.config.userAgent
      }
    });
    if (!response.ok) {
      throw new Error(`Nominatim returned HTTP ${response.status}`);
    }
    const payload = await response.json() as NominatimSearchResult[];
    const result = this.response(
      normalizedQuery,
      language,
      limit,
      payload.map(nominatimResultToPlace).filter((item): item is PlaceGeocodeResult => Boolean(item)),
      now,
      cacheKey,
      "miss"
    );
    this.cache.set(cacheKey, {
      expiresAt: now.getTime() + this.config.cacheTtlSeconds * 1000,
      response: result
    });
    return result;
  }

  private response(
    query: string,
    language: string,
    limit: number,
    items: PlaceGeocodeResult[],
    now: Date,
    cacheKey: string,
    cacheStatus: PlaceGeocodeResponse["cache"]["status"]
  ): PlaceGeocodeResponse {
    return {
      cache: {
        key: cacheKey,
        status: cacheStatus,
        ttlSeconds: this.config.cacheTtlSeconds
      },
      contractVersion: "cop-geocode-v1",
      items,
      providerId: this.providerId,
      query: {
        language,
        limit,
        q: query
      },
      serverTimestamp: now.toISOString(),
      warnings: []
    };
  }
}

function nominatimResultToPlace(result: NominatimSearchResult): PlaceGeocodeResult | null {
  const lat = Number(result.lat);
  const lon = Number(result.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  const bbox = normalizeBoundingBox(result.boundingbox);
  const kind = result.addresstype ?? result.type ?? result.class ?? result.category;
  return {
    ...(bbox ? { bbox } : {}),
    center: [lon, lat],
    displayName: result.display_name ?? result.name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    id: `nominatim:${result.place_id ?? `${result.osm_type ?? "place"}:${result.osm_id ?? `${lat}:${lon}`}`}`,
    ...(typeof result.importance === "number" ? { importance: result.importance } : {}),
    ...(kind ? { kind } : {}),
    providerId: "nominatim",
    subtitle: [kind, result.category ?? result.class].filter(Boolean).join(" · ") || undefined,
    zoomHint: zoomHintForPlace(kind, bbox)
  };
}

function normalizeBoundingBox(value: NominatimSearchResult["boundingbox"]): PlaceGeocodeResult["bbox"] | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const south = Number(value[0]);
  const north = Number(value[1]);
  const west = Number(value[2]);
  const east = Number(value[3]);
  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
    return undefined;
  }
  return {
    east: clampNumber(east, -180, 180),
    north: clampNumber(north, -90, 90),
    south: clampNumber(south, -90, 90),
    west: clampNumber(west, -180, 180)
  };
}

function zoomHintForPlace(kind: string | undefined, bbox: PlaceGeocodeResult["bbox"] | undefined): number {
  const normalized = kind?.toLowerCase() ?? "";
  if (normalized.includes("country")) {
    return 6;
  }
  if (normalized.includes("state") || normalized.includes("region")) {
    return 7;
  }
  if (normalized.includes("city") || normalized.includes("municipality")) {
    return 10;
  }
  if (normalized.includes("village") || normalized.includes("town")) {
    return 12;
  }
  if (bbox) {
    const span = Math.max(Math.abs(bbox.east - bbox.west), Math.abs(bbox.north - bbox.south));
    if (span > 4) {
      return 6;
    }
    if (span > 1) {
      return 8;
    }
    if (span > 0.2) {
      return 10;
    }
  }
  return 13;
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 160);
}

function normalizeLanguage(value: string | undefined): string {
  const normalized = (value ?? "cs,en").trim().replace(/[^\w, -]/gu, "").slice(0, 40);
  return normalized || "cs,en";
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}
