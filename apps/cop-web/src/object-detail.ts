import type { CopObject, ObjectConflictEvidence, ObjectProvenance, SourceHealthItem } from "./cop-data";
import type { TrackHistoryPoint } from "./track-history";
import { getAffiliationPresentation, getNatoSidc, resolveCopObjectSymbol } from "./symbology";

export interface ConfidenceFactor {
  detail: string;
  label: string;
  tone: "ok" | "warn" | "neutral";
}

export interface LineageStep {
  detail: string;
  label: string;
  status: string;
}

export interface ObjectConflict {
  detail: string;
  severity: "warn" | "neutral";
  title: string;
}

export interface ObjectHistoryEntry {
  confidence?: number;
  eventId?: string;
  ingestTimestamp?: string;
  lat: number;
  lon: number;
  producerTimestamp?: string;
  sourceSystemId?: string;
  status?: string;
  timestamp: string;
}

export interface ObjectDetailModel {
  affiliation: ReturnType<typeof getAffiliationPresentation>;
  conflicts: ObjectConflict[];
  confidenceFactors: ConfidenceFactor[];
  history: ObjectHistoryEntry[];
  lineage: LineageStep[];
  provenance?: ObjectProvenance;
  sidc: string;
  sourceHealth?: SourceHealthItem;
  symbolCode: string;
}

const sourceDistanceConflictKm = 2;

export function buildObjectDetailModel({
  historyPoints,
  object,
  sourceHealth
}: {
  historyPoints: TrackHistoryPoint[];
  object: CopObject;
  sourceHealth: SourceHealthItem[];
}): ObjectDetailModel {
  const provenance = object.attributes?.provenance;
  const conflictEvidence = object.attributes?.conflictEvidence;
  const sourceHealthItem = provenance?.sourceSystemId
    ? sourceHealth.find((item) => item.sourceSystemId === provenance.sourceSystemId)
    : undefined;
  const symbol = resolveCopObjectSymbol(object);
  const sidc = getNatoSidc(object.objectType, object.affiliation);

  return {
    affiliation: getAffiliationPresentation(object.affiliation),
    conflicts: conflictsFromServerEvidence(conflictEvidence) ?? detectObjectConflicts(object, historyPoints, sourceHealthItem),
    confidenceFactors: buildConfidenceFactors(object, provenance, sourceHealthItem),
    history: historyPoints.slice(-6).reverse().map((point) => ({
      confidence: point.confidence,
      eventId: point.eventId,
      ingestTimestamp: point.ingestTimestamp,
      lat: point.lat,
      lon: point.lon,
      producerTimestamp: point.producerTimestamp,
      sourceSystemId: point.sourceSystemId,
      status: point.status,
      timestamp: point.timestamp
    })),
    lineage: buildLineage(object, provenance, sidc, symbol.symbolCode),
    provenance,
    sidc,
    sourceHealth: sourceHealthItem,
    symbolCode: symbol.symbolCode
  };
}

function conflictsFromServerEvidence(evidence: ObjectConflictEvidence | undefined): ObjectConflict[] | null {
  if (!evidence) {
    return null;
  }

  if (evidence.signals.length === 0) {
    return [
      {
        detail: `Server fusion evaluated this object at ${evidence.evaluatedAt}; no conflicting evidence is currently visible.`,
        severity: "neutral",
        title: "No conflict detected"
      }
    ];
  }

  return evidence.signals.map((signal) => ({
    detail: signal.sourceSystemIds.length > 0 ? `${signal.detail} Sources: ${signal.sourceSystemIds.join(", ")}.` : signal.detail,
    severity: signal.severity === "warning" ? "warn" : "neutral",
    title: signal.title
  }));
}

function buildConfidenceFactors(
  object: CopObject,
  provenance: ObjectProvenance | undefined,
  sourceHealth: SourceHealthItem | undefined
): ConfidenceFactor[] {
  const confidence = object.confidence ?? 0;
  const ageSeconds = object.lastUpdatedAt ? secondsSince(object.lastUpdatedAt) : undefined;
  return [
    {
      detail: `${Math.round(confidence * 100)} % current object confidence`,
      label: "Score",
      tone: confidence >= 0.75 ? "ok" : confidence >= 0.5 ? "neutral" : "warn"
    },
    {
      detail: reliabilityExplanation(provenance?.sourceReliability),
      label: "Source reliability",
      tone: provenance?.sourceReliability && !["E", "F", "UNKNOWN"].includes(provenance.sourceReliability) ? "ok" : "neutral"
    },
    {
      detail: credibilityExplanation(provenance?.informationCredibility),
      label: "Information credibility",
      tone: provenance?.informationCredibility && !["5", "6", "UNKNOWN"].includes(provenance.informationCredibility) ? "ok" : "neutral"
    },
    {
      detail: ageSeconds === undefined ? "No object timestamp available" : `${ageSeconds}s since last object update`,
      label: "Data age",
      tone: ageSeconds === undefined ? "neutral" : ageSeconds > 120 ? "warn" : "ok"
    },
    {
      detail: sourceHealth ? `${sourceHealth.health.toLowerCase()} source, ${sourceHealth.currentTracks} current tracks` : "No source health record linked",
      label: "Source health",
      tone: sourceHealth?.health === "ONLINE" ? "ok" : sourceHealth ? "warn" : "neutral"
    },
    {
      detail: object.synthetic || provenance?.synthetic ? "Synthetic/SIM origin is explicitly marked" : "No synthetic marker on this object",
      label: "Origin",
      tone: object.synthetic || provenance?.synthetic ? "neutral" : "ok"
    }
  ];
}

function buildLineage(
  object: CopObject,
  provenance: ObjectProvenance | undefined,
  sidc: string,
  symbolCode: string
): LineageStep[] {
  return [
    {
      detail: provenance?.eventId ?? "event id n/a",
      label: "Source event",
      status: provenance?.sourceSystemId ?? "source n/a"
    },
    {
      detail: provenance?.adapterVersion ? `${provenance.adapterId ?? "adapter"} ${provenance.adapterVersion}` : provenance?.adapterId ?? "adapter n/a",
      label: "Adapter transform",
      status: provenance?.producerTimestamp ?? "producer time n/a"
    },
    {
      detail: `${object.domain} / ${object.status} / confidence ${Math.round((object.confidence ?? 0) * 100)} %`,
      label: "Canonical COP object",
      status: object.objectId
    },
    {
      detail: `${sidc} -> ${symbolCode}`,
      label: "APP-6 rendering",
      status: `${object.objectType} / ${object.affiliation}`
    }
  ];
}

function detectObjectConflicts(
  object: CopObject,
  historyPoints: TrackHistoryPoint[],
  sourceHealth: SourceHealthItem | undefined
): ObjectConflict[] {
  const conflicts: ObjectConflict[] = [];
  if (object.status === "CONFLICTED") {
    conflicts.push({
      detail: "Object status is marked CONFLICTED in the COP state.",
      severity: "warn",
      title: "State conflict"
    });
  }

  const recentPoints = historyPoints.slice(-12);
  const affiliations = new Set(recentPoints.map((point) => point.affiliation).filter(Boolean));
  if (affiliations.size > 1) {
    conflicts.push({
      detail: `Recent history contains ${affiliations.size} affiliation values: ${Array.from(affiliations).join(", ")}.`,
      severity: "warn",
      title: "Affiliation variance"
    });
  }

  const statusValues = new Set(recentPoints.map((point) => point.status).filter(Boolean));
  if (statusValues.size > 2) {
    conflicts.push({
      detail: `Recent history contains changing lifecycle states: ${Array.from(statusValues).join(", ")}.`,
      severity: "warn",
      title: "Status variance"
    });
  }

  const sourcePositions = latestPositionBySource(recentPoints);
  const maxDistanceKm = maxSourceDistanceKm(sourcePositions);
  if (maxDistanceKm > sourceDistanceConflictKm) {
    conflicts.push({
      detail: `Latest positions from sources differ by up to ${maxDistanceKm.toFixed(1)} km.`,
      severity: "warn",
      title: "Position variance"
    });
  }

  if (sourceHealth && sourceHealth.health !== "ONLINE") {
    conflicts.push({
      detail: `Linked source health is ${sourceHealth.health.toLowerCase()}; last observation age may affect confidence.`,
      severity: "warn",
      title: "Source degraded"
    });
  }

  if (conflicts.length === 0) {
    conflicts.push({
      detail: "No source conflict is visible in the current object snapshot and recent history.",
      severity: "neutral",
      title: "No conflict detected"
    });
  }
  return conflicts;
}

function latestPositionBySource(points: TrackHistoryPoint[]): Array<{ lat: number; lon: number; sourceSystemId: string }> {
  const bySource = new Map<string, { lat: number; lon: number; sourceSystemId: string; timestampMs: number }>();
  points.forEach((point) => {
    if (!point.sourceSystemId) {
      return;
    }
    const timestampMs = new Date(point.timestamp).getTime();
    const current = bySource.get(point.sourceSystemId);
    if (!current || timestampMs > current.timestampMs) {
      bySource.set(point.sourceSystemId, {
        lat: point.lat,
        lon: point.lon,
        sourceSystemId: point.sourceSystemId,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0
      });
    }
  });
  return Array.from(bySource.values());
}

function maxSourceDistanceKm(points: Array<{ lat: number; lon: number }>): number {
  let maxDistance = 0;
  for (let index = 0; index < points.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < points.length; compareIndex += 1) {
      maxDistance = Math.max(maxDistance, distanceKm(points[index]!, points[compareIndex]!));
    }
  }
  return maxDistance;
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const deltaLat = (b.lat - a.lat) * toRad;
  const deltaLon = (b.lon - a.lon) * toRad;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function secondsSince(value: string): number | undefined {
  const timestampMs = new Date(value).getTime();
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }
  return Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
}

function reliabilityExplanation(value: string | undefined): string {
  const labels: Record<string, string> = {
    A: "A - completely reliable",
    B: "B - usually reliable",
    C: "C - fairly reliable",
    D: "D - not usually reliable",
    E: "E - unreliable",
    F: "F - reliability cannot be judged",
    UNKNOWN: "unknown reliability"
  };
  return value ? labels[value] ?? value : "not supplied";
}

function credibilityExplanation(value: string | undefined): string {
  const labels: Record<string, string> = {
    "1": "1 - confirmed by other sources",
    "2": "2 - probably true",
    "3": "3 - possibly true",
    "4": "4 - doubtful",
    "5": "5 - improbable",
    "6": "6 - cannot be judged",
    UNKNOWN: "unknown credibility"
  };
  return value ? labels[value] ?? value : "not supplied";
}
