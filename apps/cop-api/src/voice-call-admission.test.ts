import { describe, expect, it, vi } from "vitest";
import { createVoiceCallAdmission } from "./voice-call-admission.js";
import { InMemoryVoiceCallStore, type VoiceCallPhase, type VoiceCallRecord } from "./voice-call-store.js";
import { startVoiceAdmissionGateway } from "./voice-admission-main.js";

const callId = "8125d40f-398b-4ce5-98ea-e34b3cc64d36", target = { callId, room: "cop-call-" + callId };
const deadline = new Date("2026-10-11T12:00:00.000Z");
function record(phase: VoiceCallPhase = "connected"): VoiceCallRecord {
  return { callId, roomId: "!matrix-room:synthetic.test", phase, expiresAt: deadline.toISOString(),
    revision: 1, createdAt: deadline.toISOString(), updatedAt: deadline.toISOString(),
    initiatorSubjectId: "synthetic-A", participantSubjectIds: ["synthetic-A", "synthetic-B"], kind: "direct", title: "Synthetic" };
}
describe("persistent canonical call admission", () => {
  it.each(["ringing", "accepted", "connecting_media"] as const)("respects %s invitation/media timeout before, at and after its existing deadline", async phase => {
    const get = vi.fn(async () => record(phase)), assert = createVoiceCallAdmission({ get });
    await expect(assert(target, new Date(deadline.getTime() - 1))).resolves.toBeUndefined();
    for (const now of [deadline, new Date(deadline.getTime() + 1)]) await expect(assert(target, now)).rejects.toMatchObject({ status: 403, code: "VOICE_CALL_ADMISSION_DENIED" });
    expect(get).toHaveBeenCalledWith(callId);
  });
  it("allows established connected calls after invite/media deadline without confusing the Matrix room with LiveKit room", async () => {
    await expect(createVoiceCallAdmission({ get: async () => record() })(target, new Date(deadline.getTime() + 86400_000))).resolves.toBeUndefined();
  });
  it.each(["created", "declined", "missed", "cancelled", "failed", "ended"] as const)("denies canonical %s state", async phase => {
    await expect(createVoiceCallAdmission({ get: async () => record(phase) })(target, deadline)).rejects.toMatchObject({ status: 403 });
  });
  it("denies missing calls, mismatched canonical ID and route room before querying a different call", async () => {
    await expect(createVoiceCallAdmission({ get: async () => null })(target, deadline)).rejects.toMatchObject({ status: 403 });
    const get = vi.fn(async () => ({ ...record(), callId: "another-call" }));
    await expect(createVoiceCallAdmission({ get })(target, deadline)).rejects.toMatchObject({ status: 403 });
    get.mockClear();
    for (const room of ["!matrix-room:synthetic.test", "cop-call-other", "cop-call-" + callId.toUpperCase()]) await expect(createVoiceCallAdmission({ get })({ callId, room }, deadline)).rejects.toMatchObject({ status: 403 });
    expect(get).not.toHaveBeenCalled();
  });
  it("sanitizes provider errors and corrupt phases/deadlines as service unavailability", async () => {
    await expect(createVoiceCallAdmission({ get: async () => { throw new Error("secret-dsn-and-raw-subject"); } })(target, deadline)).rejects.toMatchObject({ status: 503, message: "VOICE_CALL_STATE_UNAVAILABLE" });
    for (const value of [{ ...record(), phase: "unknown" as VoiceCallPhase }, { ...record("ringing"), expiresAt: "bad" },
      { ...record("accepted"), expiresAt: "bad" }, { ...record("connecting_media"), expiresAt: "bad" }]) {
      await expect(createVoiceCallAdmission({ get: async () => value })(target, deadline)).rejects.toMatchObject({ status: 503 });
    }
    await expect(createVoiceCallAdmission({ get: async () => record() })(target, new Date("bad"))).rejects.toMatchObject({ status: 503 });
  });
  it("bounds an unresponsive authoritative read rather than waiting indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const result = expect(createVoiceCallAdmission({ get: () => new Promise(() => undefined) })(target, deadline))
        .rejects.toMatchObject({ status: 503, code: "VOICE_CALL_STATE_UNAVAILABLE" });
      await vi.advanceTimersByTimeAsync(5000); await result;
    } finally { vi.useRealTimers(); }
  });
  it.each(["memory", "disabled", "auto", ""])("rejects %s gateway runtime instead of silently accepting implicit call state", async mode => {
    await expect(startVoiceAdmissionGateway({ COP_VOICE_SIGNAL_GATEWAY_ENABLED: "true", COP_VOICE_CALL_STORE: mode,
      COP_DATABASE_URL: "postgresql://synthetic.invalid/cop", COP_LIVEKIT_API_KEY: "synthetic-key", COP_LIVEKIT_API_SECRET: "synthetic-secret-over-32-characters" })).rejects.toThrow("Explicit persistent voice call store required");
  });
  it("observes a real canonical store transition without relying on expiry sweep traffic", async () => {
    const store = new InMemoryVoiceCallStore();
    const call = await store.create({ now: deadline.toISOString(), expiresAt: new Date(deadline.getTime() + 60_000).toISOString(),
      initiatorSubjectId: "synthetic-A", participantSubjectIds: ["synthetic-B"], kind: "direct", roomId: "!matrix:synthetic.test", title: "Synthetic" });
    const assert = createVoiceCallAdmission(store), callTarget = { callId: call.callId, room: "cop-call-" + call.callId };
    await assert(callTarget, deadline);
    await store.transition(call.callId, { action: "cancel", actorSubjectId: "synthetic-A", now: deadline.toISOString() });
    await expect(assert(callTarget, deadline)).rejects.toMatchObject({ status: 403 });
  });
});
