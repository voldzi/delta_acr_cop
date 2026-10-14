import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "./security.js";
import {
  DisabledVoiceCallMediaIssuer,
  LiveKitVoiceCallMediaIssuer,
  createVoiceCallMediaIssuerFromEnv
} from "./voice-call-media.js";
import type { VoiceCallRecord } from "./voice-call-store.js";

const now = new Date("2026-09-21T12:00:00.000Z");
const actor: AuthenticatedActor = {
  authMode: "oidc",
  displayName: "Jiřina Volková",
  subjectId: "user-1",
  username: "jirina"
};

function call(callId: string): VoiceCallRecord {
  return {
    callId,
    createdAt: now.toISOString(),
    expiresAt: "2026-09-21T12:10:00.000Z",
    initiatorSubjectId: "user-1",
    kind: "direct",
    participantSubjectIds: ["user-2"],
    phase: "connected",
    revision: 3,
    roomId: "!room:example.test",
    title: "Direct call",
    updatedAt: now.toISOString()
  };
}

describe("LiveKitVoiceCallMediaIssuer", () => {
  it("derives a stable call-specific E2EE key without exposing the deployment secret", async () => {
    const deploymentSecret = "test-deployment-secret-with-at-least-32-characters";
    const issuer = new LiveKitVoiceCallMediaIssuer({
      apiKey: "test-api-key",
      apiSecret: "test-api-secret-with-at-least-32-characters",
      e2eeSecret: deploymentSecret,
      publicUrl: "wss://livekit.example.test",
      tokenTtlSeconds: 120
    });

    const first = await issuer.issue(call("call-a"), actor, now);
    const repeated = await issuer.issue(call("call-a"), actor, now);
    const anotherCall = await issuer.issue(call("call-b"), actor, now);

    expect(first.e2eeKey).toBe(repeated.e2eeKey);
    expect(first.e2eeKey).not.toBe(anotherCall.e2eeKey);
    expect(first.e2eeKey.length).toBeGreaterThanOrEqual(32);
    expect(first.e2eeKey).not.toContain(deploymentSecret);
    const payload = JSON.parse(Buffer.from(first.token.split(".")[1]!, "base64url").toString("utf8")) as { exp: number; iat?: number };
    expect(first.expiresAt).toBe(new Date(payload.exp * 1000).toISOString());
    expect(first.serverUrl).toBe("wss://livekit.example.test");
  });

  it("uses the emitted JWT expiry even when the caller's request clock is two hours stale", async () => {
    const issuer = new LiveKitVoiceCallMediaIssuer({ apiKey: "synthetic-key", apiSecret: "synthetic-api-secret-at-least-32-characters",
      e2eeSecret: "synthetic-e2ee-secret-at-least-32-characters", publicUrl: "wss://synthetic-livekit.example.test", tokenTtlSeconds: 120 });
    const actualBefore = Date.now(), staleRequest = new Date(actualBefore - 7_200_000);
    const media = await issuer.issue(call("synthetic-stale-clock"), actor, staleRequest);
    const payload = JSON.parse(Buffer.from(media.token.split(".")[1]!, "base64url").toString("utf8")) as { exp: number };
    expect(media.expiresAt).toBe(new Date(payload.exp * 1000).toISOString());
    expect(Date.parse(media.expiresAt)).toBeGreaterThanOrEqual(actualBefore + 119_000);
    expect(Date.parse(media.expiresAt)).toBeLessThanOrEqual(Date.now() + 120_000);
  });

  it("requires an independent E2EE secret whenever voice media is configured", () => {
    expect(() =>
      createVoiceCallMediaIssuerFromEnv({
        COP_LIVEKIT_API_KEY: "key",
        COP_LIVEKIT_API_SECRET: "secret",
        COP_LIVEKIT_PUBLIC_URL: "wss://livekit.example.test",
        COP_VOICE_CALLS_ENABLED: "true"
      })
    ).toThrow(/COP_VOICE_CALL_E2EE_SECRET/u);

    expect(createVoiceCallMediaIssuerFromEnv({})).toBeInstanceOf(DisabledVoiceCallMediaIssuer);
  });
});
