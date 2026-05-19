import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";

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
          selectedLayer: "foreign",
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
        selectedLayer: "foreign",
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
        iss: issuer
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
  return {
    json: async () => body,
    ok: true,
    status: 200
  } as Response;
}
