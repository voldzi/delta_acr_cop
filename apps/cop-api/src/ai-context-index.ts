import { randomUUID } from "node:crypto";
import type { AiSemanticCitation, AiSemanticContext, AiSemanticDocument, AiSemanticRetriever } from "./ai-semantic-retrieval.js";
import type { AiRetrievalIntent } from "./ai-retrieval-intent.js";

export interface AiContextGeoFilter {
  bbox?: AiContextBbox;
  center?: {
    lat: number;
    lon: number;
    radiusKm: number;
  };
  label?: string;
  source?: "body" | "geocoder" | "map" | "profile";
}

export interface AiContextBbox {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface AiContextTimeWindow {
  from?: string;
  maxAgeSeconds?: number;
  to?: string;
}

export interface AiContextIndexRefreshResult {
  contractVersion: "cop-ai-context-index-refresh-v1";
  documentCount: number;
  indexedAt: string;
  reason: string;
  status: "disabled" | "ok";
}

export interface AiIndexedContext {
  citations: AiSemanticCitation[];
  contractVersion: "cop-ai-indexed-context-v1";
  generatedAt: string;
  index: {
    documentCount: number;
    lastRefreshReason?: string;
    refreshedAt?: string;
    status: "disabled" | "empty" | "ok";
  };
  query: {
    geo?: AiContextGeoFilter;
    limit: number;
    retrievalIntent?: AiRetrievalIntent;
    text: string;
    timeWindow?: AiContextTimeWindow;
  };
  semanticContext: AiSemanticContext;
  toolCall: AiContextIndexToolCall;
}

export interface AiContextIndexToolCall {
  candidateDocumentCount: number;
  durationMs: number;
  invocationId: string;
  matchedDocumentCount: number;
  mode: "read_only";
  status: "disabled" | "ok";
  toolId: "cop.ai.context_index.query";
  warnings: string[];
}

export interface AiContextIndexOptions {
  enabled?: boolean;
  maxDocuments?: number;
}

interface IndexedDocument {
  document: AiSemanticDocument;
  indexedAt: string;
}

export class AiContextIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly enabled: boolean;
  private readonly maxDocuments: number;
  private lastRefreshReason: string | undefined;
  private refreshedAt: string | undefined;

  constructor(options: AiContextIndexOptions = {}) {
    this.enabled = options.enabled !== false;
    this.maxDocuments = Math.max(1, Math.trunc(options.maxDocuments ?? 800));
  }

  replaceDocuments(documents: AiSemanticDocument[], input: { indexedAt: Date; reason: string }): AiContextIndexRefreshResult {
    if (!this.enabled) {
      this.documents.clear();
      this.lastRefreshReason = input.reason;
      this.refreshedAt = input.indexedAt.toISOString();
      return {
        contractVersion: "cop-ai-context-index-refresh-v1",
        documentCount: 0,
        indexedAt: this.refreshedAt,
        reason: input.reason,
        status: "disabled"
      };
    }
    const indexedAt = input.indexedAt.toISOString();
    this.documents.clear();
    for (const document of documents.filter((item) => item.text.trim()).slice(0, this.maxDocuments)) {
      this.documents.set(document.documentId, {
        document,
        indexedAt
      });
    }
    this.lastRefreshReason = input.reason;
    this.refreshedAt = indexedAt;
    return {
      contractVersion: "cop-ai-context-index-refresh-v1",
      documentCount: this.documents.size,
      indexedAt,
      reason: input.reason,
      status: "ok"
    };
  }

  shouldRefresh(now: Date, maxAgeMs: number): boolean {
    if (!this.enabled) {
      return false;
    }
    if (!this.refreshedAt || this.documents.size === 0) {
      return true;
    }
    return now.getTime() - Date.parse(this.refreshedAt) > maxAgeMs;
  }

  diagnostics(): { documentCount: number; refreshedAt?: string; status: "disabled" | "empty" | "ok" } {
    if (!this.enabled) {
      return {
        documentCount: 0,
        status: "disabled"
      };
    }
    return {
      documentCount: this.documents.size,
      ...(this.refreshedAt ? { refreshedAt: this.refreshedAt } : {}),
      status: this.documents.size > 0 ? "ok" : "empty"
    };
  }

  async query(retriever: AiSemanticRetriever, input: {
    generatedAt: Date;
    geo?: AiContextGeoFilter;
    limit?: number;
    query: string;
    retrievalIntent?: AiRetrievalIntent;
    timeWindow?: AiContextTimeWindow;
  }): Promise<AiIndexedContext> {
    const startedAt = Date.now();
    const invocationId = randomUUID();
    const query = input.query.trim();
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 8), 24));
    const warnings: string[] = [];
    const allDocuments = Array.from(this.documents.values()).map((item) => item.document);
    const matchedDocuments = this.enabled
      ? allDocuments.filter((document) => matchesGeoFilter(document, input.geo) && matchesTimeWindow(document, input.timeWindow, input.generatedAt))
      : [];
    if (!this.enabled) {
      warnings.push("COP AI context index is disabled.");
    }
    if (this.enabled && allDocuments.length === 0) {
      warnings.push("COP AI context index has no background documents.");
    }
    if (this.enabled && allDocuments.length > 0 && matchedDocuments.length === 0) {
      warnings.push("COP AI context index matched no documents for the requested geo/time filter.");
    }
    const semanticContext = this.enabled
      ? remapSemanticContextCitations(await retriever.retrieve({
          documents: matchedDocuments,
          generatedAt: input.generatedAt,
          limit,
          query,
          ...(input.retrievalIntent ? { retrievalIntent: input.retrievalIntent } : {})
        }), "I")
      : emptySemanticContext(input.generatedAt, query, "disabled", warnings[0] ?? "COP AI context index is disabled.", input.retrievalIntent);
    for (const warning of warnings) {
      if (!semanticContext.warnings.includes(warning)) {
        semanticContext.warnings.push(warning);
      }
    }
    const durationMs = Date.now() - startedAt;
    return {
      citations: semanticContext.citations,
      contractVersion: "cop-ai-indexed-context-v1",
      generatedAt: input.generatedAt.toISOString(),
      index: {
        documentCount: allDocuments.length,
        ...(this.lastRefreshReason ? { lastRefreshReason: this.lastRefreshReason } : {}),
        ...(this.refreshedAt ? { refreshedAt: this.refreshedAt } : {}),
        status: this.enabled ? allDocuments.length > 0 ? "ok" : "empty" : "disabled"
      },
      query: {
        ...(input.geo ? { geo: input.geo } : {}),
        limit,
        ...(input.retrievalIntent ? { retrievalIntent: input.retrievalIntent } : {}),
        text: query,
        ...(input.timeWindow ? { timeWindow: input.timeWindow } : {})
      },
      semanticContext,
      toolCall: {
        candidateDocumentCount: allDocuments.length,
        durationMs,
        invocationId,
        matchedDocumentCount: matchedDocuments.length,
        mode: "read_only",
        status: this.enabled ? "ok" : "disabled",
        toolId: "cop.ai.context_index.query",
        warnings
      }
    };
  }
}

function matchesGeoFilter(document: AiSemanticDocument, geo: AiContextGeoFilter | undefined): boolean {
  if (!geo?.bbox && !geo?.center) {
    return true;
  }
  if (document.entityType === "sourceHealth") {
    return true;
  }
  const position = documentPosition(document);
  if (!position) {
    return false;
  }
  if (geo.bbox && !pointInBbox(position, geo.bbox)) {
    return false;
  }
  if (geo.center && distanceKm(position, geo.center) > geo.center.radiusKm) {
    return false;
  }
  return true;
}

function matchesTimeWindow(document: AiSemanticDocument, timeWindow: AiContextTimeWindow | undefined, generatedAt: Date): boolean {
  if (!timeWindow?.from && !timeWindow?.to && !timeWindow?.maxAgeSeconds) {
    return true;
  }
  if (document.entityType === "sourceHealth") {
    return true;
  }
  const timestamp = documentTimestamp(document);
  if (!timestamp) {
    return false;
  }
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  const fromMs = timeWindow.from ? Date.parse(timeWindow.from) : undefined;
  const toMs = timeWindow.to ? Date.parse(timeWindow.to) : undefined;
  const maxAgeFromMs = timeWindow.maxAgeSeconds ? generatedAt.getTime() - timeWindow.maxAgeSeconds * 1000 : undefined;
  if (fromMs !== undefined && Number.isFinite(fromMs) && timestampMs < fromMs) {
    return false;
  }
  if (maxAgeFromMs !== undefined && timestampMs < maxAgeFromMs) {
    return false;
  }
  if (toMs !== undefined && Number.isFinite(toMs) && timestampMs > toMs) {
    return false;
  }
  return true;
}

function documentPosition(document: AiSemanticDocument): { lat: number; lon: number } | undefined {
  const payload = asRecord(document.payload);
  return positionFromValue(payload?.position) ?? positionFromValue(payload?.location) ?? positionFromValue(payload?.map);
}

function positionFromValue(value: unknown): { lat: number; lon: number } | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const lat = finiteNumber(record.lat);
  const lon = finiteNumber(record.lon);
  return lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
}

function documentTimestamp(document: AiSemanticDocument): string | undefined {
  const payload = asRecord(document.payload);
  return stringValue(document.metadata?.updatedAt)
    ?? stringValue(document.metadata?.timestamp)
    ?? stringValue(payload?.updatedAt)
    ?? stringValue(payload?.lastUpdatedAt)
    ?? stringValue(payload?.observedAt)
    ?? stringValue(payload?.submittedAt)
    ?? stringValue(payload?.createdAt);
}

function remapSemanticContextCitations(context: AiSemanticContext, prefix: "I"): AiSemanticContext {
  const citationMap = new Map<string, string>();
  const citations = context.citations.map((citation, index) => {
    const citationId = `${prefix}${index + 1}`;
    citationMap.set(citation.citationId, citationId);
    return {
      ...citation,
      citationId
    };
  });
  const items = context.items.map((item, index) => {
    const fallbackId = `${prefix}${index + 1}`;
    const citationId = citationMap.get(item.citation.citationId) ?? fallbackId;
    return {
      ...item,
      citation: {
        ...item.citation,
        citationId
      }
    };
  });
  return {
    ...context,
    citations,
    items
  };
}

function emptySemanticContext(
  generatedAt: Date,
  query: string,
  status: AiSemanticContext["status"],
  warning: string,
  retrievalIntent?: AiRetrievalIntent
): AiSemanticContext {
  return {
    citations: [],
    contractVersion: "cop-ai-semantic-context-v1",
    generatedAt: generatedAt.toISOString(),
    includedDocumentCount: 0,
    items: [],
    query,
    ...(retrievalIntent ? { retrievalIntent } : {}),
    status,
    warnings: [warning]
  };
}

function pointInBbox(point: { lat: number; lon: number }, bbox: AiContextBbox): boolean {
  return point.lon >= bbox.west && point.lon <= bbox.east && point.lat >= bbox.south && point.lat <= bbox.north;
}

function distanceKm(left: { lat: number; lon: number }, right: { lat: number; lon: number }): number {
  const radiusKm = 6371;
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);
  const deltaLat = toRadians(right.lat - left.lat);
  const deltaLon = toRadians(right.lon - left.lon);
  const haversine =
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
