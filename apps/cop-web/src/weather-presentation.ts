import type React from "react";
import type { SituationFeature } from "./cop-data";

export type WeatherTone = "neutral" | "ok" | "warn" | "critical";

export function normalizeSituationCategory(category: string | undefined): string {
  return (category ?? "").toLowerCase().replace(/[\s.-]+/g, "_");
}

export function isCurrentWeatherSummaryFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return feature.properties.layerId === "public.weather.current"
    || feature.properties.providerLayerId === "weather.open_meteo"
    || (feature.properties.layer === "weather" && feature.properties.sourceId === "open_meteo")
    || stringProperty(tags.mapDisplayHint) === "weather_observation_point";
}

export function isMeasuredWeatherStationFeature(feature: SituationFeature): boolean {
  const providerLayerId = stringProperty(feature.properties.providerLayerId);
  return feature.properties.layerId === "public.weather.observations"
    || feature.properties.sourceId === "chmi_weather_stations"
    || providerLayerId === "weather.chmi_station_observations"
    || providerLayerId?.includes("chmi_station") === true;
}

export function weatherDisplayRecord(feature: SituationFeature): Record<string, unknown> | undefined {
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  return isRecord(providerProperties.display) ? providerProperties.display : undefined;
}

export function weatherDisplayString(feature: SituationFeature, key: string): string | undefined {
  const display = weatherDisplayRecord(feature);
  return display ? stringProperty(display[key]) : undefined;
}

export function weatherDisplayNumber(feature: SituationFeature, key: string): number | undefined {
  const display = weatherDisplayRecord(feature);
  return display ? numberProperty(display[key]) : undefined;
}

export function weatherDisplayTone(feature: SituationFeature): WeatherTone | undefined {
  const tone = weatherDisplayString(feature, "badgeTone")?.toLowerCase();
  switch (tone) {
    case "critical":
    case "danger":
    case "error":
      return "critical";
    case "warning":
    case "warn":
    case "advisory":
      return "warn";
    case "ok":
    case "success":
    case "info":
      return "ok";
    case "neutral":
    case "unknown":
      return "neutral";
    default:
      return undefined;
  }
}

export function weatherConditionModeLabel(value: string | undefined): string | undefined {
  switch (value) {
    case "observed":
      return "autoritativní stav";
    case "measured":
      return "měřený jev";
    case "estimated":
      return "odhad SIM";
    case "unclassified":
      return "měření";
    default:
      return value;
  }
}

export function weatherStationDetailUrl(feature: SituationFeature): string | undefined {
  return weatherDisplayString(feature, "detailUrl") ?? feature.properties.detailUrl;
}

export function weatherFeatureHeadline(feature: SituationFeature): string {
  const displayTitle = weatherDisplayString(feature, "title");
  if (displayTitle) {
    return displayTitle;
  }
  if (isCurrentWeatherSummaryFeature(feature)) {
    return "Počasí ve středu oblasti";
  }
  const metrics = metricsRecord(feature);
  switch (feature.properties.layer) {
    case "weather_temperature_grid": {
      const value = weatherMetricValue(feature, metrics, "temperatureC");
      return value !== undefined ? `Teplota ${Math.round(value)} °C` : "Teplotní pole";
    }
    case "weather_wind_field": {
      const value = weatherMetricValue(feature, metrics, "windSpeedMps");
      return value !== undefined ? `Vítr ${Math.round(value)} m/s` : "Pole větru";
    }
    case "weather_precipitation_grid": {
      const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
      return value !== undefined ? `Srážky: ${precipitationIntensityLabel(value)}` : "Srážky";
    }
    case "weather_humidity_grid": {
      const value = weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent");
      return value !== undefined ? `Vlhkost ${Math.round(value)} %` : "Vlhkost vzduchu";
    }
    case "weather_pressure_grid": {
      const value = weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel");
      return value !== undefined ? `Tlak ${Math.round(value)} hPa` : "Tlak vzduchu";
    }
    case "weather_radar_reflectivity":
      return "Radarová odrazivost";
    case "weather_radar_precipitation":
      return "Radarové srážky";
    case "weather_radar_nowcast":
      return "Radarový nowcast";
    case "weather_thunderstorm_risk":
      return "Bouřkové riziko";
    default:
      return feature.properties.headline ?? feature.properties.label ?? "Počasí";
  }
}

export function weatherFeatureSubtitle(feature: SituationFeature): string {
  const displaySubtitle = weatherDisplayString(feature, "subtitle");
  if (displaySubtitle) {
    return displaySubtitle;
  }
  const metrics = metricsRecord(feature);
  return [
    weatherFeatureValueLabel(feature, metrics),
    feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId),
    weatherDataQualityLabel(stringProperty(feature.properties.dataQuality)),
    feature.properties.stale ? "starší data" : undefined
  ].filter(Boolean).join(" · ");
}

export function weatherFeatureTypeLabel(feature: SituationFeature): string {
  if (isCurrentWeatherSummaryFeature(feature)) {
    return "Aktuální souhrn oblasti";
  }
  switch (feature.properties.layer) {
    case "weather_temperature_grid":
      return "Teplotní vrstva";
    case "weather_wind_field":
      return "Vrstva větru";
    case "weather_precipitation_grid":
      return "Srážková vrstva";
    case "weather_humidity_grid":
      return "Vlhkostní vrstva";
    case "weather_pressure_grid":
      return "Tlaková vrstva";
    case "weather_radar_reflectivity":
      return "Radarová vrstva";
    case "weather_radar_precipitation":
      return "Radarová srážková vrstva";
    case "weather_radar_nowcast":
      return "Nowcasting srážek";
    case "weather_thunderstorm_risk":
      return "Bouřkové riziko";
    default:
      return isMeasuredWeatherStationFeature(feature) ? "Měřicí stanice ČHMÚ" : "Měřené počasí";
  }
}

export function weatherFeatureValueLabel(feature: SituationFeature, metrics: Record<string, unknown>): string | undefined {
  const displayValue = weatherDisplayString(feature, "primaryValue");
  if (displayValue) {
    return displayValue;
  }
  switch (feature.properties.layer) {
    case "weather_temperature_grid": {
      const value = weatherMetricValue(feature, metrics, "temperatureC");
      return value !== undefined ? `${Math.round(value)} °C` : undefined;
    }
    case "weather_wind_field": {
      const speed = weatherMetricValue(feature, metrics, "windSpeedMps");
      const direction = recordNumber(metrics, "windDirectionDeg");
      return [
        speed !== undefined ? `${Math.round(speed)} m/s` : undefined,
        direction !== undefined ? `${Math.round(direction)}°` : undefined
      ].filter(Boolean).join(", ") || undefined;
    }
    case "weather_precipitation_grid": {
      const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
      return value !== undefined ? `${formatPrecipitationAmount(value)} za 10 min` : undefined;
    }
    case "weather_humidity_grid": {
      const value = weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent");
      return value !== undefined ? `${Math.round(value)} %` : undefined;
    }
    case "weather_pressure_grid": {
      const value = weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel");
      return value !== undefined ? `${Math.round(value)} hPa` : undefined;
    }
    default:
      return isMeasuredWeatherStationFeature(feature) ? weatherMeasuredStationPrimaryValue(metrics) : undefined;
  }
}

export function weatherFeatureConditionLabel(feature: SituationFeature, metrics: Record<string, unknown>): string {
  const displayBadge = weatherDisplayString(feature, "badgeLabel");
  if (displayBadge) {
    return displayBadge;
  }
  const displayMode = weatherConditionModeLabel(weatherDisplayString(feature, "conditionMode"));
  if (displayMode) {
    return displayMode;
  }
  if (isCurrentWeatherSummaryFeature(feature)) {
    const temperature = weatherMetricValue(feature, metrics, "temperatureC");
    const wind = weatherMetricValue(feature, metrics, "windSpeedMps");
    const precipitation = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
    return [
      temperature !== undefined ? `${Math.round(temperature)} °C` : undefined,
      wind !== undefined ? `vítr ${Math.round(wind)} m/s` : undefined,
      precipitation !== undefined ? `${formatPrecipitationAmount(precipitation)} srážek` : undefined
    ].filter(Boolean).join(" · ") || "aktuální počasí";
  }
  switch (feature.properties.layer) {
    case "weather_precipitation_grid": {
      const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
      return value !== undefined ? precipitationIntensityLabel(value) : "srážky";
    }
    case "weather_wind_field": {
      const value = weatherMetricValue(feature, metrics, "windSpeedMps");
      if (value === undefined) {
        return "vítr";
      }
      if (value < 3) {
        return "slabý vítr";
      }
      if (value < 8) {
        return "mírný vítr";
      }
      if (value < 14) {
        return "čerstvý vítr";
      }
      return "silný vítr";
    }
    case "weather_temperature_grid":
      return "teplota";
    case "weather_humidity_grid":
      return "vlhkost";
    case "weather_pressure_grid":
      return "tlak";
    case "weather_radar_reflectivity":
      return "radarová odrazivost";
    case "weather_radar_precipitation":
      return "radarové srážky";
    case "weather_radar_nowcast":
      return "krátkodobá predikce srážek";
    case "weather_thunderstorm_risk":
      return "riziko bouřek";
    default:
      return isMeasuredWeatherStationFeature(feature) ? weatherMeasuredStationConditionLabel(metrics) : "počasí";
  }
}

export function weatherContextDetailRows(feature: SituationFeature): Array<[string, React.ReactNode]> {
  const metrics = metricsRecord(feature);
  const display = weatherDisplayRecord(feature);
  if (display && isMeasuredWeatherStationFeature(feature)) {
    const summaryRows = compactDetailRows([
      ["Stanice", weatherDisplayString(feature, "title") ?? feature.properties.label ?? feature.properties.headline],
      ["Závěr SIM", weatherFeatureConditionLabel(feature, metrics)],
      ["Hodnota", weatherDisplayString(feature, "primaryValue")],
      ["Doplňkově", [weatherDisplayString(feature, "secondaryValue"), weatherDisplayString(feature, "tertiaryValue")].filter(Boolean).join(" · ")],
      ["Typ závěru", weatherConditionModeLabel(weatherDisplayString(feature, "conditionMode"))],
      ["Jistota závěru", formatOptionalPercentFromWhole(weatherDisplayNumber(feature, "confidencePercent"), feature.properties.confidence)],
      ["Čas měření", formatShortDateTime(feature.properties.observedAt)],
      ["Stáří dat", formatAge(feature.properties.observedAt)],
      ["Zdroj", feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId)]
    ]);
    const measuredRows = weatherMeasuredStationDetailRows(feature, metrics, false);
    const rows = [...summaryRows, ...measuredRows];
    return rows.length > 0 ? rows : [["Stav", "měření"]];
  }
  if (!isMeasuredWeatherStationFeature(feature)) {
    return [
      ["Charakter", weatherFeatureConditionLabel(feature, metrics)],
      ["Kvalita dat", weatherDataQualityLabel(stringProperty(feature.properties.dataQuality)) ?? "n/a"],
      ["Jistota", formatOptionalPercent(feature.properties.confidence)]
    ];
  }
  return weatherMeasuredStationDetailRows(feature, metrics, true);
}

export function weatherMeasuredMetric(metrics: Record<string, unknown>, ...keys: string[]): number | undefined {
  return firstRecordNumber(metrics, ...keys);
}

export function weatherMeasuredStationPrimaryValue(metrics: Record<string, unknown>): string | undefined {
  const temperatureC = weatherMeasuredMetric(metrics, "temperatureC");
  const windSpeedMps = weatherMeasuredMetric(metrics, "windSpeedMps");
  const precipitation10mMm = weatherMeasuredMetric(metrics, "precipitation10mMm", "precipitationMm");
  const parts = [
    temperatureC !== undefined ? `${Math.round(temperatureC)} °C` : undefined,
    windSpeedMps !== undefined ? `vítr ${Math.round(windSpeedMps)} m/s` : undefined,
    precipitation10mMm !== undefined && precipitation10mMm > 0 ? `${formatPrecipitationAmount(precipitation10mMm)} srážek` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function weatherMeasuredStationConditionLabel(metrics: Record<string, unknown>): string {
  const temperatureC = weatherMeasuredMetric(metrics, "temperatureC");
  const windSpeedMps = weatherMeasuredMetric(metrics, "windSpeedMps");
  const precipitation10mMm = weatherMeasuredMetric(metrics, "precipitation10mMm", "precipitationMm");
  const humidityPercent = weatherMeasuredMetric(metrics, "relativeHumidityPercent", "humidityPercent");
  if (precipitation10mMm !== undefined && precipitation10mMm > 0) {
    return temperatureC !== undefined && temperatureC <= 1.5 ? "měřený sníh/srážky" : "měřené srážky";
  }
  if (humidityPercent !== undefined && humidityPercent >= 95 && (windSpeedMps === undefined || windSpeedMps < 3)) {
    return "podmínky pro mlhu";
  }
  if (windSpeedMps !== undefined && windSpeedMps >= 7) {
    return "větrno";
  }
  return "měřicí stanice";
}

export function formatWeatherTemperatureRange(minC: number | undefined, maxC: number | undefined): string | undefined {
  if (minC === undefined && maxC === undefined) {
    return undefined;
  }
  if (minC !== undefined && maxC !== undefined) {
    return `${Math.round(minC)} / ${Math.round(maxC)} °C`;
  }
  return minC !== undefined ? `min ${Math.round(minC)} °C` : `max ${Math.round(maxC as number)} °C`;
}

export function formatMeasuredWeatherWind(directionDeg: number | undefined, speedMps: number | undefined, gustMps: number | undefined): string {
  const parts = [
    directionDeg !== undefined ? `${Math.round(directionDeg)}°` : undefined,
    speedMps !== undefined ? `${Math.round(speedMps)} m/s` : undefined,
    gustMps !== undefined ? `náraz ${Math.round(gustMps)} m/s` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "n/a";
}

export function weatherTemperatureTone(value: number | undefined): WeatherTone {
  if (value === undefined) {
    return "neutral";
  }
  if (value >= 34 || value <= -12) {
    return "critical";
  }
  if (value >= 30 || value <= -6) {
    return "warn";
  }
  return "ok";
}

export function weatherMeasuredWindTone(speedMps: number | undefined, gustMps: number | undefined): WeatherTone {
  const value = Math.max(speedMps ?? 0, gustMps ?? 0);
  if (value <= 0) {
    return "neutral";
  }
  if (value >= 20) {
    return "critical";
  }
  if (value >= 12) {
    return "warn";
  }
  return "ok";
}

export function weatherMeasuredPrecipitationTone(value: number | undefined): WeatherTone {
  if (value === undefined || value <= 0.02) {
    return "neutral";
  }
  if (value >= 5) {
    return "critical";
  }
  if (value >= 2) {
    return "warn";
  }
  return "ok";
}

export function weatherMetricValue(feature: SituationFeature, metrics: Record<string, unknown>, ...fallbackKeys: string[]): number | undefined {
  const rendering = isRecord(feature.properties.rendering) ? feature.properties.rendering : {};
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  const providerRendering = isRecord(providerProperties.rendering) ? providerProperties.rendering : {};
  const metricKey = stringProperty(rendering.valueMetric) ?? stringProperty(providerRendering.valueMetric);
  if (metricKey) {
    const metricValue = recordNumber(metrics, metricKey);
    if (metricValue !== undefined) {
      return metricValue;
    }
  }
  return recordNumber(metrics, "value") ?? firstRecordNumber(metrics, ...fallbackKeys);
}

export function weatherFeatureTone(feature: SituationFeature): WeatherTone {
  const metrics = metricsRecord(feature);
  if (feature.properties.stale) {
    return "warn";
  }
  const displayTone = weatherDisplayTone(feature);
  if (displayTone) {
    return displayTone;
  }
  if (feature.properties.layer === "weather_precipitation_grid") {
    const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
    if (value === undefined || value <= 0.02) {
      return "neutral";
    }
    if (value >= 5) {
      return "critical";
    }
    return value >= 2 ? "warn" : "ok";
  }
  if (feature.properties.layer === "weather_wind_field") {
    const value = weatherMetricValue(feature, metrics, "windSpeedMps");
    if (value === undefined) {
      return "neutral";
    }
    if (value >= 22) {
      return "critical";
    }
    return value >= 14 ? "warn" : "ok";
  }
  return "neutral";
}

export function formatPrecipitationAmount(value: number): string {
  return value < 0.05 ? "0 mm" : `${value.toFixed(value < 1 ? 1 : 0)} mm`;
}

export function precipitationIntensityLabel(value: number): string {
  if (value <= 0.02) {
    return "beze srážek";
  }
  if (value < 0.2) {
    return "mrholení";
  }
  if (value < 0.8) {
    return "slabé";
  }
  if (value < 2) {
    return "mírné";
  }
  if (value < 5) {
    return "výrazné";
  }
  return "silné";
}

export function weatherDataQualityLabel(value: string | undefined): string | undefined {
  switch (value) {
    case "observed":
      return "měřeno";
    case "mixed":
      return "měřeno + model";
    case "modelled":
      return "model";
    default:
      return undefined;
  }
}

function weatherMeasuredStationDetailRows(
  feature: SituationFeature,
  metrics: Record<string, unknown>,
  includeIdentity: boolean
): Array<[string, React.ReactNode]> {
  const temperatureC = weatherMeasuredMetric(metrics, "temperatureC");
  const temperatureMinC = weatherMeasuredMetric(metrics, "temperatureMinC", "minTemperatureC", "temperatureMinimumC", "temperatureMin24hC");
  const temperatureMaxC = weatherMeasuredMetric(metrics, "temperatureMaxC", "maxTemperatureC", "temperatureMaximumC", "temperatureMax24hC");
  const windSpeedMps = weatherMeasuredMetric(metrics, "windSpeedMps");
  const windGustMps = weatherMeasuredMetric(metrics, "windGustMps");
  const windDirectionDeg = weatherMeasuredMetric(metrics, "windDirectionDeg");
  const precipitation10mMm = weatherMeasuredMetric(metrics, "precipitation10mMm", "precipitationMm");
  const humidityPercent = weatherMeasuredMetric(metrics, "relativeHumidityPercent", "humidityPercent");
  const pressureHpa = weatherMeasuredMetric(metrics, "pressureHpa", "pressureHpaSeaLevel");
  const sunshineDurationSeconds = weatherMeasuredMetric(metrics, "sunshineDurationSeconds");
  const elevationM = weatherMeasuredMetric(metrics, "elevationM");
  const ageSeconds = weatherMeasuredMetric(metrics, "ageSeconds");
  return compactDetailRows([
    ["Stanice", includeIdentity ? feature.properties.label ?? feature.properties.headline : undefined],
    ["Čas měření", includeIdentity ? formatShortDateTime(feature.properties.observedAt) : undefined],
    ["Stáří dat", includeIdentity ? ageSeconds !== undefined ? formatDurationSeconds(ageSeconds) : formatAge(feature.properties.observedAt) : undefined],
    ["Teplota", temperatureC !== undefined ? formatOptionalNumber(temperatureC, " °C") : undefined],
    ["Teplota min/max", formatWeatherTemperatureRange(temperatureMinC, temperatureMaxC)],
    ["Vítr", formatMeasuredWeatherWind(windDirectionDeg, windSpeedMps, windGustMps)],
    ["Srážky 10 min", precipitation10mMm !== undefined ? formatPrecipitationAmount(precipitation10mMm) : undefined],
    ["Vlhkost", humidityPercent !== undefined ? `${Math.round(humidityPercent)} %` : undefined],
    ["Tlak", pressureHpa !== undefined ? `${Math.round(pressureHpa)} hPa` : undefined],
    ["Sluneční svit", sunshineDurationSeconds !== undefined ? formatDurationSeconds(sunshineDurationSeconds) : undefined],
    ["Nadmořská výška", elevationM !== undefined ? formatOptionalNumber(elevationM, " m") : undefined],
    ["Kvalita dat", weatherDataQualityLabel(stringProperty(feature.properties.dataQuality))],
    ["Jistota", formatOptionalPercent(feature.properties.confidence)],
    ["Zdroj", includeIdentity ? feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId) : undefined]
  ]);
}

function compactDetailRows(rows: Array<[string, React.ReactNode | undefined]>): Array<[string, React.ReactNode]> {
  return rows
    .filter(([, value]) => value !== undefined && value !== "" && value !== "n/a")
    .map(([label, value]) => [label, value as React.ReactNode] as [string, React.ReactNode]);
}

function metricsRecord(feature: SituationFeature): Record<string, unknown> {
  return isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberProperty(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
}

function firstRecordNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = recordNumber(record, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function sourceDisplayName(sourceSystemId: string | undefined): string {
  if (!sourceSystemId) {
    return "zdroj není dostupný";
  }
  const labels: Record<string, string> = {
    aviation_weather: "METAR/TAF",
    chmi_air_quality: "ČHMÚ",
    chmi_weather_stations: "ČHMÚ",
    chmi_weather_webcams: "ČHMÚ webkamery",
    open_meteo: "Open-Meteo",
    "safety-data-api": "Výstražná data",
    "situation-data-api": "Situační vrstvy"
  };
  return labels[sourceSystemId] ?? sourceSystemId;
}

function formatOptionalPercent(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)} %` : "n/a";
}

function formatOptionalPercentFromWhole(value: number | undefined, fallbackRatio?: number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)} %`;
  }
  return formatOptionalPercent(fallbackRatio);
}

function formatOptionalNumber(value: number | undefined, unit: string): string {
  return value === undefined ? "n/a" : `${Math.round(value * 10) / 10}${unit}`;
}

function formatDurationSeconds(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  if (value < 60) {
    return `${Math.round(value)} s`;
  }
  if (value < 3600) {
    return `${Math.round(value / 60)} min`;
  }
  return `${Math.round((value / 3600) * 10) / 10} h`;
}

function formatShortDateTime(value: string | undefined): string {
  if (!value) {
    return "n/a";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "n/a";
  }
  return timestamp.toLocaleTimeString("cs-CZ");
}

function formatAge(value: string | undefined): string {
  if (!value) {
    return "live sample";
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "n/a";
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  return `${Math.round(seconds / 60)} min`;
}
