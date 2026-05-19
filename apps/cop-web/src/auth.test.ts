// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createInitialAuthSession, decodeJwtPayload, getAuthorizationToken, isOidcEnabled, type AuthConfig } from "./auth";

describe("web auth helpers", () => {
  it("keeps lab mode as the default non-OIDC state", () => {
    const config: AuthConfig = {
      clientId: "cop-web",
      issuer: "",
      mode: "lab",
      scope: "openid profile email"
    };

    expect(isOidcEnabled(config)).toBe(false);
    expect(createInitialAuthSession(config)).toMatchObject({
      profile: { username: "lab" },
      status: "lab"
    });
  });

  it("prefers an OIDC access token over the public lab token", () => {
    expect(getAuthorizationToken({ accessToken: "oidc-token", status: "authenticated" }, "lab-token")).toBe("oidc-token");
    expect(getAuthorizationToken({ status: "anonymous" }, "lab-token")).toBe("lab-token");
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
});

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
