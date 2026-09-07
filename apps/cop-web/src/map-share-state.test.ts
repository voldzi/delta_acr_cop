import { describe, expect, it } from "vitest";
import { buildCopMapShareUrl, decodeCopMapShareSearch, type CopMapShareState } from "./map-share-state";

const state: CopMapShareState = {
  basemap: "risk",
  camera: { bearing: 12, center: [14.42076, 50.08804], pitch: 24, zoom: 13.5 },
  catalogLayerIds: ["public.safety.warnings"],
  safetyLayerIds: ["warnings", "flood"],
  selectedObjectId: "incident-1",
  situationLayerIds: ["weather"],
  trackLayerIds: ["all"],
  version: 1,
  workspace: "map"
};

describe("versioned COP map share state", () => {
  it("round trips a bounded view without discarding unrelated query parameters", () => {
    const url = new URL(buildCopMapShareUrl("https://cop.example/?report=1", state));
    expect(url.searchParams.get("report")).toBe("1");
    expect(decodeCopMapShareSearch(url.search)).toEqual(state);
  });

  it("rejects incomplete and unsafe camera values", () => {
    expect(decodeCopMapShareSearch("?sv=1&slon=15&slat=50")).toBeNull();
    expect(decodeCopMapShareSearch("?sv=1&slon=15&slat=500&sz=8&sbr=0&spi=0")).toBeNull();
  });

  it("drops malformed layer identifiers", () => {
    const parsed = decodeCopMapShareSearch("?sv=1&slon=15&slat=50&sz=8&sbr=0&spi=0&strk=air-situation,%3Cscript%3E");
    expect(parsed?.trackLayerIds).toEqual(["air-situation"]);
  });
});
