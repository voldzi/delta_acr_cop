import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAPLIBRE_GLYPHS_TEMPLATE,
  DEFAULT_OSM_TILE_TEMPLATE,
  OPENSTREETMAP_ATTRIBUTION,
  createRasterBasemapStyle,
  ensureOpenStreetMapAttribution,
  normalizeMapConfig,
  normalizeMapGlyphsTemplate,
  normalizeMapStyleUrl,
  normalizeMapTileTemplate,
  resolveBasemapStyle
} from "./config";

describe("geo basemap configuration", () => {
  it("normalizes current COP-compatible map environment values", () => {
    const result = normalizeMapConfig({
      attribution: OPENSTREETMAP_ATTRIBUTION,
      glyphsUrl: " https://tiles.zeleznalady.cz/fonts/{fontstack}/{range}.pbf ",
      styleUrl: "",
      tileUrl: " https://tiles.zeleznalady.cz/osm/{z}/{x}/{y}.png "
    });

    expect(result).toEqual({
      config: {
        attribution: OPENSTREETMAP_ATTRIBUTION,
        glyphsUrl: "https://tiles.zeleznalady.cz/fonts/{fontstack}/{range}.pbf",
        styleUrl: "",
        tileUrl: "https://tiles.zeleznalady.cz/osm/{z}/{x}/{y}.png"
      },
      warnings: []
    });
  });

  it("rejects unsafe URLs and incomplete templates", () => {
    expect(normalizeMapStyleUrl("javascript:alert(1)")).toBe("");
    expect(normalizeMapStyleUrl("https://user:secret@tiles.example.test/style.json")).toBe("");
    expect(normalizeMapTileTemplate("https://tiles.example.test/{z}/{x}.png")).toBe(DEFAULT_OSM_TILE_TEMPLATE);
    expect(normalizeMapTileTemplate("data:text/plain,{z}/{x}/{y}")).toBe(DEFAULT_OSM_TILE_TEMPLATE);
    expect(normalizeMapGlyphsTemplate("https://tiles.example.test/{range}.pbf")).toBe(DEFAULT_MAPLIBRE_GLYPHS_TEMPLATE);
    expect(normalizeMapGlyphsTemplate("/fonts/{fontstack}/{range}.pbf")).toBe("/fonts/{fontstack}/{range}.pbf");
  });

  it("always preserves OpenStreetMap attribution", () => {
    expect(ensureOpenStreetMapAttribution(undefined)).toBe(OPENSTREETMAP_ATTRIBUTION);
    expect(ensureOpenStreetMapAttribution("Map provider")).toBe(`Map provider | ${OPENSTREETMAP_ATTRIBUTION}`);
    expect(ensureOpenStreetMapAttribution("© OpenStreetMap contributors")).toBe("© OpenStreetMap contributors");
  });

  it("creates a MapLibre-compatible raster fallback style", () => {
    const config = normalizeMapConfig({}).config;
    const style = createRasterBasemapStyle(config);

    expect(style.version).toBe(8);
    expect(style.glyphs).toBe(DEFAULT_MAPLIBRE_GLYPHS_TEMPLATE);
    expect(style.sources["osm-raster"]).toEqual({
      attribution: OPENSTREETMAP_ATTRIBUTION,
      maxzoom: 19,
      minzoom: 0,
      tiles: [DEFAULT_OSM_TILE_TEMPLATE],
      tileSize: 256,
      type: "raster"
    });
    expect(resolveBasemapStyle(config)).toEqual(style);
  });

  it("prefers a safe vector style URL without rewriting it", () => {
    const config = normalizeMapConfig({ styleUrl: "https://tiles.example.test/styles/v1/civil.json?rev=4" }).config;
    expect(resolveBasemapStyle(config)).toBe("https://tiles.example.test/styles/v1/civil.json?rev=4");
  });
});
