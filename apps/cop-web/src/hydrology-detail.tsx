import React from "react";
import {
  fetchSafetyHydroStationDetail,
  type HydroSeriesId,
  type HydroStationDetailResponse,
  type SituationFeature
} from "./cop-data";
import {
  booleanProperty,
  formatDurationSeconds,
  formatFloodThresholds,
  formatOptionalNumber,
  formatShortDateTime,
  formatShortTime,
  formatStringList,
  humanizeApiError,
  isRecord,
  numberProperty,
  recordNumber,
  recordString,
  stringProperty
} from "./detail-format";
import { DataMetric, DetailGrid, ObjectDetailSection, StatusBadge, type DetailTone } from "./detail-ui";

export function SafetyRiskSummary({
  apiBase,
  authToken,
  feature
}: {
  apiBase: string;
  authToken: string | undefined;
  feature: SituationFeature;
}) {
  const properties = feature.properties;
  const metrics = isRecord(properties.metrics) ? properties.metrics : {};
  const isFlood = properties.layer === "flood";
  const status = isFlood ? null : safetyFeatureStatusModel(feature);
  const hydroDetailUrl = React.useMemo(
    () => hydrologyDetailUrl(properties),
    [properties.detailUrl, properties.stationId, properties.tags, properties.timelineUrl]
  );
  const [hydroDetail, setHydroDetail] = React.useState<HydroStationDetailResponse | null>(null);
  const [hydroError, setHydroError] = React.useState<string | null>(null);
  const [hydroLoading, setHydroLoading] = React.useState(false);
  const loadHydroDetail = React.useCallback(async () => {
    if (!hydroDetailUrl) {
      return;
    }
    setHydroLoading(true);
    setHydroError(null);
    try {
      setHydroDetail(await fetchSafetyHydroStationDetail(apiBase, authToken, hydroDetailUrl));
    } catch (error) {
      setHydroDetail(null);
      setHydroError(
        error instanceof Error ? humanizeApiError(error.message) : "Detail hydrologické stanice se nepodařilo načíst."
      );
    } finally {
      setHydroLoading(false);
    }
  }, [apiBase, authToken, hydroDetailUrl]);

  React.useEffect(() => {
    if (properties.layer !== "flood" || !hydroDetailUrl) {
      setHydroDetail(null);
      setHydroError(null);
      setHydroLoading(false);
      return;
    }
    void loadHydroDetail();
  }, [hydroDetailUrl, loadHydroDetail, properties.layer]);

  const canonicalTypeCode = safetyCanonicalTypeCode(properties);
  const canonicalSourceCode = safetyCanonicalSourceCode(properties);
  const canonicalSourceSystem = safetyCanonicalSourceSystem(properties);
  const presentation = safetyProviderPresentation(properties);
  const detailText = safetyDetailText(properties);
  const rows: Array<[string, React.ReactNode]> = isFlood
    ? []
    : [
        ["Jev", safetyDisplayLabel(properties)],
        ["Typ jevu", canonicalTypeCode ? humanizeSafetyTypeCode(canonicalTypeCode) : "n/a"],
        ["Strojový typ", canonicalTypeCode ?? "n/a"],
        ["Stav", status ? <StatusBadge key="status" label={status.label} tone={status.tone} /> : "n/a"],
        ["Oblast", properties.areaName ?? properties.affectedArea ?? formatStringList(properties.affectedAreas)],
        ["Geometrie", safetyGeometryModeLabel(properties.geometryMode, feature.geometry.type)],
        ["Platí od", formatShortDateTime(properties.validFrom ?? properties.effectiveAt)],
        ["Platí do", formatShortDateTime(properties.validUntil ?? properties.expiresAt)],
        ["Zdroj", properties.sourceName ?? properties.source ?? properties.sourceId],
        ["Podklady", safetyBasisLabel(properties.basis)],
        ["Push kandidát", safetyNotificationEligibleLabel(properties)]
      ];
  if (!isFlood && canonicalSourceCode) {
    rows.splice(3, 0, ["Zdrojový kód", canonicalSourceCode]);
  }
  if (!isFlood && canonicalSourceSystem) {
    rows.splice(canonicalSourceCode ? 4 : 3, 0, ["Zdrojový systém", canonicalSourceSystem]);
  }
  if (!isFlood && stringProperty(presentation.iconKey)) {
    rows.push(["Ikona", stringProperty(presentation.iconKey)]);
  }
  if (!isFlood && stringProperty(presentation.styleKey)) {
    rows.push(["Styl", stringProperty(presentation.styleKey)]);
  }
  if (!isFlood && detailText) {
    rows.push(["Detail", detailText]);
  }

  if (isFlood) {
    rows.push(
      ["Tok", properties.riverName ?? "n/a"],
      [
        "Stanice",
        properties.areaName
          ? [properties.areaName, properties.stationId].filter(Boolean).join(" · ")
          : (properties.stationId ?? "n/a")
      ],
      ["Předpověď", formatHydroForecast(properties, metrics)],
      ["Stáří měření", formatDurationSeconds(safetyMetricNumber(properties, metrics, "observationAgeSeconds"))],
      [
        "Povodí",
        properties.basin ??
          recordString(isRecord(properties.tags) ? properties.tags : undefined, "hydrologicalOrder") ??
          "n/a"
      ],
      ["Plocha povodí", formatOptionalNumber(safetyMetricNumber(properties, metrics, "catchmentAreaKm2"), " km2")],
      ["Prahy SPA", formatFloodThresholds(metrics)]
    );
  }

  if (properties.layer === "fire") {
    rows.push(
      ["Požární stav", fireStatusLabel(properties.fireStatus ?? properties.status)],
      ["Typ zdroje", fireSourceIncidentLabel(properties.sourceIncident)],
      ["Potvrzení", fireConfirmationLabel(canonicalTypeCode, properties.sourceIncident)],
      ["Poznámka", fireRiskNotice(properties)]
    );
  }

  return (
    <ObjectDetailSection title={isFlood ? "Hydrologie" : properties.layer === "fire" ? "Požární riziko" : "Výstraha"}>
      {isFlood ? <HydrologyStatusOverview feature={feature} metrics={metrics} /> : null}
      <DetailGrid rows={rows} />
      {isFlood ? (
        <HydroStationDetailCard
          detail={hydroDetail}
          detailUrl={hydroDetailUrl}
          error={hydroError}
          loading={hydroLoading}
          onRefresh={loadHydroDetail}
        />
      ) : null}
    </ObjectDetailSection>
  );
}

function HydrologyStatusOverview({
  feature,
  metrics
}: {
  feature: SituationFeature;
  metrics: Record<string, unknown>;
}) {
  const properties = feature.properties;
  const floodStage = safetyMetricNumber(properties, metrics, "floodStage", "floodActivityLevel") ?? 0;
  const stage = floodStageStatusModel(floodStage);
  const trend = floodTrendLabel(properties.trend);
  const trendTone = floodTrendTone(properties.trend);
  return (
    <div className="hydro-status-overview">
      <div className={`hydro-status-card ${stage.tone}`}>
        <span>Stupeň povodňové aktivity</span>
        <strong>{floodStageLabel(floodStage)}</strong>
      </div>
      <div className={`hydro-status-card ${trendTone}`}>
        <span>Trend</span>
        <strong>{trend}</strong>
      </div>
      <div className="hydro-status-card neutral">
        <span>Vodní stav</span>
        <strong>{formatOptionalNumber(safetyMetricNumber(properties, metrics, "waterLevelCm"), " cm")}</strong>
      </div>
      <div className="hydro-status-card neutral">
        <span>Průtok</span>
        <strong>
          {formatOptionalNumber(safetyMetricNumber(properties, metrics, "discharge", "flowM3s"), " m3/s")}
        </strong>
      </div>
      <div className="hydro-status-card neutral">
        <span>Teplota vody</span>
        <strong>{formatOptionalNumber(safetyMetricNumber(properties, metrics, "waterTemperatureC"), " °C")}</strong>
      </div>
    </div>
  );
}

function HydroStationDetailCard({
  detail,
  detailUrl,
  error,
  loading,
  onRefresh
}: {
  detail: HydroStationDetailResponse | null;
  detailUrl: string | undefined;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (!detailUrl) {
    return <div className="hydro-detail-empty">Detailní graf pro tento hlásný profil zatím není dostupný.</div>;
  }
  return (
    <div className="hydro-detail">
      <div className="hydro-detail-header">
        <div>
          <strong>{detail?.chart.title ?? "Detail hlásného profilu"}</strong>
          <span>
            {detail
              ? `${formatShortDateTime(detail.window.from)} - ${formatShortDateTime(detail.window.to)}`
              : "Časová řada ČHMÚ"}
          </span>
        </div>
        <button className="mini-button" disabled={loading} onClick={onRefresh} type="button">
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>
      {error ? <div className="hydro-detail-error">{error}</div> : null}
      {loading && !detail ? <div className="hydro-detail-empty">Načítám hydrologická měření...</div> : null}
      {detail ? <HydroStationChart detail={detail} /> : null}
      {detail?.warnings.length ? (
        <div className="hydro-detail-warning">{detail.warnings.slice(0, 2).join(" · ")}</div>
      ) : null}
    </div>
  );
}

function HydroStationChart({ detail }: { detail: HydroStationDetailResponse }) {
  const panels = detail.chart.panels.filter((panel) =>
    panel.seriesIds.some((seriesId) => hydroSeriesById(detail, seriesId)?.points.length)
  );
  if (panels.length === 0) {
    return <div className="hydro-detail-empty">Pro zvolené období zatím nejsou dostupné hodnoty grafu.</div>;
  }
  return (
    <div className="hydro-chart">
      {panels.map((panel) => (
        <HydroChartPanel detail={detail} key={panel.id} panel={panel} />
      ))}
      <div className="hydro-chart-legend">
        <span>
          <i className="legend-line measured" /> měření
        </span>
        <span>
          <i className="legend-line forecast" /> předpověď
        </span>
        <span>
          <i className="legend-line dry" /> sucho
        </span>
        <span>
          <i className="legend-line spa" /> SPA
        </span>
        <span>
          <i className="legend-line now" /> aktuální čas
        </span>
      </div>
    </div>
  );
}

function HydroChartPanel({
  detail,
  panel
}: {
  detail: HydroStationDetailResponse;
  panel: HydroStationDetailResponse["chart"]["panels"][number];
}) {
  const series = panel.seriesIds
    .map((seriesId) => hydroSeriesById(detail, seriesId))
    .filter((item): item is NonNullable<ReturnType<typeof hydroSeriesById>> => Boolean(item && item.points.length));
  const allPoints = series.flatMap((item) => item.points);
  const timeDomain = hydroTimeDomain(allPoints, detail.chart.currentTime);
  const thresholdValues = hydroThresholdLines(detail, panel.thresholdSet).map((line) => line.value);
  const valueDomain = hydroValueDomain([...allPoints.map((point) => point.value), ...thresholdValues]);
  const width = 640;
  const height = panel.id === "temperature" ? 150 : 190;
  const padding = { bottom: 26, left: 54, right: 16, top: 20 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (at: string) =>
    padding.left + ((Date.parse(at) - timeDomain.min) / Math.max(1, timeDomain.max - timeDomain.min)) * chartWidth;
  const y = (value: number) =>
    padding.top +
    chartHeight -
    ((value - valueDomain.min) / Math.max(1, valueDomain.max - valueDomain.min)) * chartHeight;
  const nowX = x(detail.chart.currentTime);
  const [focusTime, setFocusTime] = React.useState<number | null>(null);
  const updateFocusFromPointer = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      setFocusTime(hydroChartPointerTime(event, width, padding.left, chartWidth, timeDomain));
    },
    [chartWidth, timeDomain.max, timeDomain.min]
  );
  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      updateFocusFromPointer(event);
    },
    [updateFocusFromPointer]
  );
  const handlePointerLeave = React.useCallback(() => setFocusTime(null), []);
  const focusItems =
    focusTime === null
      ? []
      : series.flatMap((item) => {
          const point = nearestHydroChartPoint(item.points, focusTime);
          if (!point) {
            return [];
          }
          return [
            {
              colorClass: `${item.role === "forecast" ? "forecast" : "measured"} ${item.id}`,
              label: item.label,
              time: point.at,
              value: point.value,
              x: x(point.at),
              y: y(point.value),
              valueLabel: formatHydroAxisValue(point.value, panel.yAxis.unit)
            }
          ];
        });
  const focusX =
    focusTime === null
      ? null
      : padding.left + ((focusTime - timeDomain.min) / Math.max(1, timeDomain.max - timeDomain.min)) * chartWidth;
  const tooltipWidth = 190;
  const tooltipHeight = Math.max(42, 22 + focusItems.length * 15);
  const tooltipX =
    focusX !== null && focusX > padding.left + chartWidth - tooltipWidth - 10
      ? padding.left + 8
      : Math.min((focusX ?? padding.left) + 10, padding.left + chartWidth - tooltipWidth);
  const tooltipY = padding.top + 6;

  return (
    <div className="hydro-chart-panel">
      <div className="hydro-chart-panel-title">
        <strong>{panel.title}</strong>
        <span>{panel.yAxis.unit}</span>
      </div>
      <svg
        aria-label={panel.title}
        className="hydro-chart-svg"
        onPointerCancel={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onPointerMove={updateFocusFromPointer}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          className="hydro-axis"
          x1={padding.left}
          x2={padding.left + chartWidth}
          y1={padding.top + chartHeight}
          y2={padding.top + chartHeight}
        />
        <line
          className="hydro-axis"
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={padding.top + chartHeight}
        />
        <text className="hydro-axis-label" x={padding.left} y={height - 6}>
          {formatShortTime(timeDomain.min)}
        </text>
        <text className="hydro-axis-label end" x={padding.left + chartWidth} y={height - 6}>
          {formatShortTime(timeDomain.max)}
        </text>
        <text className="hydro-axis-label" x={4} y={padding.top + 6}>
          {formatHydroAxisValue(valueDomain.max, panel.yAxis.unit)}
        </text>
        <text className="hydro-axis-label" x={4} y={padding.top + chartHeight}>
          {formatHydroAxisValue(valueDomain.min, panel.yAxis.unit)}
        </text>
        {hydroThresholdLines(detail, panel.thresholdSet).map((line) => (
          <g key={line.key}>
            <line
              className={`hydro-threshold ${line.key}`}
              x1={padding.left}
              x2={padding.left + chartWidth}
              y1={y(line.value)}
              y2={y(line.value)}
            />
            <text className={`hydro-threshold-label ${line.key}`} x={padding.left + 4} y={y(line.value) - 4}>
              {line.label}
            </text>
          </g>
        ))}
        {Number.isFinite(nowX) ? (
          <line className="hydro-now-line" x1={nowX} x2={nowX} y1={padding.top} y2={padding.top + chartHeight} />
        ) : null}
        {series.map((item) => (
          <polyline
            className={`hydro-series ${item.role === "forecast" ? "forecast" : "measured"} ${item.id}`}
            fill="none"
            key={item.id}
            points={item.points.map((point) => `${x(point.at)},${y(point.value)}`).join(" ")}
          />
        ))}
        {focusX !== null && focusItems.length > 0 ? (
          <g className="hydro-chart-focus" pointerEvents="none">
            <line
              className="hydro-chart-crosshair"
              x1={focusX}
              x2={focusX}
              y1={padding.top}
              y2={padding.top + chartHeight}
            />
            {focusItems.map((item) => (
              <circle
                className={`hydro-chart-focus-dot ${item.colorClass}`}
                cx={item.x}
                cy={item.y}
                key={`${item.label}-${item.time}`}
                r={3.8}
              />
            ))}
            <rect
              className="hydro-chart-tooltip-bg"
              height={tooltipHeight}
              rx={6}
              width={tooltipWidth}
              x={tooltipX}
              y={tooltipY}
            />
            <text className="hydro-chart-tooltip-time" x={tooltipX + 10} y={tooltipY + 15}>
              {formatHydroChartFocusDateTime(focusTime ?? timeDomain.min)}
            </text>
            {focusItems.map((item, index) => (
              <g key={`${item.label}-${item.time}-label`}>
                <circle
                  className={`hydro-chart-tooltip-dot ${item.colorClass}`}
                  cx={tooltipX + 11}
                  cy={tooltipY + 30 + index * 15}
                  r={3}
                />
                <text className="hydro-chart-tooltip-text" x={tooltipX + 20} y={tooltipY + 33 + index * 15}>
                  {`${item.label}: ${item.valueLabel}`}
                </text>
              </g>
            ))}
          </g>
        ) : null}
        <rect className="hydro-chart-hitbox" height={chartHeight} width={chartWidth} x={padding.left} y={padding.top} />
      </svg>
    </div>
  );
}

function hydrologyDetailUrl(properties: SituationFeature["properties"]): string | undefined {
  const directUrl = properties.detailUrl ?? properties.timelineUrl;
  if (directUrl) {
    return directUrl;
  }
  const tags = isRecord(properties.tags) ? properties.tags : {};
  const stationId = properties.stationId ?? recordString(tags, "stationId");
  if (stationId) {
    return `/safety-data/api/v1/hydro/stations/${encodeURIComponent(stationId)}/observations`;
  }
  return undefined;
}

function hydroSeriesById(
  detail: HydroStationDetailResponse,
  seriesId: HydroSeriesId
): HydroStationDetailResponse["series"][number] | undefined {
  return detail.series.find((series) => series.id === seriesId);
}

function hydroTimeDomain(points: Array<{ at: string }>, currentTime: string): { max: number; min: number } {
  const values = [...points.map((point) => Date.parse(point.at)), Date.parse(currentTime)].filter(Number.isFinite);
  if (values.length === 0) {
    const now = Date.now();
    return { max: now + 60 * 60 * 1000, min: now - 60 * 60 * 1000 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(30 * 60 * 1000, (max - min) * 0.04);
  return { max: max + padding, min: min - padding };
}

function hydroValueDomain(values: number[]): { max: number; min: number } {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return { max: 1, min: 0 };
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    return { max: max + Math.max(1, Math.abs(max) * 0.1), min: min - Math.max(1, Math.abs(min) * 0.1) };
  }
  const padding = (max - min) * 0.12;
  return { max: max + padding, min: Math.max(0, min - padding) };
}

function hydroThresholdLines(
  detail: HydroStationDetailResponse,
  thresholdSet: "discharge" | "waterLevel" | undefined
): Array<{ key: string; label: string; value: number }> {
  if (!thresholdSet) {
    return [];
  }
  const thresholds = detail.thresholds[thresholdSet];
  return [
    { key: "dry", label: "sucho", value: thresholds.dry },
    { key: "spa1", label: "SPA 1", value: thresholds.spa1 },
    { key: "spa2", label: "SPA 2", value: thresholds.spa2 },
    { key: "spa3", label: "SPA 3", value: thresholds.spa3 },
    { key: "spa4", label: "SPA 4", value: thresholds.spa4 }
  ].flatMap((item) =>
    typeof item.value === "number" && Number.isFinite(item.value) ? [{ ...item, value: item.value }] : []
  );
}

function formatHydroAxisValue(value: number, unit: string): string {
  return `${Math.round(value * 10) / 10} ${normalizeHydroUnit(unit)}`;
}

function hydroChartPointerTime(
  event: React.PointerEvent<SVGSVGElement>,
  svgWidth: number,
  paddingLeft: number,
  chartWidth: number,
  timeDomain: { max: number; min: number }
): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const renderedWidth = rect.width || svgWidth;
  const svgX = ((event.clientX - rect.left) / Math.max(1, renderedWidth)) * svgWidth;
  const clampedX = Math.min(paddingLeft + chartWidth, Math.max(paddingLeft, svgX));
  const ratio = (clampedX - paddingLeft) / Math.max(1, chartWidth);
  return timeDomain.min + ratio * (timeDomain.max - timeDomain.min);
}

function nearestHydroChartPoint(
  points: Array<{ at: string; value: number }>,
  timeMs: number
): { at: string; value: number } | undefined {
  return points.reduce<{ distance: number; point: { at: string; value: number } } | undefined>((nearest, point) => {
    const distance = Math.abs(Date.parse(point.at) - timeMs);
    return !nearest || distance < nearest.distance ? { distance, point } : nearest;
  }, undefined)?.point;
}

function formatHydroChartFocusDateTime(timeMs: number): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(timeMs));
}

function normalizeHydroUnit(unit: string): string {
  return unit === "0C" ? "°C" : unit;
}

function safetyFeatureStatusModel(feature: SituationFeature): { label: string; tone: DetailTone } {
  if (feature.properties.stale) {
    return { label: "starší data", tone: "warn" };
  }
  if (feature.properties.layer === "flood") {
    const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
    const floodStage = safetyMetricNumber(feature.properties, metrics, "floodStage", "floodActivityLevel");
    if (floodStage !== undefined) {
      return floodStageStatusModel(floodStage);
    }
  }
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const raw =
    stringProperty(tags.status) ??
    stringProperty(tags.networkStatus) ??
    stringProperty(metrics.status) ??
    stringProperty(metrics.networkStatus) ??
    feature.properties.severity ??
    "info";
  const normalized = raw.toLowerCase();
  if (["critical", "down", "offline", "outage", "failed", "error"].includes(normalized)) {
    return { label: "KRITICKÝ", tone: "critical" };
  }
  if (["warning", "degraded", "poor", "weak"].includes(normalized)) {
    return { label: "ZHORŠENÝ", tone: "warn" };
  }
  if (["advisory", "limited", "fair"].includes(normalized)) {
    return { label: "OMEZENÝ", tone: "warn" };
  }
  if (["ok", "online", "good", "fresh", "info"].includes(normalized)) {
    return { label: "OK", tone: "ok" };
  }
  return { label: raw.toUpperCase(), tone: "neutral" };
}

function safetyMetricNumber(
  properties: SituationFeature["properties"],
  metrics: Record<string, unknown>,
  propertyKey: string,
  metricKey: string = String(propertyKey)
): number | undefined {
  const propertyValue = numberProperty((properties as unknown as Record<string, unknown>)[propertyKey]);
  return propertyValue ?? recordNumber(metrics, metricKey);
}

function safetyGeometryModeLabel(mode: string | undefined, geometryType: string): string {
  switch (mode) {
    case "admin_boundary":
      return "územní polygon";
    case "representative_point":
      return "náhradní bod";
    case undefined:
      return geometryType;
    default:
      return mode.replace(/_/g, " ");
  }
}

function safetyCanonicalTypeCode(properties: SituationFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyProviderTaxonomy(properties);
  return properties.typeCode ?? stringProperty(providerProperties.typeCode) ?? stringProperty(taxonomy.typeCode);
}

function safetyCanonicalSourceCode(properties: SituationFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyProviderTaxonomy(properties);
  const sourceCode =
    properties.sourceCode ?? stringProperty(providerProperties.sourceCode) ?? stringProperty(taxonomy.sourceCode);
  if (!sourceCode) {
    return undefined;
  }
  const sourceSystem =
    properties.sourceSystem ??
    stringProperty(providerProperties.sourceSystem) ??
    stringProperty(taxonomy.codeSystem) ??
    stringProperty(taxonomy.sourceSystem);
  return sourceSystem ? `${sourceSystem} ${sourceCode}` : sourceCode;
}

function safetyCanonicalSourceSystem(properties: SituationFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyProviderTaxonomy(properties);
  return (
    properties.sourceSystem ??
    stringProperty(providerProperties.sourceSystem) ??
    stringProperty(taxonomy.codeSystem) ??
    stringProperty(taxonomy.sourceSystem)
  );
}

function safetyProviderProperties(properties: SituationFeature["properties"]): Record<string, unknown> {
  return isRecord(properties.providerProperties) ? properties.providerProperties : {};
}

function safetyProviderTaxonomy(properties: SituationFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.taxonomy) ? providerProperties.taxonomy : {};
}

function safetyProviderPresentation(properties: SituationFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.presentation) ? providerProperties.presentation : {};
}

function safetyProviderNotification(properties: SituationFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.notification) ? providerProperties.notification : {};
}

function localizedSafetyRecord(properties: SituationFeature["properties"], locale = "cs"): Record<string, unknown> {
  const localized = isRecord(properties.localized) ? properties.localized : {};
  const entry = localized[locale];
  return isRecord(entry) ? entry : localized;
}

function localizedSafetyString(
  properties: SituationFeature["properties"],
  locale: "cs" | "en",
  ...keys: string[]
): string | undefined {
  const record = localizedSafetyRecord(properties, locale);
  for (const key of keys) {
    const value = stringProperty(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function safetyPresentationString(properties: SituationFeature["properties"], ...keys: string[]): string | undefined {
  const presentation = safetyProviderPresentation(properties);
  for (const key of keys) {
    const value = stringProperty(presentation[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function safetyDisplayLabel(properties: SituationFeature["properties"]): string {
  return (
    localizedSafetyString(properties, "cs", "headline", "title", "label", "name") ??
    safetyPresentationString(properties, "label", "title") ??
    properties.headline ??
    properties.areaName ??
    properties.label ??
    humanizeSafetyTypeCode(safetyCanonicalTypeCode(properties)) ??
    safetyCanonicalSourceCode(properties) ??
    "Výstraha"
  );
}

function safetyDetailText(properties: SituationFeature["properties"]): string | undefined {
  return (
    localizedSafetyString(properties, "cs", "detail", "description", "summary") ??
    renderSafetyDetailTemplate(properties) ??
    properties.description ??
    properties.summary
  );
}

function renderSafetyDetailTemplate(properties: SituationFeature["properties"]): string | undefined {
  const template = safetyPresentationString(properties, "detailTemplate");
  if (!template) {
    return undefined;
  }
  const values: Record<string, string> = {
    areaName: properties.areaName ?? properties.affectedArea ?? "",
    headline: properties.headline ?? properties.label ?? "",
    label: safetyDisplayLabel(properties),
    severity: properties.severity ?? properties.status ?? "",
    sourceCode: safetyCanonicalSourceCode(properties) ?? "",
    sourceSystem: safetyCanonicalSourceSystem(properties) ?? "",
    typeCode: safetyCanonicalTypeCode(properties) ?? ""
  };
  return (
    template
      .replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => values[key] ?? "")
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

function safetyNotificationEligibleLabel(properties: SituationFeature["properties"]): string {
  const notification = safetyProviderNotification(properties);
  const value = notification.eligible;
  if (value === false) {
    return "ne";
  }
  if (value === true) {
    return "ano";
  }
  return "neuvedeno";
}

function humanizeSafetyTypeCode(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const known: Record<string, string> = {
    "air_quality.pm10.smog": "Smogová situace PM10",
    "hydro.flood.warning": "Hydrologická výstraha",
    "weather.fire_danger": "Nebezpečí požáru",
    "weather.temperature.high": "Vysoké teploty"
  };
  return (
    known[value] ??
    value
      .split(/[._-]+/u)
      .filter(Boolean)
      .join(" ")
  );
}

function safetyBasisLabel(value: string[] | undefined): string {
  if (!value || value.length === 0) {
    return "n/a";
  }
  const labels = value
    .filter((item) => !item.startsWith("http://") && !item.startsWith("https://"))
    .map((item) => {
      switch (item) {
        case "chmi_cap":
          return "ČHMÚ CAP";
        case "chmi_cap_cisorp":
          return "ČSÚ CISORP";
        case "osm_postgis_admin_boundary_match":
          return "PostGIS hranice ORP";
        case "chmi_hydro_now":
          return "ČHMÚ hydrologie";
        default:
          return item.replace(/_/g, " ");
      }
    });
  return labels.length > 0 ? Array.from(new Set(labels)).slice(0, 4).join(" · ") : "n/a";
}

function floodStageLabel(value: number | undefined): string {
  if (value === undefined || value <= 0) {
    return "bez SPA";
  }
  if (value === 1) {
    return "1. SPA bdělost";
  }
  if (value === 2) {
    return "2. SPA pohotovost";
  }
  if (value === 3) {
    return "3. SPA ohrožení";
  }
  return `${Math.round(value)}. SPA`;
}

function floodStageStatusModel(value: number): { label: string; tone: DetailTone } {
  if (value <= 0) {
    return { label: "bez SPA", tone: "ok" };
  }
  if (value === 1) {
    return { label: "1. SPA", tone: "warn" };
  }
  if (value === 2) {
    return { label: "2. SPA", tone: "warn" };
  }
  return { label: value >= 4 ? "extrémní SPA" : "3. SPA", tone: "critical" };
}

function formatHydroForecast(properties: SituationFeature["properties"], metrics: Record<string, unknown>): string {
  const available = booleanProperty(properties.forecastAvailable) ?? booleanProperty(metrics.forecastAvailable);
  const until = properties.forecastUntil ?? stringProperty(metrics.forecastUntil);
  if (available === false) {
    return "není dostupná";
  }
  if (available === true) {
    return until ? `dostupná do ${formatShortDateTime(until)}` : "dostupná";
  }
  return until ? `do ${formatShortDateTime(until)}` : "n/a";
}

function floodTrendLabel(value: string | undefined): string {
  switch (value) {
    case "rising":
      return "stoupá";
    case "falling":
      return "klesá";
    case "stable":
      return "stabilní";
    case "unknown":
    case undefined:
      return "neznámý";
    default:
      return value;
  }
}

function floodTrendTone(value: string | undefined): DetailTone {
  switch (value) {
    case "rising":
      return "warn";
    case "falling":
      return "ok";
    default:
      return "neutral";
  }
}

function fireStatusLabel(value: string | undefined): string {
  switch (value) {
    case "active":
      return "aktivní požár";
    case "confirmed":
      return "potvrzeno";
    case "contained":
      return "pod kontrolou";
    case "risk":
      return "požární nebezpečí";
    case "thermal_anomaly":
      return "tepelná anomálie";
    case "unknown":
    case undefined:
      return "neznámý";
    default:
      return value.replace(/_/g, " ");
  }
}

function fireSourceIncidentLabel(value: string | undefined): string {
  switch (value) {
    case "CHMI_CAP_FIRE_DANGER":
      return "ČHMÚ požární nebezpečí";
    case "NASA_FIRMS_HOTSPOT":
      return "NASA FIRMS hotspot";
    default:
      return value ? value.replace(/_/g, " ") : "n/a";
  }
}

function fireConfirmationLabel(typeCode: string | undefined, sourceIncident: string | undefined): string {
  if (typeCode === "weather.fire_danger" || sourceIncident === "CHMI_CAP_FIRE_DANGER") {
    return "nejde o potvrzený požár";
  }
  if (sourceIncident === "NASA_FIRMS_HOTSPOT") {
    return "satelitní detekce, vyžaduje ověření";
  }
  return "situační kontext";
}

function fireRiskNotice(properties: SituationFeature["properties"]): string {
  if (
    safetyCanonicalTypeCode(properties) === "weather.fire_danger" ||
    properties.sourceIncident === "CHMI_CAP_FIRE_DANGER"
  ) {
    return "Oficiální výstraha ČHMÚ pro podmínky vzniku a šíření požárů.";
  }
  if (properties.sourceIncident === "NASA_FIRMS_HOTSPOT") {
    return "Tepelná anomálie ze satelitu, nikoli potvrzený incident HZS.";
  }
  return properties.description ?? "n/a";
}
