import { describe, expect, it } from "vitest";
import type { AoiRule, SituationFeature } from "./cop-data";
import { buildSafetyAreaAlertMatches } from "./safety-area-alerts";

describe("safety area alerts", () => {
  const zone: AoiRule = {
    enabled: true,
    id: "zone-1",
    lat: 50,
    lon: 14,
    name: "Sledovaná obec",
    radiusKm: 5
  };

  it("matches active safety point inside a user area", () => {
    const matches = buildSafetyAreaAlertMatches(
      [
        safetyFeature({
          coordinates: [14.01, 50.01],
          featureId: "warning-1",
          headline: "Dopravní nehoda",
          severity: "warning"
        })
      ],
      [zone]
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      aoiRule: { id: "zone-1" },
      severityRank: 2,
      title: "Dopravní nehoda",
      tone: "warning"
    });
  });

  it("ignores features outside the user area", () => {
    const matches = buildSafetyAreaAlertMatches(
      [
        safetyFeature({
          coordinates: [14.5, 50.5],
          featureId: "warning-2",
          headline: "Vzdálená výstraha",
          severity: "critical"
        })
      ],
      [zone]
    );

    expect(matches).toEqual([]);
  });

  it("matches a polygon that contains the watched area center", () => {
    const matches = buildSafetyAreaAlertMatches(
      [
        {
          geometry: {
            coordinates: [
              [
                [13.9, 49.9],
                [14.1, 49.9],
                [14.1, 50.1],
                [13.9, 50.1],
                [13.9, 49.9]
              ]
            ],
            type: "Polygon"
          },
          properties: {
            category: "warning",
            featureId: "weather-polygon",
            headline: "Silný vítr",
            label: "Silný vítr",
            layer: "weather_alerts",
            layerId: "public.safety.weather_alerts",
            severity: "critical",
            sourceId: "chmi_alerts",
            tags: { dataSource: "safety-data" }
          },
          type: "Feature"
        } satisfies SituationFeature
      ],
      [zone]
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.tone).toBe("critical");
  });

  it("orders matches by severity first", () => {
    const matches = buildSafetyAreaAlertMatches(
      [
        safetyFeature({ coordinates: [14.01, 50.01], featureId: "info", headline: "Informace", severity: "info" }),
        safetyFeature({
          coordinates: [14.02, 50.02],
          featureId: "critical",
          headline: "Kritická výstraha",
          severity: "critical"
        })
      ],
      [zone]
    );

    expect(matches.map((match) => match.feature.properties.featureId)).toEqual(["critical", "info"]);
  });
});

function safetyFeature(input: {
  coordinates: [number, number];
  featureId: string;
  headline: string;
  severity: string;
}): SituationFeature {
  return {
    geometry: {
      coordinates: input.coordinates,
      type: "Point"
    },
    properties: {
      category: "warning",
      featureId: input.featureId,
      headline: input.headline,
      label: input.headline,
      layer: "warnings",
      layerId: "public.safety.warnings",
      severity: input.severity,
      sourceId: "road_srti_lod",
      tags: { dataSource: "safety-data" }
    },
    type: "Feature"
  };
}
