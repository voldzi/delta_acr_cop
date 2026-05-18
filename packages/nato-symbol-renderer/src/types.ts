export type ObjectType =
  | "AIRCRAFT"
  | "UAV"
  | "MISSILE_TRACK"
  | "GROUND_UNIT"
  | "RESCUE_ASSET"
  | "INCIDENT"
  | "REPORT"
  | "UNKNOWN";

export type Affiliation = "FRIEND" | "ASSUMED_FRIEND" | "NEUTRAL" | "UNKNOWN" | "SUSPECT" | "HOSTILE" | "PENDING";

export type Domain = "AIR" | "LAND" | "SEA" | "RESCUE" | "OTHER";

export type ObjectStatus = "ACTIVE" | "INACTIVE" | "LOST" | "STALE" | "CONFLICTED";

export interface SymbolResolveRequest {
  objectType: ObjectType;
  affiliation: Affiliation;
  domain: Domain;
  status: ObjectStatus;
  modifiers?: Record<string, unknown>;
}

export interface SymbolResolution {
  symbolSet: "APP6";
  standardVersion: string;
  symbolCode: string;
  renderer: "SVG" | "CANVAS" | "NVG";
  modifiers: Record<string, unknown>;
  fallback: boolean;
  extension: null | {
    catalog: string;
    reason: string;
  };
  warnings?: string[];
}
