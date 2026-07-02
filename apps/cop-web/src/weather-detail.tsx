import React from "react";
import {
  fetchWeatherForecastAreaDetail,
  fetchWeatherStationDetail,
  type SituationFeature,
  type WeatherForecastAreaDetailResponse,
  type WeatherStationAttribution,
  type WeatherStationChart,
  type WeatherStationDetailResponse
} from "./cop-data";
import {
  formatMeasuredWeatherWind,
  formatPrecipitationAmount,
  isMeasuredWeatherStationFeature,
  weatherConditionModeLabel,
  weatherDataQualityLabel,
  weatherDisplayNumber,
  weatherDisplayRecord,
  weatherDisplayString,
  weatherFeatureConditionLabel,
  weatherFeatureHeadline,
  weatherFeatureSubtitle,
  weatherFeatureTone,
  weatherFeatureValueLabel,
  weatherMeasuredMetric,
  weatherMeasuredPrecipitationTone,
  weatherMeasuredWindTone,
  weatherStationDetailUrl,
  weatherTemperatureTone
} from "./weather-presentation";
import {
  formatOptionalNumber,
  formatOptionalPercentFromWhole,
  formatShortDateTime,
  formatShortTime,
  humanizeApiError,
  isRecord,
  numberProperty,
  sourceDisplayName,
  stringProperty
} from "./detail-format";
import { DataMetric } from "./detail-ui";

export function WeatherContextSummary({ feature }: { feature: SituationFeature }) {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const display = weatherDisplayRecord(feature);
  if (display && isMeasuredWeatherStationFeature(feature)) {
    const tone = weatherFeatureTone(feature);
    const summaryCards = [
      <DataMetric key="state" label="Stav" value={weatherFeatureConditionLabel(feature, metrics)} tone={tone} />,
      weatherDisplayString(feature, "primaryValue")
        ? <DataMetric key="primary" label="Hodnota" value={weatherDisplayString(feature, "primaryValue") as string} tone={tone} />
        : null,
      weatherDisplayString(feature, "secondaryValue")
        ? <DataMetric key="secondary" label="Doplňkově" value={weatherDisplayString(feature, "secondaryValue") as string} tone="neutral" />
        : null,
      weatherDisplayString(feature, "tertiaryValue")
        ? <DataMetric key="tertiary" label="Další" value={weatherDisplayString(feature, "tertiaryValue") as string} tone="neutral" />
        : null,
      <DataMetric
        key="mode"
        label="Typ závěru"
        value={weatherConditionModeLabel(weatherDisplayString(feature, "conditionMode")) ?? "měření"}
        tone="neutral"
      />,
      <DataMetric
        key="confidence"
        label="Jistota"
        value={formatOptionalPercentFromWhole(weatherDisplayNumber(feature, "confidencePercent"), feature.properties.confidence)}
        tone="neutral"
      />
    ].filter(Boolean);
    return <div className="mobile-status-summary weather-context-summary">{summaryCards}</div>;
  }
  if (isMeasuredWeatherStationFeature(feature)) {
    const temperatureC = weatherMeasuredMetric(metrics, "temperatureC");
    const windSpeedMps = weatherMeasuredMetric(metrics, "windSpeedMps");
    const windGustMps = weatherMeasuredMetric(metrics, "windGustMps");
    const windDirectionDeg = weatherMeasuredMetric(metrics, "windDirectionDeg");
    const precipitation10mMm = weatherMeasuredMetric(metrics, "precipitation10mMm", "precipitationMm");
    const humidityPercent = weatherMeasuredMetric(metrics, "relativeHumidityPercent", "humidityPercent");
    const pressureHpa = weatherMeasuredMetric(metrics, "pressureHpa", "pressureHpaSeaLevel");
    const cards = [
      temperatureC !== undefined ? <DataMetric key="temperature" label="Teplota" value={formatOptionalNumber(temperatureC, " °C")} tone={weatherTemperatureTone(temperatureC)} /> : null,
      windSpeedMps !== undefined || windGustMps !== undefined || windDirectionDeg !== undefined
        ? <DataMetric key="wind" label="Vítr" value={formatMeasuredWeatherWind(windDirectionDeg, windSpeedMps, windGustMps)} tone={weatherMeasuredWindTone(windSpeedMps, windGustMps)} />
        : null,
      precipitation10mMm !== undefined ? <DataMetric key="precipitation" label="Srážky 10 min" value={formatPrecipitationAmount(precipitation10mMm)} tone={weatherMeasuredPrecipitationTone(precipitation10mMm)} /> : null,
      humidityPercent !== undefined ? <DataMetric key="humidity" label="Vlhkost" value={`${Math.round(humidityPercent)} %`} tone={humidityPercent >= 95 ? "warn" : "neutral"} /> : null,
      pressureHpa !== undefined ? <DataMetric key="pressure" label="Tlak" value={`${Math.round(pressureHpa)} hPa`} tone="neutral" /> : null
    ].filter(Boolean);
    if (cards.length > 0) {
      return <div className="mobile-status-summary weather-context-summary">{cards}</div>;
    }
  }
  return (
    <div className="mobile-status-summary weather-context-summary">
      <DataMetric label="Hodnota" value={weatherFeatureValueLabel(feature, metrics) ?? "n/a"} tone={weatherFeatureTone(feature)} />
      <DataMetric label="Charakter" value={weatherFeatureConditionLabel(feature, metrics)} tone={weatherFeatureTone(feature)} />
      <DataMetric label="Podklad" value={weatherDataQualityLabel(stringProperty(feature.properties.dataQuality)) ?? "měření/model"} tone="neutral" />
      <DataMetric label="Zdroj" value={feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId)} tone="neutral" />
    </div>
  );
}

export function isWeatherForecastAreaFeature(feature: SituationFeature): boolean {
  const providerLayerId = stringProperty(feature.properties.providerLayerId);
  return feature.properties.layer === "weather_forecast_area"
    || feature.properties.layerId === "public.weather.forecast_area"
    || feature.properties.sourceId === "weather_forecast"
    || providerLayerId === "weather.forecast_area"
    || providerLayerId === "weather_forecast_area"
    || providerLayerId === "public.weather.forecast_area";
}

export function weatherForecastAreaTitle(feature: SituationFeature): string {
  const presentation = weatherForecastAreaPresentation(feature);
  return stringProperty(presentation.title)
    ?? stringProperty(presentation.mapLabel)
    ?? stringProperty(presentation.label)
    ?? feature.properties.areaName
    ?? feature.properties.label
    ?? feature.properties.headline
    ?? "Předpověď počasí";
}

export function weatherForecastAreaSubtitle(feature: SituationFeature): string {
  const presentation = weatherForecastAreaPresentation(feature);
  const providerProperties = weatherForecastAreaProviderProperties(feature);
  const forecast = isRecord(providerProperties.weatherForecast) ? providerProperties.weatherForecast : {};
  return [
    stringProperty(presentation.subtitle)
      ?? stringProperty(forecast.summary)
      ?? stringProperty(feature.properties.description)
      ?? "plošná předpověď",
    sourceDisplayName(feature.properties.sourceId)
  ].filter(Boolean).join(" · ");
}

export function WeatherForecastAreaSummary({ feature }: { feature: SituationFeature }) {
  const presentation = weatherForecastAreaPresentation(feature);
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const riskScore = numberProperty(metrics.riskScore) ?? numberProperty(presentation.riskScore);
  const riskLevel = stringProperty(presentation.riskLevel) ?? stringProperty(metrics.riskLevel) ?? stringProperty(feature.properties.severity);
  const badgeTone = stringProperty(presentation.badgeTone) ?? weatherForecastRiskTone(riskScore, riskLevel);
  return (
    <div className="mobile-status-summary weather-context-summary">
      <DataMetric
        label="Stav"
        value={stringProperty(presentation.badgeLabel) ?? weatherForecastRiskLabel(riskScore, riskLevel)}
        tone={weatherDisplayToneFromDisplay(badgeTone)}
      />
      <DataMetric
        label="Hodnota"
        value={stringProperty(presentation.primaryValue) ?? stringProperty(presentation.mapLabel) ?? "předpověď"}
        tone={weatherDisplayToneFromDisplay(badgeTone)}
      />
      <DataMetric
        label="Doplňkově"
        value={[stringProperty(presentation.secondaryValue), stringProperty(presentation.tertiaryValue)].filter(Boolean).join(" · ") || "n/a"}
        tone="neutral"
      />
      <DataMetric
        label="Riziko"
        value={formatWeatherForecastRiskValue(riskScore, riskLevel)}
        tone={weatherDisplayToneFromDisplay(badgeTone)}
      />
      <DataMetric
        label="Jistota"
        value={formatOptionalPercentFromWhole(numberProperty(presentation.confidencePercent), feature.properties.confidence)}
        tone="neutral"
      />
    </div>
  );
}

export function WeatherForecastAreaDetailPanel({
  apiBase,
  authToken,
  feature
}: {
  apiBase: string;
  authToken: string | undefined;
  feature: SituationFeature;
}) {
  const detailUrl = React.useMemo(() => weatherForecastAreaDetailUrl(feature), [feature]);
  const [detail, setDetail] = React.useState<WeatherForecastAreaDetailResponse | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadDetail = React.useCallback(async () => {
    if (!detailUrl) {
      return;
    }
    setLoading(true);
    setDetailError(null);
    try {
      setDetail(await fetchWeatherForecastAreaDetail(apiBase, authToken, detailUrl, {
        dailyDays: 5,
        forecastHours: 48,
        nowcastHours: 6
      }));
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? humanizeApiError(error.message) : "Detail plošné předpovědi se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, authToken, detailUrl]);

  React.useEffect(() => {
    if (!isWeatherForecastAreaFeature(feature) || !detailUrl) {
      setDetail(null);
      setDetailError(null);
      setLoading(false);
      return;
    }
    void loadDetail();
  }, [detailUrl, feature, loadDetail]);

  if (!isWeatherForecastAreaFeature(feature)) {
    return null;
  }
  if (!detailUrl) {
    return <div className="weather-station-detail-empty">Detail plošné předpovědi zatím není dostupný.</div>;
  }

  const currentDisplay = detail?.current?.display;
  const title = currentDisplay?.title ?? weatherForecastAreaTitle(feature);
  const subtitle = currentDisplay?.subtitle ?? weatherForecastAreaSubtitle(feature);

  return (
    <div className="weather-station-detail">
      <div className="weather-station-detail-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <button className="mini-button" disabled={loading} onClick={() => void loadDetail()} type="button">
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>
      {currentDisplay ? (
        <div className="mobile-status-summary weather-context-summary">
          <DataMetric label="Stav" value={currentDisplay.badgeLabel ?? "předpověď"} tone={weatherDisplayToneFromDisplay(currentDisplay.badgeTone)} />
          <DataMetric label="Hodnota" value={currentDisplay.primaryValue ?? "n/a"} tone={weatherDisplayToneFromDisplay(currentDisplay.badgeTone)} />
          <DataMetric label="Doplňkově" value={[currentDisplay.secondaryValue, currentDisplay.tertiaryValue].filter(Boolean).join(" · ") || "n/a"} tone="neutral" />
          <DataMetric label="Jistota" value={formatOptionalPercentFromWhole(currentDisplay.confidencePercent, currentDisplay.confidence)} tone="neutral" />
        </div>
      ) : null}
      {detailError ? <div className="weather-station-detail-error">{detailError}</div> : null}
      {loading && !detail ? <div className="weather-station-detail-empty">Načítám plošnou předpověď a meteogram...</div> : null}
      {detail ? (
        <>
          {formatWeatherForecastSummary(detail.summary) ? (
            <div className="weather-forecast-summary-text">{formatWeatherForecastSummary(detail.summary)}</div>
          ) : null}
          <div className="mobile-status-summary weather-context-summary">
            <DataMetric label="Nowcast" value={formatForecastPointCount(detail.nowcast)} tone="neutral" />
            <DataMetric label="Hodiny" value={formatForecastPointCount(detail.hourly)} tone="neutral" />
            <DataMetric label="Dny" value={formatForecastPointCount(detail.daily)} tone="neutral" />
            <DataMetric label="Vygenerováno" value={formatShortDateTime(detail.generatedAt)} tone="neutral" />
          </div>
          <WeatherStationCharts charts={detail.charts ?? []} emptyLabel="Meteogram zatím neobsahuje datové body." />
          <div className="weather-station-attribution">{formatWeatherStationAttribution(detail.attribution)}</div>
        </>
      ) : null}
    </div>
  );
}

export function WeatherStationDetailPanel({
  apiBase,
  authToken,
  feature
}: {
  apiBase: string;
  authToken: string | undefined;
  feature: SituationFeature;
}) {
  const detailUrl = React.useMemo(() => weatherStationDetailUrl(feature), [feature]);
  const [detail, setDetail] = React.useState<WeatherStationDetailResponse | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadDetail = React.useCallback(async () => {
    if (!detailUrl) {
      return;
    }
    setLoading(true);
    setDetailError(null);
    try {
      setDetail(await fetchWeatherStationDetail(apiBase, authToken, detailUrl, {
        forecastHours: 24,
        historyHours: 48
      }));
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? humanizeApiError(error.message) : "Detail meteorologické stanice se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, authToken, detailUrl]);

  React.useEffect(() => {
    if (!isMeasuredWeatherStationFeature(feature) || !detailUrl) {
      setDetail(null);
      setDetailError(null);
      setLoading(false);
      return;
    }
    void loadDetail();
  }, [detailUrl, feature, loadDetail]);

  if (!isMeasuredWeatherStationFeature(feature)) {
    return null;
  }
  if (!detailUrl) {
    return <div className="weather-station-detail-empty">Detail meteorologické stanice zatím není dostupný.</div>;
  }

  const currentDisplay = detail?.current?.display;
  const title = currentDisplay?.title ?? weatherFeatureHeadline(feature);
  const subtitle = currentDisplay?.subtitle ?? weatherFeatureSubtitle(feature);
  const charts = detail?.charts ?? [];

  return (
    <div className="weather-station-detail">
      <div className="weather-station-detail-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <button className="mini-button" disabled={loading} onClick={() => void loadDetail()} type="button">
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>
      {currentDisplay ? (
        <div className="mobile-status-summary weather-context-summary">
          <DataMetric label="Stav" value={currentDisplay.badgeLabel ?? "měření"} tone={weatherDisplayToneFromDisplay(currentDisplay.badgeTone)} />
          <DataMetric label="Hodnota" value={currentDisplay.primaryValue ?? "n/a"} tone={weatherDisplayToneFromDisplay(currentDisplay.badgeTone)} />
          <DataMetric label="Doplňkově" value={[currentDisplay.secondaryValue, currentDisplay.tertiaryValue].filter(Boolean).join(" · ") || "n/a"} tone="neutral" />
          <DataMetric label="Typ závěru" value={weatherConditionModeLabel(currentDisplay.conditionMode) ?? "měření"} tone="neutral" />
          <DataMetric label="Jistota" value={formatOptionalPercentFromWhole(currentDisplay.confidencePercent, currentDisplay.confidence)} tone="neutral" />
        </div>
      ) : null}
      {detailError ? <div className="weather-station-detail-error">{detailError}</div> : null}
      {loading && !detail ? <div className="weather-station-detail-empty">Načítám měření a grafy ČHMÚ...</div> : null}
      {detail ? (
        <>
          <WeatherStationCharts charts={charts} />
          <div className="weather-station-attribution">{formatWeatherStationAttribution(detail.attribution)}</div>
        </>
      ) : null}
    </div>
  );
}

function weatherForecastAreaProviderProperties(feature: SituationFeature): Record<string, unknown> {
  return isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
}

function weatherForecastAreaPresentation(feature: SituationFeature): Record<string, unknown> {
  const providerProperties = weatherForecastAreaProviderProperties(feature);
  return isRecord(providerProperties.presentation) ? providerProperties.presentation : {};
}

function weatherForecastAreaDisplay(feature: SituationFeature): Record<string, unknown> {
  const providerProperties = weatherForecastAreaProviderProperties(feature);
  return isRecord(providerProperties.display) ? providerProperties.display : {};
}

function weatherForecastAreaDetailUrl(feature: SituationFeature): string | undefined {
  const providerProperties = weatherForecastAreaProviderProperties(feature);
  const display = weatherForecastAreaDisplay(feature);
  const forecast = isRecord(providerProperties.weatherForecast) ? providerProperties.weatherForecast : {};
  return stringProperty(display.chartUrl)
    ?? stringProperty(display.detailUrl)
    ?? stringProperty(forecast.detailUrl)
    ?? stringProperty(providerProperties.detailUrl);
}

function weatherForecastRiskTone(riskScore: number | undefined, riskLevel: string | undefined): "critical" | "ok" | "warn" {
  const normalized = (riskLevel ?? "").toLowerCase();
  const score = riskScore ?? 0;
  if (score >= 0.75 || normalized.includes("critical") || normalized.includes("extreme") || normalized.includes("vysok")) {
    return "critical";
  }
  if (score >= 0.25 || normalized.includes("warning") || normalized.includes("advisory") || normalized.includes("moderate") || normalized.includes("riziko")) {
    return "warn";
  }
  return "ok";
}

function weatherForecastRiskLabel(riskScore: number | undefined, riskLevel: string | undefined): string {
  const tone = weatherForecastRiskTone(riskScore, riskLevel);
  if (tone === "critical") {
    return "vysoké riziko";
  }
  if (tone === "warn") {
    return "riziko";
  }
  return "předpověď";
}

function formatWeatherForecastRiskValue(riskScore: number | undefined, riskLevel: string | undefined): string {
  const level = riskLevel?.trim();
  const score = typeof riskScore === "number" && Number.isFinite(riskScore) ? `${Math.round(riskScore * 100)} %` : undefined;
  return [level, score].filter(Boolean).join(" · ") || "nízké";
}

function formatWeatherForecastSummary(summary: WeatherForecastAreaDetailResponse["summary"]): string | undefined {
  if (typeof summary === "string") {
    const trimmed = summary.trim();
    return trimmed || undefined;
  }
  if (!isRecord(summary)) {
    return undefined;
  }
  return stringProperty(summary.cs)
    ?? stringProperty(summary.text)
    ?? stringProperty(summary.summary)
    ?? stringProperty(summary.headline)
    ?? stringProperty(summary.label);
}

function formatForecastPointCount(section: WeatherForecastAreaDetailResponse["hourly"]): string {
  if (!section) {
    return "n/a";
  }
  const count = typeof section.pointCount === "number" ? section.pointCount : section.points?.length;
  const interval = [formatShortDateTime(section.from), formatShortDateTime(section.to)]
    .filter((value) => value !== "n/a")
    .join(" - ");
  return [typeof count === "number" ? `${count} bodů` : undefined, interval].filter(Boolean).join(" · ") || "n/a";
}

function weatherDisplayToneFromDisplay(value: string | undefined): "critical" | "neutral" | "ok" | "warn" {
  switch (value?.toLowerCase()) {
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
    default:
      return "neutral";
  }
}

function WeatherStationCharts({ charts, emptyLabel = "Grafy zatím nejsou v detailu stanice dostupné." }: { charts: WeatherStationChart[]; emptyLabel?: string }) {
  const visibleCharts = charts.filter((chart) => (chart.series ?? []).some((series) => weatherChartSeriesPoints(series).length > 0));
  if (visibleCharts.length === 0) {
    return <div className="weather-station-detail-empty">{emptyLabel}</div>;
  }
  return (
    <div className="weather-station-chart-grid">
      {visibleCharts.map((chart, index) => (
        <WeatherStationChartPanel chart={chart} key={`${weatherStationChartId(chart) ?? chart.title ?? "chart"}-${index}`} />
      ))}
    </div>
  );
}

function WeatherStationChartPanel({ chart }: { chart: WeatherStationChart }) {
  const series = (chart.series ?? [])
    .map((item, index) => ({ item, index, points: weatherChartSeriesPoints(item) }))
    .filter((entry) => entry.points.length > 0);
  const allPoints = series.flatMap((entry) => entry.points);
  const timeDomain = weatherChartTimeDomain(allPoints);
  const valueDomain = weatherChartValueDomain(allPoints.map((point) => point.value));
  const width = 640;
  const height = 175;
  const padding = { bottom: 24, left: 48, right: 14, top: 18 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (time: string) => padding.left + ((Date.parse(time) - timeDomain.min) / Math.max(1, timeDomain.max - timeDomain.min)) * chartWidth;
  const y = (value: number) => padding.top + chartHeight - ((value - valueDomain.min) / Math.max(1, valueDomain.max - valueDomain.min)) * chartHeight;
  const unit = weatherStationChartUnit(chart, series);

  return (
    <div className="weather-station-chart-panel">
      <div className="weather-station-chart-title">
        <strong>{weatherStationChartTitle(chart)}</strong>
        <span>{unit}</span>
      </div>
      <svg aria-label={chart.title ?? "Graf počasí"} className="weather-station-chart-svg" role="img" viewBox={`0 0 ${width} ${height}`}>
        <line className="weather-chart-axis" x1={padding.left} x2={padding.left + chartWidth} y1={padding.top + chartHeight} y2={padding.top + chartHeight} />
        <line className="weather-chart-axis" x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + chartHeight} />
        <text className="weather-chart-axis-label" x={padding.left} y={height - 6}>{formatShortTime(timeDomain.min)}</text>
        <text className="weather-chart-axis-label end" x={padding.left + chartWidth} y={height - 6}>{formatShortTime(timeDomain.max)}</text>
        <text className="weather-chart-axis-label" x={4} y={padding.top + 6}>{formatWeatherChartAxisValue(valueDomain.max, unit)}</text>
        <text className="weather-chart-axis-label" x={4} y={padding.top + chartHeight}>{formatWeatherChartAxisValue(valueDomain.min, unit)}</text>
        {series.map((entry) => (
          <polyline
            className={`weather-chart-series ${weatherStationChartSeriesRole(entry.item)}`}
            fill="none"
            key={`${weatherStationChartSeriesId(entry.item) ?? weatherStationChartSeriesLabel(entry.item) ?? "series"}-${entry.index}`}
            points={entry.points.map((point) => `${x(point.time)},${y(point.value)}`).join(" ")}
            stroke={entry.item.color ?? weatherChartPalette(entry.index)}
          />
        ))}
      </svg>
      <div className="weather-station-chart-legend">
        {series.map((entry) => (
          <span key={`${weatherStationChartSeriesId(entry.item) ?? weatherStationChartSeriesLabel(entry.item) ?? "series"}-legend-${entry.index}`}>
            <i style={{ borderColor: entry.item.color ?? weatherChartPalette(entry.index) }} />
            {weatherStationChartSeriesLabel(entry.item) ?? weatherStationChartSeriesId(entry.item) ?? `řada ${entry.index + 1}`}
          </span>
        ))}
      </div>
    </div>
  );
}

export function formatWeatherStationAttribution(attribution: WeatherStationDetailResponse["attribution"]): string {
  if (typeof attribution === "string") {
    const trimmed = attribution.trim();
    return trimmed || "Zdroj: Český hydrometeorologický ústav";
  }
  if (Array.isArray(attribution)) {
    const labels = attribution
      .map(formatWeatherStationAttributionItem)
      .filter((label) => label.length > 0);
    return labels.length > 0 ? `Zdroj: ${Array.from(new Set(labels)).join(" · ")}` : "Zdroj: Český hydrometeorologický ústav";
  }
  return "Zdroj: Český hydrometeorologický ústav";
}

function formatWeatherStationAttributionItem(item: WeatherStationAttribution): string {
  const label = stringProperty(item.label) ?? sourceDisplayName(stringProperty(item.sourceId));
  const role = weatherStationAttributionRoleLabel(stringProperty(item.role));
  return [label, role].filter(Boolean).join(" / ");
}

function weatherStationAttributionRoleLabel(role: string | undefined): string | undefined {
  switch (role) {
    case "observation":
      return "měření";
    case "forecast":
      return "předpověď";
    default:
      return role;
  }
}

function weatherStationChartId(chart: WeatherStationChart): string | undefined {
  return chart.id ?? chart.chartId;
}

function weatherStationChartTitle(chart: WeatherStationChart): string {
  const explicitTitle = chart.title ?? chart.titleCs ?? chart.labelCs;
  if (explicitTitle) {
    return explicitTitle;
  }
  switch (weatherStationChartId(chart)) {
    case "temperature":
      return "Teplota";
    case "precipitation":
      return "Srážky";
    case "wind":
      return "Vítr";
    case "humidity_cloud":
      return "Vlhkost a oblačnost";
    case "risk":
      return "Riziko";
    default:
      return weatherStationChartId(chart) ?? "Graf";
  }
}

function weatherStationChartSeriesId(series: NonNullable<WeatherStationChart["series"]>[number]): string | undefined {
  const record = isRecord(series) ? series : {};
  return series.id ?? series.seriesId ?? stringProperty(record.key);
}

function weatherStationChartSeriesLabel(series: NonNullable<WeatherStationChart["series"]>[number]): string | undefined {
  const record = isRecord(series) ? series : {};
  return stringProperty(record.labelCs)
    ?? series.label
    ?? stringProperty(record.labelEn)
    ?? weatherStationChartSeriesId(series);
}

function weatherStationChartSeriesRole(series: NonNullable<WeatherStationChart["series"]>[number]): "forecast" | "measured" {
  const role = series.role ?? series.style ?? series.source;
  if (role === "forecast" || role === "dashed" || role === "open_meteo" || /předpověď/i.test(weatherStationChartSeriesLabel(series) ?? "")) {
    return "forecast";
  }
  return "measured";
}

function weatherStationChartUnit(
  chart: WeatherStationChart,
  series: Array<{ item: NonNullable<WeatherStationChart["series"]>[number] }>
): string {
  return chart.unit
    ?? chart.yUnit
    ?? chart.yAxis?.unit
    ?? series.find((entry) => entry.item.unit)?.item.unit
    ?? "";
}

function weatherChartSeriesPoints(series: NonNullable<WeatherStationChart["series"]>[number]): Array<{ time: string; value: number }> {
  return (series.points ?? []).flatMap((point) => {
    const record = isRecord(point) ? point : {};
    const time = stringProperty(point.time)
      ?? stringProperty(point.at)
      ?? stringProperty(record.t)
      ?? stringProperty(record.timestamp)
      ?? stringProperty(record.validAt)
      ?? stringProperty(record.datetime)
      ?? stringProperty(record.x);
    const value = numberProperty(point.value)
      ?? numberProperty(record.y)
      ?? numberProperty(record.v)
      ?? numberProperty(record.riskScore);
    return time && value !== undefined && Number.isFinite(Date.parse(time)) ? [{ time, value }] : [];
  });
}

function weatherChartTimeDomain(points: Array<{ time: string }>): { max: number; min: number } {
  const values = points.map((point) => Date.parse(point.time)).filter(Number.isFinite);
  if (values.length === 0) {
    const now = Date.now();
    return { max: now + 60 * 60 * 1000, min: now - 60 * 60 * 1000 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(30 * 60 * 1000, (max - min) * 0.04);
  return { max: max + padding, min: min - padding };
}

function weatherChartValueDomain(values: number[]): { max: number; min: number } {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return { max: 1, min: 0 };
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    const padding = Math.max(1, Math.abs(max) * 0.1);
    return { max: max + padding, min: min - padding };
  }
  const padding = (max - min) * 0.12;
  return { max: max + padding, min: min - padding };
}

function weatherChartPalette(index: number): string {
  return ["#38bdf8", "#a7f3d0", "#fbbf24", "#c084fc", "#fb7185"][index % 5] ?? "#38bdf8";
}

function formatWeatherChartAxisValue(value: number, unit: string | undefined): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(Math.abs(value) < 10 ? 1 : 0);
  return unit ? `${rounded} ${unit}` : rounded;
}
