import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  clearJwksCacheForTests();
});

afterEach(() => {
  process.env = { ...originalEnv };
  clearJwksCacheForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("COP API authentication", () => {
  it.each([undefined, "Bearer not-authorized"])("rejects a protected malformed upload before parsing it (%s)", async (authorization) => {
    const app = buildServer();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/community/reports",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        payload: '{"not-valid-json":'
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("UNAUTHORIZED");
    } finally {
      await app.close();
    }
  });

  it("preserves body parsing and limits after successful authentication", async () => {
    const app = buildServer();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/community/reports",
        headers: { "content-type": "application/json", authorization: "Bearer dev-lab-token" },
        payload: '{"not-valid-json":'
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("preserves credential-free CORS preflight on protected routes", async () => {
    process.env.COP_API_ALLOWED_ORIGINS = "https://cop.example.test";
    const app = buildServer();
    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/v1/community/reports",
        headers: { origin: "https://cop.example.test", "access-control-request-method": "POST" }
      });
      expect(response.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it("resolves a BFF cookie before body parsing and rejects an untrusted origin first", async () => {
    process.env.COP_WEB_BFF_SESSION_ENABLED = "true";
    process.env.COP_AUTH_MODE = "lab";
    process.env.COP_PUBLIC_URL = "https://cop.example.test";
    const sessions = new InMemoryWebSessionStore();
    const record = await sessions.create({
      accessToken: "dev-lab-token",
      accessTokenExpiresAt: new Date(Date.now() + 300_000),
      profile: { name: "Synthetic", subjectId: "lab", username: "lab" }
    }, new Date(Date.now() + 86_400_000));
    const app = buildServer({ webSessionStore: sessions });
    try {
      const request = {
        method: "POST" as const,
        url: "/api/v1/community/reports",
        headers: { cookie: `cop_web_session_v1=${record.sessionId}`, "content-type": "application/json", origin: "https://evil.example.test" },
        payload: '{"not-valid-json":'
      };
      const rejected = await app.inject(request);
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json().error.code).toBe("BFF_ORIGIN_FORBIDDEN");
      const allowed = await app.inject({ ...request, headers: { ...request.headers, origin: "https://cop.example.test" } });
      expect(allowed.statusCode).toBe(400);
      const profile = await app.inject({ url: "/api/v1/me/preferences", headers: { cookie: request.headers.cookie } });
      expect(profile.statusCode).toBe(200);
      expect(profile.json().actor.subjectId).toBe("lab");
    } finally {
      await app.close();
    }
  });

  it("accepts the exact lab token in lab mode", async () => {
    const app = buildServer();

    const response = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/sources"
    });

    expect(response.statusCode).toBe(200);
  });

  it("rejects arbitrary bearer tokens in lab mode", async () => {
    const app = buildServer();

    const response = await app.inject({
      headers: {
        authorization: "Bearer any-token"
      },
      method: "GET",
      url: "/api/v1/sources"
    });

    expect(response.statusCode).toBe(401);
  });

  it("allows configured public read endpoints without a bearer token", async () => {
    process.env.COP_AUTH_MODE = "oidc";
    process.env.COP_PUBLIC_READ_ENABLED = "true";
    const app = buildServer();

    const tracksResponse = await app.inject({
      method: "GET",
      url: "/api/v1/cop/tracks"
    });
    const sourcesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/sources"
    });
    const writeResponse = await app.inject({
      method: "POST",
      payload: {
        category: "fire"
      },
      url: "/api/v1/community/reports"
    });
    const profileResponse = await app.inject({
      method: "GET",
      url: "/api/v1/me/preferences"
    });

    expect(tracksResponse.statusCode).toBe(200);
    expect(sourcesResponse.statusCode).toBe(200);
    expect(writeResponse.statusCode).toBe(401);
    expect(profileResponse.statusCode).toBe(401);

    await app.close();
  });

  it("still rejects invalid bearer tokens on public read endpoints", async () => {
    process.env.COP_AUTH_MODE = "oidc";
    process.env.COP_PUBLIC_READ_ENABLED = "true";
    const app = buildServer();

    const response = await app.inject({
      headers: {
        authorization: "Bearer not-a-valid-token"
      },
      method: "GET",
      url: "/api/v1/cop/tracks"
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("requires a bearer token for read endpoints when public read is disabled", async () => {
    process.env.COP_AUTH_MODE = "oidc";
    process.env.COP_PUBLIC_READ_ENABLED = "false";
    const app = buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cop/tracks"
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts a valid Keycloak-style OIDC token in oidc mode", async () => {
    const issuer = "https://login.zeleznalady.cz/realms/cop";
    const keyId = "cop-test-key";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: keyId,
      use: "sig"
    };

    process.env.COP_AUTH_MODE = "oidc";
    process.env.COP_OIDC_ISSUER = issuer;
    process.env.COP_OIDC_ALLOWED_CLIENTS = "cop-web";
    process.env.COP_OIDC_REQUIRED_ROLE = "cop_operator";

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ keys: [publicJwk] })));
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      privateKey,
      keyId,
      {
        azp: "cop-web",
        exp: now + 300,
        iat: now,
        iss: issuer,
        sub: "synthetic-operator",
        realm_access: {
          roles: ["cop_operator"]
        }
      }
    );
    const app = buildServer();

    const response = await app.inject({
      headers: {
        authorization: `Bearer ${token}`
      },
      method: "GET",
      url: "/api/v1/sources"
    });

    expect(response.statusCode).toBe(200);
  });

  it("keeps server-side preferences isolated by OIDC subject", async () => {
    const issuer = "https://login.zeleznalady.cz/realms/cop";
    const keyId = "cop-test-key";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: keyId,
      use: "sig"
    };

    process.env.COP_AUTH_MODE = "oidc";
    process.env.COP_OIDC_ISSUER = issuer;
    process.env.COP_OIDC_ALLOWED_CLIENTS = "cop-web";
    process.env.COP_OIDC_REQUIRED_ROLE = "cop_operator";

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ keys: [publicJwk] })));
    const now = Math.floor(Date.now() / 1000);
    const commonPayload = {
      azp: "cop-web",
      exp: now + 300,
      iat: now,
      iss: issuer,
      sub: "synthetic-operator",
      realm_access: {
        roles: ["cop_operator"]
      }
    };
    const operatorAToken = signJwt(privateKey, keyId, {
      ...commonPayload,
      name: "Operator A",
      preferred_username: "operator.a",
      sub: "operator-a"
    });
    const operatorBToken = signJwt(privateKey, keyId, {
      ...commonPayload,
      name: "Operator B",
      preferred_username: "operator.b",
      sub: "operator-b"
    });
    const app = buildServer();

    const updateResponse = await app.inject({
      headers: {
        authorization: `Bearer ${operatorAToken}`
      },
      method: "PUT",
      payload: {
        alertPreferences: {
          minimumSeverity: "warning"
        },
        preferences: {
          mapControlsCollapsed: true,
          mapLegendCollapsed: true,
          selectedLayer: "foreign",
          showAlertAreas: true,
          trackHistoryWindowSeconds: 60
        }
      },
      url: "/api/v1/me/preferences"
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      actor: {
        subjectId: "operator-a",
        username: "operator.a"
      },
      alertPreferences: {
        minimumSeverity: "warning"
      },
      preferences: {
        mapControlsCollapsed: true,
        mapLegendCollapsed: true,
        selectedLayer: "foreign",
        showAlertAreas: true,
        trackHistoryWindowSeconds: 60
      }
    });

    const operatorAProfile = await app.inject({
      headers: {
        authorization: `Bearer ${operatorAToken}`
      },
      method: "GET",
      url: "/api/v1/me/preferences"
    });
    const operatorBProfile = await app.inject({
      headers: {
        authorization: `Bearer ${operatorBToken}`
      },
      method: "GET",
      url: "/api/v1/me/preferences"
    });

    expect(operatorAProfile.json()).toMatchObject({
      preferences: {
        selectedLayer: "foreign"
      }
    });
    expect(operatorBProfile.json()).toMatchObject({
      actor: {
        subjectId: "operator-b"
      },
      preferences: {}
    });

    await app.close();
  });

  it("rejects OIDC tokens without surfacing JWKS fetch failures", async () => {
    const issuer = "https://login.zeleznalady.cz/realms/cop";
    const keyId = "missing-key";
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

    process.env.COP_AUTH_MODE = "oidc";
    process.env.COP_OIDC_ISSUER = issuer;
    process.env.COP_OIDC_ALLOWED_CLIENTS = "cop-web";

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("jwks unavailable");
    }));
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      privateKey,
      keyId,
      {
        azp: "cop-web",
        exp: now + 300,
        iat: now,
        iss: issuer,
        sub: "synthetic-operator"
      }
    );
    const app = buildServer();

    const response = await app.inject({
      headers: {
        authorization: `Bearer ${token}`
      },
      method: "GET",
      url: "/api/v1/sources"
    });

    expect(response.statusCode).toBe(401);
  });
});

function signJwt(privateKey: KeyObject, keyId: string, payload: Record<string, unknown>): string {
  const header = {
    alg: "RS256",
    kid: keyId,
    typ: "JWT"
  };
  const signedContent = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signedContent);
  signer.end();
  return `${signedContent}.${bufferToBase64Url(signer.sign(privateKey))}`;
}

function base64Url(value: string): string {
  return bufferToBase64Url(Buffer.from(value, "utf8"));
}

function bufferToBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function jsonResponse(body: unknown): Response {
  return Response.json(body);
}
