import type { Affiliation, Domain, ObjectStatus, ObjectType } from "./types.js";

export interface SymbolCatalogEntry {
  objectType: ObjectType;
  affiliation: Affiliation | "*";
  domain: Domain | "*";
  status: ObjectStatus | "*";
  symbolCode: string;
  label: string;
}

export const app6MappingCatalog: SymbolCatalogEntry[] = [
  {
    objectType: "AIRCRAFT",
    affiliation: "FRIEND",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-FRIEND-AIRCRAFT-ACTIVE",
    label: "Friendly aircraft"
  },
  {
    objectType: "AIRCRAFT",
    affiliation: "ASSUMED_FRIEND",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-ASSUMED-FRIEND-AIRCRAFT-ACTIVE",
    label: "Assumed friendly aircraft"
  },
  {
    objectType: "AIRCRAFT",
    affiliation: "HOSTILE",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-HOSTILE-AIRCRAFT-ACTIVE",
    label: "Hostile aircraft"
  },
  {
    objectType: "AIRCRAFT",
    affiliation: "SUSPECT",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-SUSPECT-AIRCRAFT-ACTIVE",
    label: "Suspect aircraft"
  },
  {
    objectType: "AIRCRAFT",
    affiliation: "UNKNOWN",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-UNKNOWN-AIRCRAFT-ACTIVE",
    label: "Unknown aircraft"
  },
  {
    objectType: "UAV",
    affiliation: "FRIEND",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-FRIEND-UAV-ACTIVE",
    label: "Friendly UAV"
  },
  {
    objectType: "UAV",
    affiliation: "ASSUMED_FRIEND",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-ASSUMED-FRIEND-UAV-ACTIVE",
    label: "Assumed friendly UAV"
  },
  {
    objectType: "UAV",
    affiliation: "HOSTILE",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-HOSTILE-UAV-ACTIVE",
    label: "Hostile UAV"
  },
  {
    objectType: "UAV",
    affiliation: "SUSPECT",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-SUSPECT-UAV-ACTIVE",
    label: "Suspect UAV"
  },
  {
    objectType: "UAV",
    affiliation: "UNKNOWN",
    domain: "AIR",
    status: "ACTIVE",
    symbolCode: "APP6-AIR-UNKNOWN-UAV-ACTIVE",
    label: "Unknown UAV"
  },
  {
    objectType: "MISSILE_TRACK",
    affiliation: "*",
    domain: "AIR",
    status: "*",
    symbolCode: "APP6-AIR-TRACK-GENERIC",
    label: "Air track"
  },
  {
    objectType: "GROUND_UNIT",
    affiliation: "FRIEND",
    domain: "LAND",
    status: "ACTIVE",
    symbolCode: "APP6-LAND-FRIEND-UNIT-ACTIVE",
    label: "Friendly ground unit"
  },
  {
    objectType: "RESCUE_ASSET",
    affiliation: "*",
    domain: "RESCUE",
    status: "*",
    symbolCode: "APP6-RESCUE-ASSET-GENERIC",
    label: "Rescue asset"
  },
  {
    objectType: "INCIDENT",
    affiliation: "*",
    domain: "*",
    status: "*",
    symbolCode: "APP6-INCIDENT-GENERIC",
    label: "Incident"
  },
  {
    objectType: "REPORT",
    affiliation: "*",
    domain: "*",
    status: "*",
    symbolCode: "APP6-REPORT-GENERIC",
    label: "Report"
  }
];

export const localExtensionCatalog: SymbolCatalogEntry[] = [
  {
    objectType: "UNKNOWN",
    affiliation: "*",
    domain: "*",
    status: "*",
    symbolCode: "LOCAL-COP-UNKNOWN-OBJECT",
    label: "Local fallback unknown object"
  }
];
