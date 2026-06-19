export const eventTypes = [
  "track.created",
  "track.updated",
  "track.lost",
  "track.restored",
  "track.deleted",
  "incident.created",
  "incident.updated",
  "incident.closed",
  "report.created",
  "report.updated",
  "report.submitted",
  "media.attached",
  "media.derivative.created",
  "community.group.created",
  "community.group.updated",
  "community.group.member.updated",
  "alert.created",
  "alert.updated",
  "alert.acknowledged",
  "user.zone.created",
  "user.zone.updated",
  "user.zone.deleted",
  "zone.entered",
  "zone.exited",
  "sketch.drawing.created",
  "sketch.drawing.updated",
  "sketch.drawing.deleted",
  "notification.requested",
  "ai.summary.created",
  "data.conflict.detected",
  "source.status.changed"
] as const;

export type EventType = (typeof eventTypes)[number];

export const objectTypes = [
  "MAP_FEATURE",
  "AIRCRAFT",
  "UAV",
  "MISSILE_TRACK",
  "GROUND_UNIT",
  "RESCUE_ASSET",
  "SENSOR_OBSERVATION",
  "WEATHER_OBSERVATION",
  "MOBILE_NETWORK_OBSERVATION",
  "TRAFFIC_OBSERVATION",
  "INCIDENT",
  "ALERT",
  "REPORT",
  "EVIDENCE",
  "TASK",
  "USER_ZONE",
  "SKETCH_DRAWING",
  "UNKNOWN"
] as const;

export type ObjectType = (typeof objectTypes)[number];

export type Affiliation =
  | "FRIEND"
  | "ASSUMED_FRIEND"
  | "NEUTRAL"
  | "UNKNOWN"
  | "SUSPECT"
  | "HOSTILE"
  | "PENDING";

export type Domain =
  | "AIR"
  | "LAND"
  | "SEA"
  | "RESCUE"
  | "WEATHER"
  | "SAFETY"
  | "COMMUNICATIONS"
  | "TRANSPORT"
  | "COMMUNITY"
  | "OTHER";

export type ObjectStatus = "ACTIVE" | "INACTIVE" | "LOST" | "STALE" | "CONFLICTED";

export type ClassificationLevel = "UNCLASSIFIED" | "RESTRICTED" | "CONFIDENTIAL" | "SECRET";

export type CanonicalEntityType =
  | "mapFeature"
  | "observedObject"
  | "sensorObservation"
  | "incident"
  | "alert"
  | "communityReport"
  | "evidence"
  | "task"
  | "userZone"
  | "sketchDrawing"
  | "sourceSystem";

export type Visibility = "public" | "group" | "event" | "private" | "restricted";

export type DataQuality = "observed" | "modelled" | "mixed" | "inferred" | "synthetic" | "unknown";

export type ReleaseScope = "public" | "authenticated" | "group" | "event" | "operator" | "admin";

export interface ReleasePolicy {
  visibility: Visibility;
  allowedScopes: ReleaseScope[];
  groupIds?: string[];
  eventIds?: string[];
  userIds?: string[];
  mediaAccess?: Visibility;
  expiresAt?: string | null;
  reason?: string | null;
}

export interface ProvenanceRecord {
  provenanceId: string;
  sourceSystemId: string;
  sourceName?: string | null;
  sourceFeatureId?: string | null;
  adapterId?: string | null;
  adapterVersion?: string | null;
  eventId?: string | null;
  transformedAt: string;
  transformation: string;
  basis?: string[];
  sourceRevision?: string | null;
}

export interface ConfidenceAssessment {
  confidence: number;
  dataQuality: DataQuality;
  stale?: boolean;
  sourceReliability?: "A" | "B" | "C" | "D" | "E" | "F" | "UNKNOWN";
  informationCredibility?: "1" | "2" | "3" | "4" | "5" | "6" | "UNKNOWN";
  factors?: Array<{
    name: string;
    value: number | string | boolean;
    effect: "positive" | "negative" | "neutral";
    explanation?: string;
  }>;
  explanation?: string;
}

export interface CanonicalEntityBase {
  id: string;
  entityType: CanonicalEntityType;
  title?: string;
  summary?: string;
  source: SourceRef;
  classification: Classification;
  releasePolicy: ReleasePolicy;
  confidence: ConfidenceAssessment;
  provenance: ProvenanceRecord[];
  createdAt: string;
  updatedAt: string;
  validFrom?: string | null;
  validUntil?: string | null;
  ownerSubjectId?: string | null;
  correlationId?: string | null;
}

export interface SourceRef {
  sourceSystemId: string;
  sourceDeviceId?: string | null;
  adapterId: string;
  adapterVersion: string;
}

export interface Classification {
  level: ClassificationLevel;
  releasability: string[];
  handlingCaveats: string[];
}

export interface GeoPoint {
  lat: number;
  lon: number;
  altitudeM?: number | null;
  accuracyM?: number | null;
}

export interface ObservedObject {
  objectId: string;
  objectType: ObjectType;
  affiliation: Affiliation;
  domain: Domain;
  status: ObjectStatus;
  position?: GeoPoint;
  movement?: {
    speedMps?: number | null;
    headingDeg?: number | null;
    verticalRateMps?: number | null;
  };
  speedMps?: number | null;
  headingDeg?: number | null;
  verticalRateMps?: number | null;
  confidence?: number;
  dataQuality?: DataQuality;
  lastUpdatedAt?: string;
  validFrom?: string | null;
  validUntil?: string | null;
  synthetic?: boolean;
  symbol?: Record<string, unknown>;
  provenanceIds?: string[];
  provenance?: ProvenanceRecord[];
  releasePolicy?: ReleasePolicy;
  ownerSubjectId?: string | null;
  attributes?: Record<string, unknown>;
}

export interface SensorObservation extends CanonicalEntityBase {
  entityType: "sensorObservation";
  observationType: "weather" | "airQuality" | "mobileNetwork" | "traffic" | "safety" | "other";
  geometry?: GeoPoint | Record<string, unknown>;
  metrics: Record<string, number | string | boolean | null>;
  tags?: Record<string, string | number | boolean | null>;
}

export interface IncidentEntity extends CanonicalEntityBase {
  entityType: "incident";
  status: "new" | "active" | "monitoring" | "resolved" | "archived";
  severity: "info" | "warning" | "critical";
  geometry?: GeoPoint | Record<string, unknown>;
  affectedArea?: Record<string, unknown>;
}

export interface AlertEntity extends CanonicalEntityBase {
  entityType: "alert";
  alertType: string;
  severity: "info" | "warning" | "critical";
  urgency?: "immediate" | "expected" | "future" | "past" | "unknown";
  certainty?: "observed" | "likely" | "possible" | "unlikely" | "unknown";
  recommendedAction?: string | null;
  evidence?: Record<string, unknown>;
}

export interface EvidenceEntity extends CanonicalEntityBase {
  entityType: "evidence";
  evidenceType: "photo" | "video" | "spatialVideo" | "document" | "audio" | "text" | "other";
  reportId?: string | null;
  groupId?: string | null;
  location?: GeoPoint | null;
  media?: {
    bucket?: string;
    objectKey?: string;
    contentType?: string;
    byteSize?: number;
    checksumSha256?: string | null;
    derivativeIds?: string[];
  };
}

export interface UserZoneEntity extends CanonicalEntityBase {
  entityType: "userZone";
  zoneType: "watch" | "warning" | "operational" | "custom";
  geometry: Record<string, unknown>;
  style?: Record<string, unknown>;
  alertRules?: Array<Record<string, unknown>>;
}

export interface SketchDrawingEntity extends CanonicalEntityBase {
  entityType: "sketchDrawing";
  geometry: Record<string, unknown>;
  drawingKind: "marker" | "line" | "polygon" | "circle" | "text" | "arrow" | "measurement";
  style: Record<string, unknown>;
  symbol?: Record<string, unknown>;
  revision: number;
}

export type CanonicalEntity =
  | ObservedObject
  | SensorObservation
  | IncidentEntity
  | AlertEntity
  | EvidenceEntity
  | UserZoneEntity
  | SketchDrawingEntity;

export interface CanonicalEventEnvelope {
  eventId: string;
  eventType: EventType;
  contractVersion: "cop-ingest-v1";
  source: SourceRef;
  correlationId: string;
  producerTimestamp: string;
  ingestTimestamp?: string;
  sequence?: {
    streamId: string;
    number: number;
  };
  classification: Classification;
  geo: GeoPoint;
  payload: ObservedObject;
  quality: {
    confidence: number;
    sourceReliability: "A" | "B" | "C" | "D" | "E" | "F" | "UNKNOWN";
    informationCredibility: "1" | "2" | "3" | "4" | "5" | "6" | "UNKNOWN";
  };
  simulation?: {
    synthetic: boolean;
    scenarioId?: string | null;
    blockId?: string | null;
    seed?: number | null;
  };
  signature?: {
    signed: boolean;
    keyId?: string | null;
    algorithm?: string | null;
  };
}

export interface CopDomainEventEnvelope {
  eventId: string;
  eventType: EventType;
  contractVersion: "cop-domain-event-v1";
  source: SourceRef;
  correlationId: string;
  producerTimestamp: string;
  ingestTimestamp?: string;
  classification: Classification;
  releasePolicy: ReleasePolicy;
  payload: CanonicalEntity;
  quality: ConfidenceAssessment;
  provenance?: ProvenanceRecord[];
  signature?: CanonicalEventEnvelope["signature"];
}

export interface SourceSystem {
  sourceSystemId: string;
  displayName: string;
  sourceType:
    | "SIMULATOR"
    | "AIR_SYSTEM"
    | "PUBLIC_FLIGHT_AGGREGATE"
    | "PUBLIC_SAFETY_AGGREGATE"
    | "PUBLIC_SITUATION_AGGREGATE"
    | "TAK_COT_GATEWAY"
    | "GROUND_SYSTEM"
    | "UAV_SYSTEM"
    | "RESCUE_SYSTEM"
    | "MANUAL_REPORTING";
  owner: string;
  allowedEventTypes: string[];
  allowedObjectTypes: string[];
  trustProfile: "LAB_SYNTHETIC" | "TRUSTED_INTERNAL" | "PARTNER" | "UNKNOWN";
  classificationLimit: ClassificationLevel;
  synthetic: boolean;
  status?: "REGISTERED" | "ACTIVE" | "SUSPENDED" | "REVOKED";
  attributes?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export function createSimSourceSystem(): SourceSystem {
  const now = new Date().toISOString();
  return {
    sourceSystemId: "sim-air-situation-001",
    displayName: "COP Air Situation Simulator",
    sourceType: "SIMULATOR",
    owner: "SIM project",
    allowedEventTypes: ["track.created", "track.updated", "track.lost", "track.restored"],
    allowedObjectTypes: ["AIRCRAFT", "UAV", "MISSILE_TRACK"],
    trustProfile: "LAB_SYNTHETIC",
    classificationLimit: "UNCLASSIFIED",
    synthetic: true,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now
  };
}

export function createPublicFlightAggregateSourceSystem(): SourceSystem {
  const now = new Date().toISOString();
  return {
    sourceSystemId: "flight-data-api",
    displayName: "Public Flight Data Aggregate",
    sourceType: "PUBLIC_FLIGHT_AGGREGATE",
    owner: "SIM flight-data-api",
    allowedEventTypes: ["track.created", "track.updated", "track.lost", "track.restored"],
    allowedObjectTypes: ["AIRCRAFT", "UAV", "UNKNOWN"],
    trustProfile: "UNKNOWN",
    classificationLimit: "UNCLASSIFIED",
    synthetic: false,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now
  };
}

export function createPublicSituationAggregateSourceSystem(): SourceSystem {
  const now = new Date().toISOString();
  return {
    sourceSystemId: "situation-data-api",
    displayName: "SIM Situation Data",
    sourceType: "PUBLIC_SITUATION_AGGREGATE",
    owner: "SIM situation-data-api",
    allowedEventTypes: [],
    allowedObjectTypes: ["INCIDENT", "REPORT", "GROUND_UNIT", "UNKNOWN"],
    trustProfile: "UNKNOWN",
    classificationLimit: "UNCLASSIFIED",
    synthetic: false,
    status: "ACTIVE",
    attributes: {
      contextOnly: true,
      contractVersion: "cop-situation-source-v1"
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createPublicSafetyAggregateSourceSystem(): SourceSystem {
  const now = new Date().toISOString();
  return {
    sourceSystemId: "safety-data-api",
    displayName: "SIM Safety Data",
    sourceType: "PUBLIC_SAFETY_AGGREGATE",
    owner: "SIM safety-data-api",
    allowedEventTypes: [],
    allowedObjectTypes: ["INCIDENT", "REPORT", "UNKNOWN"],
    trustProfile: "UNKNOWN",
    classificationLimit: "UNCLASSIFIED",
    synthetic: false,
    status: "ACTIVE",
    attributes: {
      contextOnly: true,
      contractVersion: "cop-safety-source-v1"
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createTakGatewaySourceSystem(): SourceSystem {
  const now = new Date().toISOString();
  return {
    sourceSystemId: "tak-gateway-api",
    displayName: "TAK Gateway",
    sourceType: "TAK_COT_GATEWAY",
    owner: "SIM tak-gateway-api",
    allowedEventTypes: [],
    allowedObjectTypes: ["GROUND_UNIT", "RESCUE_ASSET", "UNKNOWN"],
    trustProfile: "PARTNER",
    classificationLimit: "RESTRICTED",
    synthetic: false,
    status: "ACTIVE",
    attributes: {
      contextOnly: true,
      contractVersion: "cop-tak-source-v1",
      partnerData: true
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createCopObjectFromEvent(event: CanonicalEventEnvelope): ObservedObject {
  return {
    ...event.payload,
    position: event.payload.position ?? event.geo,
    movement:
      event.payload.movement ??
      {
        speedMps: event.payload.speedMps,
        headingDeg: event.payload.headingDeg,
        verticalRateMps: event.payload.verticalRateMps
      },
    confidence: event.quality.confidence,
    lastUpdatedAt: event.ingestTimestamp ?? new Date().toISOString(),
    synthetic: event.simulation?.synthetic ?? false,
    provenanceIds: [event.eventId]
  };
}
