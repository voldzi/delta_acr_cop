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

  it("keeps PWA chat available when provider health is degraded only by APNs delivery", async () => {
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
            matrixTokenBootstrap: true,
            webPushDelivery: true
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
        return new Response(JSON.stringify({
          checks: [
            { id: "matrix_config", message: "Matrix bootstrap is configured.", status: "ok" },
            { id: "metadata_store", message: "Conversation metadata store is writable.", status: "ok" },
            {
              id: "apns",
              message: "APNs key material is required for live native delivery.",
              status: "degraded"
            },
            { id: "web_push", message: "Web Push live delivery is configured.", status: "ok" }
          ],
          status: "degraded"
        }), { status: 503 });
      }
      return new Response(JSON.stringify({ versions: ["v1.12"] }), { status: 200 });
    }));

    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      matrixHomeserverPublicUrl: "https://msg.zeleznalady.cz",
      timeoutMs: 3000
    });

    const status = await provider.fetchStatus(new Date("2026-05-22T12:00:00Z"));

    expect(status.status).toBe("degraded");
    expect(status.chatAvailable).toBe(true);
    expect(status.detail).toBe("provider=online; health=degraded");
    expect(status.warnings).toContain("apns: APNs key material is required for live native delivery.");
    expect(status.warnings).not.toContain("Messaging metadata API is available server-side, but client-safe Matrix/E2EE bootstrap is not ready.");
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
        "x-csm-user-name": "Jiri Volek",
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
      displayName: "Jiří Volek",
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

  it("sends an authenticated voice-call wake notification without call signalling content", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab");
    vi.stubEnv("COP_LAB_TOKEN", "lab-secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((url.endsWith("/api/v1/conversations") || url.includes("/api/v1/conversations?")) && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({
          contractVersion: "csm-messaging-provider-v1",
          conversations: [{
            conversationId: "conv_call",
            matrix: { roomId: "!call:docker.home.cz" },
            memberCount: 2,
            status: "matrix_ready",
            title: "Přímý chat",
            type: "direct"
          }],
          count: 1,
          providerId: "csm.messaging"
        }), { status: 200 });
      }
      if (url.endsWith("/api/v1/conversations/conv_call")) {
        return new Response(JSON.stringify({
          contractVersion: "csm-messaging-provider-v1",
          conversation: {
            conversationId: "conv_call",
            matrix: { roomId: "!call:docker.home.cz" },
            members: [
              { displayName: "Lab operator", userId: "lab" },
              { displayName: "Příjemce", userId: "citizen-2" }
            ],
            status: "matrix_ready",
            title: "Přímý chat",
            type: "direct"
          }
        }), { status: 200 });
      }
      if (url.endsWith("/api/v1/notifications")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          audience: { userIds: ["citizen-2"] },
          metadata: {
            callId: "call-123",
            roomId: "!call:docker.home.cz",
            sender: "lab"
          },
          type: "chat.voice_call.incoming"
        });
        expect(JSON.stringify(body)).not.toContain("offer");
        expect(JSON.stringify(body)).not.toContain("candidate");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer provider-token",
          "Idempotency-Key": expect.stringMatching(/^voice-call:invite:/u),
          "x-csm-user-id": "lab"
        });
        return new Response(JSON.stringify({
          contractVersion: "csm-messaging-provider-v1",
          notification: {
            deduplicated: false,
            notificationId: "notif_call",
            targetDeviceCount: 1,
            type: "chat.voice_call.incoming"
          },
          providerId: "csm.messaging"
        }), { status: 202 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
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
      now: () => new Date("2026-07-10T06:00:00Z")
    });

    const response = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "POST",
      payload: { action: "invite", callId: "call-123", roomId: "!call:docker.home.cz" },
      url: "/api/v1/messaging/calls/wake"
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ notificationId: "notif_call", status: "online" });
    await app.close();
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

  it("allows iOS to ensure a Matrix room binding without sending a roomId", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab");
    vi.stubEnv("COP_LAB_TOKEN", "lab-secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/conversations/conv_1/matrix-room");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "x-csm-user-id": "lab"
      });
      expect(init?.body).toBe(JSON.stringify({}));
      return new Response(JSON.stringify({
        contractVersion: "csm-messaging-provider-v1",
        conversation: {
          avatarUrl: "mxc://msg.example/room-avatar",
          conversationId: "conv_1",
          directPeer: {
            avatarUrl: "mxc://msg.example/user-avatar",
            displayName: "COP Operator",
            userId: "cop.operator"
          },
          encrypted: true,
          e2eeRequired: true,
          matrix: {
            roomId: "!room:msg.example",
            state: "ready"
          },
          members: [
            { avatarUrl: "mxc://msg.example/lab-avatar", displayName: "Lab", userId: "lab" },
            { avatarUrl: "mxc://msg.example/user-avatar", displayName: "COP Operator", userId: "cop.operator" }
          ],
          status: "ready",
          title: "COP Operator",
          type: "direct"
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
      payload: {},
      url: "/api/v1/messaging/conversations/conv_1/matrix-room"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      conversation: {
        avatarUrl: "mxc://msg.example/room-avatar",
        directPeer: {
          avatarUrl: "mxc://msg.example/user-avatar",
          userId: "cop.operator"
        },
        matrix: {
          roomId: "!room:msg.example"
        },
        members: [
          { avatarUrl: "mxc://msg.example/lab-avatar", userId: "lab" },
          { avatarUrl: "mxc://msg.example/user-avatar", userId: "cop.operator" }
        ]
      },
      status: "online"
    });
    await app.close();
  });

  it("exposes browser Web Push config without leaking provider secrets", async () => {
    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token",
      webPushEnabled: true,
      webPushVapidPublicKey: "browser-public-vapid-key"
    });

    const config = await provider.fetchWebPushConfig(new Date("2026-06-23T10:00:00Z"));

    expect(config).toMatchObject({
      contractVersion: "cop-web-push-config-v1",
      enabled: true,
      providerId: "csm.messaging",
      status: "online",
      vapidPublicKey: "browser-public-vapid-key"
    });
    expect(JSON.stringify(config)).not.toContain("provider-token");
    expect(JSON.stringify(config)).not.toContain("private");
  });

  it("exposes browser Web Push config through the COP API public read boundary", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: true,
        timeoutMs: 3000,
        token: "provider-token",
        webPushEnabled: true,
        webPushVapidPublicKey: "browser-public-vapid-key"
      }),
      now: () => new Date("2026-06-23T10:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/push/web/config"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contractVersion: "cop-web-push-config-v1",
      enabled: true,
      providerId: "csm.messaging",
      status: "online",
      vapidPublicKey: "browser-public-vapid-key"
    });
    expect(response.body).not.toContain("provider-token");
    await app.close();
  });

  it("returns structured degraded Web Push registration responses without browser-visible 502", async () => {
    vi.stubEnv("COP_AUTH_MODE", "lab");
    vi.stubEnv("COP_LAB_TOKEN", "lab-secret");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          contractVersion: "csm-device-v1",
          providerId: "csm.messaging",
          status: "degraded",
          warnings: ["Device registry temporarily unavailable."]
        }),
        { status: 500 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      messagingProvider: new CsmMessagingProvider({
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: true,
        timeoutMs: 3000,
        token: "provider-token",
        webPushEnabled: true,
        webPushVapidPublicKey: "browser-public-vapid-key"
      }),
      now: () => new Date("2026-07-07T11:35:00Z")
    });

    const response = await app.inject({
      headers: { authorization: "Bearer lab-secret" },
      method: "POST",
      payload: {
        deviceId: "web_device-1",
        subscription: {
          endpoint: "https://push.example.test/subscription/1",
          keys: {
            auth: "auth-secret",
            p256dh: "p256dh-public"
          }
        }
      },
      url: "/api/v1/push/web/devices"
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      contractVersion: "cop-web-push-device-v1",
      enabled: true,
      providerId: "csm.messaging",
      registered: false,
      status: "degraded"
    });
    expect(response.body).not.toContain("provider-token");
    expect(response.body).toContain("HTTP 500");
    await app.close();
  });

  it("registers browser Web Push devices server-side with sanitized actor headers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/devices");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "Content-Type": "application/json",
        "x-csm-device-id": "web_device-1",
        "x-csm-user-id": "user-123",
        "x-csm-user-name": "Jiri Volek",
        "x-csm-user-role": "cop_operator"
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        capabilities: ["notifications", "deep_links"],
        deviceId: "web_device-1",
        locale: "cs-CZ",
        platform: "web",
        pushProvider: "webpush",
        pushSubscription: {
          endpoint: "https://push.example.test/subscription/1",
          keys: {
            auth: "auth-secret",
            p256dh: "p256dh-public"
          }
        },
        timezone: "Europe/Prague"
      });
      return new Response(JSON.stringify({
        contractVersion: "csm-device-v1",
        deviceId: "web_device-1",
        providerId: "csm.messaging",
        registered: true,
        status: "registered",
        warnings: []
      }), { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token",
      webPushEnabled: true,
      webPushVapidPublicKey: "browser-public-vapid-key"
    });

    const result = await provider.registerWebPushDevice(
      {
        authMode: "oidc",
        displayName: "Jiří Volek",
        roles: ["cop_operator"],
        subjectId: "user-123",
        username: "jiri.volek"
      },
      new Date("2026-06-23T10:00:00Z"),
      {
        capabilities: ["notifications", "deep_links"],
        deviceId: "web_device-1",
        endpoint: "https://push.example.test/subscription/1",
        keys: {
          auth: "auth-secret",
          p256dh: "p256dh-public"
        },
        locale: "cs-CZ",
        notificationPreferences: {
          safetyAlerts: true
        },
        timezone: "Europe/Prague"
      }
    );

    expect(result).toMatchObject({
      contractVersion: "cop-web-push-device-v1",
      deviceId: "web_device-1",
      enabled: true,
      providerId: "csm.messaging",
      registered: true,
      status: "online"
    });
    expect(JSON.stringify(result)).not.toContain("provider-token");
  });

  it("accepts nested active CSM device responses as successful Web Push registration", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          contractVersion: "csm-messaging-provider-v1",
          device: {
            deviceId: "web_device-1",
            platform: "web",
            pushProvider: "webpush",
            status: "active"
          },
          providerId: "csm.messaging"
        }),
        { status: 201 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token",
      webPushEnabled: true,
      webPushVapidPublicKey: "browser-public-vapid-key"
    });

    const result = await provider.registerWebPushDevice(
      {
        authMode: "oidc",
        displayName: "Jiří Volek",
        roles: ["cop_operator"],
        subjectId: "user-123",
        username: "jiri.volek"
      },
      new Date("2026-07-07T11:07:45Z"),
      {
        capabilities: ["notifications", "deep_links"],
        deviceId: "web_device-1",
        endpoint: "https://web.push.apple.com/subscription/1",
        keys: {
          auth: "auth-secret",
          p256dh: "p256dh-public"
        },
        locale: "cs-CZ",
        timezone: "Europe/Prague"
      }
    );

    expect(result).toMatchObject({
      contractVersion: "cop-web-push-device-v1",
      deviceId: "web_device-1",
      enabled: true,
      providerId: "csm.messaging",
      registered: true,
      status: "online",
      warnings: []
    });
  });

  it("accepts top-level active CSM device responses as successful Web Push registration", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          contractVersion: "csm-device-v1",
          deviceId: "web_device-1",
          providerId: "csm.messaging",
          status: "active"
        }),
        { status: 201 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token",
      webPushEnabled: true,
      webPushVapidPublicKey: "browser-public-vapid-key"
    });

    const result = await provider.registerWebPushDevice(
      {
        authMode: "oidc",
        displayName: "Jiří Volek",
        roles: ["cop_operator"],
        subjectId: "user-123",
        username: "jiri.volek"
      },
      new Date("2026-07-07T11:38:00Z"),
      {
        deviceId: "web_device-1",
        endpoint: "https://web.push.apple.com/subscription/1",
        keys: {
          auth: "auth-secret",
          p256dh: "p256dh-public"
        }
      }
    );

    expect(result).toMatchObject({
      contractVersion: "cop-web-push-device-v1",
      deviceId: "web_device-1",
      enabled: true,
      providerId: "csm.messaging",
      registered: true,
      status: "online",
      warnings: []
    });
  });

  it("deletes browser Web Push devices through the server-side provider", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/devices/web_device-1");
      expect(init?.method).toBe("DELETE");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "x-csm-device-id": "web_device-1",
        "x-csm-user-id": "user-123"
      });
      return new Response(JSON.stringify({ status: "deleted" }), { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token",
      webPushEnabled: true,
      webPushVapidPublicKey: "browser-public-vapid-key"
    });

    const result = await provider.deleteWebPushDevice(
      {
        authMode: "oidc",
        displayName: "Jiří Volek",
        roles: ["cop_operator"],
        subjectId: "user-123",
        username: "jiri.volek"
      },
      new Date("2026-06-23T10:00:00Z"),
      "web_device-1"
    );

    expect(result).toMatchObject({
      contractVersion: "cop-web-push-device-v1",
      deleted: true,
      deviceId: "web_device-1",
      enabled: true,
      status: "online"
    });
    expect(JSON.stringify(result)).not.toContain("provider-token");
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
        contractVersion: "csm-messaging-provider-v1",
        notification: {
          deduplicated: false,
          notificationId: "notif_1",
          targetDeviceCount: 1,
          type: "safety.alert"
        },
        providerId: "csm.messaging",
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

  it("forwards Matrix push gateway payloads to CSM Messaging without requiring browser auth", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/matrix/push/notify");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer provider-token",
        "Content-Type": "application/json"
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        notification: {
          devices: [{ pushkey: "web_device-1" }],
          event_id: "$event"
        }
      });
      return new Response(JSON.stringify({ rejected: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CsmMessagingProvider({
      baseUrl: "http://messaging.local:4050",
      cacheTtlMs: 10000,
      enabled: true,
      timeoutMs: 3000,
      token: "provider-token"
    });

    const result = await provider.forwardMatrixPushNotification(new Date("2026-07-07T13:20:00Z"), {
      notification: {
        devices: [{ pushkey: "web_device-1" }],
        event_id: "$event"
      }
    });

    expect(result).toMatchObject({
      body: { rejected: [] },
      ok: true,
      status: "online",
      statusCode: 200,
      warnings: []
    });
    expect(JSON.stringify(result)).not.toContain("provider-token");
  });

  it("exposes the Matrix push gateway through the public canonical Matrix endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://messaging.local:4050/api/v1/matrix/push/notify");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ rejected: [] }), { status: 200 });
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
      now: () => new Date("2026-07-07T13:21:00Z")
    });

    const response = await app.inject({
      method: "POST",
      payload: {
        notification: {
          devices: [{ pushkey: "web_device-1" }],
          event_id: "$event"
        }
      },
      url: "/_matrix/push/v1/notify"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ rejected: [] });
    expect(response.body).not.toContain("provider-token");
    await app.close();
  });
});
