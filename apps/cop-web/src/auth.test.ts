// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialAuthSession,
  decodeJwtPayload,
  getAuthorizationToken,
  initializeAuth,
  isAuthSessionActive,
  isOidcEnabled,
  refreshAuthSession,
  subjectIdFromAuthSession,
  subjectIdFromStoredAuthValue,
  type AuthConfig
} from "./auth";

describe("web auth helpers", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage()
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage()
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps lab mode as the default non-OIDC state", () => {
    const config: AuthConfig = {
      clientId: "cop-web",
      issuer: "",
      mode: "lab",
      publicReadEnabled: false,
      scope: "openid profile email"
    };

    expect(isOidcEnabled(config)).toBe(false);
    expect(createInitialAuthSession(config)).toMatchObject({
      profile: { username: "lab" },
      status: "lab"
    });
  });

  it("prefers an OIDC access token over the public lab token", () => {
    expect(getAuthorizationToken({ accessToken: "oidc-token", expiresAt: Date.now() + 120_000, status: "authenticated" }, "lab-token")).toBe("oidc-token");
    expect(getAuthorizationToken({ status: "lab" }, "lab-token")).toBe("lab-token");
    expect(getAuthorizationToken({ status: "anonymous" }, "lab-token")).toBeUndefined();
  });

  it("does not send an expired OIDC access token", () => {
    const expired = { accessToken: "expired-token", expiresAt: Date.now() - 1_000, status: "authenticated" as const };

    expect(isAuthSessionActive(expired)).toBe(false);
    expect(getAuthorizationToken(expired, "lab-token")).toBeUndefined();
  });

  it("decodes JWT payloads for operator display data", () => {
    const token = [
      base64Url(JSON.stringify({ alg: "none" })),
      base64Url(JSON.stringify({ email: "operator@example.test", name: "COP Operator", preferred_username: "operator" })),
      ""
    ].join(".");

    expect(decodeJwtPayload(token)).toMatchObject({
      email: "operator@example.test",
      name: "COP Operator",
      preferred_username: "operator"
    });
  });

  it("restores an active OIDC session from persistent storage after reload", () => {
    window.localStorage.setItem("cop.oidc.session.v1", JSON.stringify({
      accessToken: "persisted-token",
      expiresAt: Date.now() + 120_000,
      profile: { name: "COP Operator", username: "operator" },
      refreshToken: "persisted-refresh"
    }));

    expect(createInitialAuthSession(oidcConfig())).toMatchObject({
      accessToken: "persisted-token",
      profile: { username: "operator" },
      status: "authenticated"
    });
  });

  it("extracts stable subject IDs from active and stored sessions", () => {
    expect(subjectIdFromAuthSession({
      accessToken: "token",
      expiresAt: Date.now() + 120_000,
      profile: { email: "operator@example.test", name: "COP Operator", subjectId: "subject-1", username: "operator" },
      status: "authenticated"
    })).toBe("subject-1");
    expect(subjectIdFromAuthSession({
      profile: { email: "operator@example.test", name: "COP Operator", username: "operator" },
      status: "authenticated"
    })).toBe("operator");
    expect(subjectIdFromStoredAuthValue(JSON.stringify({
      accessToken: "stored-token",
      expiresAt: Date.now() + 120_000,
      profile: { name: "Stored Operator", subjectId: "stored-subject", username: "stored" }
    }))).toBe("stored-subject");
    expect(subjectIdFromStoredAuthValue(null)).toBeUndefined();
    expect(subjectIdFromStoredAuthValue("{bad json")).toBeUndefined();
  });

  it("refreshes an expired persisted OIDC session instead of dropping it to anonymous", async () => {
    window.localStorage.setItem("cop.oidc.session.v1", JSON.stringify({
      accessToken: "expired-token",
      expiresAt: Date.now() - 10_000,
      profile: { name: "COP Operator", username: "operator" },
      refreshToken: "persisted-refresh"
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        access_token: unsignedJwt({ name: "COP Operator", preferred_username: "operator", sub: "user-1" }),
        expires_in: 300,
        refresh_token: "next-refresh"
      }),
      ok: true
    } as Response)));

    const session = await initializeAuth(oidcConfig());
    const stored = JSON.parse(window.localStorage.getItem("cop.oidc.session.v1") ?? "{}") as { refreshToken?: string };

    expect(session).toMatchObject({
      profile: { subjectId: "user-1", username: "operator" },
      status: "authenticated"
    });
    expect(stored.refreshToken).toBe("next-refresh");
  });

  it("can refresh the active request session for a retry after API 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        access_token: unsignedJwt({ email: "operator@example.test", name: "COP Operator", preferred_username: "operator" }),
        expires_in: 300
      }),
      ok: true
    } as Response)));

    const session = await refreshAuthSession(oidcConfig(), {
      accessToken: "rejected-token",
      expiresAt: Date.now() + 120_000,
      refreshToken: "retry-refresh",
      status: "authenticated"
    });

    expect(session).toMatchObject({
      profile: { email: "operator@example.test", username: "operator" },
      refreshToken: "retry-refresh",
      status: "authenticated"
    });
  });
});

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: "none" })),
    base64Url(JSON.stringify(payload)),
    ""
  ].join(".");
}

function oidcConfig(): AuthConfig {
  return {
    clientId: "cop-web",
    issuer: "https://login.example.test/realms/cop",
    mode: "oidc",
    publicReadEnabled: true,
    scope: "openid profile email"
  };
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
}
