import type { SituationLayer, SituationLayerId, SituationSourceDescriptor } from "./cop-data";

const technicalMobileLayerIds = new Set<SituationLayerId>(["mobile", "mobile_coverage"]);
const technicalMobileSourceIds = new Set(["mobile_coverage_model", "ctu_nettest", "osm_postgis", "osm_overpass"]);

export function toCitizenSituationLayerId(layerId: SituationLayerId): SituationLayerId {
  return technicalMobileLayerIds.has(layerId) ? "mobile_network" : layerId;
}

export function isCitizenSituationLayerId(layerId: SituationLayerId): boolean {
  return !technicalMobileLayerIds.has(layerId);
}

export function normalizeCitizenSituationLayerIds(layerIds: SituationLayerId[]): SituationLayerId[] {
  return Array.from(new Set(layerIds.map(toCitizenSituationLayerId).filter(isCitizenSituationLayerId)));
}

export function filterCitizenSituationLayers(layers: SituationLayer[]): SituationLayer[] {
  return layers.filter((layer) => isCitizenSituationLayerId(layer.layerId));
}

export function isTechnicalSituationSourceId(sourceId: string): boolean {
  return technicalMobileSourceIds.has(sourceId);
}

export function isTechnicalSituationSource(source: SituationSourceDescriptor): boolean {
  return isTechnicalSituationSourceId(source.sourceId);
}

export function filterCitizenSituationSources(sources: SituationSourceDescriptor[]): SituationSourceDescriptor[] {
  return sources.filter((source) => !isTechnicalSituationSource(source));
}

export function filterTechnicalSituationSources(sources: SituationSourceDescriptor[]): SituationSourceDescriptor[] {
  return sources.filter(isTechnicalSituationSource);
}

export function sanitizeCitizenSituationSourceIds(sourceIds: string[]): string[] {
  return Array.from(new Set(sourceIds.map((item) => item.trim()).filter(Boolean).filter((sourceId) => !isTechnicalSituationSourceId(sourceId)))).slice(0, 32);
}

export function resolveSituationSourcesForFetch(layerIds: SituationLayerId[], selectedSourceIds: string[]): string[] | undefined {
  const citizenLayerIds = normalizeCitizenSituationLayerIds(layerIds);
  const citizenSelectedSourceIds = sanitizeCitizenSituationSourceIds(selectedSourceIds);
  if (citizenSelectedSourceIds.length > 0) {
    return citizenSelectedSourceIds;
  }
  if (citizenLayerIds.length === 1 && citizenLayerIds[0] === "mobile_network") {
    return ["mobile_network_model"];
  }
  return undefined;
}

