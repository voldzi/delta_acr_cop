import type { AiEmbeddingResponse } from "@cop/ai-gateway";
import { createHash } from "node:crypto";

export type AiSemanticEntityType =
  | "alert"
  | "chatMessage"
  | "communityReport"
  | "incident"
  | "observedObject"
  | "sourceHealth";

export interface AiSemanticDocument {
  documentId: string;
  entityId: string;
  entityType: AiSemanticEntityType;
  metadata?: Record<string, boolean | number | string | undefined>;
  payload?: Record<string, unknown>;
  text: string;
  title?: string;
}

export interface AiSemanticResult {
  citation: AiSemanticCitation;
  documentId: string;
  entityId: string;
  entityType: AiSemanticEntityType;
  metadata?: Record<string, boolean | number | string>;
  payload?: Record<string, unknown>;
  priorityScore: number;
  score: number;
  semanticScore: number;
  text: string;
  title?: string;
}

export interface AiSemanticCitation {
  citationId: string;
  entityId: string;
  entityType: AiSemanticEntityType;
  label: string;
  position?: {
    lat: number;
    lon: number;
  };
  sourceSystemIds?: string[];
  updatedAt?: string;
}

export interface AiSemanticContext {
  citations: AiSemanticCitation[];
  contractVersion: "cop-ai-semantic-context-v1";
  generatedAt: string;
  includedDocumentCount: number;
  items: AiSemanticResult[];
  model?: string;
  query: string;
  status: "degraded" | "disabled" | "ok";
  warnings: string[];
}

export interface AiSemanticRetrieverOptions {
  embedText: (input: string) => Promise<AiEmbeddingResponse>;
  enabled?: boolean;
  maxCacheEntries?: number;
  maxDocuments?: number;
}

interface CachedEmbedding {
  embedding: number[];
  lastUsedAt: number;
  model: string;
}

export class AiSemanticRetriever {
  private readonly cache = new Map<string, CachedEmbedding>();
  private readonly enabled: boolean;
  private readonly maxCacheEntries: number;
  private readonly maxDocuments: number;

  constructor(private readonly options: AiSemanticRetrieverOptions) {
    this.enabled = options.enabled !== false;
    this.maxCacheEntries = Math.max(0, Math.trunc(options.maxCacheEntries ?? 500));
    this.maxDocuments = Math.max(1, Math.trunc(options.maxDocuments ?? 12));
  }

  async retrieve(input: {
    documents: AiSemanticDocument[];
    generatedAt: Date;
    limit?: number;
    query: string;
  }): Promise<AiSemanticContext> {
    const query = input.query.trim();
    const documents = dedupeDocuments(input.documents).filter((document) => document.text.trim());
    if (!this.enabled) {
      return this.empty(input.generatedAt, query, "disabled", "Semantic retrieval is disabled.");
    }
    if (!query || documents.length === 0) {
      return this.empty(input.generatedAt, query, "disabled", "Semantic retrieval has no query or documents.");
    }
    try {
      const queryEmbedding = await this.embed(`query\n${query}`);
      const scored = await mapWithConcurrency(documents, 4, async (document) => {
        const embedding = await this.embed(documentEmbeddingText(document));
        const semanticScore = cosineSimilarity(queryEmbedding.embedding, embedding.embedding);
        const priorityScore = crisisPriorityScore(document);
        return {
          document,
          priorityScore,
          score: semanticScore + priorityScore,
          semanticScore,
          model: embedding.model
        };
      });
      const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? this.maxDocuments), this.maxDocuments));
      const items = scored
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => right.score - left.score || left.document.documentId.localeCompare(right.document.documentId))
        .slice(0, limit)
        .map(({ document, priorityScore, score, semanticScore }, index) => {
          const citation = citationForDocument(document, index + 1);
          return {
            citation,
            documentId: document.documentId,
            entityId: document.entityId,
            entityType: document.entityType,
            ...(document.metadata ? { metadata: compactMetadata(document.metadata) } : {}),
            ...(document.payload ? { payload: document.payload } : {}),
            priorityScore: roundScore(priorityScore),
            score: roundScore(score),
            semanticScore: roundScore(semanticScore),
            text: document.text.slice(0, 1200),
            ...(document.title ? { title: document.title.slice(0, 160) } : {})
          };
        });
      return {
        citations: items.map((item) => item.citation),
        contractVersion: "cop-ai-semantic-context-v1",
        generatedAt: input.generatedAt.toISOString(),
        includedDocumentCount: items.length,
        items,
        model: queryEmbedding.model,
        query,
        status: "ok",
        warnings: []
      };
    } catch (error) {
      return this.empty(input.generatedAt, query, "degraded", `Semantic retrieval unavailable: ${errorMessage(error)}`);
    }
  }

  private empty(generatedAt: Date, query: string, status: AiSemanticContext["status"], warning: string): AiSemanticContext {
    return {
      citations: [],
      contractVersion: "cop-ai-semantic-context-v1",
      generatedAt: generatedAt.toISOString(),
      includedDocumentCount: 0,
      items: [],
      query,
      status,
      warnings: [warning]
    };
  }

  private async embed(text: string): Promise<CachedEmbedding> {
    const key = createHash("sha256").update(text).digest("hex");
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached) {
      cached.lastUsedAt = now;
      return cached;
    }
    const response = await this.options.embedText(text.slice(0, 4000));
    const next = {
      embedding: response.embedding,
      lastUsedAt: now,
      model: response.model
    };
    if (this.maxCacheEntries > 0) {
      this.cache.set(key, next);
      this.evictCache();
    }
    return next;
  }

  private evictCache(): void {
    if (this.cache.size <= this.maxCacheEntries) {
      return;
    }
    const overflow = this.cache.size - this.maxCacheEntries;
    const keys = Array.from(this.cache.entries())
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)
      .slice(0, overflow)
      .map(([key]) => key);
    for (const key of keys) {
      this.cache.delete(key);
    }
  }
}

export function createSemanticDocuments(input: {
  alerts?: Record<string, unknown>[];
  chatContext?: Record<string, unknown>;
  communityReports?: Record<string, unknown>[];
  incidents?: Record<string, unknown>[];
  objects?: Record<string, unknown>[];
  sourceHealth?: Record<string, unknown>[];
}): AiSemanticDocument[] {
  return [
    ...(input.objects ?? []).map((item) => documentFromRecord("observedObject", item, "objectId")),
    ...(input.alerts ?? []).map((item) => documentFromRecord("alert", item, "alertId")),
    ...(input.communityReports ?? []).map((item) => documentFromRecord("communityReport", item, "reportId")),
    ...(input.incidents ?? []).map((item) => documentFromRecord("incident", item, "incidentId")),
    ...(input.sourceHealth ?? []).map((item) => documentFromRecord("sourceHealth", item, "sourceSystemId")),
    ...chatDocuments(input.chatContext)
  ].filter((item): item is AiSemanticDocument => Boolean(item));
}

function documentFromRecord(
  entityType: Exclude<AiSemanticEntityType, "chatMessage">,
  record: Record<string, unknown>,
  idKey: string
): AiSemanticDocument | undefined {
  const entityId = optionalText(record[idKey]);
  if (!entityId) {
    return undefined;
  }
  const title = optionalText(record.title)
    ?? optionalText(record.displayName)
    ?? optionalText(record.objectType)
    ?? entityId;
  const text = recordToText(record);
  return {
    documentId: `${entityType}:${entityId}`,
    entityId,
    entityType,
    metadata: compactMetadata({
      category: optionalText(record.category),
      confidence: numberValue(record.confidence),
      dataQuality: optionalText(record.dataQuality),
      domain: optionalText(record.domain),
      health: optionalText(record.health),
      severity: optionalText(record.severity),
      sourceSystemId: optionalText(record.sourceSystemId),
      status: optionalText(record.status),
      synthetic: booleanValue(record.synthetic),
      type: optionalText(record.type),
      updatedAt: optionalText(record.updatedAt) ?? optionalText(record.lastUpdatedAt)
    }),
    payload: record,
    text,
    title
  };
}

function chatDocuments(chatContext: Record<string, unknown> | undefined): AiSemanticDocument[] {
  const messages = Array.isArray(chatContext?.messages) ? chatContext.messages : [];
  return messages.flatMap((item, index) => {
    if (!isRecord(item)) {
      return [];
    }
    const body = optionalText(item.body);
    const eventId = optionalText(item.eventId) ?? `chat-message-${index}`;
    if (!body) {
      return [];
    }
    const sender = optionalText(item.senderDisplayName) ?? optionalText(item.sender) ?? "chat";
    return [{
      documentId: `chatMessage:${eventId}`,
      entityId: eventId,
      entityType: "chatMessage" as const,
      metadata: compactMetadata({
        encrypted: booleanValue(chatContext?.encrypted),
        own: booleanValue(item.own),
        roomId: optionalText(chatContext?.roomId),
        sender,
        timestamp: optionalText(item.timestamp)
      }),
      payload: item,
      text: `${sender}: ${body}`.slice(0, 1400),
      title: sender
    }];
  });
}

function documentEmbeddingText(document: AiSemanticDocument): string {
  return [
    `entityType: ${document.entityType}`,
    `entityId: ${document.entityId}`,
    document.title ? `title: ${document.title}` : "",
    `text: ${document.text}`
  ].filter(Boolean).join("\n");
}

function crisisPriorityScore(document: AiSemanticDocument): number {
  const metadata = document.metadata ?? {};
  const payload = isRecord(document.payload) ? document.payload : {};
  const text = `${document.title ?? ""}\n${document.text}`.toLocaleLowerCase("cs-CZ");
  let score = entityTypePriority(document.entityType);
  score += severityPriority(optionalText(metadata.severity) ?? optionalText(payload.severity));
  score += statusPriority(optionalText(metadata.status) ?? optionalText(payload.status));
  score += healthPriority(optionalText(metadata.health) ?? optionalText(payload.health));
  score += categoryPriority(optionalText(metadata.category) ?? optionalText(payload.category), text);
  score += domainPriority(optionalText(metadata.domain) ?? optionalText(payload.domain), text);
  score += dataQualityPriority(optionalText(metadata.dataQuality) ?? optionalText(payload.dataQuality), text);
  return Math.max(-0.4, Math.min(0.75, score));
}

function entityTypePriority(entityType: AiSemanticEntityType): number {
  switch (entityType) {
    case "incident":
      return 0.34;
    case "communityReport":
      return 0.28;
    case "alert":
      return 0.22;
    case "chatMessage":
      return 0.18;
    case "sourceHealth":
      return 0.03;
    case "observedObject":
      return 0.02;
  }
}

function severityPriority(severity: string | undefined): number {
  switch (severity) {
    case "critical":
      return 0.28;
    case "warning":
      return 0.16;
    case "advisory":
      return 0.08;
    case "info":
      return 0;
    default:
      return 0;
  }
}

function statusPriority(status: string | undefined): number {
  switch (status) {
    case "active":
    case "ACTIVE":
    case "submitted":
    case "published":
    case "monitoring":
      return 0.08;
    case "candidate":
      return 0.04;
    case "resolved":
    case "closed":
    case "ACKNOWLEDGED":
      return -0.08;
    case "LOST":
      return -0.04;
    default:
      return 0;
  }
}

function healthPriority(health: string | undefined): number {
  switch (health) {
    case "DISABLED":
    case "DEGRADED":
    case "degraded":
      return 0.12;
    case "STALE":
    case "stale":
      return -0.08;
    case "OK":
    case "ok":
      return -0.03;
    default:
      return 0;
  }
}

function categoryPriority(category: string | undefined, text: string): number {
  const value = `${category ?? ""} ${text}`;
  if (/(flood|povod|řek|rek|hladin|hydro|water|voda|záplav|zaplav)/u.test(value)) {
    return 0.24;
  }
  if (/(fire|požár|pozar|kouř|kour|hotspot|firms)/u.test(value)) {
    return 0.22;
  }
  if (/(security|polic|kráde|krade|zlod|incident|crime|bezpeč)/u.test(value)) {
    return 0.2;
  }
  if (/(medical|zdravot|zran|evaku|hazard|nebezpe|bridge|most|road|silnic|infrastructure|utility|outage|výpad|vypad)/u.test(value)) {
    return 0.16;
  }
  if (/(weather|vítr|vitr|bouř|bour|warning)/u.test(value)) {
    return 0.12;
  }
  return 0;
}

function domainPriority(domain: string | undefined, text: string): number {
  const normalizedDomain = domain?.toLocaleLowerCase("cs-CZ");
  if (normalizedDomain === "air" || /\b(aircraft|flight|letadl|track_stale|stale track)\b/u.test(text)) {
    return /(critical|warning|incident|conflict|lost)/u.test(text) ? 0 : -0.12;
  }
  return 0;
}

function dataQualityPriority(dataQuality: string | undefined, text: string): number {
  const value = `${dataQuality ?? ""} ${text}`;
  if (/(track_stale|TRACK_STALE|stale track|zastaral)/u.test(value)) {
    return -0.18;
  }
  if (/(low_confidence|LOW_CONFIDENCE)/u.test(value)) {
    return -0.06;
  }
  return 0;
}

function citationForDocument(document: AiSemanticDocument, index: number): AiSemanticCitation {
  const payload = isRecord(document.payload) ? document.payload : {};
  const position = positionFromRecord(payload.position) ?? positionFromRecord(payload.location);
  const sourceSystemIds = sourceSystemIdsFromRecord(payload);
  const updatedAt = optionalText(payload.updatedAt) ?? optionalText(payload.lastUpdatedAt) ?? optionalText(payload.observedAt);
  return {
    citationId: `S${index}`,
    entityId: document.entityId,
    entityType: document.entityType,
    label: (document.title ?? document.entityId).slice(0, 120),
    ...(position ? { position } : {}),
    ...(sourceSystemIds.length ? { sourceSystemIds } : {}),
    ...(updatedAt ? { updatedAt } : {})
  };
}

function positionFromRecord(value: unknown): { lat: number; lon: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = numberValue(value.lat);
  const lon = numberValue(value.lon);
  return lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
}

function sourceSystemIdsFromRecord(record: Record<string, unknown>): string[] {
  const values = [
    optionalText(record.sourceSystemId),
    ...stringList(record.sourceSystemIds),
    ...sourceRefSystemIds(record.sourceRefs)
  ].filter((item): item is string => Boolean(item));
  return Array.from(new Set(values)).slice(0, 8);
}

function sourceRefSystemIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => isRecord(item) ? stringList(item.sourceId) : []);
}

function stringList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
}

function recordToText(record: Record<string, unknown>): string {
  const lines: string[] = [];
  appendLine(lines, "title", record.title);
  appendLine(lines, "description", record.description);
  appendLine(lines, "detail", record.detail);
  appendLine(lines, "category", record.category);
  appendLine(lines, "severity", record.severity);
  appendLine(lines, "status", record.status);
  appendLine(lines, "objectType", record.objectType);
  appendLine(lines, "domain", record.domain);
  appendLine(lines, "health", record.health);
  appendLine(lines, "sourceType", record.sourceType);
  appendLine(lines, "warnings", record.warnings);
  appendLine(lines, "sourceRefs", record.sourceRefs);
  appendLine(lines, "location", record.location);
  appendLine(lines, "position", record.position);
  appendLine(lines, "confidence", record.confidence);
  appendLine(lines, "dataQuality", record.dataQuality);
  appendLine(lines, "updatedAt", record.updatedAt ?? record.lastUpdatedAt ?? record.observedAt);
  return lines.join("\n").slice(0, 1800);
}

function appendLine(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text && text !== "{}" && text !== "[]") {
    lines.push(`${label}: ${text}`);
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function dedupeDocuments(documents: AiSemanticDocument[]): AiSemanticDocument[] {
  const seen = new Set<string>();
  const result: AiSemanticDocument[] = [];
  for (const document of documents) {
    if (seen.has(document.documentId)) {
      continue;
    }
    seen.add(document.documentId);
    result.push(document);
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await mapper(items[current] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function compactMetadata(metadata: Record<string, boolean | number | string | undefined>): Record<string, boolean | number | string> {
  return Object.fromEntries(Object.entries(metadata).filter((entry): entry is [string, boolean | number | string] => entry[1] !== undefined));
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
