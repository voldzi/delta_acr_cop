import type { AoiRule } from "./alerts.js";
import type { CommunityReportRecord } from "./community-report-store.js";
import type { SafetyFeature, SafetyGeometry } from "./safety-data-source.js";

export type CopNotificationType = "community.report" | "safety.alert";
export type CopNotificationSeverity = "advisory" | "critical" | "info" | "warning";
export type CopNotificationPriority = "high" | "low" | "normal" | "time_sensitive";

export interface CopNotificationAudience {
  areaIds?: string[];
  groupIds?: string[];
  userIds?: string[];
}

export interface LocalizedNotificationText {
  cs: string;
  en?: string;
}

export interface CopNotificationSource {
  featureId: string;
  layerId: string;
  providerId: string;
  sourceName?: string;
}

export interface CopNotificationRequest {
  audience: CopNotificationAudience;
  body: LocalizedNotificationText;
  deepLink: string;
  expiresAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
  priority: CopNotificationPriority;
  severity: CopNotificationSeverity;
  source: CopNotificationSource;
  title: LocalizedNotificationText;
  type: CopNotificationType;
}

export interface CopNotificationDecision {
  contractVersion: "cop-notification-decision-v1";
  decisionId: string;
  idempotencyKey: string;
  notification: CopNotificationRequest;
  reason: string;
  relevance: {
    matchedAoiRuleIds: string[];
    source: "community-group" | "current-location" | "explicit-audience" | "none" | "watched-area";
  };
  shouldSend: boolean;
}

export interface SafetyNotificationContext {
  actor?: {
    subjectId: string;
  };
  audience?: CopNotificationAudience;
  currentLocation?: {
    lat: number;
    lon: number;
    radiusKm?: number;
  };
  now: Date;
  watchedAreas?: AoiRule[];
}

export function buildCommunityReportNotificationDecision(
  report: CommunityReportRecord,
  requestNow: Date,
  audienceOverride?: CopNotificationAudience
): CopNotificationDecision {
  const severity = normalizeNotificationSeverity(report.properties.hazardSeverity ?? report.properties.severity) ?? "advisory";
  const groupId = typeof report.properties.groupId === "string" ? report.properties.groupId : undefined;
  const audience = normalizeAudience({
    ...audienceOverride,
    groupIds: [...(audienceOverride?.groupIds ?? []), ...(groupId ? [groupId] : [])]
  });
  const activeStatus = report.status === "submitted" || report.status === "published";
  const expired = isExpired(timestampProperty(report.properties.validUntil), requestNow);
  const shouldSend = activeStatus && !expired && isCommunityPushSeverity(severity) && hasAudience(audience);
  const reason = !activeStatus
    ? "Community report is not submitted or published."
    : expired
      ? "Community report validity has expired."
      : !isCommunityPushSeverity(severity)
        ? "Community report severity is informational."
        : !hasAudience(audience)
          ? "Community report has no group, user or area audience."
          : "Community report is eligible for CSM Messaging notification.";
  const sourceFeatureId = `community:${report.reportId}`;
  return {
    contractVersion: "cop-notification-decision-v1",
    decisionId: createDecisionId("community", report.reportId, report.updatedAt),
    idempotencyKey: `cop.community-report:${report.reportId}:${report.submittedAt ?? report.updatedAt}`,
    notification: {
      audience,
      body: {
        cs: "Otevřete CSM pro detail, polohu a sdílená média.",
        en: "Open CSM for details, location and shared media."
      },
      deepLink: `csm://map/report/${encodeURIComponent(report.reportId)}`,
      ...(timestampProperty(report.properties.validUntil) ? { expiresAt: timestampProperty(report.properties.validUntil) } : {}),
      metadata: compactMetadata({
        category: report.category,
        reportId: report.reportId,
        visibility: report.visibility
      }),
      priority: priorityForSeverity(severity),
      severity,
      source: {
        featureId: sourceFeatureId,
        layerId: "public.community.reports",
        providerId: "cop.community",
        sourceName: "Community reports"
      },
      title: {
        cs: report.title,
        en: report.title
      },
      type: "community.report"
    },
    reason,
    relevance: {
      matchedAoiRuleIds: [],
      source: groupId ? "community-group" : hasAudience(audience) ? "explicit-audience" : "none"
    },
    shouldSend
  };
}

export function buildSafetyFeatureNotificationDecision(
  feature: SafetyFeature,
  context: SafetyNotificationContext
): CopNotificationDecision {
  const candidate = evaluateSafetyFeatureCandidate(feature, context.now);
  const audienceResult = resolveSafetyAudience(feature, context);
  const shouldSend = candidate.ok && hasAudience(audienceResult.audience);
  const reason = candidate.ok
    ? hasAudience(audienceResult.audience)
      ? "Safety feature is relevant to the selected audience."
      : "Safety feature has no matching user, group or watched-area audience."
    : candidate.reason;
  const properties = feature.properties;
  const featureId = properties.featureId;
  const layerId = publicSafetyLayerId(properties.layer, properties.layerId);
  const sourceName = properties.sourceName ?? properties.source ?? properties.sourceId;
  const validFrom = properties.validFrom ?? properties.effectiveAt ?? properties.observedAt ?? properties.updatedAt ?? "";
  const validUntil = properties.validUntil ?? properties.expiresAt ?? "";
  const severity = safetyFeatureNotificationSeverity(properties) ?? "info";
  const titleCs = safetyTitle(properties, severity, "cs");
  const titleEn = safetyTitle(properties, severity, "en") ?? titleCs;
  const presentation = safetyPresentation(properties);
  return {
    contractVersion: "cop-notification-decision-v1",
    decisionId: createDecisionId("safety", featureId, `${validFrom}:${validUntil}`),
    idempotencyKey: `sim.safety-data:${layerId}:${featureId}:${validFrom}:${validUntil}`,
    notification: {
      audience: audienceResult.audience,
      body: {
        cs: safeSafetyBody(properties, "cs") ?? "Otevřete CSM pro aktuální detail výstrahy.",
        en: safeSafetyBody(properties, "en") ?? "Open CSM for the current warning detail."
      },
      deepLink: `csm://map/alert/${encodeURIComponent(featureId)}`,
      ...(validUntil ? { expiresAt: validUntil } : {}),
      metadata: compactMetadata({
        certainty: properties.certainty,
        confidence: typeof properties.confidence === "number" ? properties.confidence : undefined,
        iconKey: stringRecordValue(presentation, "iconKey"),
        sourceCode: safetySourceCode(properties),
        sourceSystem: safetySourceSystem(properties),
        styleKey: stringRecordValue(presentation, "styleKey"),
        typeCode: safetyTypeCode(properties),
        urgency: properties.urgency
      }),
      priority: priorityForSeverity(severity),
      severity,
      source: {
        featureId,
        layerId,
        providerId: "sim.safety-data",
        ...(sourceName ? { sourceName } : {})
      },
      title: {
        cs: titleCs,
        en: titleEn
      },
      type: "safety.alert"
    },
    reason,
    relevance: {
      matchedAoiRuleIds: audienceResult.matchedAoiRuleIds,
      source: audienceResult.source
    },
    shouldSend
  };
}

export function evaluateSafetyFeatureCandidate(feature: SafetyFeature, requestNow: Date): { ok: boolean; reason: string } {
  const properties = feature.properties;
  const layerId = publicSafetyLayerId(properties.layer, properties.layerId);
  const severity = safetyFeatureNotificationSeverity(properties);
  if (!properties.featureId) {
    return { ok: false, reason: "Safety feature has no stable featureId." };
  }
  if (layerId === "public.boundary.admin") {
    return { ok: false, reason: "Boundary reference layers are not citizen safety alerts." };
  }
  if (properties.stale === true) {
    return { ok: false, reason: "Safety feature is stale." };
  }
  if (safetyNotificationEligible(properties) === false) {
    return { ok: false, reason: "Safety feature is not eligible for notification by provider policy." };
  }
  if (isExpired(properties.validUntil ?? properties.expiresAt, requestNow)) {
    return { ok: false, reason: "Safety feature validity has expired." };
  }
  if (severity !== "warning" && severity !== "critical") {
    return { ok: false, reason: "Safety feature severity is below push threshold." };
  }
  return { ok: true, reason: "Safety feature is eligible for notification evaluation." };
}

function resolveSafetyAudience(feature: SafetyFeature, context: SafetyNotificationContext): {
  audience: CopNotificationAudience;
  matchedAoiRuleIds: string[];
  source: CopNotificationDecision["relevance"]["source"];
} {
  const explicitAudience = normalizeAudience(context.audience ?? {});
  if (hasAudience(explicitAudience)) {
    return {
      audience: explicitAudience,
      matchedAoiRuleIds: [],
      source: "explicit-audience"
    };
  }

  const matchedAoiRuleIds = (context.watchedAreas ?? [])
    .filter((rule) => rule.enabled && safetyFeatureTouchesAoi(feature.geometry, rule))
    .map((rule) => rule.id);
  if (context.actor && matchedAoiRuleIds.length > 0) {
    return {
      audience: normalizeAudience({
        areaIds: matchedAoiRuleIds,
        userIds: [context.actor.subjectId]
      }),
      matchedAoiRuleIds,
      source: "watched-area"
    };
  }

  if (context.actor && context.currentLocation && safetyFeatureTouchesCurrentLocation(feature.geometry, context.currentLocation)) {
    return {
      audience: normalizeAudience({
        userIds: [context.actor.subjectId]
      }),
      matchedAoiRuleIds: [],
      source: "current-location"
    };
  }

  return {
    audience: {},
    matchedAoiRuleIds: [],
    source: "none"
  };
}

function safetyFeatureTouchesAoi(geometry: SafetyGeometry, rule: AoiRule): boolean {
  const featureBbox = geometryBbox(geometry);
  if (!featureBbox) {
    return false;
  }
  if (rule.polygon) {
    const ruleBbox = coordinateBbox(rule.polygon.coordinates.flat(1));
    return Boolean(ruleBbox && bboxesIntersect(featureBbox, ruleBbox));
  }
  const point = geometryRepresentativePoint(geometry);
  if (!point) {
    return false;
  }
  return distanceKm(point.lat, point.lon, rule.lat, rule.lon) <= rule.radiusKm;
}

function safetyFeatureTouchesCurrentLocation(
  geometry: SafetyGeometry,
  location: { lat: number; lon: number; radiusKm?: number }
): boolean {
  const point = geometryRepresentativePoint(geometry);
  return Boolean(point && distanceKm(point.lat, point.lon, location.lat, location.lon) <= (location.radiusKm ?? 10));
}

function geometryRepresentativePoint(geometry: SafetyGeometry): { lat: number; lon: number } | undefined {
  if (geometry.type === "Point") {
    return { lat: geometry.coordinates[1], lon: geometry.coordinates[0] };
  }
  const bbox = geometryBbox(geometry);
  return bbox ? { lat: (bbox.south + bbox.north) / 2, lon: (bbox.west + bbox.east) / 2 } : undefined;
}

function geometryBbox(geometry: SafetyGeometry): { east: number; north: number; south: number; west: number } | undefined {
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return { east: lon, north: lat, south: lat, west: lon };
  }
  const coordinates = geometry.type === "Polygon"
    ? geometry.coordinates.flat(1)
    : geometry.coordinates.flat(2);
  return coordinateBbox(coordinates);
}

function coordinateBbox(coordinates: Array<[number, number]>): { east: number; north: number; south: number; west: number } | undefined {
  if (coordinates.length === 0) {
    return undefined;
  }
  const lons = coordinates.map((coordinate) => coordinate[0]).filter(Number.isFinite);
  const lats = coordinates.map((coordinate) => coordinate[1]).filter(Number.isFinite);
  if (lons.length === 0 || lats.length === 0) {
    return undefined;
  }
  return {
    east: Math.max(...lons),
    north: Math.max(...lats),
    south: Math.min(...lats),
    west: Math.min(...lons)
  };
}

function bboxesIntersect(
  a: { east: number; north: number; south: number; west: number },
  b: { east: number; north: number; south: number; west: number }
): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function distanceKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const radiusKm = 6371;
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function publicSafetyLayerId(layer: string, layerId: string | undefined): string {
  if (layerId?.startsWith("public.")) {
    return layerId;
  }
  if (layer === "weather_alerts" || layer === "warnings") {
    return "public.safety.weather_alerts";
  }
  if (layer === "fire") {
    return "public.safety.fire";
  }
  if (layer === "flood") {
    return "public.safety.flood";
  }
  if (layer === "boundary_admin") {
    return "public.boundary.admin";
  }
  return `public.safety.${layer}`;
}

function normalizeNotificationSeverity(value: unknown): CopNotificationSeverity | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "critical" || normalized === "warning" || normalized === "advisory" || normalized === "info") {
    return normalized;
  }
  if (normalized === "risk" || normalized === "watch") {
    return "warning";
  }
  return undefined;
}

function safetyFeatureNotificationSeverity(properties: SafetyFeature["properties"]): CopNotificationSeverity | undefined {
  if (properties.layer === "flood") {
    const fromStage = floodStageNotificationSeverity(properties.floodStage);
    if (fromStage) {
      return fromStage;
    }
  }
  return normalizeNotificationSeverity(properties.severity ?? properties.status);
}

function floodStageNotificationSeverity(value: unknown): CopNotificationSeverity | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value <= 0) {
    return "info";
  }
  if (value === 1) {
    return "advisory";
  }
  if (value === 2) {
    return "warning";
  }
  return "critical";
}

function isCommunityPushSeverity(severity: CopNotificationSeverity): boolean {
  return severity === "advisory" || severity === "warning" || severity === "critical";
}

function priorityForSeverity(severity: CopNotificationSeverity): CopNotificationPriority {
  if (severity === "critical") {
    return "high";
  }
  if (severity === "warning") {
    return "time_sensitive";
  }
  if (severity === "advisory") {
    return "normal";
  }
  return "low";
}

function safetyTitle(
  properties: SafetyFeature["properties"],
  severity: CopNotificationSeverity,
  locale: "cs" | "en"
): string {
  const title = localizedSafetyString(properties, locale, "headline", "title", "label", "name")
    ?? safetyPresentationString(properties, "label", "title")
    ?? properties.headline
    ?? humanizeSafetyTypeCode(safetyTypeCode(properties))
    ?? safetySourceCode(properties)
    ?? (locale === "cs" ? "výstraha" : "alert");
  const prefix = locale === "cs"
    ? severity === "critical" ? "Kritická výstraha" : "Výstraha"
    : severity === "critical" ? "Critical alert" : "Alert";
  const trimmed = title.trim();
  const normalized = trimmed.toLowerCase();
  const withPrefix = normalized.includes("výstrah") || normalized.includes("alert") ? trimmed : `${prefix}: ${trimmed}`;
  return withPrefix.slice(0, 120);
}

function safeSafetyBody(properties: SafetyFeature["properties"], locale: "cs" | "en"): string | undefined {
  const action = localizedSafetyString(properties, locale, "recommendedAction", "instruction", "recommendation", "description", "detail")
    ?? (locale === "cs" ? properties.recommendedAction : undefined);
  if (!action) {
    return locale === "cs" ? "Otevřete CSM pro aktuální detail výstrahy." : undefined;
  }
  return action.trim().length <= 180 ? action.trim() : locale === "cs" ? "Otevřete CSM pro aktuální detail výstrahy." : undefined;
}

function safetyNotificationEligible(properties: SafetyFeature["properties"]): boolean | undefined {
  const notification = safetyNotification(properties);
  const value = notification.eligible;
  return typeof value === "boolean" ? value : undefined;
}

function safetyTypeCode(properties: SafetyFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyTaxonomy(properties);
  return properties.typeCode
    ?? stringRecordValue(providerProperties, "typeCode")
    ?? stringRecordValue(taxonomy, "typeCode");
}

function safetySourceCode(properties: SafetyFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyTaxonomy(properties);
  return properties.sourceCode
    ?? stringRecordValue(providerProperties, "sourceCode")
    ?? stringRecordValue(taxonomy, "sourceCode");
}

function safetySourceSystem(properties: SafetyFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyTaxonomy(properties);
  return properties.sourceSystem
    ?? stringRecordValue(providerProperties, "sourceSystem")
    ?? stringRecordValue(taxonomy, "codeSystem")
    ?? stringRecordValue(taxonomy, "sourceSystem");
}

function localizedSafetyString(
  properties: SafetyFeature["properties"],
  locale: "cs" | "en",
  ...keys: string[]
): string | undefined {
  const localized = properties.localized;
  if (!localized || typeof localized !== "object") {
    return undefined;
  }
  const entry = localized[locale];
  const record = isRecord(entry) ? entry : localized;
  for (const key of keys) {
    const value = stringRecordValue(record, key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function safetyPresentationString(properties: SafetyFeature["properties"], ...keys: string[]): string | undefined {
  const presentation = safetyPresentation(properties);
  for (const key of keys) {
    const value = stringRecordValue(presentation, key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function safetyProviderProperties(properties: SafetyFeature["properties"]): Record<string, unknown> {
  return isRecord(properties.providerProperties) ? properties.providerProperties : {};
}

function safetyTaxonomy(properties: SafetyFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.taxonomy) ? providerProperties.taxonomy : {};
}

function safetyPresentation(properties: SafetyFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.presentation) ? providerProperties.presentation : {};
}

function safetyNotification(properties: SafetyFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.notification) ? providerProperties.notification : {};
}

function stringRecordValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function humanizeSafetyTypeCode(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeAudience(audience: CopNotificationAudience): CopNotificationAudience {
  return {
    ...normalizeAudienceField("areaIds", audience.areaIds),
    ...normalizeAudienceField("groupIds", audience.groupIds),
    ...normalizeAudienceField("userIds", audience.userIds)
  };
}

function normalizeAudienceField(key: keyof CopNotificationAudience, value: string[] | undefined): CopNotificationAudience {
  const values = Array.from(new Set((value ?? []).flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 160)] : []))).slice(0, 100);
  if (values.length === 0) {
    return {};
  }
  if (key === "areaIds") {
    return { areaIds: values };
  }
  if (key === "groupIds") {
    return { groupIds: values };
  }
  return { userIds: values };
}

function hasAudience(audience: CopNotificationAudience): boolean {
  return Boolean(audience.userIds?.length || audience.groupIds?.length || audience.areaIds?.length);
}

function timestampProperty(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function isExpired(value: unknown, requestNow: Date): boolean {
  const timestamp = timestampProperty(value);
  return Boolean(timestamp && Date.parse(timestamp) <= requestNow.getTime());
}

function compactMetadata(value: Record<string, unknown>): Record<string, string | number | boolean | null> | undefined {
  const entries = Object.entries(value).flatMap(([key, rawValue]) => {
    if (rawValue === null || typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
      return [[key, rawValue] as const];
    }
    return [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function createDecisionId(prefix: string, id: string, revision: string): string {
  return `${prefix}:${id}:${revision}`.replace(/\s+/gu, "_").slice(0, 256);
}
