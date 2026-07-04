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
  documentId: string;
  entityId: string;
  entityType: AiSemanticEntityType;
  metadata?: Record<string, boolean | number | string>;
  payload?: Record<string, unknown>;
  score: number;
  text: string;
  title?: string;
}

export interface AiSemanticContext {
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
        return {
          document,
          score: cosineSimilarity(queryEmbedding.embedding, embedding.embedding),
          model: embedding.model
        };
      });
      const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? this.maxDocuments), this.maxDocuments));
      const items = scored
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => right.score - left.score || left.document.documentId.localeCompare(right.document.documentId))
        .slice(0, limit)
        .map(({ document, score }) => ({
          documentId: document.documentId,
          entityId: document.entityId,
          entityType: document.entityType,
          ...(document.metadata ? { metadata: compactMetadata(document.metadata) } : {}),
          ...(document.payload ? { payload: document.payload } : {}),
          score: roundScore(score),
          text: document.text.slice(0, 1200),
          ...(document.title ? { title: document.title.slice(0, 160) } : {})
        }));
      return {
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
      health: optionalText(record.health),
      severity: optionalText(record.severity),
      sourceSystemId: optionalText(record.sourceSystemId),
      status: optionalText(record.status),
      synthetic: booleanValue(record.synthetic),
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
