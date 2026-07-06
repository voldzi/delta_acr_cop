import { describe, expect, it } from "vitest";
import type { SituationFeature } from "./cop-data";
import {
  formatPrecipitationAmount,
  isMeasuredWeatherStationFeature,
  weatherConditionModeLabel,
  weatherContextDetailRows,
  weatherFeatureConditionLabel,
  weatherFeatureHeadline,
  weatherFeatureSubtitle,
  weatherFeatureTone,
  weatherFeatureValueLabel,
  weatherMeasuredPrecipitationTone
} from "./weather-presentation";

function feature(properties: Partial<SituationFeature["properties"]>): SituationFeature {
  return {
    geometry: {
      coordinates: [14.42, 50.08],
      type: "Point"
    },
    properties: {
      category: "weather",
      confidence: 0.91,
      layer: "weather",
      layerId: "public.weather.observations",
      observedAt: "2026-06-29T10:00:00.000Z",
      runtimeMode: "live",
      sourceId: "chmi_weather_stations",
      sourceName: "ČHMÚ",
      ...properties
    },
    type: "Feature"
  } as SituationFeature;
}

describe("weather presentation", () => {
  it("prefers SIM display contract over local heuristics", () => {
    const item = feature({
      providerProperties: {
        display: {
          badgeLabel: "OMEZENO",
          badgeTone: "warning",
          conditionMode: "measured",
          primaryValue: "29 °C",
          subtitle: "vítr 7 m/s",
          title: "Praha-Karlov"
        }
      }
    });

    expect(weatherFeatureHeadline(item)).toBe("Praha-Karlov");
    expect(weatherFeatureSubtitle(item)).toBe("vítr 7 m/s");
    expect(weatherFeatureValueLabel(item, {})).toBe("29 °C");
    expect(weatherFeatureConditionLabel(item, {})).toBe("OMEZENO");
    expect(weatherFeatureTone(item)).toBe("warn");
    expect(weatherConditionModeLabel("measured")).toBe("měřený jev");
  });

  it("does not invent partly cloudy status for raw CHMU measurements", () => {
    const item = feature({
      label: "Milešovka",
      metrics: {
        relativeHumidityPercent: 72,
        temperatureC: 27.4,
        windSpeedMps: 9.2
      }
    });

    expect(isMeasuredWeatherStationFeature(item)).toBe(true);
    expect(weatherFeatureHeadline(item)).toBe("Milešovka");
    expect(weatherFeatureValueLabel(item, item.properties.metrics as Record<string, unknown>)).toBe(
      "27 °C · vítr 9 m/s"
    );
    expect(weatherFeatureConditionLabel(item, item.properties.metrics as Record<string, unknown>)).toBe("větrno");
    expect(weatherContextDetailRows(item).map(([label]) => label)).toContain("Teplota");
  });

  it("formats precipitation measurements consistently", () => {
    const item = feature({
      metrics: {
        precipitation10mMm: 2.4,
        temperatureC: 5
      }
    });
    const metrics = item.properties.metrics as Record<string, unknown>;

    expect(formatPrecipitationAmount(0.03)).toBe("0 mm");
    expect(formatPrecipitationAmount(2.4)).toBe("2 mm");
    expect(weatherMeasuredPrecipitationTone(2.4)).toBe("warn");
    expect(weatherFeatureConditionLabel(item, metrics)).toBe("měřené srážky");
  });
});
