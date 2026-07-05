import { describe, expect, it } from "vitest";

import {
  aiMapActionsFromMapSearchContext,
  aiSituationFeatureMatchesMapSearchIntent,
  inferAiMapSearchIntent,
  summarizeSituationMapFeatureForAi,
  type AiMapSearchContext
} from "./ai-map-search.js";
import type { SituationFeature } from "./situation-data-source.js";

describe("AI map search", () => {
  const policeFeature: SituationFeature = {
    geometry: {
      coordinates: [17.3842, 50.1187],
      type: "Point"
    },
    id: "police-vrbno",
    properties: {
      category: "security-police",
      featureId: "security-police:vrbno",
      label: "Policie ČR - Obvodní oddělení Vrbno pod Pradědem",
      layer: "ground",
      layerId: "reference.infrastructure.emergency",
      providerLayerId: "security-police",
      sourceId: "reference:security-police:vrbno",
      sourceName: "COP reference data"
    },
    type: "Feature"
  };

  it("matches police intent against security-police map categories", () => {
    const intent = inferAiMapSearchIntent("Kde je nejbližší policie?", {});

    expect(intent).toMatchObject({
      categoryIds: ["police"],
      requested: true
    });
    expect(aiSituationFeatureMatchesMapSearchIntent(policeFeature, intent)).toBe(true);
  });

  it("creates focus-map actions from map search results", () => {
    const result = summarizeSituationMapFeatureForAi(policeFeature, {
      center: {
        lat: 50.12952,
        lon: 17.36285,
        radiusKm: 30
      },
      label: "Moje poloha",
      source: "body"
    });
    const context: AiMapSearchContext = {
      contractVersion: "cop-ai-map-search-v1",
      generatedAt: "2026-07-05T08:00:00.000Z",
      query: {},
      results: [result],
      toolCall: {},
      warnings: []
    };

    expect(aiMapActionsFromMapSearchContext(context)).toEqual([
      expect.objectContaining({
        action: "focus-map",
        entityId: "security-police:vrbno",
        label: expect.stringContaining("Zobrazit na mapě"),
        lat: 50.1187,
        lon: 17.3842,
        title: "Policie ČR - Obvodní oddělení Vrbno pod Pradědem",
        zoom: 16
      })
    ]);
  });
});
