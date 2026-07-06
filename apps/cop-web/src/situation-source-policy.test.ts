import { describe, expect, it } from "vitest";
import {
  filterCitizenSituationLayers,
  filterCitizenSituationSources,
  filterTechnicalSituationSources,
  normalizeCitizenSituationLayerIds,
  sanitizeCitizenSituationSourceIds
} from "./situation-source-policy";
import type { SituationLayer, SituationSourceDescriptor } from "./cop-data";

describe("situation source policy", () => {
  it("maps technical mobile inputs to the citizen mobile network layer", () => {
    expect(normalizeCitizenSituationLayerIds(["weather", "mobile", "mobile_coverage"])).toEqual([
      "weather",
      "mobile_network"
    ]);
  });

  it("hides technical mobile layers from the citizen layer picker", () => {
    const layers: SituationLayer[] = [
      { defaultVisible: true, label: "Weather", layerId: "weather" },
      { defaultVisible: false, label: "Raw mobile", layerId: "mobile" },
      { defaultVisible: false, label: "Coverage", layerId: "mobile_coverage" },
      { defaultVisible: false, label: "Unified mobile", layerId: "mobile_network" }
    ];

    expect(filterCitizenSituationLayers(layers).map((layer) => layer.layerId)).toEqual(["weather", "mobile_network"]);
  });

  it("separates citizen sources from technical mobile inputs", () => {
    const sources: SituationSourceDescriptor[] = [
      { sourceId: "open_meteo", label: "Weather" },
      { sourceId: "mobile_network_model", label: "Unified mobile network assessment" },
      { sourceId: "mobile_coverage_model", label: "Coverage model" },
      { sourceId: "ctu_nettest", label: "CTU measurements" },
      { sourceId: "osm_postgis", label: "OSM context" }
    ];

    expect(filterCitizenSituationSources(sources).map((source) => source.sourceId)).toEqual([
      "open_meteo",
      "mobile_network_model"
    ]);
    expect(filterTechnicalSituationSources(sources).map((source) => source.sourceId)).toEqual([
      "mobile_coverage_model",
      "ctu_nettest",
      "osm_postgis"
    ]);
  });

  it("removes stale technical source preferences", () => {
    expect(
      sanitizeCitizenSituationSourceIds([
        "mobile_coverage_model",
        "mobile_network_model",
        "ctu_nettest",
        "mobile_network_model"
      ])
    ).toEqual(["mobile_network_model"]);
  });
});
