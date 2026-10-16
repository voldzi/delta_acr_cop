import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, open, readFile, readdir, rename, unlink, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ServiceTokenProvider, type ServiceAuthMode } from "@cop/core/service-token";
import { EdgeErasureError, edgeErasurePreflight, edgeResourcesDigest, edgeErasureProof, edgeEventAllowed, eraseEdgeCopies, installEdgeErasureFence, parseEdgeErasureRequest, validateEdgeErasureJournal, type EdgeErasureState } from "./account-erasure.js";

type EdgeMode = "ONLINE" | "DEGRADED" | "OFFLINE";
type EdgeHealth = "degraded" | "offline" | "ok";
type ClassificationLevel = "INTERNAL" | "PUBLIC" | "RESTRICTED_SIMULATED" | "SENSITIVE";
type DomainEntityType =
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
type DomainEventType =
  | "incident.created"
  | "incident.updated"
  | "incident.merged"
  | "unit.status.updated"
  | "resource.capacity.updated"
  | "sensor.observation.created"
  | "alert.raised"
  | "alert.acknowledged"
  | "task.created"
  | "task.status.changed"
  | "node.disconnected"
  | "node.reconnected"
  | "sync.conflict.detected"
  | "ai.summary.generated"
  | "ai.tool.invoked"
  | "report.created"
  | "report.updated"
  | "media.attached"
  | "media.derivative.created"
  | "sketch.drawing.created"
  | "sketch.drawing.updated"
  | "sketch.drawing.deleted"
  | "notification.requested"
  | "source.status.changed";

export interface EdgeNodeStatus {
  cachedSnapshotObjects: number;
  lastError: string | null;
  lastSyncAt: string | null;
  mode: EdgeMode;
  outboxItems: number;
  replayOffset: number;
}

interface EdgeConfig {
  adminToken: string;
  autoSync: boolean;
  centralAuthMode?: ServiceAuthMode;
  centralApiUrl: string;
  centralOidcIssuer?: string;
  centralOidcClientId?: string;
  centralOidcClientSecret?: string;
  centralTimeoutMs?: number;
  centralMaxResponseBytes?: number;
  centralToken: string;
  classificationMax: ClassificationLevel;
  dataDir: string;
  host: string;
  nodeId: string;
  nodeName: string;
  port: number;
  softwareVersion: string;
  syncIntervalMs: number;
}

interface EdgeQueuedEvent {
  clientEventId: string;
  createdAt: string;
  event: EdgeOutboxEvent;
  lastError?: string;
  status: "pending" | "rejected";
}

interface EdgeOutboxEvent {
  classification?: Partial<EdgeClassification>;
  correlationId: string;
  entityId: string;
  entityType: DomainEntityType;
  eventId?: string;
  payload: Record<string, unknown>;
  producerNodeId?: string;
  provenance?: Array<Record<string, unknown>>;
  quality?: Record<string, unknown>;
  releasePolicy?: Partial<EdgeReleasePolicy>;
  source?: string;
  subject?: string;
  time?: string;
  type: DomainEventType;
}

interface EdgeClassification {
  handlingCaveats: string[];
  level: ClassificationLevel;
  releasability: string[];
}

interface EdgeReleasePolicy {
  allowedScopes: string[];
  visibility: "event" | "group" | "internal" | "private" | "public";
}

interface EdgeStoredEvent {
  event: Record<string, unknown>;
  eventId: string;
  receivedAt: string;
  replayOffset: number;
}

interface EdgeState extends EdgeErasureState {
  contractVersion: "cop-edge-node-state-v1";
  cursor: {
    lastAckedOffset: number;
    lastReplayAt: string | null;
  };
  deadLetters: EdgeQueuedEvent[];
  inboundEvents: EdgeStoredEvent[];
  node: {
    classificationMax: ClassificationLevel;
    lastHeartbeatAt: string | null;
    nodeId: string;
    nodeName: string;
    softwareVersion: string;
  };
  outbox: EdgeQueuedEvent[];
  sync: {
    lastError: string | null;
    lastSyncAt: string | null;
    mode: EdgeMode;
  };
  updatedAt: string;
}

interface EdgeReplayResponse {
  items?: Array<Record<string, unknown> & { id?: string; replayOffset?: number }>;
  nextOffset?: number;
}

interface EdgeOutboxFlushResponse {
  items?: Array<{
    clientEventId?: string;
    errorCode?: string;
    message?: string;
    replayOffset?: number;
    status?: "accepted" | "duplicate" | "rejected";
  }>;
}

interface EdgeSyncResult {
  flushed: {
    accepted: number;
    duplicate: number;
    rejected: number;
  };
  mode: EdgeMode;
  pulled: number;
  replayOffset: number;
  status: "ok" | "degraded";
}

export function createInitialEdgeStatus(): EdgeNodeStatus {
  return {
    cachedSnapshotObjects: 0,
    lastError: null,
    lastSyncAt: null,
    mode: "DEGRADED",
    outboxItems: 0,
    replayOffset: 0
  };
}

export function readEdgeConfig(env: Record<string, string | undefined> = process.env): EdgeConfig {
  return {
    adminToken: env.COP_EDGE_ADMIN_TOKEN?.trim() ?? "",
    autoSync: readBoolean(env.COP_EDGE_AUTO_SYNC, true),
    centralAuthMode: readCentralAuthMode(env.COP_EDGE_CENTRAL_AUTH_MODE),
    centralApiUrl: trimTrailingSlash(env.COP_EDGE_CENTRAL_API_URL ?? "http://localhost:4310"),
    centralOidcIssuer: env.COP_EDGE_CENTRAL_OIDC_ISSUER?.trim(),
    centralOidcClientId: env.COP_EDGE_CENTRAL_OIDC_CLIENT_ID?.trim(),
    centralOidcClientSecret: env.COP_EDGE_CENTRAL_OIDC_CLIENT_SECRET?.trim(),
    centralTimeoutMs: readInteger(env.COP_EDGE_CENTRAL_TIMEOUT_MS, 10_000, 500, 120_000),
    centralMaxResponseBytes: readInteger(env.COP_EDGE_CENTRAL_MAX_RESPONSE_BYTES, 16 * 1024 * 1024, 1024, 128 * 1024 * 1024),
    centralToken: env.COP_EDGE_CENTRAL_TOKEN?.trim() ?? "",
    classificationMax: readClassification(env.COP_EDGE_CLASSIFICATION_MAX),
    dataDir: env.COP_EDGE_DATA_DIR?.trim() || path.resolve(process.cwd(), ".cop-edge"),
    host: env.COP_EDGE_HOST?.trim() || "0.0.0.0",
    nodeId: env.COP_EDGE_NODE_ID?.trim() || "node_edge_pilot_01",
    nodeName: env.COP_EDGE_NODE_NAME?.trim() || "CSM Edge Pilot Node",
    port: readInteger(env.COP_EDGE_PORT, 4312, 1, 65_535),
    softwareVersion: env.npm_package_version ?? "0.1.0",
    syncIntervalMs: readInteger(env.COP_EDGE_SYNC_INTERVAL_MS, 10_000, 1_000, 3_600_000)
  };
}

export class EdgeRuntime {
  private readonly statePath: string;
  private readonly centralAuth: ServiceTokenProvider;
  private state: EdgeState;
  private syncInProgress = false;
  private serialQueue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly config: EdgeConfig,
    state: EdgeState
  ) {
    this.state = state;
    this.statePath = path.join(config.dataDir, "state.json");
    this.centralAuth = new ServiceTokenProvider({
      mode: config.centralAuthMode ?? "static",
      staticToken: config.centralToken,
      issuer: config.centralOidcIssuer,
      clientId: config.centralOidcClientId,
      clientSecret: config.centralOidcClientSecret,
      timeoutMs: Math.min(config.centralTimeoutMs ?? 10_000, 30_000)
    });
  }

  static async create(config: EdgeConfig): Promise<EdgeRuntime> {
    await mkdir(config.dataDir, { recursive: true });
    const statePath = path.join(config.dataDir, "state.json");
    const state = await readStateFile(statePath, config);
    const runtime = new EdgeRuntime(config, state);
    await runtime.persist();
    return runtime;
  }

  getStatus(): EdgeNodeStatus {
    return {
      cachedSnapshotObjects: this.state.inboundEvents.length,
      lastError: this.state.sync.lastError,
      lastSyncAt: this.state.sync.lastSyncAt,
      mode: this.state.sync.mode,
      outboxItems: this.state.outbox.filter((item) => item.status === "pending").length,
      replayOffset: this.state.cursor.lastAckedOffset
    };
  }

  getPublicState(limit = 50): Record<string, unknown> {
    const status = this.getStatus();
    return {
      contractVersion: "cop-edge-node-status-v1",
      generatedAt: new Date().toISOString(),
      node: {
        classificationMax: this.state.node.classificationMax,
        lastHeartbeatAt: this.state.node.lastHeartbeatAt,
        nodeId: this.state.node.nodeId,
        nodeName: this.state.node.nodeName,
        softwareVersion: this.state.node.softwareVersion
      },
      status,
      summary: {
        cachedEvents: this.state.inboundEvents.length,
        deadLetters: this.state.deadLetters.length,
        outboxItems: status.outboxItems,
        replayOffset: status.replayOffset
      },
      recentEvents: this.state.inboundEvents.slice(-limit).reverse()
    };
  }

  async queueOutboxEvent(value: unknown): Promise<EdgeQueuedEvent> {
    return this.exclusive(() => this.queueOutboxEventLocked(value));
  }

  private async queueOutboxEventLocked(value: unknown): Promise<EdgeQueuedEvent> {
    const now = new Date().toISOString();
    const record = isRecord(value) ? value : {};
    const clientEventId = stringValue(record.clientEventId) || stringValue(record.eventId) || stringValue(record.id) || randomUUID();
    const payload = isRecord(record.payload) ? record.payload : {};
    const event: EdgeOutboxEvent = {
      classification: isRecord(record.classification)
        ? record.classification as Partial<EdgeClassification>
        : { handlingCaveats: ["EDGE_OFFLINE_CAPTURE"], level: "INTERNAL", releasability: ["CIVIL"] },
      correlationId: stringValue(record.correlationId) || clientEventId,
      entityId: stringValue(record.entityId) || clientEventId,
      entityType: readEntityType(record.entityType),
      eventId: clientEventId,
      payload,
      producerNodeId: this.config.nodeId,
      provenance: Array.isArray(record.provenance)
        ? record.provenance.filter(isRecord)
        : [{ nodeId: this.config.nodeId, observedAt: now, source: "cop-edge-node" }],
      releasePolicy: isRecord(record.releasePolicy)
        ? record.releasePolicy as Partial<EdgeReleasePolicy>
        : { allowedScopes: ["internal", "edge-node"], visibility: "internal" },
      source: stringValue(record.source) || `urn:cop:edge:${this.config.nodeId}`,
      time: stringValue(record.time) || now,
      type: readEventType(record.type)
    };
    const queued: EdgeQueuedEvent = {
      clientEventId,
      createdAt: now,
      event,
      status: "pending"
    };
    if (!edgeEventAllowed(this.state, event)) { await this.persist(); throw new EdgeErasureError(403, "EDGE_ERASURE_FENCED"); }
    this.state.outbox.push(queued);
    await this.persist();
    return queued;
  }

  async syncOnce(): Promise<EdgeSyncResult> {
    return this.exclusive(() => this.syncOnceLocked());
  }

  private async syncOnceLocked(): Promise<EdgeSyncResult> {
    if (this.syncInProgress) {
      return {
        flushed: { accepted: 0, duplicate: 0, rejected: 0 },
        mode: this.state.sync.mode,
        pulled: 0,
        replayOffset: this.state.cursor.lastAckedOffset,
        status: this.state.sync.mode === "ONLINE" ? "ok" : "degraded"
      };
    }

    this.syncInProgress = true;
    const result: EdgeSyncResult = {
      flushed: { accepted: 0, duplicate: 0, rejected: 0 },
      mode: "DEGRADED",
      pulled: 0,
      replayOffset: this.state.cursor.lastAckedOffset,
      status: "degraded"
    };
    try {
      await this.heartbeat("ok");
      result.flushed = await this.flushOutbox();
      result.pulled = await this.pullReplay();
      result.replayOffset = this.state.cursor.lastAckedOffset;
      this.state.sync = {
        lastError: null,
        lastSyncAt: new Date().toISOString(),
        mode: "ONLINE"
      };
      result.mode = "ONLINE";
      result.status = "ok";
    } catch (error) {
      const message = errorMessage(error);
      this.state.sync = {
        lastError: message,
        lastSyncAt: this.state.sync.lastSyncAt,
        mode: this.state.sync.lastSyncAt ? "DEGRADED" : "OFFLINE"
      };
      result.mode = this.state.sync.mode;
      await this.safeHeartbeat("degraded", message);
    } finally {
      this.state.updatedAt = new Date().toISOString();
      this.syncInProgress = false;
      await this.persist();
    }
    return result;
  }

  private async safeHeartbeat(health: EdgeHealth, detail: string): Promise<void> {
    try {
      await this.heartbeat(health, detail);
    } catch {
      // Central API is already known unavailable; keep the local state only.
    }
  }

  private async heartbeat(health: EdgeHealth, detail?: string): Promise<void> {
    await this.centralRequest(`/api/v1/federation/nodes/${encodeURIComponent(this.config.nodeId)}/heartbeat`, {
      body: JSON.stringify({
        capabilities: ["offline-outbox", "domain-events", "edge-replay", "local-cache"],
        classificationMax: this.config.classificationMax,
        ...(detail ? { detail } : {}),
        health,
        nodeName: this.config.nodeName,
        nodeRole: "edge-node",
        softwareVersion: this.config.softwareVersion
      }),
      method: "POST"
    });
    this.state.node.lastHeartbeatAt = new Date().toISOString();
  }

  private async flushOutbox(): Promise<EdgeSyncResult["flushed"]> {
    const pending = this.state.outbox.filter((item) => item.status === "pending");
    if (pending.length === 0) {
      return { accepted: 0, duplicate: 0, rejected: 0 };
    }

    const response = await this.centralRequest<EdgeOutboxFlushResponse>("/api/v1/edge/outbox/flush", {
      body: JSON.stringify({
        events: pending.map((item) => ({
          clientEventId: item.clientEventId,
          ...item.event
        })),
        nodeId: this.config.nodeId
      }),
      method: "POST"
    });
    const acceptedIds = new Set<string>();
    const rejectedIds = new Set<string>();
    let accepted = 0;
    let duplicate = 0;
    let rejected = 0;

    for (const item of response.items ?? []) {
      if (!item.clientEventId) {
        continue;
      }
      if (item.status === "accepted" || item.status === "duplicate") {
        acceptedIds.add(item.clientEventId);
        if (item.status === "accepted") {
          accepted += 1;
        } else {
          duplicate += 1;
        }
      } else if (item.status === "rejected") {
        rejectedIds.add(item.clientEventId);
        rejected += 1;
        const queued = pending.find((candidate) => candidate.clientEventId === item.clientEventId);
        if (queued) {
          this.state.deadLetters.push({
            ...queued,
            lastError: item.message ?? item.errorCode ?? "Rejected by central COP",
            status: "rejected"
          });
        }
      }
    }

    this.state.outbox = this.state.outbox.filter((item) => !acceptedIds.has(item.clientEventId) && !rejectedIds.has(item.clientEventId));
    this.state.deadLetters = this.state.deadLetters.slice(-1_000);
    return { accepted, duplicate, rejected };
  }

  private async pullReplay(): Promise<number> {
    const fromOffset = this.state.cursor.lastAckedOffset;
    const replay = await this.centralRequest<EdgeReplayResponse>(
      `/api/v1/edge/replay/${encodeURIComponent(this.config.nodeId)}?fromOffset=${fromOffset}&limit=100`,
      { method: "GET" }
    );
    const items = replay.items ?? [];
    const known = new Set(this.state.inboundEvents.map((item) => item.eventId));
    for (const item of items) {
      if (!edgeEventAllowed(this.state, item)) continue;
      const eventId = typeof item.id === "string" ? item.id : randomUUID();
      if (known.has(eventId)) {
        continue;
      }
      const replayOffset = Number.isInteger(item.replayOffset) ? Number(item.replayOffset) : fromOffset;
      this.state.inboundEvents.push({
        event: item,
        eventId,
        receivedAt: new Date().toISOString(),
        replayOffset
      });
      known.add(eventId);
    }
    this.state.inboundEvents = this.state.inboundEvents.slice(-2_000);
    const nextOffset = Number.isInteger(replay.nextOffset) ? Number(replay.nextOffset) : Math.max(fromOffset, ...items.map((item) => Number(item.replayOffset) || 0));
    if (nextOffset > fromOffset || items.length > 0) {
      await this.centralRequest(`/api/v1/edge/replay-cursors/${encodeURIComponent(this.config.nodeId)}/ack`, {
        body: JSON.stringify({ lastAckedOffset: nextOffset }),
        method: "POST"
      });
      this.state.cursor = {
        lastAckedOffset: Math.max(this.state.cursor.lastAckedOffset, nextOffset),
        lastReplayAt: new Date().toISOString()
      };
    }
    return items.length;
  }

  private async centralRequest<T = Record<string, unknown>>(route: string, init: RequestInit): Promise<T> {
    let token: string;
    try {
      token = await this.centralAuth.getToken();
      if (!token.trim()) throw new Error("Missing central credential.");
    } catch {
      throw new Error("Central COP authentication is unavailable.");
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let text: string;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(centralTimeoutError());
        }, this.config.centralTimeoutMs ?? 10_000);
      });
      text = await Promise.race([
        this.fetchCentralText(route, init, token, controller.signal),
        deadline
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const body = text ? parseJson(text) : {};
    return body as T;
  }

  private async fetchCentralText(route: string, init: RequestInit, token: string, signal: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.config.centralApiUrl}${route}`, {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.headers ?? {}),
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        signal,
        redirect: "error"
      });
    } catch {
      throw signal.aborted ? centralTimeoutError() : new Error("Central COP request is unavailable.");
    }
    if (signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      throw centralTimeoutError();
    }
    if (response.status === 401) this.centralAuth.invalidate(token);
    if (!response.ok) {
      // Never wait on or reflect an upstream error body.
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`Central COP request failed (HTTP ${response.status}).`);
    }
    return readCentralResponseText(response, signal, this.config.centralMaxResponseBytes ?? 16 * 1024 * 1024);
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serialQueue.then(work);
    this.serialQueue = result.catch(() => undefined);
    return result;
  }

  private async diskReadback(): Promise<void> {
    const bytes = await readFile(this.statePath, "utf8");
    if (JSON.stringify(JSON.parse(bytes)) !== JSON.stringify(this.state)) throw new EdgeErasureError(503, "EDGE_ERASURE_STATE_READBACK_FAILED");
  }

  async accountErasureCapabilities(): Promise<Record<string, unknown>> {
    return this.exclusive(async () => {
      await this.diskReadback();
      return { contractVersion: "cop-edge-account-erasure-v1", nodeId: this.config.nodeId, writerFenceInstalled: true, stateReadbackVerified: true };
    });
  }

  async eraseAccount(value: unknown): Promise<Record<string, unknown>> {
    const input = parseEdgeErasureRequest(value);
    return this.exclusive(async () => {
      await this.diskReadback();
      const result = { contractVersion: "cop-edge-account-erasure-v1", nodeId: this.config.nodeId, accountKey: input.accountKey,
        operationId: input.operationId, datasetBinding: input.datasetBinding, resourcesDigest: edgeResourcesDigest(input.resources) };
      if (input.phase === "preflight") {
        const ready = edgeErasurePreflight(this.state, input);
        return { ...result, state: ready ? "ready" : "pending", ...(!ready ? { reason: "ownership_unresolved" } : {}) };
      }
      const fence = installEdgeErasureFence(this.state, input);
      // Persist the fence before touching payload copies. Crash at either point
      // remains pending and is recoverable by the original operation only.
      await this.persist();
      const absent = eraseEdgeCopies(this.state, fence);
      await this.persist();
      await this.removeObsoleteStateCopies();
      await this.diskReadback();
      if (!absent) return { ...result, state: "pending", reason: "ownership_unresolved" };
      fence.proofId = edgeErasureProof(this.state, fence, this.config.nodeId);
      await this.persist(); await this.diskReadback();
      return { ...result, state: "completed", proofId: fence.proofId };
    });
  }

  private async removeObsoleteStateCopies(): Promise<void> {
    // This directory is exclusively owned by this single edge service. These
    // are only its known abandoned atomic-write snapshots, never user files.
    const names = await readdir(this.config.dataDir);
    if (names.length > 10000) throw new EdgeErasureError(503, "EDGE_ERASURE_STATE_COPIES_UNVERIFIED");
    for (const name of names) {
      if (!/^state\.json\.[0-9]+\.[0-9]+(?:\.[a-f0-9-]+)?\.tmp$/u.test(name)) continue;
      const target = path.join(this.config.dataDir, name), metadata = await lstat(target);
      if (!metadata.isFile() || metadata.nlink !== 1) throw new EdgeErasureError(503, "EDGE_ERASURE_STATE_COPIES_UNVERIFIED");
      await unlink(target);
    }
  }

  private async persist(): Promise<void> {
    this.state.updatedAt = new Date().toISOString();
    const tmpPath = `${this.statePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    const file = await open(tmpPath, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(this.state, null, 2)}\n`, "utf8"); await file.sync(); } finally { await file.close(); }
    await rename(tmpPath, this.statePath);
    if (this.state.accountErasure?.fences.length) {
      const marker = await open(path.join(this.config.dataDir, ".erasure-fence-v1"), "a", 0o600);
      try { await marker.sync(); } finally { await marker.close(); }
    }
    const directory = await open(this.config.dataDir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

export async function startEdgeServer(config: EdgeConfig = readEdgeConfig()): Promise<void> {
  const runtime = await EdgeRuntime.create(config);
  if (config.autoSync) {
    void runtime.syncOnce();
  }
  const timer = config.autoSync
    ? setInterval(() => {
        void runtime.syncOnce();
      }, config.syncIntervalMs)
    : undefined;

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(config, runtime, request, response);
    } catch (error) {
      sendJson(response, error instanceof EdgeErasureError ? error.status : 500, {
        error: { code: error instanceof EdgeErasureError ? error.code : "INTERNAL_ERROR",
          message: error instanceof EdgeErasureError ? "Edge account operation is unavailable." : errorMessage(error),
          ...(error instanceof EdgeErasureError ? { correlationId: randomUUID() } : {}) }
      });
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(JSON.stringify({
      contractVersion: "cop-edge-node-runtime-v1",
      event: "edge-node-started",
      nodeId: config.nodeId,
      port: config.port
    }));
  });

  const shutdown = () => {
    if (timer) {
      clearInterval(timer);
    }
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export async function handleRequest(config: EdgeConfig, runtime: EdgeRuntime, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method?.toUpperCase() ?? "GET";
  const url = new URL(request.url ?? "/", "http://edge.local");
  const route = normalizeRoute(url.pathname);

  if (route === "/internal/account-erasure/capabilities" && method === "GET" || route === "/internal/account-erasure" && method === "POST") {
    if (!isAdminAuthorized(config, request)) { sendJson(response, 401, { error: { code: "UNAUTHORIZED", message: "Edge admin token is required.", correlationId: randomUUID() } }); return; }
    try {
      let input: unknown;
      if (method === "POST") {
        try { input = await readJsonBody(request); }
        catch { throw new EdgeErasureError(400, "EDGE_ERASURE_REQUEST_INVALID"); }
      }
      const result = method === "GET" ? await runtime.accountErasureCapabilities() : await runtime.eraseAccount(input);
      sendJson(response, result.state === "pending" ? 202 : 200, result);
    } catch (error) {
      sendJson(response, error instanceof EdgeErasureError ? error.status : 503,
        { error: { code: error instanceof EdgeErasureError ? error.code : "EDGE_ERASURE_STATE_UNAVAILABLE", message: "Edge account erasure is unavailable.", correlationId: randomUUID() } });
    }
    return;
  }

  if (method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (method === "GET" && (route === "/" || route === "/status")) {
    if (acceptsHtml(request)) {
      sendHtml(response, renderStatusPage(runtime.getPublicState()));
    } else {
      sendJson(response, 200, runtime.getPublicState(readLimit(url.searchParams.get("limit"), 50, 500)));
    }
    return;
  }

  if (method === "GET" && route === "/events") {
    sendJson(response, 200, runtime.getPublicState(readLimit(url.searchParams.get("limit"), 100, 1_000)));
    return;
  }

  if (method === "GET" && (route === "/health/live" || route === "/live")) {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (method === "GET" && (route === "/health/ready" || route === "/ready")) {
    sendJson(response, 200, {
      status: runtime.getStatus().mode === "OFFLINE" ? "degraded" : "ok",
      ...runtime.getStatus()
    });
    return;
  }

  if (method === "POST" && route === "/sync") {
    if (!isAdminAuthorized(config, request)) {
      sendJson(response, 401, { error: { code: "UNAUTHORIZED", message: "Edge admin token is required." } });
      return;
    }
    const result = await runtime.syncOnce();
    sendJson(response, 202, {
      contractVersion: "cop-edge-sync-result-v1",
      generatedAt: new Date().toISOString(),
      result
    });
    return;
  }

  if (method === "POST" && route === "/outbox") {
    if (!isAdminAuthorized(config, request)) {
      sendJson(response, 401, { error: { code: "UNAUTHORIZED", message: "Edge admin token is required." } });
      return;
    }
    const body = await readJsonBody(request);
    const queued = await runtime.queueOutboxEvent(body);
    sendJson(response, 202, {
      contractVersion: "cop-edge-outbox-queued-v1",
      item: {
        clientEventId: queued.clientEventId,
        createdAt: queued.createdAt,
        status: queued.status
      }
    });
    return;
  }

  sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Edge endpoint was not found." } });
}

async function readStateFile(statePath: string, config: EdgeConfig): Promise<EdgeState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = parseJson(raw);
    if (isValidState(parsed)) {
      return {
        ...parsed,
        node: {
          ...parsed.node,
          classificationMax: config.classificationMax,
          nodeId: config.nodeId,
          nodeName: config.nodeName,
          softwareVersion: config.softwareVersion
        }
      };
    }
    throw new EdgeErasureError(503, "EDGE_STATE_FILE_INVALID");
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw new EdgeErasureError(503, "EDGE_STATE_FILE_INVALID");
    try { await readFile(path.join(config.dataDir, ".erasure-fence-v1")); throw new EdgeErasureError(503, "EDGE_ERASURE_STATE_MISSING"); }
    catch (markerError) { if (!isNodeErrorCode(markerError, "ENOENT")) throw new EdgeErasureError(503, "EDGE_ERASURE_STATE_MISSING"); }
  }
  const timestamp = new Date().toISOString();
  return {
    contractVersion: "cop-edge-node-state-v1",
    cursor: {
      lastAckedOffset: 0,
      lastReplayAt: null
    },
    deadLetters: [],
    inboundEvents: [],
    node: {
      classificationMax: config.classificationMax,
      lastHeartbeatAt: null,
      nodeId: config.nodeId,
      nodeName: config.nodeName,
      softwareVersion: config.softwareVersion
    },
    outbox: [],
    sync: {
      lastError: null,
      lastSyncAt: null,
      mode: "DEGRADED"
    },
    updatedAt: timestamp
  };
}

function isValidState(value: unknown): value is EdgeState {
  return isRecord(value)
    && value.contractVersion === "cop-edge-node-state-v1"
    && isRecord(value.cursor)
    && Array.isArray(value.deadLetters) && value.deadLetters.every(validQueuedStateRow)
    && Array.isArray(value.inboundEvents) && value.inboundEvents.every(row => isRecord(row) && isRecord(row.event) &&
      typeof row.eventId === "string" && row.eventId.length > 0 && typeof row.receivedAt === "string" &&
      Number.isFinite(Date.parse(row.receivedAt)) && Number.isSafeInteger(row.replayOffset) && Number(row.replayOffset) >= 0)
    && isRecord(value.node)
    && Array.isArray(value.outbox) && value.outbox.every(validQueuedStateRow)
    && isRecord(value.sync)
    && (value.accountErasure === undefined || validateEdgeErasureJournal(value.accountErasure));
}

function validQueuedStateRow(value: unknown): boolean {
  return isRecord(value) && isRecord(value.event) && typeof value.clientEventId === "string" && value.clientEventId.length > 0 &&
    typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) && ["pending", "rejected"].includes(String(value.status));
}

function normalizeRoute(pathname: string): string {
  if (pathname === "/edge") {
    return "/";
  }
  if (pathname.startsWith("/edge/")) {
    return pathname.slice("/edge".length);
  }
  return pathname;
}

function renderStatusPage(state: Record<string, unknown>): string {
  const status = isRecord(state.status) ? state.status : {};
  const mode = typeof status.mode === "string" ? status.mode : "UNKNOWN";
  const outboxItems = typeof status.outboxItems === "number" ? status.outboxItems : 0;
  const cachedSnapshotObjects = typeof status.cachedSnapshotObjects === "number" ? status.cachedSnapshotObjects : 0;
  const replayOffset = typeof status.replayOffset === "number" ? status.replayOffset : 0;
  const lastSyncAt = typeof status.lastSyncAt === "string" ? status.lastSyncAt : "never";
  const lastError = typeof status.lastError === "string" ? status.lastError : "";
  return `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CSM Edge Node</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #071016; color: #e7edf4; }
      main { max-width: 820px; margin: 0 auto; padding: 32px 20px; }
      .card { border: 1px solid #294052; background: #0d1821; padding: 20px; border-radius: 8px; }
      .mode { color: ${mode === "ONLINE" ? "#bdf27a" : mode === "OFFLINE" ? "#ff7777" : "#ffd95a"}; font-weight: 800; }
      dl { display: grid; grid-template-columns: minmax(120px, 220px) 1fr; gap: 12px; }
      dt { color: #9eb0bf; }
      dd { margin: 0; font-weight: 700; }
      .error { margin-top: 16px; border-left: 4px solid #ff7777; padding-left: 12px; color: #ffc9c9; }
    </style>
  </head>
  <body>
    <main>
      <h1>CSM Edge Node</h1>
      <section class="card">
        <dl>
          <dt>Režim</dt><dd class="mode">${escapeHtml(mode)}</dd>
          <dt>Poslední synchronizace</dt><dd>${escapeHtml(lastSyncAt)}</dd>
          <dt>Replay offset</dt><dd>${replayOffset}</dd>
          <dt>Lokálně uložené události</dt><dd>${cachedSnapshotObjects}</dd>
          <dt>Čeká k odeslání</dt><dd>${outboxItems}</dd>
        </dl>
        ${lastError ? `<p class="error">${escapeHtml(lastError)}</p>` : ""}
      </section>
    </main>
  </body>
</html>`;
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8"
  });
  response.end(html);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(statusCode === 204 ? undefined : JSON.stringify(body));
}

function acceptsHtml(request: IncomingMessage): boolean {
  return request.headers.accept?.includes("text/html") ?? false;
}

function isAdminAuthorized(config: EdgeConfig, request: IncomingMessage): boolean {
  if (!config.adminToken) {
    return false;
  }
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${config.adminToken}`;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  return parseJson(Buffer.concat(chunks).toString("utf8"));
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readCentralAuthMode(value: string | undefined): ServiceAuthMode {
  if (value === undefined) return "static";
  const mode = value.trim();
  if (mode === "static" || mode === "oidc") return mode;
  throw new Error("COP_EDGE_CENTRAL_AUTH_MODE must be static or oidc.");
}

async function readCentralResponseText(response: Response, signal: AbortSignal, maximumBytes: number): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/u.test(length) && Number(length) > maximumBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Central COP response exceeds its size limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let finished = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw centralTimeoutError();
      if (chunk.done) {
        finished = true;
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new Error("Central COP response exceeds its size limit.");
      chunks.push(chunk.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch (error) {
    if (signal.aborted) throw centralTimeoutError();
    if (error instanceof Error && error.message === "Central COP response exceeds its size limit.") throw error;
    throw new Error("Central COP response is unavailable.");
  } finally {
    signal.removeEventListener("abort", abort);
    if (!finished) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function centralTimeoutError(): Error {
  return new Error("Central COP request timed out.");
}

function readClassification(value: string | undefined): ClassificationLevel {
  return value === "PUBLIC" || value === "RESTRICTED_SIMULATED" || value === "SENSITIVE" ? value : "INTERNAL";
}

function readInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

function readLimit(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

function readEntityType(value: unknown): DomainEntityType {
  const candidate = typeof value === "string" ? value : "";
  const allowed = new Set<DomainEntityType>([
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
  ]);
  return allowed.has(candidate as DomainEntityType) ? candidate as DomainEntityType : "communityReport";
}

function readEventType(value: unknown): DomainEventType {
  const candidate = typeof value === "string" ? value : "";
  const allowed = new Set<DomainEventType>([
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
  ]);
  return allowed.has(candidate as DomainEventType) ? candidate as DomainEventType : "report.created";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startEdgeServer();
}
