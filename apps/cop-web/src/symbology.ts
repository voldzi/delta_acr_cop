import { resolveSymbol, type SymbolResolution, type SymbolResolveRequest } from "@cop/nato-symbol-renderer";
import ms, { type ColorMode } from "milsymbol";
import type { CopObject } from "./cop-data";

type Affiliation = SymbolResolveRequest["affiliation"];
type Domain = SymbolResolveRequest["domain"];
type ObjectStatus = SymbolResolveRequest["status"];
type ObjectType = SymbolResolveRequest["objectType"];

export type AffiliationDisposition = "friend" | "hostile" | "neutral" | "unknown" | "pending";

export interface AffiliationPresentation {
  disposition: AffiliationDisposition;
  color: string;
  label: string;
}

const knownObjectTypes = new Set<ObjectType>([
  "AIRCRAFT",
  "UAV",
  "MISSILE_TRACK",
  "GROUND_UNIT",
  "RESCUE_ASSET",
  "INCIDENT",
  "REPORT",
  "UNKNOWN"
]);

const knownAffiliations = new Set<Affiliation>([
  "FRIEND",
  "ASSUMED_FRIEND",
  "NEUTRAL",
  "UNKNOWN",
  "SUSPECT",
  "HOSTILE",
  "PENDING"
]);

const knownDomains = new Set<Domain>(["AIR", "LAND", "SEA", "RESCUE", "OTHER"]);
const knownStatuses = new Set<ObjectStatus>(["ACTIVE", "INACTIVE", "LOST", "STALE", "CONFLICTED"]);

export const natoSymbolColorMode: ColorMode = {
  Civilian: "#38bdf8",
  Friend: "#3b82f6",
  Hostile: "#ef4444",
  Neutral: "#22c55e",
  Unknown: "#facc15",
  Suspect: "#ef4444"
};

export function resolveCopObjectSymbol(object: CopObject): SymbolResolution {
  return resolveSymbol(
    normalizeObjectType(object.objectType),
    normalizeAffiliation(object.affiliation),
    normalizeDomain(object.domain),
    normalizeStatus(object.status),
    {
      synthetic: Boolean(object.synthetic),
      confidence: object.confidence ?? 0
    }
  );
}

export function getAffiliationPresentation(affiliation: string): AffiliationPresentation {
  const normalized = normalizeAffiliation(affiliation);
  if (normalized === "FRIEND" || normalized === "ASSUMED_FRIEND") {
    return { disposition: "friend", color: "#3b82f6", label: "Vlastní" };
  }
  if (normalized === "HOSTILE" || normalized === "SUSPECT") {
    return { disposition: "hostile", color: "#ef4444", label: "Rizikové" };
  }
  if (normalized === "NEUTRAL") {
    return { disposition: "neutral", color: "#22c55e", label: "Neutrální" };
  }
  if (normalized === "PENDING") {
    return { disposition: "pending", color: "#a78bfa", label: "Čeká na potvrzení" };
  }
  return { disposition: "unknown", color: "#facc15", label: "Neznámé" };
}

export function getNatoIconKey(objectType: string, affiliation: string): string {
  const type = normalizeObjectType(objectType).toLowerCase().replaceAll("_", "-");
  return `nato-${getAffiliationPresentation(affiliation).disposition}-${type}`;
}

export function getObjectTypeGlyph(objectType: string): string {
  if (objectType === "AIRCRAFT") {
    return "AC";
  }
  if (objectType === "UAV") {
    return "UAV";
  }
  if (objectType === "MISSILE_TRACK") {
    return "MSL";
  }
  if (objectType === "GROUND_UNIT") {
    return "GND";
  }
  return objectType.slice(0, 3).toUpperCase();
}

export function getNatoSidc(objectType: string, affiliation: string): string {
  return [
    "S",
    getSidcAffiliation(normalizeAffiliation(affiliation)),
    getSidcDimension(normalizeObjectType(objectType)),
    "P",
    getSidcFunctionId(normalizeObjectType(objectType)),
    "-----"
  ].join("");
}

export function createNatoSymbolSvg(objectType: string, affiliation: string): string {
  const symbol = new ms.Symbol(getNatoSidc(objectType, affiliation), {
    standard: "APP6",
    size: 64,
    colorMode: natoSymbolColorMode,
    frameColor: natoSymbolColorMode,
    fill: true,
    frame: true,
    icon: true,
    infoFields: false,
    outlineColor: "#061019",
    outlineWidth: 4,
    strokeWidth: 5
  });

  return symbol.asSVG();
}

export function normalizeAffiliation(value: string | undefined): Affiliation {
  return knownAffiliations.has(value as Affiliation) ? (value as Affiliation) : "UNKNOWN";
}

function normalizeObjectType(value: string): ObjectType {
  return knownObjectTypes.has(value as ObjectType) ? (value as ObjectType) : "UNKNOWN";
}

function normalizeDomain(value: string): Domain {
  return knownDomains.has(value as Domain) ? (value as Domain) : "OTHER";
}

function normalizeStatus(value: string): ObjectStatus {
  return knownStatuses.has(value as ObjectStatus) ? (value as ObjectStatus) : "STALE";
}

function getSidcAffiliation(affiliation: Affiliation): string {
  if (affiliation === "FRIEND") {
    return "F";
  }
  if (affiliation === "ASSUMED_FRIEND") {
    return "A";
  }
  if (affiliation === "HOSTILE") {
    return "H";
  }
  if (affiliation === "SUSPECT") {
    return "S";
  }
  if (affiliation === "NEUTRAL") {
    return "N";
  }
  if (affiliation === "PENDING") {
    return "P";
  }
  return "U";
}

function getSidcDimension(objectType: ObjectType): string {
  if (objectType === "GROUND_UNIT") {
    return "G";
  }
  if (objectType === "UNKNOWN" || objectType === "INCIDENT" || objectType === "REPORT") {
    return "Z";
  }
  return "A";
}

function getSidcFunctionId(objectType: ObjectType): string {
  if (objectType === "UAV") {
    return "MFQ---";
  }
  if (objectType === "MISSILE_TRACK") {
    return "WM----";
  }
  return "------";
}
