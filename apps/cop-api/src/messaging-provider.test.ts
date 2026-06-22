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
      const url = String(input);
      expect(init?.headers).not.toMatchObject({ Authorization: expect.any(String) });
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
            mapObjectLinks: true,
            matrixIdentityResolution: true,
            matrixRoomBinding: true,
            matrixTokenBootstrap: true
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
      if (url === "https://msg.zeleznalady.cz/_matrix/client/versions") {
        return new Response(JSON.stringify({ versions: ["v1.12"] }), { status: 200 });
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
      matrixHomeserverPublicUrl: "https://msg.zeleznalady.cz",
      timeoutMs: 3000
    });
    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://messaging.local:4050/api/v1/capabilities");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://messaging.local:4050/health/ready");
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("https://msg.zeleznalady.cz/_matrix/client/versions");
    expect(status).toMatchObject({
      architecture: { plaintextOnServer: false },
      chatAvailable: true,
      enabled: true,
      features: { directMessages: true, endToEndEncryptionRequired: true },
      providerId: "csm.messaging",
      serviceName: "CSM Messaging",
      status: "online"
    });
    expect(JSON.stringify(status)).not.toContain("accessToken");
  });

  it("keeps chat disabled when the public Matrix homeserver URL is not reachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/capabilities")) {
        return new Response(JSON.stringify({
          architecture: { plaintextOnServer: false },
          contractVersion: "csm-messaging-provider-v1",
          features: {
            endToEndEncryptionRequired: true,
            matrixIdentityResolution: true,
            matrixRoomBinding: true,
            matrixTokenBootstrap: true
          },
          providerId: "csm.messaging",
          security: {
            readFromBrowser: false,
            serverSideIntegrationOnly: true
          },
          serviceName: "CSM Messaging",
          status: "online"
        }), { status: 200 });
      }
      if (url.endsWith("/health/ready")) {
        return new Response(JSON.stringify({ checks: [], status: "ok" }), { status: 200 });
      }
      throw new TypeError("fetch failed: DNS lookup failed");
    }));

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      matrixHomeserverPublicUrl: "https://msg.zeleznalady.cz",
      timeoutMs: 3000
    });

    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(status.status).toBe("online");
    expect(status.chatAvailable).toBe(false);
    expect(status.warnings.join("\n")).toContain("Matrix public homeserver is not reachable");
  });

  it("sends the configured server token only to the messaging provider", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer server-token-123" });
      const url = String(input);
      if (url.endsWith("/api/v1/capabilities")) {
        return new Response(JSON.stringify({
          contractVersion: "csm-messaging-provider-v1",
          providerId: "csm.messaging",
          security: {
            authMode: "csm-server-token",
            authRequired: true,
            readFromBrowser: false,
            serverSideIntegrationOnly: true
          },
          serviceName: "CSM Messaging",
          status: "online"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ checks: [], status: "ok" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "server-token-123"
    });

    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(status).toMatchObject({
      providerId: "csm.messaging",
      security: {
        authRequired: true
      },
      status: "online"
    });
    expect(JSON.stringify(status)).not.toContain("server-token-123");
  });

  it("keeps chat disabled when Matrix bootstrap is not advertised", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/capabilities")) {
        return new Response(JSON.stringify({
          architecture: { plaintextOnServer: false },
          contractVersion: "csm-messaging-provider-v1",
          features: {
            endToEndEncryptionRequired: true
          },
          providerId: "csm.messaging",
          security: {
            readFromBrowser: false,
            serverSideIntegrationOnly: true
          },
          serviceName: "CSM Messaging",
          status: "online"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ checks: [], status: "ok" }), { status: 200 });
    }));

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000
    });

    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(status.chatAvailable).toBe(false);
    expect(status.warnings).toContain("Messaging metadata API is available server-side, but client-safe Matrix/E2EE bootstrap is not ready.");
  });

  it("keeps chat disabled when identity resolution or room binding capabilities are missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/capabilities")) {
        return new Response(JSON.stringify({
          architecture: { plaintextOnServer: false },
          contractVersion: "csm-messaging-provider-v1",
          features: {
            endToEndEncryptionRequired: true,
            matrixTokenBootstrap: true
          },
          providerId: "csm.messaging",
          security: {
            readFromBrowser: false,
            serverSideIntegrationOnly: true
          },
          serviceName: "CSM Messaging",
          status: "online"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ checks: [], status: "ok" }), { status: 200 });
    }));

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000
    });

    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(status).toMatchObject({
      chatAvailable: false,
      features: {
        matrixTokenBootstrap: true
      },
      status: "online"
    });
    expect(status.warnings).toContain("Messaging metadata API is available server-side, but client-safe Matrix/E2EE bootstrap is not ready.");
  });

  it("sanitizes provider credential hints from public messaging status", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/capabilities")) {
        return new Response(JSON.stringify({
          architecture: { plaintextOnServer: false },
          contractVersion: "csm-messaging-provider-v1",
          features: {
            endToEndEncryptionRequired: true,
            matrixTokenBootstrap: false
          },
          providerId: "csm.messaging",
          security: {
            readFromBrowser: false,
            serverSideIntegrationOnly: true
          },
          serviceName: "CSM Messaging",
          status: "degraded"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        checks: [{
          id: "matrix_config",
          message: "CSM_MATRIX_ADMIN_TOKEN must be configured before Matrix token bootstrap is operational.",
          status: "degraded"
        }],
        status: "degraded"
      }), { status: 503 });
    }));

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000
    });

    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(JSON.stringify(status)).not.toContain("CSM_MATRIX_ADMIN_TOKEN");
    expect(status.warnings).toContain("Messaging Matrix token bootstrap configuration is incomplete.");
  });

  it("fetches Matrix bootstrap server-side with provider token and COP user headers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/matrix/token");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "x-csm-device-id": "COPWEB.device-1",
        "x-csm-user-id": "user-123",
        "x-csm-user-name": "User One",
        "x-csm-user-role": "cop_operator"
      });
      return new Response(JSON.stringify({
        accessToken: "matrix-user-token",
        contractVersion: "csm-messaging-provider-v1",
        deviceId: "COP_WEB_1",
        e2eeRequired: true,
        expiresAt: "2026-05-23T12:00:00Z",
        homeserverBaseUrl: "https://msg.zeleznalady.cz",
        providerId: "csm.messaging",
        serverName: "msg.zeleznalady.cz",
        status: "ready",
        tokenAvailable: true,
        userId: "@user:msg.zeleznalady.cz",
        warnings: []
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token"
    });

    const bootstrap = await provider.fetchMatrixBootstrap({
      authMode: "oidc",
      displayName: "User One",
      roles: ["cop_operator"],
      subjectId: "user-123",
      username: "user.one"
    }, new Date("2026-05-22T12:00:00Z"), "COPWEB.device-1");

    expect(bootstrap).toMatchObject({
      accessToken: "matrix-user-token",
      chatAvailable: true,
      contractVersion: "cop-messaging-bootstrap-v1",
      e2eeRequired: true,
      providerId: "csm.messaging",
      status: "online",
      tokenAvailable: true,
      userId: "@user:msg.zeleznalady.cz"
    });
    expect(JSON.stringify(bootstrap)).not.toContain("provider-token");
  });

  it("returns a disabled bootstrap state when provider token is not available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      contractVersion: "csm-messaging-provider-v1",
      providerId: "csm.messaging",
      status: "ready",
      tokenAvailable: false,
      warnings: ["Matrix token issuer is not configured."]
    }), { status: 200 })));

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000
    });

    const bootstrap = await provider.fetchMatrixBootstrap({
      authMode: "oidc",
      displayName: "User One",
      subjectId: "user-123",
      username: "user.one"
    }, new Date("2026-05-22T12:00:00Z"));

    expect(bootstrap).toMatchObject({
      chatAvailable: false,
      status: "degraded",
      tokenAvailable: false
    });
    expect(bootstrap.accessToken).toBeUndefined();
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

  it("requires authentication for Matrix bootstrap and never exposes provider token in status", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: false,
        timeoutMs: 3000,
        token: "server-token-123"
      }),
      now: () => new Date("2026-05-22T12:00:00Z")
    });

    const statusResponse = await app.inject({
      method: "GET",
      url: "/api/v1/messaging/status"
    });
    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/api/v1/messaging/bootstrap"
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(JSON.stringify(statusResponse.json())).not.toContain("server-token-123");
    expect(bootstrapResponse.statusCode).toBe(401);
  });

  it("exposes authenticated Matrix bootstrap without leaking provider token", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab");
    vi.stubEnv("COP_LAB_TOKEN", "lab-secret");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "x-csm-device-id": "COPWEB.route-test"
      });

      return new Response(JSON.stringify({
        accessToken: "matrix-user-token",
        contractVersion: "csm-messaging-provider-v1",
        deviceId: "COPWEB.route-test",
        e2eeRequired: true,
        expiresAt: "2026-05-23T12:00:00Z",
        homeserverBaseUrl: "https://msg.zeleznalady.cz",
        providerId: "csm.messaging",
        serverName: "msg.zeleznalady.cz",
        status: "ready",
        tokenAvailable: true,
        userId: "@lab:msg.zeleznalady.cz",
        warnings: []
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: true,
        timeoutMs: 3000,
        token: "provider-token"
      }),
      now: () => new Date("2026-05-22T12:00:00Z")
    });

    const response = await app.inject({
      body: {
        deviceId: "COPWEB.route-test"
      },
      headers: {
        authorization: "Bearer lab-secret"
      },
      method: "POST",
      url: "/api/v1/messaging/bootstrap"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accessToken: "matrix-user-token",
      chatAvailable: true,
      tokenAvailable: true
    });
    expect(JSON.stringify(response.json())).not.toContain("provider-token");
  });

  it("proxies conversation metadata server-side without plaintext message fields", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab");
    vi.stubEnv("COP_LAB_TOKEN", "lab-secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "x-csm-user-id": "lab",
        "x-csm-user-role": "lab"
      });
      const url = String(input);
      if (url.endsWith("/api/v1/conversations") && init?.method === "POST") {
        expect(init.body).toBe(JSON.stringify({
          metadata: {
            externalId: "community-group-1",
            source: "cop.community"
          },
          title: "Povodně Vrbno",
          type: "group"
        }));
        return new Response(JSON.stringify({
          contractVersion: "csm-messaging-provider-v1",
          conversation: {
            conversationId: "conv_1",
            encrypted: true,
            e2eeRequired: true,
            matrix: {
              roomId: null,
              state: "pending_matrix_integration"
            },
            memberCount: 1,
            status: "metadata_ready",
            title: "Povodně Vrbno",
            type: "group"
          },
          providerId: "csm.messaging"
        }), { status: 201 });
      }
      return new Response(JSON.stringify({
        contractVersion: "csm-messaging-provider-v1",
        conversations: [],
        count: 0,
        providerId: "csm.messaging"
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: true,
        timeoutMs: 3000,
        token: "provider-token"
      }),
      now: () => new Date("2026-05-22T12:00:00Z")
    });

    const listResponse = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "GET",
      url: "/api/v1/messaging/conversations"
    });
    const createResponse = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "POST",
      payload: {
        metadata: {
          externalId: "community-group-1",
          source: "cop.community"
        },
        title: "Povodně Vrbno",
        type: "group"
      },
      url: "/api/v1/messaging/conversations"
    });
    const rejectedResponse = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "POST",
      payload: {
        message: "plaintext must not pass COP",
        title: "Forbidden",
        type: "group"
      },
      url: "/api/v1/messaging/conversations"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      conversation: {
        conversationId: "conv_1",
        title: "Povodně Vrbno"
      },
      status: "online"
    });
    expect(rejectedResponse.statusCode).toBe(400);
    expect(JSON.stringify(createResponse.json())).not.toContain("provider-token");
    await app.close();
  });

  it("normalizes COP user headers before proxying conversation metadata", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "x-csm-user-id": "subject-1",
        "x-csm-user-name": "Jiri Volek",
        "x-csm-user-role": "krizovy-operator"
      });
      return new Response(JSON.stringify({
        contractVersion: "csm-messaging-provider-v1",
        conversations: [],
        count: 0,
        providerId: "csm.messaging"
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token"
    });

    const result = await provider.fetchConversations({
      authMode: "oidc",
      displayName: "Jiří Volek",
      roles: ["krizový-operátor"],
      subjectId: "subject-1",
      username: "jiri.volek"
    }, new Date("2026-05-22T12:00:00Z"));

    expect(result.status).toBe("online");
  });

  it("returns conversation detail metadata without requiring clients to list locally", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab");
    vi.stubEnv("COP_LAB_TOKEN", "lab-secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "x-csm-user-id": "lab"
      });
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/conversations/conv_1");
      return new Response(JSON.stringify({
        contractVersion: "csm-messaging-provider-v1",
        conversation: {
          conversationId: "conv_1",
          encrypted: true,
          e2eeRequired: true,
          matrix: {
            roomId: "!room:msg.zeleznalady.cz",
            state: "bound"
          },
          memberCount: 2,
          metadata: {
            externalId: "community-group-1",
            source: "cop.community"
          },
          status: "metadata_ready",
          title: "Povodně Vrbno",
          type: "group"
        },
        providerId: "csm.messaging"
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: true,
        timeoutMs: 3000,
        token: "provider-token"
      }),
      now: () => new Date("2026-05-22T12:00:00Z")
    });

    const response = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "GET",
      url: "/api/v1/messaging/conversations/conv_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      conversation: {
        conversationId: "conv_1",
        matrix: {
          roomId: "!room:msg.zeleznalady.cz"
        },
        metadata: {
          externalId: "community-group-1"
        },
        title: "Povodně Vrbno"
      },
      status: "online"
    });
    expect(JSON.stringify(response.json())).not.toContain("provider-token");
    await app.close();
  });

  it("resolves conversation metadata by Matrix room id for push deep links", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab");
    vi.stubEnv("COP_LAB_TOKEN", "lab-secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "x-csm-user-id": "lab"
      });
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/conversations");
      return new Response(JSON.stringify({
        contractVersion: "csm-messaging-provider-v1",
        conversations: [
          {
            conversationId: "conv_other",
            matrix: { roomId: "!other:msg.zeleznalady.cz" },
            title: "Jiná konverzace",
            type: "group"
          },
          {
            conversationId: "conv_1",
            matrix: { roomId: "!room:msg.zeleznalady.cz" },
            metadata: {
              externalId: "community-group-1",
              source: "cop.community"
            },
            title: "Povodně Vrbno",
            type: "group"
          }
        ],
        count: 2,
        providerId: "csm.messaging"
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: true,
        timeoutMs: 3000,
        token: "provider-token"
      }),
      now: () => new Date("2026-05-22T12:00:00Z")
    });

    const response = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "GET",
      url: `/api/v1/messaging/conversations/resolve?roomId=${encodeURIComponent("!room:msg.zeleznalady.cz")}`
    });
    const messageOnlyResponse = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "GET",
      url: `/api/v1/messaging/conversations/resolve?messageId=${encodeURIComponent("$event:msg.zeleznalady.cz")}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      conversation: {
        conversationId: "conv_1",
        matrix: {
          roomId: "!room:msg.zeleznalady.cz"
        }
      },
      status: "online"
    });
    expect(messageOnlyResponse.statusCode).toBe(400);
    expect(messageOnlyResponse.json().error.message).toContain("conversationId or roomId");
    expect(JSON.stringify(response.json())).not.toContain("provider-token");
    await app.close();
  });

  it("syncs COP group members into Messaging conversation metadata only", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab");
    vi.stubEnv("COP_LAB_TOKEN", "lab-secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "x-csm-user-id": "lab"
      });
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/conversations/conv_1/members");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({
        members: [
          { displayName: "Responder Three", userId: "user-3" }
        ]
      }));
      return new Response(JSON.stringify({
        contractVersion: "csm-messaging-provider-v1",
        conversation: {
          conversationId: "conv_1",
          encrypted: true,
          e2eeRequired: true,
          matrix: {
            roomId: null,
            state: "pending_matrix_integration"
          },
          members: [
            { displayName: "Lab", userId: "lab" },
            { displayName: "Responder Three", userId: "user-3" }
          ],
          metadata: {
            externalId: "community-group-1",
            source: "cop.community"
          },
          status: "metadata_ready",
          title: "Povodně Vrbno",
          type: "group"
        },
        providerId: "csm.messaging"
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: true,
        timeoutMs: 3000,
        token: "provider-token"
      }),
      now: () => new Date("2026-05-22T12:00:00Z")
    });

    const response = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "POST",
      payload: {
        members: [
          { displayName: "Responder Three", userId: "user-3" }
        ]
      },
      url: "/api/v1/messaging/conversations/conv_1/members"
    });
    const rejectedResponse = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "POST",
      payload: {
        members: [{ userId: "user-4" }],
        message: "plaintext must not pass COP"
      },
      url: "/api/v1/messaging/conversations/conv_1/members"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      conversation: {
        conversationId: "conv_1",
        metadata: {
          externalId: "community-group-1"
        },
        members: [
          { userId: "lab" },
          { userId: "user-3" }
        ]
      },
      status: "online"
    });
    expect(rejectedResponse.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).not.toContain("provider-token");
    await app.close();
  });

  it("sends notification intake server-side with mandatory idempotency and without device tokens", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/notifications");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "Content-Type": "application/json",
        "Idempotency-Key": "sim.safety-data:public.safety.flood:flood-1:from:until",
        "x-csm-user-id": "lab"
      });
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).not.toContain("apns");
      expect(String(init?.body)).not.toContain("deviceToken");
      return new Response(JSON.stringify({
        contractVersion: "csm-notification-v1",
        deduplicated: false,
        notificationId: "notif_1",
        providerId: "csm.messaging",
        status: "accepted",
        warnings: []
      }), { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token"
    });

    const result = await provider.sendNotification(
      {
        authMode: "lab",
        displayName: "Lab operator",
        subjectId: "lab",
        username: "lab"
      },
      new Date("2026-05-29T12:00:00Z"),
      "sim.safety-data:public.safety.flood:flood-1:from:until",
      {
        audience: { groupIds: ["group-1"] },
        body: { cs: "Otevřete CSM pro detail." },
        deepLink: "csm://map/alert/flood-1",
        priority: "time_sensitive",
        severity: "warning",
        source: {
          featureId: "flood-1",
          layerId: "public.safety.flood",
          providerId: "sim.safety-data",
          sourceName: "CHMI hydrology"
        },
        title: { cs: "Povodňová výstraha" },
        type: "safety.alert"
      }
    );

    expect(result).toMatchObject({
      deduplicated: false,
      enabled: true,
      notificationId: "notif_1",
      providerId: "csm.messaging",
      status: "online"
    });
    expect(JSON.stringify(result)).not.toContain("provider-token");
  });
});
