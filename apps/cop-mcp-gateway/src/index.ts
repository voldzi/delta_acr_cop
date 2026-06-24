import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

export interface McpGatewayConfig {
  centralApiUrl: string;
  centralTimeoutMs: number;
  centralToken: string;
  gatewayToken: string;
  host: string;
  port: number;
  softwareVersion: string;
}

interface GatewayErrorBody {
  error: {
    code: string;
    correlationId: string;
    message: string;
  };
}

const maxBodyBytes = 1024 * 1024;

export function readMcpGatewayConfig(env: NodeJS.ProcessEnv = process.env): McpGatewayConfig {
  return {
    centralApiUrl: stripTrailingSlash(stringValue(env.COP_MCP_CENTRAL_API_URL) || "http://cop-api:4310"),
    centralTimeoutMs: intValue(env.COP_MCP_CENTRAL_TIMEOUT_MS, 10_000, 500, 120_000),
    centralToken: stringValue(env.COP_MCP_CENTRAL_TOKEN),
    gatewayToken: stringValue(env.COP_MCP_GATEWAY_TOKEN),
    host: stringValue(env.COP_MCP_HOST) || "0.0.0.0",
    port: intValue(env.COP_MCP_PORT, 4313, 1, 65_535),
    softwareVersion: stringValue(env.npm_package_version) || "0.1.0"
  };
}

export function mcpGatewayMetadata(config: McpGatewayConfig): Record<string, unknown> {
  return {
    contractVersion: "cop-mcp-gateway-service-v1",
    endpoints: {
      health: {
        live: "/health/live",
        ready: "/health/ready"
      },
      mcp: "/mcp",
      tools: "/mcp/tools"
    },
    security: {
      centralAudit: true,
      gatewayTokenConfigured: config.gatewayToken.length > 0,
      gatewayTokenRequired: true,
      providerTokensExposed: false
    },
    service: "cop-mcp-gateway",
    softwareVersion: config.softwareVersion,
    upstream: {
      api: config.centralApiUrl,
      endpoints: ["/api/v1/mcp", "/api/v1/mcp/tools"]
    }
  };
}

export function isMcpGatewayAuthorized(headers: IncomingHttpHeaders, gatewayToken: string): boolean {
  if (!gatewayToken) {
    return false;
  }
  return readBearerToken(headers) === gatewayToken || firstHeader(headers["x-cop-mcp-token"]) === gatewayToken;
}

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function createMcpGatewayServer(config = readMcpGatewayConfig()) {
  return createServer(async (request, response) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = stripTrailingSlash(requestUrl.pathname) || "/";

      if (request.method === "GET" && pathname === "/") {
        return sendJson(response, 200, mcpGatewayMetadata(config), correlationId);
      }

      if (request.method === "GET" && pathname === "/health/live") {
        return sendJson(response, 200, {
          service: "cop-mcp-gateway",
          status: "ok",
          timestamp: new Date().toISOString()
        }, correlationId);
      }

      if (request.method === "GET" && pathname === "/health/ready") {
        return handleReady(config, response, correlationId);
      }

      if (!isMcpGatewayAuthorized(request.headers, config.gatewayToken)) {
        return sendError(response, 401, "UNAUTHORIZED", "MCP gateway token is missing or invalid.", correlationId);
      }

      if ((request.method === "GET" || request.method === "POST") && pathname === "/mcp") {
        return proxyToCentral(config, request, response, "/api/v1/mcp", correlationId);
      }

      if (request.method === "GET" && pathname === "/mcp/tools") {
        return proxyToCentral(config, request, response, "/api/v1/mcp/tools", correlationId);
      }

      if (request.method === "POST" && pathname.startsWith("/mcp/tools/") && pathname.endsWith("/invoke")) {
        const toolId = pathname.slice("/mcp/tools/".length, -"/invoke".length);
        if (!toolId) {
          return sendError(response, 400, "BAD_REQUEST", "MCP tool id is missing.", correlationId);
        }
        return proxyToCentral(
          config,
          request,
          response,
          `/api/v1/mcp/tools/${encodeURIComponent(decodeURIComponent(toolId))}/invoke`,
          correlationId
        );
      }

      return sendError(response, 404, "NOT_FOUND", "MCP gateway endpoint was not found.", correlationId);
    } catch (error) {
      return sendError(response, 500, "INTERNAL_ERROR", errorMessage(error), correlationId);
    }
  });
}

export async function startMcpGatewayServer(config = readMcpGatewayConfig()): Promise<void> {
  const server = createMcpGatewayServer(config);
  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });
  console.log(JSON.stringify({
    centralApiUrl: config.centralApiUrl,
    gatewayTokenConfigured: config.gatewayToken.length > 0,
    gatewayTokenRequired: true,
    host: config.host,
    port: config.port,
    service: "cop-mcp-gateway",
    status: "listening"
  }));
}

async function handleReady(config: McpGatewayConfig, response: ServerResponse, correlationId: string): Promise<void> {
  if (!config.gatewayToken) {
    return sendJson(response, 503, {
      detail: "COP_MCP_GATEWAY_TOKEN is required.",
      service: "cop-mcp-gateway",
      status: "degraded",
      timestamp: new Date().toISOString()
    }, correlationId);
  }

  try {
    const upstream = await fetchWithTimeout(
      `${config.centralApiUrl}/api/v1/mcp/tools`,
      {
        headers: centralHeaders(config, correlationId, "application/json"),
        method: "GET"
      },
      config.centralTimeoutMs
    );

    if (!upstream.ok) {
      return sendJson(response, 503, {
        detail: `central returned ${upstream.status}`,
        service: "cop-mcp-gateway",
        status: "degraded",
        timestamp: new Date().toISOString()
      }, correlationId);
    }

    return sendJson(response, 200, {
      service: "cop-mcp-gateway",
      status: "ok",
      timestamp: new Date().toISOString(),
      upstream: {
        api: config.centralApiUrl,
        status: "ok"
      }
    }, correlationId);
  } catch (error) {
    return sendJson(response, 503, {
      detail: errorMessage(error),
      service: "cop-mcp-gateway",
      status: "degraded",
      timestamp: new Date().toISOString()
    }, correlationId);
  }
}

async function proxyToCentral(
  config: McpGatewayConfig,
  request: IncomingMessage,
  response: ServerResponse,
  targetPath: string,
  correlationId: string
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const targetUrl = `${config.centralApiUrl}${targetPath}${requestUrl.search}`;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
  const upstream = await fetchWithTimeout(
    targetUrl,
    {
      body,
      headers: centralHeaders(config, correlationId, firstHeader(request.headers["content-type"]) || "application/json"),
      method: request.method
    },
    config.centralTimeoutMs
  );

  response.statusCode = upstream.status;
  response.setHeader("x-correlation-id", correlationId);
  copyHeader(upstream.headers, response, "content-type");
  copyHeader(upstream.headers, response, "cache-control");

  const payload = Buffer.from(await upstream.arrayBuffer());
  response.end(payload);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function centralHeaders(config: McpGatewayConfig, correlationId: string, contentType: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": contentType,
    "x-cop-mcp-gateway": "standalone",
    "x-correlation-id": correlationId
  };

  if (config.centralToken) {
    headers.authorization = `Bearer ${config.centralToken}`;
  }

  return headers;
}

function copyHeader(headers: Headers, response: ServerResponse, headerName: string): void {
  const value = headers.get(headerName);
  if (value) {
    response.setHeader(headerName, value);
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new Error("MCP gateway request body is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown, correlationId: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-correlation-id", correlationId);
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, statusCode: number, code: string, message: string, correlationId: string): void {
  const body: GatewayErrorBody = {
    error: {
      code,
      correlationId,
      message
    }
  };
  sendJson(response, statusCode, body, correlationId);
}

function readBearerToken(headers: IncomingHttpHeaders): string {
  const authorization = firstHeader(headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

function correlationIdFrom(value: unknown): string {
  const correlationId = firstHeader(value);
  return correlationId || randomUUID();
}

function firstHeader(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function intValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startMcpGatewayServer();
}
