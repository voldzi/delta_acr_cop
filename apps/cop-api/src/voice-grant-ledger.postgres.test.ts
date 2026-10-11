import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresMobilityStore } from "./mobility-store.js";
import { VoiceGrantLedger } from "./voice-grant-ledger.js";
import { PostgresVoiceGatewayOwner } from "./voice-admission-main.js";
import { createVoiceCallStoreFromEnv, PostgresVoiceCallStore } from "./voice-call-store.js";
import { createVoiceCallAdmission } from "./voice-call-admission.js";

const connectionString = process.env.COP_VOICE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_voice_test") throw new Error("Requires isolated loopback cop_voice_test database.");
}
const issuer = "https://voice.synthetic.test/realms/cop", clientId = "jizda-mobile";
const secret = "synthetic-livekit-voice-grant-test-secret-32-characters";
const actor = (subjectId: string) => ({ authMode: "oidc" as const, issuer, authorizedParty: clientId,
  subjectId, username: "Synthetic", displayName: "Synthetic" });
const ledger = (store: PostgresMobilityStore) => new VoiceGrantLedger({ store, issuer, clientId, identitySecret: secret });

describe.skipIf(!connectionString)("isolated real PostgreSQL scoped voice", () => {
  it("bounds actual API call-state lookup and compensation SQL when an isolated table lock stalls them", async () => {
    const admin = new Pool({ connectionString, max: 1 }), schema = "cop_voice_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scopedURL = new URL(connectionString!); scopedURL.searchParams.set("options", `-c search_path=${schema}`);
    const calls = createVoiceCallStoreFromEnv({ COP_VOICE_CALL_STORE: "postgres", COP_DATABASE_URL: scopedURL.href });
    const blocker = await admin.connect();
    try {
      await calls.init();
      const now = new Date(), owner = "synthetic-call-owner";
      const call = await calls.create({ now: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        initiatorSubjectId: owner, participantSubjectIds: ["synthetic-call-peer"], kind: "direct",
        roomId: "!synthetic:example.test", title: "Synthetic" });
      // Retain one session for the transaction; Pool.query would return its
      // idle transaction to the pool and could release this lock via idle eviction.
      await blocker.query("BEGIN"); await blocker.query(`LOCK TABLE ${schema}.cop_voice_calls IN ACCESS EXCLUSIVE MODE`);
      await expect(createVoiceCallAdmission(calls)({ callId: call.callId, room: "cop-call-" + call.callId }, now))
        .rejects.toMatchObject({ status: 503, code: "VOICE_CALL_STATE_UNAVAILABLE" });
      await expect(calls.transition(call.callId, { action: "media_failed", actorSubjectId: owner, now: now.toISOString() })).rejects.toThrow();
      await blocker.query("ROLLBACK");
      expect(await calls.get(call.callId)).toMatchObject({ phase: "ringing" });
    } finally {
      await blocker.query("ROLLBACK"); blocker.release(); await calls.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    }
  }, 20_000);

  it("reads canonical call end across two durable pools and denies reconnect without a local cache", async () => {
    const admin = new Pool({ connectionString, max: 1 }), schema = "cop_voice_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA ${schema}`);
    const config = { connectionString, max: 3, query_timeout: 5000, options: `-c search_path=${schema}` };
    const apiCalls = new PostgresVoiceCallStore(config), gatewayCalls = new PostgresVoiceCallStore(config);
    try {
      await apiCalls.init(); await gatewayCalls.init();
      const now = new Date(), owner = "synthetic-call-owner";
      const call = await apiCalls.create({ now: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        initiatorSubjectId: owner, participantSubjectIds: ["synthetic-call-peer"], kind: "direct",
        roomId: "!synthetic:example.test", title: "Synthetic" });
      const assert = createVoiceCallAdmission(gatewayCalls), target = { callId: call.callId, room: "cop-call-" + call.callId };
      await expect(assert(target, now)).resolves.toBeUndefined();
      await apiCalls.transition(call.callId, { action: "cancel", actorSubjectId: owner, now: now.toISOString() });
      expect(await gatewayCalls.get(call.callId)).toMatchObject({ phase: "cancelled" });
      await expect(assert(target, now)).rejects.toMatchObject({ status: 403, code: "VOICE_CALL_ADMISSION_DENIED" });
    } finally {
      await apiCalls.close(); await gatewayCalls.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    }
  });

  it("serializes issuance/revocation across processes and preserves exact installation fences after restart", async () => {
    const admin = new Pool({ connectionString, max: 1 }), schema = "cop_voice_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA ${schema}`);
    const config = { connectionString, max: 3, options: `-c search_path=${schema}` };
    const first = new PostgresMobilityStore(config), second = new PostgresMobilityStore(config), restarted = new PostgresMobilityStore(config);
    try {
      await first.init(); await second.init();
      const a = actor("synthetic-account-a"), b = actor("synthetic-account-b"), install = randomUUID(), otherInstall = randomUUID();
      const one = ledger(first), two = ledger(second), now = new Date();
      await one.attestInstallation(a, install, now); await two.attestInstallation(a, otherInstall, now);
      await two.attestInstallation(b, install, now);
      const callId = randomUUID(), room = "cop-call-" + callId, op = randomUUID();
      const outcomes = await Promise.allSettled([one.issueGrant(a, install, callId, room, now), two.revokeInstallation(a, install, op, now)]);
      expect(outcomes[1]).toMatchObject({ status: "fulfilled" });
      if (outcomes[0]!.status === "fulfilled") await expect(two.assertAdmission(outcomes[0]!.value.identity, room, now)).rejects.toMatchObject({ status: 403 });
      else expect(outcomes[0]!.reason).toMatchObject({ status: 403 });
      await expect(one.issueGrant(a, install, callId, room, now)).rejects.toMatchObject({ status: 403 });
      const sameUserOtherInstall = await one.issueGrant(a, otherInstall, callId, room, now);
      const otherUserSameUuid = await two.issueGrant(b, install, callId, room, now);
      expect(sameUserOtherInstall.identity).not.toBe(otherUserSameUuid.identity);
      const recovered = ledger(restarted); await recovered.init();
      await expect(recovered.assertInstallation(a, install, now)).rejects.toMatchObject({ status: 403 });
      await recovered.assertAdmission(otherUserSameUuid.identity, room, now);
      await recovered.assertAdmission(sameUserOtherInstall.identity, room, now);
      const rows = await first.transact([], tx => tx.scan("voice-grant-ledger:v1:"));
      for (const raw of [a.subjectId, b.subjectId, install, otherInstall, secret]) expect(JSON.stringify(rows)).not.toContain(raw);
    } finally {
      await first.close(); await second.close(); await restarted.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    }
  });

  it("permits one primary-PG owner and treats owner loss as terminal before a new owner can claim", async () => {
    const label = "cop-voice-owner-test-" + randomUUID(), admin = new Pool({ connectionString, max: 1 });
    let lost = false, notified!: () => void;
    const notification = new Promise<void>(resolve => { notified = resolve; });
    const one = new PostgresVoiceGatewayOwner(new Pool({ connectionString, max: 1, application_name: label }), () => { lost = true; notified(); });
    const two = new PostgresVoiceGatewayOwner(new Pool({ connectionString, max: 1, application_name: label + "-second" }), () => undefined);
    const replacement = new PostgresVoiceGatewayOwner(new Pool({ connectionString, max: 1, application_name: label + "-replacement" }), () => undefined);
    try {
      await one.claim(); await one.assertOwned(); await expect(two.claim()).rejects.toThrow("lease unavailable");
      const terminated = await admin.query<{ terminated: boolean }>("SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE datname='cop_voice_test' AND application_name=$1", [label]);
      expect(terminated.rows).toEqual([{ terminated: true }]);
      await Promise.race([notification, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Owner loss notification missing")), 2000); timer.unref(); })]);
      expect(lost).toBe(true); await expect(one.assertOwned()).rejects.toThrow("lease unavailable");
      await expect(one.claim()).rejects.toThrow("lease unavailable");
      await replacement.claim(); await replacement.assertOwned();
    } finally { await one.close(); await two.close(); await replacement.close(); await admin.end(); }
  });
});
