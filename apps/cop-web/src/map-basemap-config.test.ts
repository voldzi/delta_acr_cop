import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAPLIBRE_GLYPHS_TEMPLATE,
  DEFAULT_OSM_TILE_TEMPLATE,
  OPENSTREETMAP_ATTRIBUTION
} from "@zeleznalady/geo-client";
import { resolveCopBasemapConfig } from "./map-basemap-config.js";

describe("resolveCopBasemapConfig", () => {
  it("preserves the current COP environment variable contract", () => {
    expect(
      resolveCopBasemapConfig({
        VITE_COP_MAP_STYLE_URL: "https://tiles.example.test/styles/civil/style.json",
        VITE_COP_TILE_ATTRIBUTION: "© OpenStreetMap contributors · COP",
        VITE_COP_TILE_GLYPHS_URL: "https://tiles.example.test/fonts/{fontstack}/{range}.pbf",
        VITE_COP_TILE_URL: "https://tiles.example.test/osm/{z}/{x}/{y}.png"
      })
    ).toEqual({
      attribution: "© OpenStreetMap contributors · COP",
      glyphsUrl: "https://tiles.example.test/fonts/{fontstack}/{range}.pbf",
      styleUrl: "https://tiles.example.test/styles/civil/style.json",
      tileUrl: "https://tiles.example.test/osm/{z}/{x}/{y}.png"
    });
  });

  it("falls back safely when COP variables are absent or malformed", () => {
    expect(
      resolveCopBasemapConfig({
        VITE_COP_MAP_STYLE_URL: "javascript:alert(1)",
        VITE_COP_TILE_URL: "https://tiles.example.test/not-a-template.png"
      })
    ).toEqual({
      attribution: OPENSTREETMAP_ATTRIBUTION,
      glyphsUrl: DEFAULT_MAPLIBRE_GLYPHS_TEMPLATE,
      styleUrl: "",
      tileUrl: DEFAULT_OSM_TILE_TEMPLATE
    });
  });
});
