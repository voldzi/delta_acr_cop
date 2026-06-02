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
        detail: "Aktuálně není zjištěný konflikt mezi dostupnými zdroji.",
        severity: "neutral",
        title: "Bez konfliktu"
      }
    ];
  }

  return evidence.signals.map((signal) => ({
    detail: signal.sourceSystemIds.length > 0 ? `${signal.detail} Zdroje: ${signal.sourceSystemIds.join(", ")}.` : signal.detail,
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
      detail: `${Math.round(confidence * 100)} % aktuální jistota objektu`,
      label: "Skóre",
      tone: confidence >= 0.75 ? "ok" : confidence >= 0.5 ? "neutral" : "warn"
    },
    {
      detail: reliabilityExplanation(provenance?.sourceReliability),
      label: "Spolehlivost zdroje",
      tone: provenance?.sourceReliability && !["E", "F", "UNKNOWN"].includes(provenance.sourceReliability) ? "ok" : "neutral"
    },
    {
      detail: credibilityExplanation(provenance?.informationCredibility),
      label: "Věrohodnost informace",
      tone: provenance?.informationCredibility && !["5", "6", "UNKNOWN"].includes(provenance.informationCredibility) ? "ok" : "neutral"
    },
    {
      detail: ageSeconds === undefined ? "Objekt nemá časovou značku." : `${ageSeconds}s od poslední aktualizace objektu`,
      label: "Stáří dat",
      tone: ageSeconds === undefined ? "neutral" : ageSeconds > 120 ? "warn" : "ok"
    },
    {
      detail: sourceHealth ? `Zdroj: ${sourceHealthLabel(sourceHealth.health)}, aktuální objekty: ${sourceHealth.currentTracks}` : "Není navázán provozní stav zdroje.",
      label: "Stav zdroje",
      tone: sourceHealth?.health === "ONLINE" ? "ok" : sourceHealth ? "warn" : "neutral"
    },
    {
      detail: object.synthetic || provenance?.synthetic ? "Cvičný původ je explicitně označen." : "Objekt nemá příznak cvičného původu.",
      label: "Původ",
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
      detail: provenance?.eventId ?? "identifikátor události není dostupný",
      label: "Zdrojová událost",
      status: provenance?.sourceSystemId ?? "zdroj není dostupný"
    },
    {
      detail: provenance?.adapterVersion ? `${provenance.adapterId ?? "datový adaptér"} ${provenance.adapterVersion}` : provenance?.adapterId ?? "datový adaptér není dostupný",
      label: "Zpracování dat",
      status: provenance?.producerTimestamp ?? "čas zdroje n/a"
    },
    {
      detail: `${object.domain} / ${objectStatusLabel(object.status)} / jistota ${Math.round((object.confidence ?? 0) * 100)} %`,
      label: "Kanonický situační objekt",
      status: object.objectId
    },
    {
      detail: `${sidc} -> ${symbolCode}`,
      label: "APP-6 zobrazení",
      status: `${object.objectType} / ${getAffiliationPresentation(object.affiliation).label}`
    }
  ];
}

function sourceHealthLabel(status: SourceHealthItem["health"]): string {
  const labels: Record<SourceHealthItem["health"], string> = {
    DEGRADED: "omezený",
    DISABLED: "vypnutý",
    ONLINE: "online",
    QUIET: "bez nových dat",
    STALE: "starší data",
    UNAVAILABLE: "nedostupný",
    WAITING: "čeká"
  };
  return labels[status] ?? "neznámý";
}

function objectStatusLabel(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === "ACTIVE") {
    return "aktivní";
  }
  if (normalized === "INACTIVE") {
    return "neaktivní";
  }
  if (normalized === "LOST") {
    return "ztracený";
  }
  if (normalized === "STALE") {
    return "starší data";
  }
  if (normalized === "CONFLICTED") {
    return "konflikt dat";
  }
  return status.toLowerCase();
}

function detectObjectConflicts(
  object: CopObject,
  historyPoints: TrackHistoryPoint[],
  sourceHealth: SourceHealthItem | undefined
): ObjectConflict[] {
  const conflicts: ObjectConflict[] = [];
  if (object.status === "CONFLICTED") {
    conflicts.push({
      detail: "Dostupné zdroje se u tohoto objektu neshodují.",
      severity: "warn",
      title: "Konflikt stavu"
    });
  }

  const recentPoints = historyPoints.slice(-12);
  const affiliations = new Set(recentPoints.map((point) => point.affiliation).filter(Boolean));
  if (affiliations.size > 1) {
    conflicts.push({
      detail: `Nedávná historie obsahuje ${affiliations.size} hodnot příslušnosti: ${Array.from(affiliations).join(", ")}.`,
      severity: "warn",
      title: "Rozdílná příslušnost"
    });
  }

  const statusValues = new Set(recentPoints.map((point) => point.status).filter(Boolean));
  if (statusValues.size > 2) {
    conflicts.push({
      detail: `Nedávná historie obsahuje měnící se stavy životního cyklu: ${Array.from(statusValues).join(", ")}.`,
      severity: "warn",
      title: "Rozdílný stav"
    });
  }

  const sourcePositions = latestPositionBySource(recentPoints);
  const maxDistanceKm = maxSourceDistanceKm(sourcePositions);
  if (maxDistanceKm > sourceDistanceConflictKm) {
    conflicts.push({
      detail: `Poslední polohy ze zdrojů se liší až o ${maxDistanceKm.toFixed(1)} km.`,
      severity: "warn",
      title: "Rozdílná poloha"
    });
  }

  if (sourceHealth && sourceHealth.health !== "ONLINE") {
    conflicts.push({
      detail: `Navázaný zdroj je ve stavu ${sourceHealth.health.toLowerCase()}; stáří posledního pozorování může snížit jistotu.`,
      severity: "warn",
      title: "Zdroj omezen"
    });
  }

  if (conflicts.length === 0) {
    conflicts.push({
      detail: "V aktuálním snapshotu a nedávné historii není vidět zdrojový konflikt.",
      severity: "neutral",
      title: "Bez konfliktu"
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
    A: "A - zcela spolehlivý",
    B: "B - obvykle spolehlivý",
    C: "C - poměrně spolehlivý",
    D: "D - obvykle nespolehlivý",
    E: "E - nespolehlivý",
    F: "F - spolehlivost nelze posoudit",
    UNKNOWN: "spolehlivost neznámá"
  };
  return value ? labels[value] ?? value : "nedodáno";
}

function credibilityExplanation(value: string | undefined): string {
  const labels: Record<string, string> = {
    "1": "1 - potvrzeno dalšími zdroji",
    "2": "2 - pravděpodobně pravdivé",
    "3": "3 - možná pravdivé",
    "4": "4 - pochybné",
    "5": "5 - nepravděpodobné",
    "6": "6 - nelze posoudit",
    UNKNOWN: "věrohodnost neznámá"
  };
  return value ? labels[value] ?? value : "nedodáno";
}
