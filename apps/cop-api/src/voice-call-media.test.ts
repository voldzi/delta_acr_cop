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
    expect(first.expiresAt).toBe("2026-09-21T12:02:00.000Z");
    expect(first.serverUrl).toBe("wss://livekit.example.test");
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
