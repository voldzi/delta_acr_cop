import { describe, expect, it } from "vitest";
import { restoreWebSessionTokens } from "./web-session-store.js";

describe("web session storage", () => {
  it("restores the encrypted JSON expiration as a Date", () => {
    const tokens = restoreWebSessionTokens({
      accessToken: "server-only-access-token",
      accessTokenExpiresAt: "2026-09-19T16:00:00.000Z",
      idToken: "server-only-id-token",
      profile: {
        email: "operator@example.test",
        name: "COP Operator",
        picture: "https://login.example.test/avatar.png",
        subjectId: "operator-1",
        username: "operator"
      },
      refreshToken: "server-only-refresh-token"
    });

    expect(tokens.accessTokenExpiresAt).toBeInstanceOf(Date);
    expect(tokens.accessTokenExpiresAt.toISOString()).toBe("2026-09-19T16:00:00.000Z");
    expect(tokens.profile.picture).toBe("https://login.example.test/avatar.png");
  });

  it("rejects a corrupted stored expiration instead of crashing authenticated requests", () => {
    expect(() =>
      restoreWebSessionTokens({
        accessToken: "server-only-access-token",
        accessTokenExpiresAt: "not-a-date",
        profile: { name: "COP Operator", subjectId: "operator-1", username: "operator" }
      })
    ).toThrow("Invalid stored web session accessTokenExpiresAt");
  });
});
