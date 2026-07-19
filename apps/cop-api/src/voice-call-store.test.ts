import { describe, expect, it } from "vitest";
import { InMemoryVoiceCallStore, isTerminalPhase, voiceCallIncludesSubject } from "./voice-call-store.js";

const startedAt = "2026-07-19T10:00:00.000Z";
const expiresAt = "2026-07-19T10:01:30.000Z";

describe("InMemoryVoiceCallStore", () => {
  it("creates one server identity and converges both participants on it", async () => {
    const store = new InMemoryVoiceCallStore();
    const call = await store.create({
      expiresAt,
      initiatorSubjectId: "caller",
      kind: "direct",
      now: startedAt,
      participantSubjectIds: ["recipient", "recipient", "caller"],
      roomId: "!room:example.test",
      title: "Recipient"
    });

    expect(call.callId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(call.participantSubjectIds).toEqual(["recipient"]);
    expect(call.phase).toBe("ringing");
    expect(call.revision).toBe(1);
    expect(voiceCallIncludesSubject(call, "caller")).toBe(true);
    expect(voiceCallIncludesSubject(call, "recipient")).toBe(true);
  });

  it("accepts and connects only through allowed monotonic transitions", async () => {
    const store = new InMemoryVoiceCallStore();
    const call = await store.create({
      expiresAt,
      initiatorSubjectId: "caller",
      kind: "direct",
      now: startedAt,
      participantSubjectIds: ["recipient"],
      roomId: "!room:example.test",
      title: "Recipient"
    });

    const accepted = await store.transition(call.callId, {
      action: "accept",
      actorSubjectId: "recipient",
      expectedRevision: 1,
      now: "2026-07-19T10:00:05.000Z"
    });
    expect(accepted).toMatchObject({
      changed: true,
      record: {
        acceptedBySubjectId: "recipient",
        phase: "accepted",
        revision: 2
      }
    });

    const connected = await store.transition(call.callId, {
      action: "media_connected",
      actorSubjectId: "caller",
      expectedRevision: 2,
      now: "2026-07-19T10:00:07.000Z"
    });
    expect(connected).toMatchObject({
      changed: true,
      record: {
        connectedAt: "2026-07-19T10:00:07.000Z",
        phase: "connected",
        revision: 3
      }
    });
  });

  it("rejects stale revisions and unauthorized transitions", async () => {
    const store = new InMemoryVoiceCallStore();
    const call = await store.create({
      expiresAt,
      initiatorSubjectId: "caller",
      kind: "direct",
      now: startedAt,
      participantSubjectIds: ["recipient"],
      roomId: "!room:example.test",
      title: "Recipient"
    });

    const unauthorized = await store.transition(call.callId, {
      action: "accept",
      actorSubjectId: "stranger",
      now: "2026-07-19T10:00:02.000Z"
    });
    expect(unauthorized).toMatchObject({ changed: false, conflict: "transition" });

    const stale = await store.transition(call.callId, {
      action: "cancel",
      actorSubjectId: "caller",
      expectedRevision: 7,
      now: "2026-07-19T10:00:03.000Z"
    });
    expect(stale).toMatchObject({ changed: false, conflict: "revision" });
  });

  it("makes local hangup idempotent after the first terminal transition", async () => {
    const store = new InMemoryVoiceCallStore();
    const call = await store.create({
      expiresAt,
      initiatorSubjectId: "caller",
      kind: "direct",
      now: startedAt,
      participantSubjectIds: ["recipient"],
      roomId: "!room:example.test",
      title: "Recipient"
    });

    const ended = await store.transition(call.callId, {
      action: "end",
      actorSubjectId: "caller",
      now: "2026-07-19T10:00:10.000Z"
    });
    expect(ended?.record.phase).toBe("ended");
    expect(isTerminalPhase(ended!.record.phase)).toBe(true);

    const duplicate = await store.transition(call.callId, {
      action: "end",
      actorSubjectId: "caller",
      now: "2026-07-19T10:00:11.000Z"
    });
    expect(duplicate).toMatchObject({
      changed: false,
      conflict: "terminal",
      record: { phase: "ended" }
    });
  });

  it("expires an unanswered call as missed", async () => {
    const store = new InMemoryVoiceCallStore();
    const call = await store.create({
      expiresAt,
      initiatorSubjectId: "caller",
      kind: "direct",
      now: startedAt,
      participantSubjectIds: ["recipient"],
      roomId: "!room:example.test",
      title: "Recipient"
    });

    const expired = await store.expireDue("2026-07-19T10:01:31.000Z");
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      callId: call.callId,
      endReason: "ring_timeout",
      phase: "missed",
      revision: 2
    });
  });

  it("lists active calls and durable call history for one participant", async () => {
    const store = new InMemoryVoiceCallStore();
    const first = await store.create({
      expiresAt,
      initiatorSubjectId: "caller",
      kind: "direct",
      now: startedAt,
      participantSubjectIds: ["recipient"],
      roomId: "!first:example.test",
      title: "Recipient"
    });
    const second = await store.create({
      expiresAt,
      initiatorSubjectId: "other",
      kind: "direct",
      now: "2026-07-19T10:00:01.000Z",
      participantSubjectIds: ["recipient"],
      roomId: "!second:example.test",
      title: "Other"
    });
    await store.transition(first.callId, {
      action: "cancel",
      actorSubjectId: "caller",
      now: "2026-07-19T10:00:05.000Z"
    });

    await expect(store.listForSubject("recipient")).resolves.toMatchObject([
      { callId: first.callId, phase: "cancelled" },
      { callId: second.callId, phase: "ringing" }
    ]);
    await expect(store.listForSubject("recipient", { activeOnly: true })).resolves.toMatchObject([
      { callId: second.callId, phase: "ringing" }
    ]);
    await expect(store.listForSubject("recipient", { roomId: "!first:example.test" })).resolves.toMatchObject([
      { callId: first.callId }
    ]);
  });

  it("does not expire a connected call by its original ringing deadline", async () => {
    const store = new InMemoryVoiceCallStore();
    const call = await store.create({
      expiresAt,
      initiatorSubjectId: "caller",
      kind: "direct",
      now: startedAt,
      participantSubjectIds: ["recipient"],
      roomId: "!room:example.test",
      title: "Recipient"
    });
    await store.transition(call.callId, {
      action: "accept",
      actorSubjectId: "recipient",
      now: "2026-07-19T10:00:05.000Z"
    });
    await store.transition(call.callId, {
      action: "media_connected",
      actorSubjectId: "caller",
      now: "2026-07-19T10:00:07.000Z"
    });

    await expect(store.expireDue("2026-07-19T10:10:00.000Z")).resolves.toEqual([]);
    await expect(store.get(call.callId)).resolves.toMatchObject({ phase: "connected" });
  });
});
