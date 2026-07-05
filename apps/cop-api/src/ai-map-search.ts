import { randomUUID } from "node:crypto";
import type { AiCopQuery, AiCopResponse } from "@cop/ai-gateway";
import type { AiContextBbox, AiContextGeoFilter } from "./ai-context-index.js";
import type { MapCatalogLayer } from "./map-catalog.js";
import type { PlaceGeocodeResult } from "./place-geocoder.js";
import type { SituationFeature } from "./situation-data-source.js";

export interface AiMapSearchContext {
  contractVersion: "cop-ai-map-search-v1";
  generatedAt: string;
  query: Record<string, unknown>;
  results: AiMapSearchResult[];
  toolCall: Record<string, unknown>;
  warnings: string[];
}

export type AiMapSearchResult = Record<string, unknown>;

export interface AiMapAction {
  action: "focus-map";
  category?: string;
  distanceText?: string;
  entityId?: string;
  entityType?: string;
  label: string;
  lat: number;
  lon: number;
  title?: string;
  zoom?: number;
}

export interface AiMapSearchIntent {
  categoryIds: string[];
  layerIds: string[];
  placeQuery?: string;
  requested: boolean;
  searchTerms: string[];
}

export function inferAiMapSearchIntent(question: string, body: Record<string, unknown>): AiMapSearchIntent {
  const normalized = normalizeAiMapSearchText(question);
  const requested = /(?:^|\b)(najdi|najit|vyhledej|hledej|ukaz|ukaž|zobraz|kde je|kde jsou|nejbliz|nejblizsi|nejbli|nearest|closest|find|show)(?:\b|$)/u.test(normalized);
  const layerIds = new Set<string>();
  const categoryIds = new Set<string>();
  const searchTerms = new Set<string>();
  const addInfrastructureCategory = (layerId: string, categories: string[], terms: string[]) => {
    layerIds.add(layerId);
    categories.forEach((category) => categoryIds.add(category));
    terms.forEach((term) => searchTerms.add(term));
  };

  if (/(polic|bezpec|security|krade|kradez|zlod|crime)/u.test(normalized)) {
    addInfrastructureCategory("reference.infrastructure.emergency", ["police"], ["police", "security"]);
  }
  if (/(hasic|pozar|požar|pozarn|fire)/u.test(normalized)) {
    addInfrastructureCategory("reference.infrastructure.emergency", ["fire_station"], ["fire_station", "fire"]);
  }
  if (/(zachran|zachrann|ambulanc|zdravotnicka zachranna|zzs)/u.test(normalized)) {
    addInfrastructureCategory("reference.infrastructure.emergency", ["ambulance_station"], ["ambulance_station"]);
  }
  if (/(kryt|shelter|ukryt|evakuacn|shromazd|assembly)/u.test(normalized)) {
    addInfrastructureCategory("reference.infrastructure.emergency", ["shelter", "assembly_point"], ["shelter", "assembly_point"]);
  }
  if (/(defibrilator|aed|defib)/u.test(normalized)) {
    addInfrastructureCategory("reference.infrastructure.emergency", ["defibrillator"], ["defibrillator"]);
  }
  if (/(sirena|sireny|siren)/u.test(normalized)) {
    addInfrastructureCategory("reference.infrastructure.emergency", ["siren"], ["siren"]);
  }
  if (/(nemocnic|hospital|klinik|clinic|lekar|lékar|doktor|doctors|lekarn|lékarn|pharmacy|zdravotnictv)/u.test(normalized)) {
    addInfrastructureCategory("reference.infrastructure.healthcare", ["hospital", "clinic", "doctors", "pharmacy"], ["healthcare"]);
  }

  aiMapSearchTermsFromQuestion(question).forEach((term) => searchTerms.add(term));

  const bodyPlaceQuery = aiMapPlaceQueryFromBody(body);
  const placeQuery = requested && layerIds.size === 0
    ? bodyPlaceQuery ?? aiMapPlaceQueryFromQuestion(question) ?? aiPlaceQueryFromQuestion(question)
    : bodyPlaceQuery ?? aiPlaceQueryFromQuestion(question);

  return {
    categoryIds: Array.from(categoryIds),
    layerIds: Array.from(layerIds),
    ...(placeQuery ? { placeQuery } : {}),
    requested,
    searchTerms: Array.from(searchTerms)
  };
}

export function bboxForAiMapSearchGeoFilter(geoFilter: AiContextGeoFilter | undefined): AiContextBbox | undefined {
  if (geoFilter?.bbox) {
    return geoFilter.bbox;
  }
  if (!geoFilter?.center) {
    return undefined;
  }
  const radiusKm = clampNumber(geoFilter.center.radiusKm ?? 30, 1, 80);
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / Math.max(12, 111.32 * Math.cos((geoFilter.center.lat * Math.PI) / 180));
  return {
    east: roundCoordinate(clampNumber(geoFilter.center.lon + lonDelta, -180, 180)),
    north: roundCoordinate(clampNumber(geoFilter.center.lat + latDelta, -90, 90)),
    south: roundCoordinate(clampNumber(geoFilter.center.lat - latDelta, -90, 90)),
    west: roundCoordinate(clampNumber(geoFilter.center.lon - lonDelta, -180, 180))
  };
}

export function aiSituationFeatureMatchesMapSearchIntent(feature: SituationFeature, intent: AiMapSearchIntent): boolean {
  return aiMapFeatureMatchesMapSearchIntent(feature, intent);
}

export function aiMapCatalogLayerMatchesMapSearchIntent(layer: MapCatalogLayer, intent: AiMapSearchIntent): boolean {
  if (intent.layerIds.length > 0) {
    return intent.layerIds.includes(layer.layerId);
  }
  const candidates = aiMapCatalogLayerCategoryCandidates(layer);
  if (intent.categoryIds.length > 0) {
    return intent.categoryIds.some((categoryId) =>
      candidates.some((candidate) => aiCategoryCandidateMatchesIntent(candidate, categoryId))
    );
  }
  const terms = aiMapSearchMeaningfulTerms(intent.searchTerms);
  if (terms.length === 0) {
    return true;
  }
  const haystack = aiMapCatalogLayerSearchHaystack(layer);
  return terms.some((term) => aiMapSearchTermMatchesHaystack(term, haystack));
}

export function aiMapFeatureMatchesMapSearchIntent(feature: unknown, intent: AiMapSearchIntent): boolean {
  if (intent.categoryIds.length === 0) {
    const terms = aiMapSearchMeaningfulTerms(intent.searchTerms);
    if (terms.length === 0) {
      return true;
    }
    const haystack = aiMapFeatureSearchHaystack(feature);
    return terms.every((term) => aiMapSearchTermMatchesHaystack(term, haystack));
  }
  const candidates = aiMapFeatureCategoryCandidates(feature);
  return intent.categoryIds.some((categoryId) =>
    candidates.some((candidate) => aiCategoryCandidateMatchesIntent(candidate, categoryId))
  );
}

export function summarizeSituationMapFeatureForAi(
  feature: SituationFeature,
  geoFilter: AiContextGeoFilter | undefined
): AiMapSearchResult {
  return summarizeMapFeatureForAi(feature, geoFilter, "sim.situation-data") ?? {};
}

export function summarizeMapFeatureCollectionForAi(
  collection: unknown,
  geoFilter: AiContextGeoFilter | undefined,
  intent: AiMapSearchIntent,
  sourceSystemId: string
): AiMapSearchResult[] {
  if (!isRecord(collection) || !Array.isArray(collection.features)) {
    return [];
  }
  return collection.features
    .filter((feature) => aiMapFeatureMatchesMapSearchIntent(feature, intent))
    .map((feature) => summarizeMapFeatureForAi(feature, geoFilter, sourceSystemId))
    .filter((result): result is AiMapSearchResult => result !== undefined);
}

export function summarizeMapFeatureForAi(
  feature: unknown,
  geoFilter: AiContextGeoFilter | undefined,
  sourceSystemId?: string
): AiMapSearchResult | undefined {
  if (!isRecord(feature)) {
    return undefined;
  }
  const properties = isRecord(feature.properties) ? feature.properties : {};
  const location = locationFromMapFeatureRecord(feature);
  if (!location) {
    return undefined;
  }
  const distanceM = mapSearchDistanceM(geoFilter, location);
  const title = optionalText(properties.label)
    ?? optionalText(properties.title)
    ?? optionalText(properties.name)
    ?? optionalText(properties.summary)
    ?? optionalText(properties.category)
    ?? String(feature.id ?? optionalText(properties.featureId) ?? "mapový prvek");
  const sourceId = optionalText(properties.sourceId);
  const providerId = optionalText(properties.providerId);
  const sourceSystemIds = Array.from(new Set([sourceSystemId, providerId, sourceId].filter((value): value is string => Boolean(value))));
  return compactRecord({
    category: optionalText(properties.category) ?? optionalText(properties.typeCode),
    detail: optionalText(properties.summary) ?? optionalText(properties.description) ?? optionalText(properties.detail),
    distanceM,
    distanceText: formatAiMapDistance(distanceM),
    layer: optionalText(properties.layer),
    layerId: optionalText(properties.layerId),
    location,
    mapFeatureId: optionalText(properties.featureId)
      ?? optionalText(properties.reportId)
      ?? optionalText(properties.objectId)
      ?? String(feature.id ?? title),
    priorityScore: aiMapFeaturePriorityScore(optionalText(properties.category), distanceM),
    providerLayerId: optionalText(properties.providerLayerId),
    sourceName: optionalText(properties.sourceName) ?? optionalText(properties.groupName) ?? sourceSystemId,
    sourceSystemIds,
    status: optionalText(properties.status) ?? "map-result",
    title,
    type: "mapFeature",
    updatedAt: optionalText(properties.observedAt)
      ?? optionalText(properties.updatedAt)
      ?? optionalText(properties.generatedAt)
      ?? optionalText(properties.receivedAt)
  });
}

export function summarizeGeocodedPlaceForAi(
  place: PlaceGeocodeResult,
  geoFilter: AiContextGeoFilter | undefined
): AiMapSearchResult {
  const location = {
    lat: roundCoordinate(place.center[1]),
    lon: roundCoordinate(place.center[0])
  };
  const distanceM = mapSearchDistanceM(geoFilter, location);
  return compactRecord({
    bbox: place.bbox,
    category: place.kind ?? "place",
    detail: place.subtitle,
    distanceM,
    distanceText: formatAiMapDistance(distanceM),
    location,
    mapFeatureId: `place:${place.providerId}:${place.id}`,
    priorityScore: Math.round(clampNumber(0.38 + (place.importance ?? 0) * 0.25, 0, 1) * 1000) / 1000,
    sourceName: place.providerId,
    sourceSystemIds: ["geocoder", place.providerId],
    status: "map-result",
    title: place.displayName,
    type: "place"
  });
}

export function dedupeAiMapSearchResults(results: AiMapSearchResult[]): AiMapSearchResult[] {
  const byId = new Map<string, AiMapSearchResult>();
  for (const result of results) {
    const key = optionalText(result.mapFeatureId)
      ?? `${optionalText(result.title) ?? "map-result"}:${JSON.stringify(result.location ?? {})}`;
    if (!byId.has(key)) {
      byId.set(key, result);
    }
  }
  return Array.from(byId.values());
}

export function aiMapSearchResultCompare(left: AiMapSearchResult, right: AiMapSearchResult): number {
  const leftDistance = optionalFiniteNumber(left.distanceM, 0, 10_000_000);
  const rightDistance = optionalFiniteNumber(right.distanceM, 0, 10_000_000);
  if (leftDistance !== undefined && rightDistance !== undefined && leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }
  if (leftDistance !== undefined && rightDistance === undefined) {
    return -1;
  }
  if (leftDistance === undefined && rightDistance !== undefined) {
    return 1;
  }
  const leftPriority = optionalFiniteNumber(left.priorityScore, 0, 1) ?? 0;
  const rightPriority = optionalFiniteNumber(right.priorityScore, 0, 1) ?? 0;
  return rightPriority - leftPriority;
}

export function aiMapActionsFromMapSearchContext(context: AiMapSearchContext | undefined): AiMapAction[] {
  return (context?.results ?? [])
    .map(aiMapActionFromResult)
    .filter((action): action is AiMapAction => action !== undefined)
    .slice(0, 3);
}

export function aiMapSearchFallbackResponse(
  aiRequest: AiCopQuery,
  requestNow: Date,
  reason: string
): AiCopResponse | undefined {
  const context = isRecord(aiRequest.context) ? aiRequest.context : undefined;
  const mapSearch = isRecord(context?.mapSearch) ? context.mapSearch : undefined;
  const results = Array.isArray(mapSearch?.results) ? mapSearch.results.filter(isRecord) : [];
  const topResult = results[0];
  if (!topResult) {
    return undefined;
  }
  const mapActions = aiMapActionsFromMapSearchResults(results);
  const title = optionalText(topResult.title) ?? "mapový výsledek";
  const category = optionalText(topResult.category);
  const distanceText = optionalText(topResult.distanceText);
  const location = aiLocationFromRecord(topResult.location);
  const citationId = citationForAiMapSearchResult(context, topResult);
  const locationText = location ? `Souřadnice: ${location.lat}, ${location.lon}.` : undefined;
  const distanceSentence = distanceText ? `Vzdálenost od zadané polohy: ${distanceText}.` : undefined;
  const citationText = citationId ? `Zdroj: [${citationId}].` : "Zdroj: COP mapové vyhledávání.";
  const summary = [
    `Našel jsem v mapových datech COP: ${title}.`,
    category ? `Kategorie: ${category}.` : undefined,
    distanceSentence,
    locationText,
    citationText
  ].filter(Boolean).join(" ");
  return {
    auditId: randomUUID(),
    model: "map-search-fallback",
    policy: {
      allowed: true,
      reason: `AI provider fallback used deterministic COP map search. ${reason}`,
      redactionsApplied: false
    },
    provider: "local",
    requestId: aiRequest.requestId,
    result: {
      structured: {
        generatedAt: requestNow.toISOString(),
        mapActions,
        mapSearch: {
          resultCount: results.length,
          results: results.slice(0, 5)
        },
        mapSearchFallback: {
          reason,
          result: topResult,
          resultCount: results.length
        }
      },
      summary
    },
    status: "COMPLETED"
  };
}

function aiMapActionsFromMapSearchResults(results: Record<string, unknown>[]): AiMapAction[] {
  return results
    .map(aiMapActionFromResult)
    .filter((action): action is AiMapAction => action !== undefined)
    .slice(0, 3);
}

function aiMapActionFromResult(result: Record<string, unknown>): AiMapAction | undefined {
  const location = aiLocationFromRecord(result.location);
  if (!location) {
    return undefined;
  }
  const title = optionalText(result.title);
  const category = optionalText(result.category);
  const distanceText = optionalText(result.distanceText);
  const entityId = optionalText(result.mapFeatureId);
  const entityType = optionalText(result.type);
  const labelBase = title ?? category ?? "mapový výsledek";
  const label = distanceText
    ? `Zobrazit na mapě: ${labelBase} (${distanceText})`
    : `Zobrazit na mapě: ${labelBase}`;
  return {
    action: "focus-map",
    ...(category ? { category } : {}),
    ...(distanceText ? { distanceText } : {}),
    ...(entityId ? { entityId } : {}),
    ...(entityType ? { entityType } : {}),
    label,
    lat: location.lat,
    lon: location.lon,
    ...(title ? { title } : {}),
    zoom: 16
  };
}

function normalizeAiMapSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ");
}

function aiMapSearchTermsFromQuestion(question: string): string[] {
  const normalized = normalizeAiMapSearchText(question)
    .replace(/^\/(?:ai|fast|reasoning|reason|auto)\b[\s:,-]*/u, "")
    .replace(/^@(?:cop\s+ai|ai)\b[\s:,-]*/u, "")
    .replace(/\b(?:najdi|najit|vyhledej|hledej|ukaz|zobraz|kde|je|jsou|nearest|closest|find|show)\b/gu, " ")
    .replace(/\b(?:nejblizsi|nejblizsiho|nejbliz|blizko|pobliz|okoli|okolo|kolem|moje|moji|me|mé|poloha|polohy|aktualni|soucasne|mapa|mape|mapy)\b/gu, " ")
    .replace(/\b(?:od|do|u|v|ve|na|pro|mi|mi prosim|prosim|prosím|the|a|an|near|from|my|current|location)\b/gu, " ");
  const terms = normalized
    .split(/[^a-z0-9]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !isAiMapSearchStopword(term))
    .map(aiMapSearchTokenStem);
  return Array.from(new Set(terms)).slice(0, 8);
}

function aiMapSearchMeaningfulTerms(terms: string[]): string[] {
  return Array.from(new Set(terms
    .map((term) => normalizeAiMapSearchText(term))
    .flatMap((term) => term.split(/[^a-z0-9]+/u))
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !isAiMapSearchStopword(term))
    .map(aiMapSearchTokenStem)))
    .slice(0, 8);
}

function isAiMapSearchStopword(term: string): boolean {
  return new Set([
    "aktualni",
    "blizko",
    "closest",
    "current",
    "find",
    "hledej",
    "jsou",
    "kde",
    "kolem",
    "mapa",
    "mape",
    "mapy",
    "moje",
    "moji",
    "najdi",
    "najit",
    "near",
    "nearest",
    "nejbliz",
    "nejblizsi",
    "okoli",
    "okolo",
    "pobliz",
    "poloha",
    "polohy",
    "prosim",
    "show",
    "soucasne",
    "ukaz",
    "vyhledej",
    "zobraz"
  ]).has(term);
}

function aiMapSearchTokenStem(term: string): string {
  if (term.length <= 4) {
    return term;
  }
  return term
    .replace(/(ovou|eho|eho|ymi|ami|emi|ich|ech|ove|ova|ovy|ska|ske|sky)$/u, "")
    .replace(/(nou|ou|em|im|ho|mu|mi|ni|ci|ce|ku|ka|ky|ek|ik)$/u, "")
    .replace(/(a|e|i|u|y)$/u, "");
}

function aiMapSearchTermMatchesHaystack(term: string, haystack: string): boolean {
  return aiMapSearchTokenVariants(term).some((variant) => variant.length >= 3 && haystack.includes(variant));
}

function aiMapSearchTokenVariants(term: string): string[] {
  const normalized = aiMapSearchTokenStem(normalizeAiMapSearchText(term));
  const variants = new Set<string>([normalized]);
  if (/^(vodomer|hydro|limnigraf|hladin|reka|river)/u.test(normalized)) {
    ["vodomer", "hydro", "limnigraf", "hladin", "water", "river", "gauge", "chmi"].forEach((value) => variants.add(value));
  }
  if (/^(zastav|bus|autobus|vlak|train|tram|pid|ids)/u.test(normalized)) {
    ["zastav", "stop", "station", "transit", "traffic", "pid", "idsjmk", "train"].forEach((value) => variants.add(value));
  }
  if (/^(most|bridge)/u.test(normalized)) {
    ["most", "bridge"].forEach((value) => variants.add(value));
  }
  if (/^(kamera|webcam|camera)/u.test(normalized)) {
    ["kamera", "camera", "webcam"].forEach((value) => variants.add(value));
  }
  if (/^(report|hlaseni|udalost|incident)/u.test(normalized)) {
    ["report", "hlaseni", "community", "incident", "udalost"].forEach((value) => variants.add(value));
  }
  if (/^(pocasi|meteorolog|weather|radar|srazk|dest|teplot|vitr)/u.test(normalized)) {
    ["pocasi", "weather", "radar", "srazk", "precip", "teplot", "wind", "vitr"].forEach((value) => variants.add(value));
  }
  if (/^(mobil|signal|bts|sit|site|vez|tower)/u.test(normalized)) {
    ["mobil", "mobile", "signal", "bts", "tower", "network", "coverage"].forEach((value) => variants.add(value));
  }
  return Array.from(variants);
}

function aiMapCatalogLayerSearchHaystack(layer: MapCatalogLayer): string {
  return normalizeAiMapSearchText([
    layer.description,
    layer.groupId,
    layer.label,
    layer.layerId,
    layer.preferredProviderId,
    layer.query.providerId,
    layer.query.providerLayerIds?.join(" "),
    layer.query.providerSourceIds?.join(" "),
    layer.query.streamId,
    layer.role,
    layer.styleProfile
  ].filter((value): value is string => typeof value === "string" && value.trim() !== "").join(" "));
}

function aiMapCatalogLayerCategoryCandidates(layer: MapCatalogLayer): string[] {
  return [
    layer.description,
    layer.groupId,
    layer.label,
    layer.layerId,
    layer.preferredProviderId,
    layer.query.providerId,
    ...(layer.query.categoryIds ?? []),
    ...(layer.query.providerLayerIds ?? []),
    ...(layer.query.providerSourceIds ?? [])
  ]
    .map((value) => typeof value === "string" ? normalizeCategoryId(value) : "")
    .filter((value) => value.length > 0);
}

function aiMapFeatureSearchHaystack(feature: unknown): string {
  if (!isRecord(feature)) {
    return "";
  }
  const values: string[] = [];
  collectAiMapSearchValues(feature.id, values);
  collectAiMapSearchValues(feature.properties, values);
  return normalizeAiMapSearchText(values.join(" "));
}

function collectAiMapSearchValues(value: unknown, output: string[], depth = 0): void {
  if (output.length >= 80 || depth > 3 || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    if (value.length <= 200 && !/^https?:\/\//iu.test(value)) {
      output.push(value);
    }
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((item) => collectAiMapSearchValues(item, output, depth + 1));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    output.push(key);
    collectAiMapSearchValues(entry, output, depth + 1);
  }
}

function aiMapPlaceQueryFromQuestion(question: string): string | undefined {
  let text = question.replace(/\s+/gu, " ").trim();
  text = text
    .replace(/^\/(?:ai|fast|reasoning|reason|auto)\b[\s:,-]*/iu, "")
    .replace(/^@(?:cop\s+ai|ai)\b[\s:,-]*/iu, "")
    .replace(/^(?:najdi|najít|najit|vyhledej|hledej|ukaž|ukaz|zobraz)\s+(?:mi\s+)?/iu, "")
    .replace(/^kde\s+(?:je|jsou)\s+/iu, "")
    .replace(/\b(?:na\s+mapě|na\s+mape|v\s+mapě|v\s+mape)\b/igu, "")
    .replace(/\b(?:od\s+mé\s+polohy|od\s+me\s+polohy|u\s+mě|u\s+me|nejbližší|nejblizsi|nejbližšího|nejblizsiho|nejbližší\s+k)\b/igu, "")
    .trim();
  if (text.length < 3 || isAiGenericPlaceQuery(text)) {
    return undefined;
  }
  if (/(polic|hasi|zachran|ambulanc|nemocnic|lekar|lekarn|kryt|defibrilator|sirena)/iu.test(text)) {
    return undefined;
  }
  return text.slice(0, 120);
}

function aiPlaceQueryFromQuestion(question: string): string | undefined {
  const text = question.replace(/\s+/gu, " ").trim();
  const patterns = [
    /\b(?:ve|v|u|okolo|okolí|poblíž|blízko|kolem|pro)\s+(?<place>[^?.!,;\n]{3,120})/iu,
    /\bsituace\s+(?<place>[^?.!,;\n]{3,120})/iu
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const rawPlace = match?.groups?.place;
    if (!rawPlace) {
      continue;
    }
    const place = rawPlace
      .replace(/\b(?:vytvoř|vytvor|udělej|udelej|shrň|shrn|situational|awareness|prosím|prosim|co\b|jaká\b|jaka\b|jaký\b|jaky\b).*$/iu, "")
      .trim();
    if (place.length >= 3 && !isAiGenericPlaceQuery(place)) {
      return place.slice(0, 120);
    }
  }
  return undefined;
}

function aiMapPlaceQueryFromBody(body: Record<string, unknown>): string | undefined {
  const geoContext = isRecord(body.geoContext) ? body.geoContext : {};
  return optionalTrimmedString(geoContext.place ?? geoContext.query ?? body.placeQuery ?? body.place, 120);
}

function isAiGenericPlaceQuery(value: string): boolean {
  const normalized = value.toLocaleLowerCase("cs-CZ");
  return /^(cop|chatu?|skupině|skupine|místnosti|mistnosti|aplikaci|kontextu|mapě|mape)$/u.test(normalized);
}

function locationFromMapFeatureRecord(feature: Record<string, unknown>): { lat: number; lon: number } | undefined {
  const geometry = isRecord(feature.geometry) ? feature.geometry : undefined;
  const coordinate = firstLonLatCoordinate(geometry?.coordinates);
  return coordinate
    ? {
        lat: roundCoordinate(coordinate[1]),
        lon: roundCoordinate(coordinate[0])
      }
    : undefined;
}

function firstLonLatCoordinate(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    return [Number(value[0]), Number(value[1])];
  }
  for (const item of value) {
    const coordinate = firstLonLatCoordinate(item);
    if (coordinate) {
      return coordinate;
    }
  }
  return undefined;
}

function mapSearchDistanceM(
  geoFilter: AiContextGeoFilter | undefined,
  location: { lat: number; lon: number } | undefined
): number | undefined {
  if (!geoFilter?.center || !location) {
    return undefined;
  }
  return Math.round(distanceMetersBetween(geoFilter.center, location));
}

function distanceMetersBetween(
  left: { lat: number; lon: number },
  right: { lat: number; lon: number }
): number {
  const earthRadiusM = 6_371_000;
  const lat1 = (left.lat * Math.PI) / 180;
  const lat2 = (right.lat * Math.PI) / 180;
  const deltaLat = ((right.lat - left.lat) * Math.PI) / 180;
  const deltaLon = ((right.lon - left.lon) * Math.PI) / 180;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatAiMapDistance(distanceM: number | undefined): string | undefined {
  if (distanceM === undefined) {
    return undefined;
  }
  if (distanceM < 1000) {
    return `${distanceM} m`;
  }
  return `${Math.round(distanceM / 100) / 10} km`;
}

function aiMapFeaturePriorityScore(category: string | undefined, distanceM: number | undefined): number {
  const normalized = normalizeAiMapSearchText(category ?? "");
  let score = 0.36;
  if (/(police|fire_station|ambulance_station|hospital|clinic|doctors|pharmacy|shelter|defibrillator|siren)/u.test(normalized)) {
    score += 0.18;
  }
  if (distanceM !== undefined) {
    if (distanceM <= 1000) {
      score += 0.2;
    } else if (distanceM <= 5000) {
      score += 0.15;
    } else if (distanceM <= 15000) {
      score += 0.08;
    }
  }
  return Math.round(clampNumber(score, 0, 1) * 1000) / 1000;
}

function aiMapFeatureCategoryCandidates(feature: unknown): string[] {
  const properties = isRecord(feature) && isRecord(feature.properties) ? feature.properties : {};
  return [
    properties.category,
    properties.iconHint,
    properties.label,
    properties.layer,
    properties.layerId,
    properties.providerLayerId,
    properties.providerId,
    properties.sourceId,
    properties.sourceName,
    properties.summary,
    properties.typeCode
  ]
    .map((value) => typeof value === "string" ? normalizeCategoryId(value) : "")
    .filter((value) => value.length > 0);
}

function aiCategoryCandidateMatchesIntent(candidate: string, intentCategoryId: string): boolean {
  const intent = normalizeCategoryId(intentCategoryId);
  if (candidate === intent || candidate.includes(intent)) {
    return true;
  }
  const aliases = aiMapCategoryAliases(intent);
  return aliases.some((alias) => candidate === alias || candidate.includes(alias));
}

function aiMapCategoryAliases(categoryId: string): string[] {
  switch (categoryId) {
    case "police":
      return ["police", "policie", "polic", "security_police", "bezpecnost"];
    case "fire_station":
      return ["fire_station", "fire", "hasic", "hasici", "pozar"];
    case "ambulance_station":
      return ["ambulance_station", "ambulance", "zachran", "zachranna", "zzs"];
    case "defibrillator":
      return ["defibrillator", "defibrilator", "aed", "defib"];
    case "shelter":
      return ["shelter", "kryt", "ukryt"];
    case "assembly_point":
      return ["assembly_point", "shromazd", "evakuac"];
    case "siren":
      return ["siren", "sirena", "sireny"];
    default:
      return [categoryId];
  }
}

function citationForAiMapSearchResult(
  context: Record<string, unknown> | undefined,
  result: Record<string, unknown>
): string | undefined {
  const priorityContext = isRecord(context?.priorityContext) ? context.priorityContext : undefined;
  const citations = Array.isArray(priorityContext?.citations) ? priorityContext.citations.filter(isRecord) : [];
  const mapFeatureId = optionalText(result.mapFeatureId);
  const citation = citations.find((item) => mapFeatureId && optionalText(item.entityId) === mapFeatureId)
    ?? citations.find((item) => optionalText(item.entityType) === "mapFeature");
  return optionalText(citation?.citationId);
}

function aiLocationFromRecord(value: unknown): { lat: number; lon: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  return lat !== undefined && lon !== undefined
    ? { lat: roundCoordinate(lat), lon: roundCoordinate(lon) }
    : undefined;
}

function normalizeCategoryId(value: string): string {
  return normalizeAiMapSearchText(value).replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && !(Array.isArray(entry) && entry.length === 0))
  );
}

function optionalFiniteNumber(value: unknown, min: number, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampNumber(parsed, min, max) : undefined;
}

function optionalTrimmedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
