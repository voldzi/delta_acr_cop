import type { ObservedObject } from "@cop/canonical-model";
import { createHash } from "node:crypto";
import type { ObjectConflictEvidence } from "./conflict-evidence.js";
import type { SourceHealthItem } from "./source-health.js";
import type { AlertAcknowledgement } from "./types.js";

export type CopAlertSeverity = "info" | "warning" | "critical";
export type CopAlertStatus = "ACKNOWLEDGED" | "ACTIVE";
export type AoiRuleAffiliationScope = "all" | "friend" | "hostile" | "unknown";
export type CopAlertType = "AOI_ENTRY" | "LOW_CONFIDENCE" | "SOURCE_DEGRADED" | "TRACK_CONFLICT" | "TRACK_LOST" | "TRACK_STALE";

export interface AoiRule {
  affiliationScope?: AoiRuleAffiliationScope;
  enabled: boolean;
  id: string;
  lat: number;
  lon: number;
  name: string;
  radiusKm: number;
  severity?: CopAlertSeverity;
}

export interface CopAlert {
  acknowledgedAt?: string;
  alertId: string;
  detail: string;
  evidence?: Record<string, unknown>;
  map?: {
    lat: number;
    lon: number;
    radiusKm: number;
  };
  objectId?: string;
  observedAt: string;
  severity: CopAlertSeverity;
  sourceSystemId?: string;
  status: CopAlertStatus;
  title: string;
  type: CopAlertType;
  updatedAt: string;
}

const lowConfidenceThreshold = 0.5;

export function buildCopAlerts({
  acknowledgements,
  aoiRules = [],
  evaluatedAt,
  objects,
  sourceHealth
}: {
  acknowledgements: Map<string, AlertAcknowledgement>;
  aoiRules?: AoiRule[];
  evaluatedAt: string;
  objects: ObservedObject[];
  sourceHealth: SourceHealthItem[];
}): CopAlert[] {
  return [
    ...buildAoiAlerts(objects, acknowledgements, evaluatedAt, aoiRules),
    ...objects.flatMap((object) => buildObjectAlerts(object, acknowledgements, evaluatedAt)),
    ...sourceHealth.flatMap((source) => buildSourceAlerts(source, acknowledgements, evaluatedAt))
  ].sort(compareAlerts);
}

function buildAoiAlerts(
  objects: ObservedObject[],
  acknowledgements: Map<string, AlertAcknowledgement>,
  evaluatedAt: string,
  aoiRules: AoiRule[]
): CopAlert[] {
  const rules = aoiRules.filter(isActiveAoiRule);
  if (rules.length === 0) {
    return [];
  }

  return objects.flatMap((object) => {
    if (!object.position) {
      return [];
    }
    return rules.flatMap((rule) => {
      if (!matchesAoiAffiliationScope(object.affiliation, rule.affiliationScope ?? "all")) {
        return [];
      }
      const distanceKm = distanceBetweenKm(
        { lat: object.position!.lat, lon: object.position!.lon },
        { lat: rule.lat, lon: rule.lon }
      );
      if (distanceKm > rule.radiusKm) {
        return [];
      }
      return [
        withAcknowledgement(
          {
            alertId: alertId("AOI_ENTRY", object.objectId, rule.id),
            detail: `${object.objectId} je v oblasti ${rule.name} (${distanceKm.toFixed(1)} km od středu).`,
            evidence: {
              affiliationScope: rule.affiliationScope ?? "all",
              aoiName: rule.name,
              aoiRuleId: rule.id,
              distanceKm: Number(distanceKm.toFixed(3)),
              radiusKm: rule.radiusKm
            },
            map: { lat: rule.lat, lon: rule.lon, radiusKm: rule.radiusKm },
            objectId: object.objectId,
            observedAt: object.lastUpdatedAt ?? evaluatedAt,
            severity: rule.severity ?? "warning",
            status: "ACTIVE",
            title: "Objekt v oblasti zájmu",
            type: "AOI_ENTRY",
            updatedAt: evaluatedAt
          },
          acknowledgements
        )
      ];
    });
  });
}

function buildObjectAlerts(
  object: ObservedObject,
  acknowledgements: Map<string, AlertAcknowledgement>,
  evaluatedAt: string
): CopAlert[] {
  const alerts: CopAlert[] = [];
  const conflictEvidence = readConflictEvidence(object);
  const directConflictSignals = conflictEvidence?.signals.filter(
    (signal) => signal.type !== "LOW_CONFIDENCE" && signal.type !== "SOURCE_DEGRADED"
  ) ?? [];
  if (conflictEvidence?.state === "CONFLICTED" && directConflictSignals.length > 0) {
    const directConflictEvidence = {
      ...conflictEvidence,
      signals: directConflictSignals
    };
    alerts.push(
      withAcknowledgement(
        {
          alertId: alertId("TRACK_CONFLICT", object.objectId),
          detail: directConflictSignals.map((signal) => signal.title).join(", "),
          evidence: {
            conflictSignalTypes: directConflictSignals.map((signal) => signal.type),
            sourceSystemIds: conflictEvidence.sourceSystemIds
          },
          map: object.position ? { lat: object.position.lat, lon: object.position.lon, radiusKm: conflictSeverity(directConflictEvidence) === "critical" ? 2 : 1.2 } : undefined,
          objectId: object.objectId,
          observedAt: latestSignalTimestamp(directConflictEvidence) ?? object.lastUpdatedAt ?? evaluatedAt,
          severity: conflictSeverity(directConflictEvidence),
          sourceSystemId: conflictEvidence.sourceSystemIds[0],
          status: "ACTIVE",
          title: "Konflikt dat objektu",
          type: "TRACK_CONFLICT",
          updatedAt: evaluatedAt
        },
        acknowledgements
      )
    );
  }

  const confidence = object.confidence ?? 0;
  if (confidence < lowConfidenceThreshold) {
    alerts.push(
      withAcknowledgement(
        {
          alertId: alertId("LOW_CONFIDENCE", object.objectId),
          detail: `Confidence ${Math.round(confidence * 100)} % je pod prahovou hodnotou ${Math.round(lowConfidenceThreshold * 100)} %.`,
          evidence: { confidence, threshold: lowConfidenceThreshold },
          map: object.position ? { lat: object.position.lat, lon: object.position.lon, radiusKm: 1 } : undefined,
          objectId: object.objectId,
          observedAt: object.lastUpdatedAt ?? evaluatedAt,
          severity: "warning",
          status: "ACTIVE",
          title: "Nízká důvěra objektu",
          type: "LOW_CONFIDENCE",
          updatedAt: evaluatedAt
        },
        acknowledgements
      )
    );
  }

  if (object.status === "STALE" || object.status === "LOST") {
    alerts.push(
      withAcknowledgement(
        {
          alertId: alertId(object.status === "LOST" ? "TRACK_LOST" : "TRACK_STALE", object.objectId),
          detail: object.status === "LOST" ? "Objekt je označen jako LOST." : "Objekt je mimo čerstvé lifecycle okno a je označen jako STALE.",
          evidence: { trackStatus: object.status },
          map: object.position ? { lat: object.position.lat, lon: object.position.lon, radiusKm: object.status === "LOST" ? 1.8 : 1.1 } : undefined,
          objectId: object.objectId,
          observedAt: object.lastUpdatedAt ?? evaluatedAt,
          severity: object.status === "LOST" ? "critical" : "warning",
          status: "ACTIVE",
          title: object.status === "LOST" ? "Ztracený objekt" : "Zastaralý track",
          type: object.status === "LOST" ? "TRACK_LOST" : "TRACK_STALE",
          updatedAt: evaluatedAt
        },
        acknowledgements
      )
    );
  }

  return alerts;
}

function buildSourceAlerts(
  source: SourceHealthItem,
  acknowledgements: Map<string, AlertAcknowledgement>,
  evaluatedAt: string
): CopAlert[] {
  if (source.health === "ONLINE" || source.health === "WAITING") {
    return [];
  }

  return [
    withAcknowledgement(
      {
        alertId: alertId("SOURCE_DEGRADED", source.sourceSystemId),
        detail: `Zdroj ${source.displayName} je ve stavu ${source.health}; current tracks ${source.currentTracks}, stale ${source.staleTracks}.`,
        evidence: {
          acceptedEvents: source.acceptedEvents,
          sourceHealth: source.health,
          staleTracks: source.staleTracks,
          totalTracks: source.totalTracks
        },
        observedAt: source.lastObservationAt ?? evaluatedAt,
        severity: source.health === "DISABLED" ? "critical" : "warning",
        sourceSystemId: source.sourceSystemId,
        status: "ACTIVE",
        title: "Degradovaný zdroj dat",
        type: "SOURCE_DEGRADED",
        updatedAt: evaluatedAt
      },
      acknowledgements
    )
  ];
}

function withAcknowledgement(alert: CopAlert, acknowledgements: Map<string, AlertAcknowledgement>): CopAlert {
  const acknowledgement = acknowledgements.get(alert.alertId);
  if (!acknowledgement) {
    return alert;
  }

  return {
    ...alert,
    acknowledgedAt: acknowledgement.acknowledgedAt,
    status: "ACKNOWLEDGED"
  };
}

function readConflictEvidence(object: ObservedObject): ObjectConflictEvidence | undefined {
  const evidence = object.attributes?.conflictEvidence;
  if (!evidence || typeof evidence !== "object") {
    return undefined;
  }
  const candidate = evidence as Partial<ObjectConflictEvidence>;
  return typeof candidate.objectId === "string" && Array.isArray(candidate.signals) ? (candidate as ObjectConflictEvidence) : undefined;
}

function conflictSeverity(evidence: ObjectConflictEvidence): CopAlertSeverity {
  if (evidence.signals.some((signal) => signal.type === "STATE_CONFLICTED" || signal.type === "POSITION_VARIANCE")) {
    return "critical";
  }
  return evidence.severity === "warning" ? "warning" : "info";
}

function latestSignalTimestamp(evidence: ObjectConflictEvidence): string | undefined {
  return evidence.signals.reduce<string | undefined>((latest, signal) => {
    if (!signal.observedAt) {
      return latest;
    }
    if (!latest || Date.parse(signal.observedAt) > Date.parse(latest)) {
      return signal.observedAt;
    }
    return latest;
  }, undefined);
}

function isActiveAoiRule(rule: AoiRule): boolean {
  return rule.enabled
    && Number.isFinite(rule.lat)
    && Number.isFinite(rule.lon)
    && Number.isFinite(rule.radiusKm)
    && rule.radiusKm > 0;
}

function matchesAoiAffiliationScope(affiliation: string, scope: AoiRuleAffiliationScope): boolean {
  if (scope === "all") {
    return true;
  }
  if (scope === "friend") {
    return affiliation === "FRIEND" || affiliation === "ASSUMED_FRIEND";
  }
  if (scope === "hostile") {
    return affiliation === "HOSTILE" || affiliation === "SUSPECT";
  }
  return affiliation === "UNKNOWN" || affiliation === "PENDING";
}

function distanceBetweenKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const earthRadiusKm = 6371.0088;
  const deltaLat = degreesToRadians(b.lat - a.lat);
  const deltaLon = degreesToRadians(b.lon - a.lon);
  const startLat = degreesToRadians(a.lat);
  const endLat = degreesToRadians(b.lat);
  const haversine =
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function compareAlerts(a: CopAlert, b: CopAlert): number {
  const severityDelta = severityRank(b.severity) - severityRank(a.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return Date.parse(b.observedAt) - Date.parse(a.observedAt);
}

function severityRank(severity: CopAlertSeverity): number {
  if (severity === "critical") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }
  return 1;
}

function alertId(type: CopAlertType, targetId: string, discriminator = ""): string {
  const hash = createHash("sha256").update(`${type}:${targetId}:${discriminator}`).digest("hex").slice(0, 16);
  return `alert-${hash}`;
}
