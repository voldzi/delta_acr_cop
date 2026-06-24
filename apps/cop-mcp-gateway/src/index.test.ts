import { describe, expect, it } from "vitest";

import {
  isMcpGatewayAuthorized,
  mcpGatewayMetadata,
  readMcpGatewayConfig,
  stripTrailingSlash
} from "./index.js";

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
