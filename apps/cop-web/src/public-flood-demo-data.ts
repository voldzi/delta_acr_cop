import type { SituationFeature } from "./cop-data";

export const publicFloodDemoScenarioId = "flood-central-bohemia";
export const publicFloodDemoView = {
  bearing: 0,
  center: [14.405, 50.075] as [number, number],
  pitch: 0,
  zoom: 10.1
};

export type PublicFloodDemoStep = 0 | 1 | 2 | 3 | 4;

const syntheticProperties = {
  disclaimer: "DEMO · SYNTETICKÁ DATA. Nejde o skutečnou výstrahu ani hlášení.",
  sourceId: "demo-browser-only",
  sourceName: "Veřejná ukázka COP",
  tags: { demoScenarioId: publicFloodDemoScenarioId, synthetic: true }
} as const;

export function publicFloodDemoFeatures(step: PublicFloodDemoStep): SituationFeature[] {
  if (step === 0) return [];
  const stale = step === 4;
  const features: SituationFeature[] = [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [14.374, 50.166],
            [14.389, 50.175],
            [14.419, 50.16],
            [14.423, 50.146],
            [14.394, 50.141],
            [14.374, 50.166]
          ]
        ]
      },
      properties: {
        ...syntheticProperties,
        areaName: "Modelová záplavová oblast u Roztok",
        category: "flood",
        description: "Modelový rozliv v okolí řeky. Polygon je pouze součástí prezentace.",
        featureId: "public-demo:flood-area",
        hazardSeverity: "warning",
        label: "DEMO · Modelový rozliv",
        layer: "flood",
        stale
      }
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [14.3974, 50.1585] },
      properties: {
        ...syntheticProperties,
        areaName: "Modelový prostor u Roztok",
        category: "flood",
        description: "Syntetický vodní stav pro ukázku situační mapy.",
        featureId: "public-demo:water-level",
        floodStage: 2,
        hazardSeverity: "warning",
        label: "DEMO · Zvýšená hladina",
        layer: "flood",
        stale,
        trend: "rising"
      }
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [14.392, 49.9781] },
      properties: {
        ...syntheticProperties,
        category: "road_blockage",
        description: "Modelový neprůjezdný úsek; bez vazby na skutečný provoz.",
        featureId: "public-demo:road-closure",
        hazardSeverity: "warning",
        label: "DEMO · Uzavřený podjezd",
        layer: "community",
        stale
      }
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [14.414, 50.0912] },
      properties: {
        ...syntheticProperties,
        category: "volunteer_point",
        description: "Modelové bezpečné shromaždiště pro průchod scénářem.",
        featureId: "public-demo:assembly-point",
        hazardSeverity: "info",
        label: "DEMO · Shromaždiště",
        layer: "community",
        stale
      }
    }
  ];

  if (step >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [14.418, 50.145] },
      properties: {
        ...syntheticProperties,
        areaName: "Modelové dolní nábřeží u Roztok",
        category: "municipal_notice",
        description: "Modelově schválené sdělení fiktivní obce. Úplný text a platnost jsou v panelu.",
        featureId: "public-demo:municipal-notice",
        hazardSeverity: "warning",
        label: "DEMO · Sdělení obce",
        layer: "warnings",
        stale
      }
    });
  }

  return features;
}
