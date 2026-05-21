export const eventTypes = [
  "track.created",
  "track.updated",
  "track.lost",
  "track.restored",
  "track.deleted",
  "incident.created",
  "incident.updated",
  "report.created",
  "source.status.changed"
] as const;

export type EventType = (typeof eventTypes)[number];

export const objectTypes = [
  "AIRCRAFT",
  "UAV",
  "MISSILE_TRACK",
  "GROUND_UNIT",
  "RESCUE_ASSET",
  "INCIDENT",
  "REPORT",
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

export type Domain = "AIR" | "LAND" | "SEA" | "RESCUE" | "OTHER";

export type ObjectStatus = "ACTIVE" | "INACTIVE" | "LOST" | "STALE" | "CONFLICTED";

export type ClassificationLevel = "UNCLASSIFIED" | "RESTRICTED" | "CONFIDENTIAL" | "SECRET";

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
  lastUpdatedAt?: string;
  synthetic?: boolean;
  symbol?: Record<string, unknown>;
  provenanceIds?: string[];
  attributes?: Record<string, unknown>;
}

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
