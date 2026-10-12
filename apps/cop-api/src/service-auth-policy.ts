import type { FastifyReply, FastifyRequest } from "fastify";
import { correlationIdFrom, sendError } from "./errors.js";
import { defaultChannelForEventType, parseDomainEventPublishRequest,
  type FederatedNodeRecord, type PilotClassificationLevel } from "./federation.js";
import { verifiedOidcIdentityFromRequest } from "./security.js";

interface BaseServiceBinding {
  issuer: string;
  clientId: string;
  subjectId: string;
  audience: string;
  tenantId: string;
}
export interface EdgeServiceBinding extends BaseServiceBinding {
  kind: "edge";
  nodeId: string;
  maxClassification: PilotClassificationLevel;
}
export interface McpServiceBinding extends BaseServiceBinding {
  kind: "mcp";
  allowedTools: readonly string[];
}
export type ServiceAuthBinding = EdgeServiceBinding | McpServiceBinding;

const publicMcpTools = new Set([
  "cop.area.summary", "cop.community.reports.search", "cop.fusion.explain", "cop.sources.health"
]);
const classifications: readonly PilotClassificationLevel[] = ["PUBLIC", "INTERNAL", "RESTRICTED_SIMULATED", "SENSITIVE"];
const interactiveClients = new Set(["cop-web", "csm-mobile", "jizda-mobile"]);
const heartbeatFields = new Set(["capabilities", "classificationMax", "detail", "health", "nodeName", "nodeRole", "softwareVersion"]);
const rpcMethods = new Set(["initialize", "ping", "notifications/initialized", "tools/list", "tools/call"]);
const admittedBindings = new WeakMap<FastifyRequest, ServiceAuthBinding>();

/** Configured service clients are reserved identities; roles never widen their binding. */
export class ServiceAuthPolicy {
  private readonly bindings: ReadonlyMap<string, ServiceAuthBinding>;
  private readonly principals: ReadonlyMap<string, ServiceAuthBinding>;

  constructor(raw: string | undefined) {
    const bindings = parseServiceAuthBindings(raw);
    this.bindings = new Map(bindings.map((binding) => [binding.clientId, binding]));
    this.principals = new Map(bindings.map((binding) => [principalKey(binding.issuer, binding.subjectId), binding]));
  }

  onRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const identity = verifiedOidcIdentityFromRequest(request);
    const binding = identity && ((identity.clientId ? this.bindings.get(identity.clientId) : undefined)
      ?? this.principals.get(principalKey(identity.issuer, identity.subjectId.trim()))
      ?? identity.audiences.map((audience) => this.bindings.get(audience)).find(Boolean));
    if (!binding) return;
    if (!identity || identity.clientId !== binding.clientId || identity.issuer !== binding.issuer || identity.subjectId !== binding.subjectId
      || !identity.audiences.includes(binding.audience) || identity.tenantId !== binding.tenantId
      || !routeAllowed(binding, request)) {
      return forbidden(request, reply);
    }
    admittedBindings.set(request, binding);
  };

  preValidation = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const binding = admittedBindings.get(request);
    if (!binding) return;
    const route = request.routeOptions.url;
    const body = record(request.body);
    if (binding.kind === "edge") {
      if (route === "/api/v1/federation/nodes/:nodeId/heartbeat") {
        if (!body || Object.keys(body).some((key) => !heartbeatFields.has(key))
          || body.nodeRole !== "edge-node" || !withinClassification(body.classificationMax, binding.maxClassification)) {
          return forbidden(request, reply);
        }
      } else if (route === "/api/v1/edge/outbox/flush") {
        if (!body || body.nodeId !== binding.nodeId || !Array.isArray(body.events)
          || Object.keys(body).some((key) => key !== "nodeId" && key !== "events")
          || body.events.some((value) => {
            const event = record(value);
            if (!event) return true;
            const parsed = parseDomainEventPublishRequest({ ...event,
              id: event.id ?? event.eventId ?? event.clientEventId, producerNodeId: binding.nodeId },
              correlationIdFrom(request.headers["x-correlation-id"]));
            if (!parsed.ok || !parsed.input) return true;
            const declared = record(event.classification ?? record(event.data)?.classification);
            const derivedChannel = defaultChannelForEventType(parsed.input.type);
            return !withinClassification(parsed.input.classification?.level ?? "INTERNAL", binding.maxClassification)
              || (declared?.level !== undefined && !withinClassification(declared.level, binding.maxClassification))
              || (event.channel !== undefined && event.channel !== "cop.domain.events" && event.channel !== "cop.node.sync")
              || (derivedChannel !== "cop.domain.events" && derivedChannel !== "cop.node.sync");
          })) return forbidden(request, reply);
      }
      return;
    }
    if (request.method === "POST" && route === "/api/v1/mcp") {
      const messages = Array.isArray(request.body) ? request.body : [request.body];
      if (messages.some((value) => {
        const message = record(value);
        if (!message || typeof message.method !== "string" || !rpcMethods.has(message.method)) return true;
        if (message.method !== "tools/call") return false;
        const params = record(message.params);
        return typeof params?.name !== "string" || !binding.allowedTools.includes(params.name);
      })) return forbidden(request, reply);
    }
  };
}

export function serviceAuthBindingFromRequest(request: FastifyRequest): ServiceAuthBinding | undefined {
  return admittedBindings.get(request);
}

export function scopedEdgeNode(request: FastifyRequest, node: FederatedNodeRecord): FederatedNodeRecord | undefined {
  const binding = admittedBindings.get(request);
  if (binding?.kind !== "edge") return node;
  const graphRank = classifications.indexOf(node.classificationMax);
  const bindingRank = classifications.indexOf(binding.maxClassification);
  if (graphRank < 0 || bindingRank < 0) return undefined;
  const effective = classifications[Math.min(graphRank, bindingRank)];
  return effective ? { ...node, classificationMax: effective } : undefined;
}

export function serviceMcpTools<T extends { toolId: string }>(request: FastifyRequest, tools: readonly T[]): readonly T[] {
  const binding = admittedBindings.get(request);
  return binding?.kind === "mcp" ? tools.filter((tool) => binding.allowedTools.includes(tool.toolId)) : tools;
}

export function parseServiceAuthBindings(raw: string | undefined): readonly ServiceAuthBinding[] {
  if (!raw?.trim()) return [];
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 64) throw new Error();
    const clients = new Set<string>();
    const principals = new Set<string>();
    return Object.freeze(values.map((value): ServiceAuthBinding => {
      const binding = record(value);
      if (!binding || (binding.kind !== "edge" && binding.kind !== "mcp")) throw new Error();
      const keys = ["issuer", "clientId", "subjectId", "audience", "tenantId", "kind",
        ...(binding.kind === "edge" ? ["nodeId", "maxClassification"] : ["allowedTools"])];
      if (Object.keys(binding).length !== keys.length || Object.keys(binding).some((key) => !keys.includes(key))
        || !identifier(binding.clientId) || interactiveClients.has(binding.clientId)
        || !identifier(binding.subjectId) || !identifier(binding.audience) || !identifier(binding.tenantId)
        || typeof binding.issuer !== "string" || !binding.issuer || binding.issuer.length > 2048
        || /\s|[\u0000-\u001f\u007f]/u.test(binding.issuer) || binding.issuer.endsWith("/")
        || binding.issuer.includes("?") || binding.issuer.includes("#")) throw new Error();
      const issuer = new URL(binding.issuer);
      if (issuer.protocol !== "https:" || issuer.username || issuer.password
        || clients.has(binding.clientId) || principals.has(principalKey(binding.issuer, binding.subjectId))) throw new Error();
      clients.add(binding.clientId);
      principals.add(principalKey(binding.issuer, binding.subjectId));
      const common = { issuer: binding.issuer, clientId: binding.clientId, subjectId: binding.subjectId,
        audience: binding.audience, tenantId: binding.tenantId };
      if (binding.kind === "edge") {
        if (!identifier(binding.nodeId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(binding.nodeId)
          || !classifications.includes(binding.maxClassification as PilotClassificationLevel)) throw new Error();
        return Object.freeze({ ...common, kind: "edge", nodeId: binding.nodeId,
          maxClassification: binding.maxClassification as PilotClassificationLevel });
      }
      if (!Array.isArray(binding.allowedTools) || binding.allowedTools.length > publicMcpTools.size
        || binding.allowedTools.some((tool) => typeof tool !== "string" || !publicMcpTools.has(tool))
        || new Set(binding.allowedTools).size !== binding.allowedTools.length) throw new Error();
      return Object.freeze({ ...common, kind: "mcp", allowedTools: Object.freeze([...binding.allowedTools]) as readonly string[] });
    }));
  } catch {
    throw new Error("Invalid service authentication bindings.");
  }
}

function routeAllowed(binding: ServiceAuthBinding, request: FastifyRequest): boolean {
  const route = request.routeOptions.url;
  const params = record(request.params);
  if (binding.kind === "edge") {
    if (route === "/api/v1/edge/outbox/flush") return request.method === "POST";
    if (params?.nodeId !== binding.nodeId) return false;
    return (request.method === "POST" && (route === "/api/v1/federation/nodes/:nodeId/heartbeat"
      || route === "/api/v1/edge/replay-cursors/:nodeId/ack"))
      || (request.method === "GET" && route === "/api/v1/edge/replay/:nodeId");
  }
  return (request.method === "GET" && (route === "/api/v1/mcp" || route === "/api/v1/mcp/tools"))
    || (request.method === "POST" && route === "/api/v1/mcp")
    || (request.method === "POST" && route === "/api/v1/mcp/tools/:toolId/invoke"
      && typeof params?.toolId === "string" && binding.allowedTools.includes(params.toolId));
}

function withinClassification(value: unknown, maximum: PilotClassificationLevel): boolean {
  return typeof value === "string" && classifications.includes(value as PilotClassificationLevel)
    && classifications.indexOf(value as PilotClassificationLevel) <= classifications.indexOf(maximum);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/\s|[\u0000-\u001f\u007f]/u.test(value);
}

function principalKey(issuer: string, subject: string): string {
  return `${issuer}\u0000${subject}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function forbidden(request: FastifyRequest, reply: FastifyReply): void {
  sendError(reply, 403, "SERVICE_AUTH_FORBIDDEN", "Service identity is not authorized for this operation.",
    correlationIdFrom(request.headers["x-correlation-id"]));
}
