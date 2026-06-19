import { randomUUID } from "node:crypto";
import type { CopState } from "./types.js";

export const federationNodeRoles = [
  "central-orchestrator",
  "civil-crisis-node",
  "edge-node",
  "provider-node",
  "messaging-node"
] as const;

export type FederatedNodeRole = (typeof federationNodeRoles)[number];
export type FederatedNodeHealth = "degraded" | "offline" | "ok";
export type DomainEventChannel =
  | "cop.ai.audit"
  | "cop.audit.events"
  | "cop.domain.events"
  | "cop.node.sync"
  | "cop.notifications.requested"
  | "cop.provider.health";
export type PilotClassificationLevel = "INTERNAL" | "PUBLIC" | "RESTRICTED_SIMULATED" | "SENSITIVE";
export type DomainEntityType =
  | "alert"
  | "auditRecord"
  | "communityReport"
  | "evidence"
  | "incident"
  | "resource"
  | "sensorObservation"
  | "sketchDrawing"
  | "sourceSystem"
  | "task"
  | "unit"
  | "userZone";

export const domainEventTypes = [
  "incident.created",
  "incident.updated",
  "incident.merged",
  "unit.status.updated",
  "resource.capacity.updated",
  "sensor.observation.created",
  "alert.raised",
  "alert.acknowledged",
  "task.created",
  "task.status.changed",
  "node.disconnected",
  "node.reconnected",
  "sync.conflict.detected",
  "ai.summary.generated",
  "ai.tool.invoked",
  "report.created",
  "report.updated",
  "media.attached",
  "media.derivative.created",
  "sketch.drawing.created",
  "sketch.drawing.updated",
  "sketch.drawing.deleted",
  "notification.requested",
  "source.status.changed"
] as const;

export type DomainEventType = (typeof domainEventTypes)[number];

export interface FederatedNodeRecord {
  capabilities: string[];
  classificationMax: PilotClassificationLevel;
  contractVersion: "cop-federation-node-v1";
  detail?: string;
  health: FederatedNodeHealth;
  lastSeenAt: string;
  nodeId: string;
  nodeName: string;
  nodeRole: FederatedNodeRole;
  softwareVersion: string;
}

export interface DomainClassification {
  handlingCaveats: string[];
  level: PilotClassificationLevel;
  releasability: string[];
}

export interface DomainReleasePolicy {
  allowedScopes: string[];
  visibility: "event" | "group" | "internal" | "private" | "public";
}

export interface DomainEventQuality {
  confidence?: number;
  dataQuality?: "mixed" | "modelled" | "observed" | "unknown";
  sourceReliability?: string;
  stale?: boolean;
}

export interface CopDomainEventData {
  classification: DomainClassification;
  contractVersion: "cop-domain-event-v1";
  correlationId: string;
  entityId: string;
  entityType: DomainEntityType;
  payload: Record<string, unknown>;
  producerNodeId: string;
  provenance: Array<Record<string, unknown>>;
  quality: DomainEventQuality;
  releasePolicy: DomainReleasePolicy;
}

export interface DomainCloudEvent {
  data: CopDomainEventData;
  datacontenttype: "application/json";
  id: string;
  source: string;
  specversion: "1.0";
  subject?: string;
  time: string;
  type: DomainEventType;
}

export type DomainEventRecord = DomainCloudEvent & {
  channel: DomainEventChannel;
  receivedAt: string;
  replayOffset: number;
};

export interface DomainDeadLetterRecord {
  body: unknown;
  channel: DomainEventChannel;
  correlationId: string;
  deadLetterId: string;
  errorCode: string;
  message: string;
  receivedAt: string;
}

export interface DomainEventPublishInput {
  channel?: DomainEventChannel;
  classification?: Partial<DomainClassification>;
  correlationId: string;
  entityId: string;
  entityType: DomainEntityType;
  eventId?: string;
  payload: Record<string, unknown>;
  producerNodeId: string;
  provenance?: Array<Record<string, unknown>>;
  quality?: DomainEventQuality;
  releasePolicy?: Partial<DomainReleasePolicy>;
  source?: string;
  subject?: string;
  time?: string;
  type: DomainEventType;
}

export interface DomainEventReplayQuery {
  entityId?: string;
  fromOffset?: number;
  fromTime?: string;
  limit: number;
  producerNodeId?: string;
  toTime?: string;
  type?: DomainEventType;
}

export interface DomainEventParseResult {
  input?: DomainEventPublishInput;
  message?: string;
  ok: boolean;
}

export interface EdgeOutboxFlushItemResult {
  clientEventId?: string;
  errorCode?: string;
  eventId?: string;
  message?: string;
  replayOffset?: number;
  status: "accepted" | "duplicate" | "rejected";
}

export function createDefaultFederatedNodes(now: Date = new Date()): Map<string, FederatedNodeRecord> {
  const timestamp = now.toISOString();
  return new Map([
    [
      "node_central_cop",
      {
        capabilities: ["domain-events", "audit-events", "map-features", "notification-decisions", "mcp-gateway"],
        classificationMax: "SENSITIVE",
        contractVersion: "cop-federation-node-v1",
        health: "ok",
        lastSeenAt: timestamp,
        nodeId: "node_central_cop",
        nodeName: "CSM/COP Central",
        nodeRole: "central-orchestrator",
        softwareVersion: process.env.npm_package_version ?? "0.1.0"
      }
    ],
    [
      "node_sim_provider",
      {
        capabilities: ["map-features", "provider-observability", "domain-events"],
        classificationMax: "INTERNAL",
        contractVersion: "cop-federation-node-v1",
        health: "ok",
        lastSeenAt: timestamp,
        nodeId: "node_sim_provider",
        nodeName: "SIM Provider Gateway",
        nodeRole: "provider-node",
        softwareVersion: "external"
      }
    ],
    [
      "node_csm_messaging",
      {
        capabilities: ["chat-metadata", "device-registry", "push-notifications", "delivery-audit"],
        classificationMax: "SENSITIVE",
        contractVersion: "cop-federation-node-v1",
        health: "ok",
        lastSeenAt: timestamp,
        nodeId: "node_csm_messaging",
        nodeName: "CSM Messaging",
        nodeRole: "messaging-node",
        softwareVersion: "external"
      }
    ]
  ]);
}

export function parseDomainEventPublishRequest(body: unknown, correlationId: string): DomainEventParseResult {
  if (!isRecord(body)) {
    return { ok: false, message: "Domain event request body must be an object." };
  }

  const type = stringValue(body.type);
  const producerNodeId = stringValue(body.producerNodeId ?? getRecord(body.data)?.producerNodeId);
  const entityId = stringValue(body.entityId ?? getRecord(body.data)?.entityId);
  const entityType = stringValue(body.entityType ?? getRecord(body.data)?.entityType);
  const payload = getRecord(body.payload ?? getRecord(body.data)?.payload);

  if (!isDomainEventType(type)) {
    return { ok: false, message: "Domain event type is missing or not supported." };
  }
  if (!producerNodeId) {
    return { ok: false, message: "producerNodeId is required." };
  }
  if (!entityId) {
    return { ok: false, message: "entityId is required." };
  }
  if (!isDomainEntityType(entityType)) {
    return { ok: false, message: "entityType is missing or not supported." };
  }
  if (!payload) {
    return { ok: false, message: "payload must be an object." };
  }

  const classification = parseClassification(body.classification ?? getRecord(body.data)?.classification);
  const releasePolicy = parseReleasePolicy(body.releasePolicy ?? getRecord(body.data)?.releasePolicy);
  const quality = parseQuality(body.quality ?? getRecord(body.data)?.quality);
  const provenance = parseProvenance(body.provenance ?? getRecord(body.data)?.provenance);
  const channel = parseDomainEventChannel(body.channel);

  return {
    input: {
      channel,
      classification,
      correlationId: stringValue(body.correlationId ?? getRecord(body.data)?.correlationId) || correlationId,
      entityId,
      entityType,
      eventId: stringValue(body.id ?? body.eventId),
      payload,
      producerNodeId,
      provenance,
      quality,
      releasePolicy,
      source: stringValue(body.source),
      subject: stringValue(body.subject),
      time: stringValue(body.time),
      type
    },
    ok: true
  };
}

export function publishDomainEvent(state: CopState, input: DomainEventPublishInput, now: Date = new Date()): DomainEventRecord {
  const existing = input.eventId ? state.domainEvents.find((event) => event.id === input.eventId) : undefined;
  if (existing) {
    return existing;
  }
  const time = input.time && !Number.isNaN(Date.parse(input.time)) ? new Date(input.time).toISOString() : now.toISOString();
  const channel = input.channel ?? defaultChannelForEventType(input.type);
  const replayOffset = state.domainEvents.length + 1;
  const event: DomainEventRecord = {
    channel,
    data: {
      classification: {
        handlingCaveats: input.classification?.handlingCaveats ?? [],
        level: input.classification?.level ?? "INTERNAL",
        releasability: input.classification?.releasability ?? ["CIVIL"]
      },
      contractVersion: "cop-domain-event-v1",
      correlationId: input.correlationId,
      entityId: input.entityId,
      entityType: input.entityType,
      payload: input.payload,
      producerNodeId: input.producerNodeId,
      provenance: input.provenance ?? [
        {
          nodeId: input.producerNodeId,
          observedAt: time,
          source: "cop-api"
        }
      ],
      quality: input.quality ?? {
        confidence: 1,
        dataQuality: "observed",
        stale: false
      },
      releasePolicy: {
        allowedScopes: input.releasePolicy?.allowedScopes ?? ["event"],
        visibility: input.releasePolicy?.visibility ?? "internal"
      }
    },
    datacontenttype: "application/json",
    id: input.eventId ?? randomUUID(),
    receivedAt: now.toISOString(),
    replayOffset,
    source: input.source ?? `urn:csm:node:${input.producerNodeId}`,
    specversion: "1.0",
    ...(input.subject || input.entityId ? { subject: input.subject ?? input.entityId } : {}),
    time,
    type: input.type
  };
  state.domainEvents.push(event);
  return event;
}

export function appendDomainDeadLetter(
  state: CopState,
  input: {
    body: unknown;
    channel?: DomainEventChannel;
    correlationId: string;
    errorCode: string;
    message: string;
    now?: Date;
  }
): DomainDeadLetterRecord {
  const record: DomainDeadLetterRecord = {
    body: sanitizeDeadLetterBody(input.body),
    channel: input.channel ?? "cop.domain.events",
    correlationId: input.correlationId,
    deadLetterId: randomUUID(),
    errorCode: input.errorCode,
    message: input.message,
    receivedAt: (input.now ?? new Date()).toISOString()
  };
  state.domainDeadLetters.push(record);
  return record;
}

export function queryDomainEvents(state: CopState, query: DomainEventReplayQuery): DomainEventRecord[] {
  return state.domainEvents
    .filter((event) => query.fromOffset === undefined || event.replayOffset > query.fromOffset)
    .filter((event) => !query.type || event.type === query.type)
    .filter((event) => !query.entityId || event.data.entityId === query.entityId)
    .filter((event) => !query.producerNodeId || event.data.producerNodeId === query.producerNodeId)
    .filter((event) => !query.fromTime || event.time >= query.fromTime)
    .filter((event) => !query.toTime || event.time <= query.toTime)
    .slice(0, query.limit);
}

export function parseDomainEventReplayQuery(query: unknown): DomainEventReplayQuery {
  const record = isRecord(query) ? query : {};
  const type = stringValue(record.type);
  const parsedLimit = Number.parseInt(stringValue(record.limit) ?? "", 10);
  const parsedOffset = Number.parseInt(stringValue(record.fromOffset) ?? "", 10);
  const fromTime = validDateString(record.from ?? record.fromTime);
  const toTime = validDateString(record.to ?? record.toTime);
  return {
    ...(stringValue(record.entityId) ? { entityId: stringValue(record.entityId) } : {}),
    ...(Number.isFinite(parsedOffset) && parsedOffset >= 0 ? { fromOffset: parsedOffset } : {}),
    ...(fromTime ? { fromTime } : {}),
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100,
    ...(stringValue(record.producerNodeId) ? { producerNodeId: stringValue(record.producerNodeId) } : {}),
    ...(toTime ? { toTime } : {}),
    ...(isDomainEventType(type) ? { type } : {})
  };
}

export function updateFederatedNodeHeartbeat(
  state: CopState,
  nodeId: string,
  body: unknown,
  now: Date = new Date()
): { node?: FederatedNodeRecord; ok: boolean; message?: string } {
  if (!nodeId.trim()) {
    return { ok: false, message: "nodeId is required." };
  }
  if (!isRecord(body)) {
    return { ok: false, message: "Heartbeat body must be an object." };
  }
  const existing = state.federatedNodes.get(nodeId);
  const nodeRole = stringValue(body.nodeRole);
  const health = stringValue(body.health);
  const classificationMax = stringValue(body.classificationMax);
  const resolvedRole = isFederatedNodeRole(nodeRole) ? nodeRole : existing?.nodeRole;
  if (!resolvedRole) {
    return { ok: false, message: "nodeRole is required for new nodes." };
  }

  const updated: FederatedNodeRecord = {
    capabilities: parseStringArray(body.capabilities) ?? existing?.capabilities ?? [],
    classificationMax: isPilotClassificationLevel(classificationMax) ? classificationMax : existing?.classificationMax ?? "INTERNAL",
    contractVersion: "cop-federation-node-v1",
    ...(stringValue(body.detail) ? { detail: stringValue(body.detail) } : existing?.detail ? { detail: existing.detail } : {}),
    health: isFederatedNodeHealth(health) ? health : existing?.health ?? "ok",
    lastSeenAt: now.toISOString(),
    nodeId,
    nodeName: stringValue(body.nodeName) ?? existing?.nodeName ?? nodeId,
    nodeRole: resolvedRole,
    softwareVersion: stringValue(body.softwareVersion) ?? existing?.softwareVersion ?? "unknown"
  };
  state.federatedNodes.set(nodeId, updated);
  return { node: updated, ok: true };
}

export function defaultChannelForEventType(type: DomainEventType): DomainEventChannel {
  if (type.startsWith("ai.")) {
    return "cop.ai.audit";
  }
  if (type === "notification.requested") {
    return "cop.notifications.requested";
  }
  if (type.startsWith("node.") || type.startsWith("sync.")) {
    return "cop.node.sync";
  }
  if (type === "source.status.changed") {
    return "cop.provider.health";
  }
  return "cop.domain.events";
}

function parseClassification(value: unknown): Partial<DomainClassification> {
  const record = getRecord(value);
  if (!record) {
    return {};
  }
  const level = stringValue(record.level);
  return {
    ...(parseStringArray(record.handlingCaveats) ? { handlingCaveats: parseStringArray(record.handlingCaveats) } : {}),
    ...(isPilotClassificationLevel(level) ? { level } : {}),
    ...(parseStringArray(record.releasability) ? { releasability: parseStringArray(record.releasability) } : {})
  };
}

function parseReleasePolicy(value: unknown): Partial<DomainReleasePolicy> {
  const record = getRecord(value);
  if (!record) {
    return {};
  }
  const visibility = stringValue(record.visibility);
  return {
    ...(parseStringArray(record.allowedScopes) ? { allowedScopes: parseStringArray(record.allowedScopes) } : {}),
    ...(visibility === "event" || visibility === "group" || visibility === "internal" || visibility === "private" || visibility === "public"
      ? { visibility }
      : {})
  };
}

function parseQuality(value: unknown): DomainEventQuality | undefined {
  const record = getRecord(value);
  if (!record) {
    return undefined;
  }
  const confidence = typeof record.confidence === "number" ? record.confidence : undefined;
  const dataQuality = stringValue(record.dataQuality);
  const parsed: DomainEventQuality = {
    ...(confidence !== undefined ? { confidence: Math.max(0, Math.min(1, confidence)) } : {}),
    ...(dataQuality === "mixed" || dataQuality === "modelled" || dataQuality === "observed" || dataQuality === "unknown" ? { dataQuality } : {}),
    ...(stringValue(record.sourceReliability) ? { sourceReliability: stringValue(record.sourceReliability) } : {}),
    ...(typeof record.stale === "boolean" ? { stale: record.stale } : {})
  };
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseProvenance(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(isRecord);
}

function parseDomainEventChannel(value: unknown): DomainEventChannel | undefined {
  const channel = stringValue(value);
  if (
    channel === "cop.ai.audit"
    || channel === "cop.audit.events"
    || channel === "cop.domain.events"
    || channel === "cop.node.sync"
    || channel === "cop.notifications.requested"
    || channel === "cop.provider.health"
  ) {
    return channel;
  }
  return undefined;
}

function sanitizeDeadLetterBody(body: unknown): unknown {
  if (!isRecord(body)) {
    return body;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    clone[key] = /token|secret|password|authorization/iu.test(key) ? "[redacted]" : value;
  }
  return clone;
}

function validDateString(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text || Number.isNaN(Date.parse(text))) {
    return undefined;
  }
  return new Date(text).toISOString();
}

function isDomainEventType(value: unknown): value is DomainEventType {
  return typeof value === "string" && (domainEventTypes as readonly string[]).includes(value);
}

function isDomainEntityType(value: unknown): value is DomainEntityType {
  return typeof value === "string" && [
    "alert",
    "auditRecord",
    "communityReport",
    "evidence",
    "incident",
    "resource",
    "sensorObservation",
    "sketchDrawing",
    "sourceSystem",
    "task",
    "unit",
    "userZone"
  ].includes(value);
}

function isFederatedNodeRole(value: unknown): value is FederatedNodeRole {
  return typeof value === "string" && (federationNodeRoles as readonly string[]).includes(value);
}

function isFederatedNodeHealth(value: unknown): value is FederatedNodeHealth {
  return value === "degraded" || value === "offline" || value === "ok";
}

function isPilotClassificationLevel(value: unknown): value is PilotClassificationLevel {
  return value === "INTERNAL" || value === "PUBLIC" || value === "RESTRICTED_SIMULATED" || value === "SENSITIVE";
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
