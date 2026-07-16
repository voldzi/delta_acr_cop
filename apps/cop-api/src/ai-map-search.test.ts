import { describe, expect, it } from "vitest";
import type { AiCopQuery } from "@cop/ai-gateway";

import {
  aiMapActionsFromMapSearchContext,
  aiMapCatalogLayerMatchesMapSearchIntent,
  aiMapSearchFallbackResponse,
  aiSituationFeatureMatchesMapSearchIntent,
  filterAiMapSearchResultsForTimeWindow,
  inferAiMapSearchIntent,
  simSearchEntityTypesForAiMapSearchIntent,
  simSearchSourceSystemsForAiMapSearchIntent,
  summarizeMapFeatureCollectionForAi,
  summarizeSituationMapFeatureForAi,
  type AiMapSearchContext
} from "./ai-map-search.js";
import type { MapCatalogLayer } from "./map-catalog.js";
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

  it("keeps only forecast evidence that overlaps the requested period", () => {
    const results = [
      {
        category: "weather",
        mapFeatureId: "weather:today",
        title: "Aktuální počasí",
        validFrom: "2026-07-16T10:00:00.000Z",
        validUntil: "2026-07-16T13:00:00.000Z"
      },
      {
        category: "weather",
        mapFeatureId: "weather:tomorrow",
        title: "Předpověď na zítřek",
        validFrom: "2026-07-17T06:00:00.000Z",
        validUntil: "2026-07-17T18:00:00.000Z"
      }
    ];

    expect(filterAiMapSearchResultsForTimeWindow(results, {
      from: "2026-07-17T00:00:00.000Z",
      to: "2026-07-18T00:00:00.000Z"
    })).toEqual([results[1]]);
  });

  it("rejects undated weather evidence for a requested future period", () => {
    const results = [{
      category: "weather",
      mapFeatureId: "weather:undated",
      title: "Počasí bez časové platnosti"
    }];

    expect(filterAiMapSearchResultsForTimeWindow(results, {
      from: "2026-07-17T00:00:00.000Z",
      to: "2026-07-18T00:00:00.000Z"
    })).toEqual([]);
  });

  it("does not filter evidence when the question has no explicit period", () => {
    const results = [{
      category: "weather",
      mapFeatureId: "weather:current",
      title: "Aktuální počasí"
    }];

    expect(filterAiMapSearchResultsForTimeWindow(results, undefined)).toBe(results);
  });

  it("matches police intent against security-police map categories", () => {
    const intent = inferAiMapSearchIntent("Kde je nejbližší policie?", {});

    expect(intent).toMatchObject({
      categoryIds: ["police"],
      requested: true
    });
    expect(aiSituationFeatureMatchesMapSearchIntent(policeFeature, intent)).toBe(true);
  });

  it("matches generic map feature terms outside hard-coded emergency categories", () => {
    const intent = inferAiMapSearchIntent("Najdi mi nejbližší vodoměrnou stanici od mé polohy.", {});
    const waterGaugeFeature: SituationFeature = {
      geometry: {
        coordinates: [17.3835, 50.1201],
        type: "Point"
      },
      id: "hydro-vrbno",
      properties: {
        category: "water-gauge",
        featureId: "chmi-hydro:opava-vrbno",
        label: "Vodoměrná stanice Opava - Vrbno pod Pradědem",
        layer: "flood",
        layerId: "public.safety.flood",
        providerLayerId: "chmi_hydro",
        sourceId: "chmi_hydro",
        sourceName: "ČHMÚ hydrologická měření",
        summary: "Aktuální stav hladiny řeky Opavy."
      },
      type: "Feature"
    };

    expect(intent).toMatchObject({
      categoryIds: ["hydro"],
      layerIds: ["public.safety.flood"],
      requested: true
    });
    expect(intent.searchTerms).toContain("vodomer");
    expect(aiSituationFeatureMatchesMapSearchIntent(waterGaugeFeature, intent)).toBe(true);
    expect(aiSituationFeatureMatchesMapSearchIntent(policeFeature, intent)).toBe(false);
  });

  it("treats surrounding-area water-level questions as current-location hydro searches", () => {
    const intent = inferAiMapSearchIntent("Kde se měří výška vody v okolí? a jaká je nyní hodnota?", {});
    const waterGaugeFeature: SituationFeature = {
      geometry: {
        coordinates: [17.3835, 50.1201],
        type: "Point"
      },
      id: "hydro-vrbno",
      properties: {
        category: "water-gauge",
        featureId: "chmi-hydro:opava-vrbno",
        label: "Vodoměrná stanice Opava - Vrbno pod Pradědem",
        layer: "flood",
        layerId: "public.safety.flood",
        providerLayerId: "chmi_hydro",
        sourceId: "chmi_hydro",
        sourceName: "ČHMÚ hydrologická měření",
        summary: "Aktuální stav hladiny řeky Opavy."
      },
      type: "Feature"
    };

    expect(intent).toMatchObject({
      categoryIds: ["hydro"],
      layerIds: ["public.safety.flood"],
      requested: true
    });
    expect(intent.placeQuery).toBeUndefined();
    expect(intent.searchTerms).toEqual(expect.arrayContaining(["vody"]));
    expect(intent.searchTerms).not.toEqual(expect.arrayContaining(["okoli", "meri", "vysk", "hodnot"]));
    expect(aiSituationFeatureMatchesMapSearchIntent(waterGaugeFeature, intent)).toBe(true);
  });

  it("treats weather and storm questions as current COP weather searches", () => {
    const intent = inferAiMapSearchIntent("Bude pršet? Blíží se bouřka?", {});

    expect(intent).toMatchObject({
      categoryIds: ["weather"],
      requested: true
    });
    expect(intent.layerIds).toEqual(expect.arrayContaining([
      "public.weather.current",
      "public.weather.observations",
      "public.weather.radar_nowcast",
      "public.safety.weather_alerts"
    ]));
    expect(intent.searchTerms).toEqual(expect.arrayContaining(["weather", "rain", "storm"]));
    expect(simSearchEntityTypesForAiMapSearchIntent(intent)).toEqual([
      "weather_forecast",
      "weather_nowcast",
      "weather_radar",
      "thunderstorm_risk"
    ]);
    expect(simSearchSourceSystemsForAiMapSearchIntent(intent)).toEqual(["weather_forecast", "chmi_weather_radar"]);
  });

  it.each([
    ["Hoří v okolí?", ["fire_incident"], ["fire_incident"]],
    ["Kde je nejbližší hasičská stanice?", ["fire_station"], ["fire_station"]],
    ["Kde je nejbližší AED?", ["defibrillator"], ["public_resource"]],
    ["Jsou v okolí dopravní omezení?", ["road_closure"], ["road_closure"]],
    ["Je v okolí výpadek elektřiny?", ["critical_infrastructure"], ["critical_infrastructure"]],
    ["Jaké jsou aktivní výstrahy?", ["safety_alert"], ["safety_alert", "weather_warning"]]
  ])("maps operational question %s to SIM entity types", (question, categoryIds, entityTypes) => {
    const intent = inferAiMapSearchIntent(question, {});

    expect(intent).toMatchObject({ categoryIds, requested: true });
    expect(simSearchEntityTypesForAiMapSearchIntent(intent)).toEqual(entityTypes);
  });

  it("keeps coordinates out of ordinary nearest-object answers", () => {
    const aiRequest: AiCopQuery = {
      context: {
        mapSearch: {
          results: [{
            category: "police_station",
            distanceText: "1,2 km",
            location: { lat: 50.12, lon: 17.38 },
            mapFeatureId: "police:vrbno",
            sourceName: "osm_reference",
            status: "active",
            title: "Policie ČR Vrbno"
          }]
        },
        question: "Kde je nejbližší policie?"
      },
      outputFormat: "MARKDOWN",
      prompt: "test",
      providerPreference: "auto",
      purpose: "COP_EXPLANATION",
      requestId: "test-police-user-facing",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };

    const response = aiMapSearchFallbackResponse(aiRequest, new Date("2026-07-15T19:30:00Z"), "test");

    expect(response?.result.summary).toContain("Nejbližší odpovídající místo");
    expect(response?.result.summary).toContain("1,2 km");
    expect(response?.result.summary).not.toContain("50.12");
    expect(response?.result.summary).not.toContain("osm_reference");
  });

  it("answers direct rain questions from SIM weather metrics", () => {
    const aiRequest: AiCopQuery = {
      context: {
        mapSearch: {
          results: [
            {
              category: "weather",
              metrics: {
                precipitation1hMm: 0,
                relativeHumidityPercent: 91,
                temperatureC: 22.5,
                windGustMps: 8.1,
                windSpeedMps: 6.27
              },
              sourceName: "sim.situation-data",
              title: "Weather near map center",
              updatedAt: "2026-07-06T05:15:00.000Z",
              validFrom: "2026-07-06T05:15:00.000Z",
              validUntil: "2026-07-06T08:15:00.000Z"
            }
          ]
        },
        question: "Bude dnes ve Vrbně pod Pradědem a okolí pršet?"
      },
      outputFormat: "MARKDOWN",
      prompt: "Dotaz uživatele: Bude dnes ve Vrbně pod Pradědem a okolí pršet?",
      providerPreference: "auto",
      purpose: "COP_EXPLANATION",
      requestId: "test-weather-rain",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };

    const response = aiMapSearchFallbackResponse(aiRequest, new Date("2026-07-06T05:29:00.000Z"), "test");

    expect(response?.result.summary).toContain("Odpověď: Déšť se v dostupném meteo výsledku spíše nepotvrzuje");
    expect(response?.result.summary).toContain("srážky 1 h 0 mm");
    expect(response?.result.summary).toContain("Pozor: tato entita pokrývá nejbližší časové okno");
    expect(response?.result.summary).toContain("Meteo informace: Weather near map center");
  });

  it("prefers SIM precipitation radar results over generic reflectivity for rain answers", () => {
    const aiRequest: AiCopQuery = {
      context: {
        mapSearch: {
          results: [
            {
              category: "weather_radar",
              layerId: "public.weather.radar_nowcast",
              location: { lat: 49.695, lon: 15.0682 },
              mapFeatureId: "chmi:max-z",
              sourceName: "chmi_weather_radar",
              sourceSystemIds: ["chmi_weather_radar", "public.weather.radar_nowcast"],
              title: "ČHMÚ radar MAX_Z",
              updatedAt: "2026-07-07T19:40:00.000Z",
              validFrom: "2026-07-07T19:40:00.000Z",
              validUntil: "2026-07-07T19:55:00.000Z"
            },
            {
              category: "weather_radar",
              layerId: "public.weather.radar_precipitation",
              location: { lat: 49.695, lon: 15.0682 },
              mapFeatureId: "chmi:merge1h",
              sourceName: "chmi_weather_radar",
              sourceSystemIds: ["chmi_weather_radar", "public.weather.radar_precipitation"],
              title: "ČHMÚ MERGE 1h precipitation",
              updatedAt: "2026-07-07T19:40:00.000Z",
              validFrom: "2026-07-07T19:40:00.000Z",
              validUntil: "2026-07-07T19:55:00.000Z"
            }
          ]
        },
        question: "Bude dnes pršet?"
      },
      outputFormat: "MARKDOWN",
      prompt: "Dotaz uživatele: Bude dnes pršet?",
      providerPreference: "auto",
      purpose: "COP_EXPLANATION",
      requestId: "test-weather-radar-rain",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };

    const response = aiMapSearchFallbackResponse(aiRequest, new Date("2026-07-07T19:44:00.000Z"), "test");
    const structured = response?.result.structured as {
      mapActions?: Array<{ title?: string }>;
      mapSearchFallback?: { result?: { title?: string } };
    } | undefined;
    const fallback = structured?.mapSearchFallback;

    expect(response?.result.summary).toContain("SIM vrátil srážkový radarový podklad");
    expect(response?.result.summary).toContain("Meteo informace: ČHMÚ MERGE 1h precipitation");
    expect(response?.result.summary).not.toContain("Na déšť nelze");
    expect(fallback?.result?.title).toBe("ČHMÚ MERGE 1h precipitation");
    expect(structured?.mapActions).toEqual([
      expect.objectContaining({ title: "ČHMÚ MERGE 1h precipitation" })
    ]);
  });

  it("prefers a structured forecast and hides technical layer details for general weather", () => {
    const aiRequest: AiCopQuery = {
      context: {
        mapSearch: {
          results: [
            {
              category: "weather_radar",
              layerId: "public.weather.radar_nowcast",
              location: { lat: 49.695, lon: 15.0682 },
              mapFeatureId: "chmi:max-z",
              sourceName: "chmi_weather_radar",
              sourceSystemIds: ["chmi_weather_radar"],
              title: "ČHMÚ radar MAX_Z",
              updatedAt: "2026-07-15T19:30:00.000Z",
              validFrom: "2026-07-15T19:30:00.000Z",
              validUntil: "2026-07-15T19:45:00.000Z"
            },
            {
              category: "rain_storm_forecast",
              fallbackUsed: true,
              layerId: "public.weather.forecast_area",
              location: { lat: 50.15077, lon: 17.37303 },
              mapFeatureId: "weather_forecast:vrbno:2026-07-15T19",
              metrics: {
                precipitation3hMm: 5.9,
                precipitationProbability: 0.7,
                risk: "elevated",
                thunderstormProbability: 0.35,
                windGustMps: 12,
                windSpeedMps: 4.2
              },
              sourceName: "weather_forecast",
              sourceSystemIds: ["sim.search-data", "weather_forecast"],
              title: "Předpověď pro Vrbno pod Pradědem",
              updatedAt: "2026-07-15T19:30:00.000Z",
              validFrom: "2026-07-15T19:30:00.000Z",
              validUntil: "2026-07-15T22:30:00.000Z"
            }
          ]
        },
        question: "Jaké bude počasí?"
      },
      outputFormat: "MARKDOWN",
      prompt: "Dotaz uživatele: Jaké bude počasí?",
      providerPreference: "auto",
      purpose: "COP_EXPLANATION",
      requestId: "test-weather-summary",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };

    const response = aiMapSearchFallbackResponse(aiRequest, new Date("2026-07-15T19:32:00.000Z"), "test");
    const structured = response?.result.structured as {
      mapSearchFallback?: { result?: { title?: string } };
    } | undefined;

    expect(response?.result.summary).toContain("Pro nejbližší dostupné období");
    expect(response?.result.summary).toContain("pravděpodobnost srážek 70 %");
    expect(response?.result.summary).toContain("nárazy do 12 m/s");
    expect(response?.result.summary).toContain("celkové riziko zvýšené");
    expect(response?.result.summary).not.toContain("MAX_Z");
    expect(response?.result.summary).not.toContain("chmi_weather_radar");
    expect(response?.result.summary).not.toContain("49.695");
    expect(structured?.mapSearchFallback?.result?.title).toBe("Předpověď pro Vrbno pod Pradědem");
  });

  it("extracts a clean place query from generic map searches with a location phrase", () => {
    const intent = inferAiMapSearchIntent("Najdi vodoměrnou stanici ve Vrbně pod Pradědem.", {});
    const waterGaugeFeature: SituationFeature = {
      geometry: {
        coordinates: [17.389, 50.123],
        type: "Point"
      },
      id: "chmi-hydro:opava-vrbno",
      properties: {
        category: "water-gauge",
        featureId: "chmi-hydro:opava-vrbno",
        label: "Vodoměrná stanice Opava - Vrbno pod Pradědem",
        layer: "flood",
        layerId: "public.safety.flood",
        providerLayerId: "chmi_hydro",
        sourceId: "chmi_hydro",
        sourceName: "ČHMÚ hydrologická měření",
        summary: "Aktuální stav hladiny řeky Opavy."
      },
      type: "Feature"
    };

    expect(intent).toMatchObject({
      placeQuery: "Vrbně pod Pradědem",
      requested: true
    });
    expect(intent.searchTerms).toEqual(expect.arrayContaining(["vodomer", "stan"]));
    expect(intent.searchTerms).not.toEqual(expect.arrayContaining(["vrbn", "praded"]));
    expect(aiSituationFeatureMatchesMapSearchIntent(waterGaugeFeature, intent)).toBe(true);
  });

  it("matches production CHMI hydro features that only expose technical English metadata", () => {
    const intent = inferAiMapSearchIntent("Najdi vodoměrnou stanici ve Vrbně pod Pradědem.", {});
    const results = summarizeMapFeatureCollectionForAi({
      features: [
        {
          geometry: {
            coordinates: [17.386, 50.121],
            type: "Point"
          },
          id: "flood:chmi_hydro:1vnc992",
          properties: {
            category: "water_level",
            layerId: "public.safety.flood",
            providerLayerId: "safety.flood",
            sourceId: "chmi_hydro",
            sourceName: "CHMI hydrological stations",
            status: "monitoring"
          },
          type: "Feature"
        }
      ],
      type: "FeatureCollection"
    }, {
      bbox: {
        east: 17.45,
        north: 50.16,
        south: 50.09,
        west: 17.31
      },
      center: {
        lat: 50.123,
        lon: 17.389,
        radiusKm: 10
      },
      label: "Vrbně pod Pradědem"
    }, intent, "sim.safety-data");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      category: "water_level",
      mapFeatureId: "flood:chmi_hydro:1vnc992",
      sourceName: "CHMI hydrological stations",
      title: "water_level"
    });
  });

  it("uses catalog metadata to narrow generic map searches when possible", () => {
    const intent = inferAiMapSearchIntent("Ukaž mi nejbližší autobusovou zastávku.", {});
    const transitStopsLayer: MapCatalogLayer = {
      audience: "authenticated",
      defaultVisible: false,
      groupId: "traffic",
      kind: "vector_features",
      label: "Zastávky veřejné dopravy",
      layerId: "public.traffic.transit_stops",
      query: {
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["traffic"],
        providerSourceIds: ["public_transit_stops"],
        streamId: "public.traffic.transit_stops"
      },
      role: "reference",
      selectable: true,
      styleProfile: "traffic-transit-stops"
    };

    expect(aiMapCatalogLayerMatchesMapSearchIntent(transitStopsLayer, intent)).toBe(true);
  });

  it("summarizes generic provider feature collections for clickable map actions", () => {
    const intent = inferAiMapSearchIntent("Najdi poškozený most.", {});
    const results = summarizeMapFeatureCollectionForAi({
      features: [
        {
          geometry: {
            coordinates: [14.392, 49.9781],
            type: "Point"
          },
          id: "report-bridge",
          properties: {
            category: "bridge_damage",
            description: "Most má poškozený kraj vozovky.",
            featureId: "community:report-bridge",
            label: "Poškozený most Zbraslav",
            layer: "community",
            sourceId: "community_reports",
            status: "submitted"
          },
          type: "Feature"
        }
      ],
      type: "FeatureCollection"
    }, {
      center: {
        lat: 49.98,
        lon: 14.39,
        radiusKm: 30
      },
      label: "Moje poloha",
      source: "body"
    }, intent, "cop.community");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      category: "bridge_damage",
      mapFeatureId: "community:report-bridge",
      title: "Poškozený most Zbraslav",
      type: "mapFeature"
    });
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
        layerId: "reference.infrastructure.emergency",
        lat: 50.1187,
        lon: 17.3842,
        sourceName: "COP reference data",
        sourceSystemIds: ["reference:security-police:vrbno"],
        title: "Policie ČR - Obvodní oddělení Vrbno pod Pradědem",
        zoom: 16
      })
    ]);
  });
});
