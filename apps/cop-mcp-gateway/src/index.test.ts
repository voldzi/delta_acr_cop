import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMcpGatewayServer,
  isMcpGatewayAuthorized,
  mcpGatewayMetadata,
  readMcpGatewayConfig,
  stripTrailingSlash
} from "./index.js";

const realFetch = globalThis.fetch;
const servers: Server[] = [];
const issuer = "https://synthetic-idp.example/realms/cop";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function mockIssuer(tokenResponse: (request: RequestInit | undefined) => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(issuer + "/")) {
      if (url.endsWith("/token")) return tokenResponse(init);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({ issuer, token_endpoint: issuer + "/protocol/openid-connect/token" });
      }
      throw new Error("Unexpected synthetic issuer endpoint.");
    }
    return realFetch(input, init);
  });
}

function oidcConfig(centralApiUrl: string, clientId = "synthetic-mcp-service") {
  return readMcpGatewayConfig({
    COP_MCP_CENTRAL_API_URL: centralApiUrl,
    COP_MCP_CENTRAL_AUTH_MODE: "oidc",
    COP_MCP_CENTRAL_OIDC_ISSUER: issuer,
    COP_MCP_CENTRAL_OIDC_CLIENT_ID: clientId,
    COP_MCP_CENTRAL_OIDC_CLIENT_SECRET: "synthetic-service-secret",
    COP_MCP_CENTRAL_TOKEN: "synthetic-static-fallback-forbidden",
    COP_MCP_GATEWAY_TOKEN: "synthetic-gateway-secret"
  });
}

describe("cop-mcp-gateway runtime", () => {
  it("reads gateway configuration from environment values", () => {
    const config = readMcpGatewayConfig({
      COP_MCP_CENTRAL_API_URL: "http://cop-api:4310/",
      COP_MCP_CENTRAL_TIMEOUT_MS: "2500",
      COP_MCP_CENTRAL_TOKEN: "central-token",
      COP_MCP_GATEWAY_TOKEN: "gateway-token",
      COP_MCP_HOST: "127.0.0.1",
      COP_MCP_PORT: "4998"
    });

    expect(config).toMatchObject({
      centralApiUrl: "http://cop-api:4310",
      centralTimeoutMs: 2500,
      centralToken: "central-token",
      gatewayToken: "gateway-token",
      host: "127.0.0.1",
      port: 4998
    });
  });

  it("requires the gateway token for protected endpoints", () => {
    expect(isMcpGatewayAuthorized({}, "")).toBe(false);
    expect(isMcpGatewayAuthorized({ authorization: "Bearer gateway-token" }, "gateway-token")).toBe(true);
    expect(isMcpGatewayAuthorized({ "x-cop-mcp-token": "gateway-token" }, "gateway-token")).toBe(true);
    expect(isMcpGatewayAuthorized({ authorization: "Bearer other" }, "gateway-token")).toBe(false);
  });

  it("advertises standalone MCP gateway metadata without provider secrets", () => {
    const metadata = mcpGatewayMetadata(readMcpGatewayConfig({
      COP_MCP_CENTRAL_API_URL: "http://cop-api:4310",
      COP_MCP_CENTRAL_TOKEN: "central-secret",
      COP_MCP_GATEWAY_TOKEN: "gateway-secret"
    }));

    expect(metadata).toMatchObject({
      contractVersion: "cop-mcp-gateway-service-v1",
      security: {
        centralAudit: true,
        gatewayTokenConfigured: true,
        gatewayTokenRequired: true,
        providerTokensExposed: false
      },
      service: "cop-mcp-gateway"
    });
    expect(JSON.stringify(metadata)).not.toContain("central-secret");
    expect(JSON.stringify(metadata)).not.toContain("gateway-secret");
  });

  it("normalizes trailing slashes", () => {
    expect(stripTrailingSlash("http://cop-api:4310///")).toBe("http://cop-api:4310");
  });
});

describe("cop-mcp-gateway central service authentication", () => {
  it("keeps static mode as the default and rejects an unknown selected mode", () => {
    expect(readMcpGatewayConfig({}).centralAuthMode).toBe("static");
    expect(() => readMcpGatewayConfig({ COP_MCP_CENTRAL_AUTH_MODE: "synthetic-invalid-mode" }))
      .toThrow("COP_MCP_CENTRAL_AUTH_MODE must be static or oidc.");
    expect(JSON.stringify(mcpGatewayMetadata(oidcConfig("http://127.0.0.1:1"))))
      .not.toContain("synthetic-service-secret");
    expect(mcpGatewayMetadata(oidcConfig("http://127.0.0.1:1"))).toMatchObject({
      security: { centralAuthMode: "oidc", gatewayTokenRequired: true, providerTokensExposed: false }
    });
  });

  it("preserves static upstream compatibility and never forwards the incoming gateway bearer", async () => {
    const received: string[] = [];
    const centralUrl = await listen(createServer((request, response) => {
      received.push(request.headers.authorization ?? "");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ tools: [] }));
    }));
    const config = readMcpGatewayConfig({
      COP_MCP_CENTRAL_API_URL: centralUrl,
      COP_MCP_CENTRAL_TOKEN: "synthetic-central-static",
      COP_MCP_GATEWAY_TOKEN: "synthetic-gateway-secret"
    });
    const gatewayUrl = await listen(createMcpGatewayServer(config));
    const denied = await realFetch(gatewayUrl + "/mcp/tools", {
      headers: { Authorization: "Bearer synthetic-untrusted-user-token" }
    });
    expect(denied.status).toBe(401);
    await denied.text();
    expect(received).toEqual([]);
    const accepted = await realFetch(gatewayUrl + "/mcp/tools", {
      headers: { Authorization: "Bearer synthetic-gateway-secret" }
    });
    expect(accepted.status).toBe(200);
    await accepted.text();
    expect(received).toEqual(["Bearer synthetic-central-static"]);
  });

  it("reuses one OIDC provider across readiness and proxy, then renews before expiry", async () => {
    const received: string[] = [];
    let tokenRequests = 0;
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mockIssuer(() => Response.json({ access_token: `synthetic-oidc-${++tokenRequests}`, token_type: "Bearer", expires_in: 100 }));
    const centralUrl = await listen(createServer((request, response) => {
      received.push(request.headers.authorization ?? "");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ tools: [] }));
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(oidcConfig(centralUrl)));
    const ready = await realFetch(gatewayUrl + "/health/ready");
    expect(ready.status).toBe(200);
    await ready.text();
    const request = () => realFetch(gatewayUrl + "/mcp/tools", {
      headers: { Authorization: "Bearer synthetic-gateway-secret" }
    });
    const initial = await request();
    expect(initial.status).toBe(200);
    await initial.text();
    expect(tokenRequests).toBe(1);
    now += 81_000;
    const renewed = await request();
    expect(renewed.status).toBe(200);
    await renewed.text();
    expect(tokenRequests).toBe(2);
    expect(received).toEqual(["Bearer synthetic-oidc-1", "Bearer synthetic-oidc-1", "Bearer synthetic-oidc-2"]);
  });

  it("isolates central OIDC caches between gateway servers", async () => {
    const received: string[] = [];
    const tokenClients: string[] = [];
    mockIssuer(init => {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const client = form.get("client_id") ?? "missing";
      tokenClients.push(client);
      return Response.json({ access_token: `synthetic-token-for-${client}`, token_type: "Bearer", expires_in: 100 });
    });
    const centralUrl = await listen(createServer((request, response) => {
      received.push(request.headers.authorization ?? "");
      response.end("{}");
    }));
    const first = await listen(createMcpGatewayServer(oidcConfig(centralUrl, "synthetic-mcp-a")));
    const second = await listen(createMcpGatewayServer(oidcConfig(centralUrl, "synthetic-mcp-b")));
    for (const base of [first, second, first, second]) {
      const result = await realFetch(base + "/mcp/tools", { headers: { Authorization: "Bearer synthetic-gateway-secret" } });
      expect(result.status).toBe(200);
      await result.text();
    }
    expect(tokenClients).toEqual(["synthetic-mcp-a", "synthetic-mcp-b"]);
    expect(received).toEqual([
      "Bearer synthetic-token-for-synthetic-mcp-a", "Bearer synthetic-token-for-synthetic-mcp-b",
      "Bearer synthetic-token-for-synthetic-mcp-a", "Bearer synthetic-token-for-synthetic-mcp-b"
    ]);
  });

  it("fails selected OIDC with sanitized503 and never sends the configured static token", async () => {
    let centralRequests = 0;
    let tokenRequests = 0;
    mockIssuer(() => {
      tokenRequests += 1;
      return Response.json({ error: "synthetic-service-secret synthetic-static-fallback-forbidden" }, { status: 500 });
    });
    const centralUrl = await listen(createServer((_request, response) => {
      centralRequests += 1;
      response.end("{}");
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(oidcConfig(centralUrl)));
    const unauthorized = await realFetch(gatewayUrl + "/mcp/tools");
    expect(unauthorized.status).toBe(401);
    await unauthorized.text();
    expect(tokenRequests).toBe(0);
    const failed = await realFetch(gatewayUrl + "/mcp/tools", {
      headers: { Authorization: "Bearer synthetic-gateway-secret" }
    });
    expect(failed.status).toBe(503);
    const failureBody = await failed.text();
    expect(failureBody).toContain("CENTRAL_AUTH_UNAVAILABLE");
    expect(failureBody).not.toContain("synthetic-service-secret");
    expect(failureBody).not.toContain("synthetic-static-fallback-forbidden");
    const ready = await realFetch(gatewayUrl + "/health/ready");
    expect(ready.status).toBe(503);
    const readyBody = await ready.text();
    expect(readyBody).not.toContain("synthetic-service-secret");
    expect(readyBody).not.toContain("synthetic-static-fallback-forbidden");
    expect(centralRequests).toBe(0);
  });

  it("invalidates401 without retrying the failed POST and obtains a new token only for the next request", async () => {
    let tokenRequests = 0;
    const received: Array<{ authorization: string; body: string; method: string }> = [];
    mockIssuer(() => Response.json({ access_token: `synthetic-oidc-${++tokenRequests}`, token_type: "Bearer", expires_in: 100 }));
    const centralUrl = await listen(createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      received.push({ authorization: request.headers.authorization ?? "", body, method: request.method ?? "" });
      response.statusCode = received.length === 1 ? 401 : 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: response.statusCode }));
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(oidcConfig(centralUrl)));
    const invoke = () => realFetch(gatewayUrl + "/mcp/tools/synthetic-read-tool/invoke", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-gateway-secret", "content-type": "application/json" },
      body: JSON.stringify({ marker: "synthetic-operation" })
    });
    const failed = await invoke();
    expect(failed.status).toBe(401);
    await failed.text();
    expect(received).toHaveLength(1);
    expect(tokenRequests).toBe(1);
    const next = await invoke();
    expect(next.status).toBe(200);
    await next.text();
    expect(tokenRequests).toBe(2);
    expect(received.map(value => value.authorization)).toEqual(["Bearer synthetic-oidc-1", "Bearer synthetic-oidc-2"]);
    expect(received.every(value => value.method === "POST" && value.body === '{"marker":"synthetic-operation"}')).toBe(true);
  });

  it("invalidates an unauthorized readiness token without retrying its upstream request", async () => {
    let tokenRequests = 0;
    const received: string[] = [];
    mockIssuer(() => Response.json({ access_token: `synthetic-ready-${++tokenRequests}`, token_type: "Bearer", expires_in: 100 }));
    const centralUrl = await listen(createServer((request, response) => {
      received.push(request.headers.authorization ?? "");
      response.statusCode = received.length === 1 ? 401 : 200;
      response.end("{}");
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(oidcConfig(centralUrl)));
    const ready = await realFetch(gatewayUrl + "/health/ready");
    expect(ready.status).toBe(503);
    await ready.text();
    expect(received).toHaveLength(1);
    const next = await realFetch(gatewayUrl + "/mcp/tools", { headers: { Authorization: "Bearer synthetic-gateway-secret" } });
    expect(next.status).toBe(200);
    await next.text();
    expect(tokenRequests).toBe(2);
    expect(received).toEqual(["Bearer synthetic-ready-1", "Bearer synthetic-ready-2"]);
  });

  it("preserves upstream429 and Retry-After without any retry", async () => {
    let centralRequests = 0;
    const centralUrl = await listen(createServer((_request, response) => {
      centralRequests += 1;
      response.statusCode = 429;
      response.setHeader("retry-after", "15");
      response.end("{}");
    }));
    const config = readMcpGatewayConfig({ COP_MCP_CENTRAL_API_URL: centralUrl, COP_MCP_CENTRAL_TOKEN: "synthetic-static", COP_MCP_GATEWAY_TOKEN: "synthetic-gateway-secret" });
    const gatewayUrl = await listen(createMcpGatewayServer(config));
    const limited = await realFetch(gatewayUrl + "/mcp", { headers: { Authorization: "Bearer synthetic-gateway-secret" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("15");
    await limited.text();
    expect(centralRequests).toBe(1);
  });

  it("does not replay a POST through an upstream redirect", async () => {
    const paths: string[] = [];
    const centralUrl = await listen(createServer((request, response) => {
      paths.push(request.url ?? "");
      response.statusCode = 307;
      response.setHeader("location", centralUrl + "/synthetic-replay-target");
      response.end();
    }));
    const config = readMcpGatewayConfig({ COP_MCP_CENTRAL_API_URL: centralUrl, COP_MCP_CENTRAL_TOKEN: "synthetic-static", COP_MCP_GATEWAY_TOKEN: "synthetic-gateway-secret" });
    const gatewayUrl = await listen(createMcpGatewayServer(config));
    const result = await realFetch(gatewayUrl + "/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-gateway-secret", "content-type": "application/json" },
      body: JSON.stringify({ marker: "synthetic-operation" })
    });
    expect(result.status).toBe(503);
    expect(await result.text()).toContain("CENTRAL_UNAVAILABLE");
    expect(paths).toEqual(["/api/v1/mcp"]);
  });
});

describe("cop-mcp-gateway complete upstream response bounds", () => {
  function staticConfig(centralApiUrl: string, responseBytes?: number) {
    return readMcpGatewayConfig({
      COP_MCP_CENTRAL_API_URL: centralApiUrl,
      COP_MCP_CENTRAL_TOKEN: "synthetic-central-static",
      COP_MCP_GATEWAY_TOKEN: "synthetic-gateway-secret",
      COP_MCP_CENTRAL_TIMEOUT_MS: "500",
      ...(responseBytes === undefined ? {} : { COP_MCP_CENTRAL_MAX_RESPONSE_BYTES: String(responseBytes) })
    });
  }

  it("bounds a body that stalls after successful headers and publishes no partial upstream data", async () => {
    let resolveClosed: (() => void) | undefined;
    const upstreamClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
    let centralRequests = 0;
    const centralUrl = await listen(createServer((_request, response) => {
      centralRequests += 1;
      response.once("close", () => resolveClosed?.());
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      response.write('{"synthetic-private-upstream-data":"unfinished');
      // Deliberately never finish the body. The gateway must end this exchange.
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(staticConfig(centralUrl)));
    const result = await realFetch(gatewayUrl + "/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-gateway-secret", "content-type": "application/json" },
      body: JSON.stringify({ marker: "synthetic-operation" })
    });
    expect(result.status).toBe(503);
    const failureBody = await result.text();
    expect(failureBody).toContain("CENTRAL_UNAVAILABLE");
    expect(failureBody).not.toContain("synthetic-private-upstream-data");
    await upstreamClosed;
    expect(centralRequests).toBe(1);
  });

  it("rejects an oversized chunked response before publishing successful headers or payload", async () => {
    let resolveClosed: (() => void) | undefined;
    const upstreamClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const centralUrl = await listen(createServer((_request, response) => {
      response.once("close", () => resolveClosed?.());
      response.writeHead(200, { "content-type": "application/json", "cache-control": "synthetic-upstream-cache-marker" });
      response.flushHeaders();
      response.write("synthetic-private-upstream-data" + "x".repeat(4096));
      // No Content-Length: the streamed byte count must enforce the bound.
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(staticConfig(centralUrl, 2048)));
    const result = await realFetch(gatewayUrl + "/mcp/tools", { headers: { Authorization: "Bearer synthetic-gateway-secret" } });
    expect(result.status).toBe(503);
    expect(result.headers.get("cache-control")).toBeNull();
    const failureBody = await result.text();
    expect(failureBody).toContain("CENTRAL_UNAVAILABLE");
    expect(failureBody).not.toContain("synthetic-private-upstream-data");
    await upstreamClosed;
  });

  it("rejects an oversized declared response without waiting for its incomplete body", async () => {
    let resolveClosed: (() => void) | undefined;
    const upstreamClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const centralUrl = await listen(createServer((_request, response) => {
      response.once("close", () => resolveClosed?.());
      response.writeHead(200, { "content-type": "application/json", "content-length": "8192" });
      response.flushHeaders();
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(staticConfig(centralUrl, 2048)));
    const result = await realFetch(gatewayUrl + "/mcp/tools", { headers: { Authorization: "Bearer synthetic-gateway-secret" } });
    expect(result.status).toBe(503);
    expect(await result.text()).toContain("CENTRAL_UNAVAILABLE");
    await upstreamClosed;
  });

  it("passes a legitimate response within the byte bound without changing its data or metadata", async () => {
    const payload = JSON.stringify({ tools: [{ id: "synthetic-read-tool", description: "x".repeat(1100) }] });
    const centralUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(payload);
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(staticConfig(centralUrl, 2048)));
    const result = await realFetch(gatewayUrl + "/mcp/tools", { headers: { Authorization: "Bearer synthetic-gateway-secret" } });
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.text()).toBe(payload);
  });

  it.each([200, 503])("cancels an unnecessary readiness body for upstream status%s", async status => {
    let resolveClosed: (() => void) | undefined;
    const upstreamClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const centralUrl = await listen(createServer((_request, response) => {
      response.once("close", () => resolveClosed?.());
      response.writeHead(status, { "content-type": "application/json" });
      response.flushHeaders();
      response.write('{"synthetic-private-ready-payload":"never ending');
    }));
    const gatewayUrl = await listen(createMcpGatewayServer(staticConfig(centralUrl)));
    const result = await realFetch(gatewayUrl + "/health/ready");
    expect(result.status).toBe(status === 200 ? 200 : 503);
    expect(await result.text()).not.toContain("synthetic-private-ready-payload");
    await upstreamClosed;
  });
});
