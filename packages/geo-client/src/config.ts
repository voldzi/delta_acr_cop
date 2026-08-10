export const DEFAULT_OSM_TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_MAPLIBRE_GLYPHS_TEMPLATE = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
export const OPENSTREETMAP_ATTRIBUTION = "&copy; OpenStreetMap contributors";

export interface MapBasemapConfigInput {
  attribution?: string;
  glyphsUrl?: string;
  styleUrl?: string;
  tileUrl?: string;
}

export interface MapBasemapDefaults {
  attribution: string;
  glyphsUrl: string;
  styleUrl: string;
  tileUrl: string;
}

export type NormalizedMapBasemapConfig = MapBasemapDefaults;

export interface MapBasemapConfigResult {
  config: NormalizedMapBasemapConfig;
  warnings: string[];
}

export interface RasterStyleSpecification {
  glyphs: string;
  layers: Array<{
    id: string;
    source: string;
    type: "raster";
  }>;
  sources: Record<
    string,
    {
      attribution: string;
      maxzoom: number;
      minzoom: number;
      tiles: string[];
      tileSize: number;
      type: "raster";
    }
  >;
  version: 8;
}

const defaultBasemapConfig: MapBasemapDefaults = {
  attribution: OPENSTREETMAP_ATTRIBUTION,
  glyphsUrl: DEFAULT_MAPLIBRE_GLYPHS_TEMPLATE,
  styleUrl: "",
  tileUrl: DEFAULT_OSM_TILE_TEMPLATE
};

const mapTemplateSubstitutions: Record<string, string> = {
  "{fontstack}": "Noto%20Sans%20Regular",
  "{range}": "0-255",
  "{x}": "0",
  "{y}": "0",
  "{z}": "0"
};

export function normalizeMapConfig(
  input: MapBasemapConfigInput,
  defaults: Partial<MapBasemapDefaults> = {}
): MapBasemapConfigResult {
  const resolvedDefaults = { ...defaultBasemapConfig, ...defaults };
  const warnings: string[] = [];
  const styleUrl = normalizeMapStyleUrl(input.styleUrl, resolvedDefaults.styleUrl);
  if ((input.styleUrl ?? "").trim() && !styleUrl) {
    warnings.push("style_url_invalid");
  }
  const tileUrl = normalizeMapTileTemplate(input.tileUrl, resolvedDefaults.tileUrl);
  if ((input.tileUrl ?? "").trim() && tileUrl !== input.tileUrl?.trim()) {
    warnings.push("tile_url_invalid");
  }
  const glyphsUrl = normalizeMapGlyphsTemplate(input.glyphsUrl, resolvedDefaults.glyphsUrl);
  if ((input.glyphsUrl ?? "").trim() && glyphsUrl !== input.glyphsUrl?.trim()) {
    warnings.push("glyphs_url_invalid");
  }

  return {
    config: {
      attribution: ensureOpenStreetMapAttribution(input.attribution ?? resolvedDefaults.attribution),
      glyphsUrl,
      styleUrl,
      tileUrl
    },
    warnings
  };
}

export function normalizeMapStyleUrl(value: string | undefined, fallback = ""): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  return isSafeMapUrl(normalized) ? normalized : fallback;
}

export function normalizeMapTileTemplate(value: string | undefined, fallback = DEFAULT_OSM_TILE_TEMPLATE): string {
  return normalizeMapTemplate(value, fallback, ["{z}", "{x}", "{y}"]);
}

export function normalizeMapGlyphsTemplate(
  value: string | undefined,
  fallback = DEFAULT_MAPLIBRE_GLYPHS_TEMPLATE
): string {
  return normalizeMapTemplate(value, fallback, ["{fontstack}", "{range}"]);
}

export function ensureOpenStreetMapAttribution(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return OPENSTREETMAP_ATTRIBUTION;
  }
  if (/openstreetmap/i.test(normalized)) {
    return normalized;
  }
  return `${normalized} | ${OPENSTREETMAP_ATTRIBUTION}`;
}

export function createRasterBasemapStyle(
  config: Pick<NormalizedMapBasemapConfig, "attribution" | "glyphsUrl" | "tileUrl">
): RasterStyleSpecification {
  return {
    version: 8,
    glyphs: config.glyphsUrl,
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: [config.tileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: ensureOpenStreetMapAttribution(config.attribution)
      }
    },
    layers: [
      {
        id: "osm-raster",
        type: "raster",
        source: "osm-raster"
      }
    ]
  };
}

export function resolveBasemapStyle(config: NormalizedMapBasemapConfig): string | RasterStyleSpecification {
  return config.styleUrl || createRasterBasemapStyle(config);
}

export function isSafeMapUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.startsWith("//")) {
    return false;
  }
  const substituted = Object.entries(mapTemplateSubstitutions).reduce(
    (current, [token, replacement]) => current.split(token).join(replacement),
    normalized
  );
  try {
    const parsed = new URL(substituted, "https://geo.invalid/");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    return !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function normalizeMapTemplate(value: string | undefined, fallback: string, requiredTokens: string[]): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  const hasRequiredTokens = requiredTokens.every((token) => normalized.includes(token));
  return hasRequiredTokens && isSafeMapUrl(normalized) ? normalized : fallback;
}
