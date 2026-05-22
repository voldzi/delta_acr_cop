import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { CsmMessagingProvider, createMessagingProviderFromEnv } from "./messaging-provider.js";

describe("CsmMessagingProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports disabled status until the experimental messaging provider is enabled", async () => {
    vi.stubEnv("COP_CSM_MESSAGING_ENABLED", "false");
    const provider = createMessagingProviderFromEnv();

    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(status).toMatchObject({
      chatAvailable: false,
      enabled: false,
      providerId: "csm.messaging",
      status: "disabled"
    });
  });

  it("reads provider capabilities and health server-side without exposing a browser token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).not.toMatchObject({ Authorization: expect.any(String) });
      const url = String(input);
      if (url.endsWith("/api/v1/capabilities")) {
        return new Response(JSON.stringify({
          architecture: {
            mode: "matrix-backed",
            plaintextOnServer: false,
            serverRole: "policy-and-integration"
          },
          contractVersion: "csm-messaging-provider-v1",
          features: {
            directMessages: true,
            endToEndEncryptionRequired: true,
            groups: true,
            mapObjectLinks: true
          },
          providerId: "csm.messaging",
          security: {
            authMode: "csm-server-token",
            readFromBrowser: false,
            serverSideIntegrationOnly: true
          },
          serviceName: "CSM Messaging",
          status: "online"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        checks: [],
        status: "ok"
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000
    });
    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://messaging.local:4050/api/v1/capabilities");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://messaging.local:4050/health/ready");
    expect(status).toMatchObject({
      architecture: { plaintextOnServer: false },
      chatAvailable: false,
      enabled: true,
      features: { directMessages: true, endToEndEncryptionRequired: true },
      providerId: "csm.messaging",
      serviceName: "CSM Messaging",
      status: "online"
    });
    expect(status.warnings).toContain("Chat messages are not enabled yet. Current CSM Messaging contract exposes capabilities and health only.");
  });

  it("exposes messaging status through the COP API public read boundary", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: false,
        timeoutMs: 3000
      }),
      now: () => new Date("2026-05-22T12:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/messaging/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contractVersion: "cop-messaging-status-v1",
      providerId: "csm.messaging",
      status: "disabled"
    });
  });
});
