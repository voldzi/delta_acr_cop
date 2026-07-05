import type { AiIndexedContext } from "./ai-context-index.js";
import type { AiSemanticContext, AiSemanticEntityType, AiSemanticResult } from "./ai-semantic-retrieval.js";
import { aiIntentSuppressesRoutineCivilAir, inferAiRetrievalIntent, isRoutineCivilAirText, type AiRetrievalIntent } from "./ai-retrieval-intent.js";

type AiPromptRecordSet = Record<string, unknown>[];

export interface AiPromptContextCompressionInput {
  alerts: AiPromptRecordSet;
  chatContext?: Record<string, unknown>;
  communityReports: AiPromptRecordSet;
  generatedAt: Date;
  incidents: AiPromptRecordSet;
  indexedContext: AiIndexedContext;
  mapFeatures?: AiPromptRecordSet;
  objects: AiPromptRecordSet;
  priorityContext: Record<string, unknown>;
  retrievalIntent?: AiRetrievalIntent;
  semanticContext: AiSemanticContext;
  sourceHealth: AiPromptRecordSet;
}

export interface AiPromptContextCompressionOutput {
  alerts: AiPromptRecordSet;
  chatContext?: Record<string, unknown>;
  communityReports: AiPromptRecordSet;
  contextCompression: Record<string, unknown>;
  incidents: AiPromptRecordSet;
  indexedContext: AiIndexedContext;
  mapFeatures: AiPromptRecordSet;
  objects: AiPromptRecordSet;
  semanticContext: AiSemanticContext;
  sourceHealth: AiPromptRecordSet;
}

const promptRecordLimits: Record<AiSemanticEntityType, number> = {
  alert: 8,
  chatMessage: 8,
  communityReport: 8,
  incident: 6,
  mapFeature: 8,
  observedObject: 6,
  sourceHealth: 6
};

const semanticPromptItemLimit = 8;
const semanticPromptTextLimit = 520;

export function buildAiPromptContextCompression(input: AiPromptContextCompressionInput): AiPromptContextCompressionOutput {
  const retrievalIntent = input.retrievalIntent ?? input.semanticContext.retrievalIntent ?? inferAiRetrievalIntent(input.semanticContext.query);
  const selectedEntityIds = selectedEntityIdsFromEvidence(input.priorityContext, input.semanticContext, input.indexedContext);
  const objects = selectPromptRecords(input.objects, "observedObject", selectedEntityIds, retrievalIntent);
  const alerts = selectPromptRecords(input.alerts, "alert", selectedEntityIds, retrievalIntent);
  const communityReports = selectPromptRecords(input.communityReports, "communityReport", selectedEntityIds, retrievalIntent);
  const incidents = selectPromptRecords(input.incidents, "incident", selectedEntityIds, retrievalIntent);
  const mapFeatures = selectPromptRecords(input.mapFeatures ?? [], "mapFeature", selectedEntityIds, retrievalIntent);
  const sourceHealth = selectPromptRecords(input.sourceHealth, "sourceHealth", selectedEntityIds, retrievalIntent);
  const chatContext = compressPromptChatContext(input.chatContext, selectedEntityIds);
  const semanticContext = compressPromptSemanticContext(input.semanticContext);
  const indexedContext = compressPromptIndexedContext(input.indexedContext);
  const originalCounts = {
    alerts: input.alerts.length,
    chatMessages: promptChatMessageCount(input.chatContext),
    communityReports: input.communityReports.length,
    incidents: input.incidents.length,
    mapFeatures: input.mapFeatures?.length ?? 0,
    objects: input.objects.length,
    sourceHealth: input.sourceHealth.length
  };
  const includedCounts = {
    alerts: alerts.length,
    chatMessages: promptChatMessageCount(chatContext),
    communityReports: communityReports.length,
    incidents: incidents.length,
    mapFeatures: mapFeatures.length,
    objects: objects.length,
    sourceHealth: sourceHealth.length
  };
  return {
    alerts,
    ...(chatContext ? { chatContext } : {}),
    communityReports,
    contextCompression: compactRecord({
      contractVersion: "cop-ai-prompt-context-compression-v1",
      generatedAt: input.generatedAt.toISOString(),
      guidance: "Provider prompt receives bge-m3 evidence-first thin context. Omitted records remain counted in scope/evidence and must not be treated as absent from COP.",
      includedCounts,
      indexed: compactRecord({
        originalItemCount: input.indexedContext.semanticContext.items.length,
        promptItemCount: indexedContext.semanticContext.items.length,
        status: indexedContext.semanticContext.status
      }),
      mode: "bge-m3-evidence-first",
      omittedCounts: subtractCounts(originalCounts, includedCounts),
      originalCounts,
      retrievalIntent,
      semantic: compactRecord({
        model: input.semanticContext.model,
        originalItemCount: input.semanticContext.items.length,
        promptItemCount: semanticContext.items.length,
        status: semanticContext.status
      }),
      selectedEntityCount: selectedEntityCount(selectedEntityIds)
    }),
    incidents,
    indexedContext,
    mapFeatures,
    objects,
    semanticContext,
    sourceHealth
  };
}

function selectedEntityIdsFromEvidence(
  priorityContext: Record<string, unknown>,
  semanticContext: AiSemanticContext,
  indexedContext: AiIndexedContext
): Map<AiSemanticEntityType, Set<string>> {
  const selected = new Map<AiSemanticEntityType, Set<string>>();
  for (const signal of arrayRecords(priorityContext.prioritySignals)) {
    addSelectedEntity(selected, entityTypeFromValue(signal.entityType), textValue(signal.entityId));
  }
  for (const citation of arrayRecords(priorityContext.citations)) {
    addSelectedEntity(selected, entityTypeFromValue(citation.entityType), textValue(citation.entityId));
  }
  for (const item of semanticContext.items) {
    addSelectedEntity(selected, item.entityType, item.entityId);
  }
  for (const item of indexedContext.semanticContext.items) {
    addSelectedEntity(selected, item.entityType, item.entityId);
  }
  return selected;
}

function addSelectedEntity(selected: Map<AiSemanticEntityType, Set<string>>, entityType: AiSemanticEntityType | undefined, entityId: string | undefined): void {
  if (!entityType || !entityId) {
    return;
  }
  const values = selected.get(entityType) ?? new Set<string>();
  values.add(entityId);
  selected.set(entityType, values);
}

function selectPromptRecords(
  records: AiPromptRecordSet,
  entityType: Exclude<AiSemanticEntityType, "chatMessage">,
  selectedEntityIds: Map<AiSemanticEntityType, Set<string>>,
  retrievalIntent: AiRetrievalIntent
): AiPromptRecordSet {
  const selected = selectedEntityIds.get(entityType) ?? new Set<string>();
  const limit = promptRecordLimits[entityType];
  const seen = new Set<string>();
  return records
    .map((record, index) => ({
      index,
      record,
      selected: selected.has(recordEntityId(entityType, record) ?? ""),
      score: promptRecordScore(entityType, record, retrievalIntent),
      timestamp: timestampMillis(recordTimestamp(record))
    }))
    .filter((item) => (item.selected && item.score >= promptSelectedRecordFloor(entityType)) || item.score >= promptRecordFallbackThreshold(entityType))
    .sort((left, right) =>
      Number(right.selected) - Number(left.selected)
      || right.score - left.score
      || right.timestamp - left.timestamp
      || left.index - right.index
    )
    .flatMap((item) => {
      const entityId = recordEntityId(entityType, item.record) ?? `${entityType}:${item.index}`;
      if (seen.has(entityId)) {
        return [];
      }
      seen.add(entityId);
      return [slimPromptRecord(item.record)];
    })
    .slice(0, limit);
}

function compressPromptChatContext(
  chatContext: Record<string, unknown> | undefined,
  selectedEntityIds: Map<AiSemanticEntityType, Set<string>>
): Record<string, unknown> | undefined {
  const messages = arrayRecords(chatContext?.messages);
  if (!chatContext || messages.length === 0) {
    return undefined;
  }
  const selected = selectedEntityIds.get("chatMessage") ?? new Set<string>();
  const limit = promptRecordLimits.chatMessage;
  const seen = new Set<string>();
  const selectedMessages = messages
    .map((message, index) => ({
      index,
      message,
      selected: selected.has(textValue(message.eventId) ?? ""),
      score: promptChatMessageScore(message),
      timestamp: timestampMillis(textValue(message.timestamp))
    }))
    .filter((item) => item.selected || item.score >= 0.22)
    .sort((left, right) =>
      Number(right.selected) - Number(left.selected)
      || right.score - left.score
      || right.timestamp - left.timestamp
      || left.index - right.index
    )
    .flatMap((item) => {
      const eventId = textValue(item.message.eventId) ?? `chat-message-${item.index}`;
      if (seen.has(eventId)) {
        return [];
      }
      seen.add(eventId);
      return [slimPromptRecord(item.message)];
    })
    .slice(0, limit);
  if (selectedMessages.length === 0) {
    return compactRecord({
      encrypted: chatContext.encrypted === true,
      includedMessageCount: 0,
      omittedMessageCount: messages.length,
      roomId: textValue(chatContext.roomId),
      source: textValue(chatContext.source),
      visibleMessageCount: numberValue(chatContext.visibleMessageCount)
    });
  }
  return compactRecord({
    encrypted: chatContext.encrypted === true,
    includedMessageCount: selectedMessages.length,
    messages: selectedMessages,
    omittedMessageCount: Math.max(0, messages.length - selectedMessages.length),
    roomId: textValue(chatContext.roomId),
    source: textValue(chatContext.source),
    visibleMessageCount: numberValue(chatContext.visibleMessageCount)
  });
}

function compressPromptIndexedContext(context: AiIndexedContext): AiIndexedContext {
  const semanticContext = compressPromptSemanticContext(context.semanticContext, "I");
  return {
    ...context,
    citations: semanticContext.citations,
    semanticContext
  };
}

function compressPromptSemanticContext(context: AiSemanticContext, expectedPrefix: "I" | "S" = "S"): AiSemanticContext {
  const items = context.items.slice(0, semanticPromptItemLimit).map((item) => slimSemanticItem(item));
  const warnings = [...context.warnings];
  if (context.items.length > items.length) {
    warnings.push(`Prompt semantic context compressed from ${context.items.length} to ${items.length} items.`);
  }
  return {
    ...context,
    citations: context.citations
      .filter((citation) => citation.citationId.startsWith(expectedPrefix))
      .slice(0, items.length),
    includedDocumentCount: items.length,
    items,
    warnings
  };
}

function slimSemanticItem(item: AiSemanticResult): AiSemanticResult {
  return {
    citation: item.citation,
    documentId: item.documentId,
    entityId: item.entityId,
    entityType: item.entityType,
    ...(item.metadata ? { metadata: slimPromptRecord(item.metadata) as Record<string, boolean | number | string> } : {}),
    priorityScore: item.priorityScore,
    score: item.score,
    semanticScore: item.semanticScore,
    text: item.text.slice(0, semanticPromptTextLimit),
    ...(item.title ? { title: item.title.slice(0, 140) } : {})
  };
}

function slimPromptRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, slimPromptValue(value, key, 0)] as const)
      .filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0))
  );
}

function slimPromptValue(value: unknown, key: string, depth: number): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.slice(0, longTextKey(key) ? 420 : 180);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return depth >= 2
      ? undefined
      : value.slice(0, 6).map((item) => slimPromptValue(item, key, depth + 1)).filter((item) => item !== undefined);
  }
  if (isRecord(value)) {
    if (depth >= 2) {
      return undefined;
    }
    return slimPromptRecord(Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, slimPromptValue(childValue, childKey, depth + 1)])
    ));
  }
  return undefined;
}

function promptRecordScore(entityType: Exclude<AiSemanticEntityType, "chatMessage">, record: Record<string, unknown>, intent: AiRetrievalIntent): number {
  const text = JSON.stringify(record).toLocaleLowerCase("cs-CZ");
  let score = promptEntityBaseScore(entityType);
  score += severityScore(textValue(record.severity));
  score += statusScore(textValue(record.status) ?? textValue(record.health));
  score += crisisTermScore(`${textValue(record.category) ?? ""} ${textValue(record.type) ?? ""} ${text}`);
  if ((textValue(record.domain) ?? "").toLocaleLowerCase("cs-CZ") === "air" || isRoutineCivilAirText(text)) {
    const routineCivilAirPenalty = isRoutineCivilAirText(text) ? 0.46 : 0.22;
    score -= aiIntentSuppressesRoutineCivilAir(intent) ? routineCivilAirPenalty : 0.06;
  }
  if (/low_confidence|zastaral|stale/u.test(text)) {
    score -= aiIntentSuppressesRoutineCivilAir(intent) ? 0.18 : 0.08;
  }
  return Math.max(0, Math.min(1, score));
}

function promptChatMessageScore(message: Record<string, unknown>): number {
  const body = textValue(message.body) ?? "";
  const text = body.toLocaleLowerCase("cs-CZ");
  const ai = isRecord(message.ai) ? message.ai : undefined;
  let score = ai ? -0.08 : 0.18;
  score += crisisTermScore(text);
  return Math.max(0, Math.min(1, score));
}

function promptEntityBaseScore(entityType: Exclude<AiSemanticEntityType, "chatMessage">): number {
  switch (entityType) {
    case "incident":
      return 0.44;
    case "communityReport":
      return 0.38;
    case "mapFeature":
      return 0.34;
    case "alert":
      return 0.28;
    case "sourceHealth":
      return 0.06;
    case "observedObject":
      return 0.03;
  }
}

function promptRecordFallbackThreshold(entityType: Exclude<AiSemanticEntityType, "chatMessage">): number {
  switch (entityType) {
    case "sourceHealth":
      return 0.16;
    case "mapFeature":
      return 0.22;
    case "observedObject":
      return 0.28;
    default:
      return 0.26;
  }
}

function promptSelectedRecordFloor(entityType: Exclude<AiSemanticEntityType, "chatMessage">): number {
  return entityType === "observedObject" ? 0.12 : 0;
}

function crisisTermScore(text: string): number {
  if (/(flood|povod|hladin|hydro|river|řek|rek|water|voda|záplav|zaplav)/u.test(text)) {
    return 0.24;
  }
  if (/(fire|požár|pozar|kouř|kour|hotspot|firms)/u.test(text)) {
    return 0.22;
  }
  if (/(security|polic|kráde|krade|zlod|crime|bezpeč|bezpec)/u.test(text)) {
    return 0.2;
  }
  if (/(medical|zdravot|zran|evaku|bridge|most|road|silnic|infrastructure|utility|outage|výpad|vypad|hazard|nebezpe)/u.test(text)) {
    return 0.16;
  }
  if (/(traffic|doprav|weather|vítr|vitr|bouř|bour|warning|výstrah|vystrah)/u.test(text)) {
    return 0.1;
  }
  return 0;
}

function severityScore(severity: string | undefined): number {
  switch (severity) {
    case "critical":
      return 0.3;
    case "warning":
      return 0.18;
    case "advisory":
      return 0.08;
    default:
      return 0;
  }
}

function statusScore(status: string | undefined): number {
  switch (status) {
    case "ACTIVE":
    case "active":
    case "monitoring":
    case "submitted":
    case "published":
      return 0.08;
    case "candidate":
      return 0.04;
    case "degraded":
    case "DEGRADED":
    case "DISABLED":
      return 0.12;
    case "STALE":
    case "stale":
      return -0.08;
    case "resolved":
    case "closed":
    case "ACKNOWLEDGED":
    case "ok":
    case "OK":
      return -0.08;
    default:
      return 0;
  }
}

function recordEntityId(entityType: Exclude<AiSemanticEntityType, "chatMessage">, record: Record<string, unknown>): string | undefined {
  switch (entityType) {
    case "alert":
      return textValue(record.alertId);
    case "communityReport":
      return textValue(record.reportId);
    case "incident":
      return textValue(record.incidentId);
    case "mapFeature":
      return textValue(record.mapFeatureId);
    case "observedObject":
      return textValue(record.objectId);
    case "sourceHealth":
      return textValue(record.sourceSystemId);
  }
}

function recordTimestamp(record: Record<string, unknown>): string | undefined {
  return textValue(record.updatedAt)
    ?? textValue(record.lastUpdatedAt)
    ?? textValue(record.observedAt)
    ?? textValue(record.submittedAt)
    ?? textValue(record.createdAt);
}

function selectedEntityCount(selected: Map<AiSemanticEntityType, Set<string>>): number {
  return Array.from(selected.values()).reduce((sum, values) => sum + values.size, 0);
}

function promptChatMessageCount(chatContext: Record<string, unknown> | undefined): number {
  return arrayRecords(chatContext?.messages).length;
}

function subtractCounts(
  left: Record<string, number>,
  right: Record<string, number>
): Record<string, number> {
  return Object.fromEntries(Object.entries(left).map(([key, value]) => [key, Math.max(0, value - (right[key] ?? 0))]));
}

function entityTypeFromValue(value: unknown): AiSemanticEntityType | undefined {
  return value === "alert"
    || value === "chatMessage"
    || value === "communityReport"
    || value === "incident"
    || value === "mapFeature"
    || value === "observedObject"
    || value === "sourceHealth"
    ? value
    : undefined;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && !(Array.isArray(entry) && entry.length === 0))
  );
}

function longTextKey(key: string): boolean {
  return /body|description|detail|summary|text|warning/i.test(key);
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestampMillis(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
