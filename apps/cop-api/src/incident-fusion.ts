import { createHash } from "node:crypto";

import type { CommunityReportCategory, CommunityReportRecord } from "./community-report-store.js";
import type { IncidentCategory, IncidentLocation, IncidentSeverity, IncidentSourceRef } from "./incident-store.js";

export interface IncidentFusionSuggestion {
  category: IncidentCategory;
  confidence: number;
  description: string;
  explanation: string;
  location: IncidentLocation;
  metrics: {
    maxDistanceM: number;
    reportCount: number;
    timeSpanSeconds: number;
  };
  properties: Record<string, unknown>;
  reportIds: string[];
  severity: IncidentSeverity;
  sourceRefs: IncidentSourceRef[];
  suggestionId: string;
  title: string;
}

export interface IncidentFusionOptions {
  includeSingletons?: boolean;
  limit?: number;
  radiusM?: number;
  timeWindowSeconds?: number;
}

interface ReportCluster {
  reports: CommunityReportRecord[];
}

export function buildIncidentFusionSuggestions(
  reports: CommunityReportRecord[],
  requestNow: Date,
  options: IncidentFusionOptions = {}
): IncidentFusionSuggestion[] {
  const radiusM = clampNumber(options.radiusM, 250, 20_000, 1_500);
  const timeWindowSeconds = clampNumber(options.timeWindowSeconds, 900, 86_400, 21_600);
  const limit = clampNumber(options.limit, 1, 100, 25);
  const usableReports = reports
    .filter((report) => report.status === "submitted" || report.status === "published")
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  const clusters = clusterReports(usableReports, radiusM, timeWindowSeconds);
  return clusters
    .filter((cluster) => options.includeSingletons || cluster.reports.length > 1)
    .map((cluster) => buildSuggestion(cluster, requestNow, radiusM, timeWindowSeconds))
    .sort((left, right) => right.confidence - left.confidence || right.metrics.reportCount - left.metrics.reportCount)
    .slice(0, limit);
}

function clusterReports(reports: CommunityReportRecord[], radiusM: number, timeWindowSeconds: number): ReportCluster[] {
  const clusters: ReportCluster[] = [];
  for (const report of reports) {
    const category = mapReportCategory(report.category);
    const candidate = clusters.find((cluster) => {
      const clusterCategory = mapReportCategory(cluster.reports[0]?.category ?? "other");
      if (clusterCategory !== category) {
        return false;
      }
      const centroid = centroidLocation(cluster.reports);
      const distanceM = haversineMeters(report.location.lat, report.location.lon, centroid.lat, centroid.lon);
      const spanSeconds = clusterTimeSpanSeconds([...cluster.reports, report]);
      return distanceM <= radiusM && spanSeconds <= timeWindowSeconds;
    });
    if (candidate) {
      candidate.reports.push(report);
    } else {
      clusters.push({ reports: [report] });
    }
  }
  return clusters;
}

function buildSuggestion(cluster: ReportCluster, requestNow: Date, radiusM: number, timeWindowSeconds: number): IncidentFusionSuggestion {
  const reports = cluster.reports;
  const category = mapReportCategory(reports[0]?.category ?? "other");
  const severity = resolveSeverity(reports);
  const centroid = centroidLocation(reports);
  const maxDistanceM = maxDistanceFromCentroid(reports, centroid);
  const timeSpanSeconds = clusterTimeSpanSeconds(reports);
  const confidence = resolveConfidence(reports, requestNow, maxDistanceM, radiusM, timeSpanSeconds, timeWindowSeconds);
  const reportIds = reports.map((report) => report.reportId).sort();
  const sourceRefs = reports.map((report) => ({
    id: report.reportId,
    kind: "community_report" as const,
    observedAt: report.observedAt,
    sourceId: "cop.community-report-store",
    title: report.title
  }));
  const title = buildTitle(category, reports);
  return {
    category,
    confidence,
    description: `Návrh vznikl sloučením ${reports.length} blízkých hlášení v okruhu přibližně ${Math.round(maxDistanceM)} m.`,
    explanation: `Deterministická fúze: stejný typ události, vzdálenost do ${Math.round(radiusM)} m a časové okno do ${Math.round(timeWindowSeconds / 3600)} h. Operátor musí návrh potvrdit nebo upravit.`,
    location: {
      lat: centroid.lat,
      lon: centroid.lon,
      source: "fusion"
    },
    metrics: {
      maxDistanceM: Math.round(maxDistanceM),
      reportCount: reports.length,
      timeSpanSeconds
    },
    properties: {
      fusedAt: requestNow.toISOString(),
      fusionMode: "community-report-radius-time-v1",
      radiusM,
      timeWindowSeconds
    },
    reportIds,
    severity,
    sourceRefs,
    suggestionId: stableSuggestionId(category, centroid, reportIds),
    title
  };
}

function buildTitle(category: IncidentCategory, reports: CommunityReportRecord[]): string {
  const firstTitle = reports[0]?.title.trim();
  if (reports.length === 1 && firstTitle) {
    return firstTitle;
  }
  const categoryLabel: Record<IncidentCategory, string> = {
    community: "Komunitní událost",
    fire: "Požár",
    flood: "Povodeň",
    infrastructure: "Poškození infrastruktury",
    medical: "Zdravotní událost",
    other: "Událost",
    security: "Bezpečnostní událost",
    traffic: "Dopravní omezení",
    weather: "Meteorologická událost"
  };
  return `${categoryLabel[category]} z ${reports.length} hlášení`;
}

function mapReportCategory(category: CommunityReportCategory): IncidentCategory {
  const map: Record<CommunityReportCategory, IncidentCategory> = {
    bridge_damage: "infrastructure",
    fire: "fire",
    flood: "flood",
    hazard: "community",
    infrastructure_damage: "infrastructure",
    medical: "medical",
    other: "community",
    road_blockage: "traffic",
    utility_outage: "infrastructure"
  };
  return map[category] ?? "community";
}

function resolveSeverity(reports: CommunityReportRecord[]): IncidentSeverity {
  const order: Record<IncidentSeverity, number> = { critical: 4, warning: 3, advisory: 2, info: 1 };
  return reports.reduce<IncidentSeverity>((highest, report) => {
    const value = readReportSeverity(report);
    return order[value] > order[highest] ? value : highest;
  }, "advisory");
}

function readReportSeverity(report: CommunityReportRecord): IncidentSeverity {
  const value = report.properties.hazardSeverity ?? report.properties.severity ?? report.properties.riskLevel;
  if (value === "critical" || value === "warning" || value === "advisory" || value === "info") {
    return value;
  }
  if (report.category === "fire" || report.category === "flood" || report.category === "bridge_damage") {
    return "warning";
  }
  return "advisory";
}

function resolveConfidence(
  reports: CommunityReportRecord[],
  requestNow: Date,
  maxDistanceM: number,
  radiusM: number,
  timeSpanSeconds: number,
  timeWindowSeconds: number
): number {
  const countScore = Math.min(0.32, reports.length * 0.08);
  const distanceScore = Math.max(0, 0.18 * (1 - maxDistanceM / radiusM));
  const timeScore = Math.max(0, 0.18 * (1 - timeSpanSeconds / timeWindowSeconds));
  const freshnessScore = Math.max(0, 0.12 * (1 - newestAgeSeconds(reports, requestNow) / timeWindowSeconds));
  return roundConfidence(Math.min(0.95, 0.35 + countScore + distanceScore + timeScore + freshnessScore));
}

function centroidLocation(reports: CommunityReportRecord[]): { lat: number; lon: number } {
  const sum = reports.reduce(
    (accumulator, report) => ({
      lat: accumulator.lat + report.location.lat,
      lon: accumulator.lon + report.location.lon
    }),
    { lat: 0, lon: 0 }
  );
  return {
    lat: roundCoordinate(sum.lat / Math.max(1, reports.length)),
    lon: roundCoordinate(sum.lon / Math.max(1, reports.length))
  };
}

function maxDistanceFromCentroid(reports: CommunityReportRecord[], centroid: { lat: number; lon: number }): number {
  return reports.reduce((max, report) => Math.max(max, haversineMeters(report.location.lat, report.location.lon, centroid.lat, centroid.lon)), 0);
}

function clusterTimeSpanSeconds(reports: CommunityReportRecord[]): number {
  const timestamps = reports.map((report) => Date.parse(report.observedAt)).filter(Number.isFinite).sort((left, right) => left - right);
  if (timestamps.length < 2) {
    return 0;
  }
  const oldest = timestamps[0];
  const newest = timestamps.at(-1);
  if (oldest === undefined || newest === undefined) {
    return 0;
  }
  return Math.round((newest - oldest) / 1000);
}

function newestAgeSeconds(reports: CommunityReportRecord[], requestNow: Date): number {
  const newest = Math.max(...reports.map((report) => Date.parse(report.observedAt)).filter(Number.isFinite));
  if (!Number.isFinite(newest)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Math.round((requestNow.getTime() - newest) / 1000));
}

function stableSuggestionId(category: IncidentCategory, centroid: { lat: number; lon: number }, reportIds: string[]): string {
  const hash = createHash("sha256")
    .update(category)
    .update("|")
    .update(centroid.lat.toFixed(4))
    .update("|")
    .update(centroid.lon.toFixed(4))
    .update("|")
    .update(reportIds.join(","))
    .digest("hex")
    .slice(0, 24);
  return `fusion_${hash}`;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Number(value)));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}
