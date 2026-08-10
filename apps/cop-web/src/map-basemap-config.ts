import {
  normalizeMapConfig,
  type MapBasemapConfigInput,
  type NormalizedMapBasemapConfig
} from "@zeleznalady/geo-client";

export interface CopMapEnvironment {
  VITE_COP_MAP_STYLE_URL?: string;
  VITE_COP_TILE_ATTRIBUTION?: string;
  VITE_COP_TILE_GLYPHS_URL?: string;
  VITE_COP_TILE_URL?: string;
}

/**
 * The only COP-specific bridge between Vite environment variables and the
 * framework-neutral shared geo contract.
 */
export function resolveCopBasemapConfig(environment: CopMapEnvironment): NormalizedMapBasemapConfig {
  const input: MapBasemapConfigInput = {
    attribution: environment.VITE_COP_TILE_ATTRIBUTION,
    glyphsUrl: environment.VITE_COP_TILE_GLYPHS_URL,
    styleUrl: environment.VITE_COP_MAP_STYLE_URL,
    tileUrl: environment.VITE_COP_TILE_URL
  };

  return normalizeMapConfig(input).config;
}
