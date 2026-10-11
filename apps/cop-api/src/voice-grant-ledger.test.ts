import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryMobilityStore, type MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import { VOICE_GRANT_CONFIG_KEY, VOICE_GRANT_GATEWAY_CONFIG_KEY, VOICE_GRANT_IDENTITY_PREFIX, VoiceGrantLedger, type VoiceGrantLedgerOptions } from "./voice-grant-ledger.js";

const issuer = "https://identity.synthetic.test/realms/cop", clientId = "jizda-mobile";
const secret = "synthetic-livekit-server-secret-at-least-32-characters";
const installationA = "e573c0a9-b181-4ff9-a2b8-1d0ed5de05ad", installationB = "8bd3e01b-fc04-4687-87cc-3cf130f7a158";
const callId = "34d7c97d-97f5-41a2-933c-e020972a194f", room = "cop-call-" + callId;
const operationA = "4855f9b8-e336-46ae-b1f7-171a45341be5", operationB = "bc7a984c-d658-44e9-9b16-71adcf69b3b6";
const now = new Date("2026-10-11T12:00:00Z");
const actor = (subjectId = "SYNTHETIC_RAW_SUBJECT_A@example.test", authorizedParty = clientId): AuthenticatedActor => ({ authMode: "oidc",
  issuer, subjectId, authorizedParty, username: "SYNTHETIC_RAW_USERNAME", displayName: "SYNTHETIC_RAW_DISPLAY_NAME" });
function fixture(options: Partial<VoiceGrantLedgerOptions> = {}) {
  const store = options.store ?? new MemoryMobilityStore(), settings = { store, issuer, clientId, identitySecret: secret, ...options };
  return { store, settings, ledger: new VoiceGrantLedger(settings), restart(extra: Partial<VoiceGrantLedgerOptions> = {}) { return new VoiceGrantLedger({ ...settings, ...extra }); } };
}
const later = (ms: number) => new Date(now.getTime() + ms);

describe("durable scoped voice grant ledger", () => {
  it("requires prior attestation and isolates two actors and two installations, even with the same client UUID", async () => {
    const f = fixture(), owner = actor(), other = actor("SYNTHETIC_RAW_SUBJECT_B@example.test");
    await expect(f.ledger.assertInstallation(owner, installationA, now)).rejects.toMatchObject({ status: 403, code: "VOICE_INSTALLATION_NOT_ATTESTED" });
    await expect(f.ledger.issueGrant(owner, installationA, callId, room, now)).rejects.toMatchObject({ status: 403, code: "VOICE_INSTALLATION_NOT_ATTESTED" });
    await f.ledger.attestInstallation(owner, installationA, now); await f.ledger.attestInstallation(owner, installationB, now);
    await expect(f.ledger.issueGrant(other, installationA, callId, room, now)).rejects.toMatchObject({ status: 403, code: "VOICE_INSTALLATION_NOT_ATTESTED" });
    await f.ledger.attestInstallation(other, installationA, now);
    const a = await f.ledger.issueGrant(owner, installationA, callId, room, now),
      a2 = await f.ledger.issueGrant(owner, installationB, callId, room, now), b = await f.ledger.issueGrant(other, installationA, callId, room, now);
    expect(new Set([a.identity, a2.identity, b.identity]).size).toBe(3);
    expect(a.appKey).toBe(a2.appKey); expect(a.installationKey).not.toBe(a2.installationKey); expect(b.appKey).not.toBe(a.appKey);
    const revoked = await f.ledger.revokeInstallation(owner, installationA, operationA, later(1000));
    expect(revoked.scope).toBe("installation"); expect(revoked.grants.map(grant => grant.identity)).toEqual([a.identity]);
    await expect(f.ledger.assertAdmission(a.identity, room, later(2000))).rejects.toMatchObject({ status: 403 });
    expect((await f.ledger.assertAdmission(a2.identity, room, later(2000))).identity).toBe(a2.identity);
    expect((await f.ledger.assertAdmission(b.identity, room, later(2000))).identity).toBe(b.identity);
  });

  it("does not accept legacy clients, issuer/client forgeries or raw UUID as app ownership", async () => {
    const f = fixture(), owner = actor(); await f.ledger.attestInstallation(owner, installationA, now);
    const grant = await f.ledger.issueGrant(owner, installationA, callId, room, now);
    for (const forged of [actor(owner.subjectId, "csm-mobile"), actor(owner.subjectId, "cop-web"), actor(owner.subjectId, "other-app"),
      { ...owner, issuer: "https://another.identity.test/cop" }, { ...owner, authMode: "lab" as const }]) {
      expect(f.ledger.owns(forged)).toBe(false);
      await expect(f.ledger.attestInstallation(forged, installationA, now)).rejects.toMatchObject({ status: 403, code: "VOICE_SCOPE_NOT_PROVEN" });
      await expect(f.ledger.revokeApp(forged, operationA, now)).rejects.toMatchObject({ status: 403 });
    }
    expect((await f.ledger.assertAdmission(grant.identity, room, now)).identity).toBe(grant.identity);
    expect(await f.ledger.confirmsRevoked(owner.subjectId)).toBe(false); // Legacy LiveKit identity is untouched.
    expect(() => fixture({ clientId: "csm-mobile" })).toThrow(); expect(() => fixture({ clientId: "cop-web" })).toThrow();
    expect(() => fixture({ clientId: undefined as unknown as string })).toThrow();
  });

  it("reuses one persisted identity for refreshed JWTs without extending validity, and refuses another room", async () => {
    const f = fixture(); await f.ledger.attestInstallation(actor(), installationA, now);
    const first = await f.ledger.issueGrant(actor(), installationA.toUpperCase(), callId, room, now);
    const refreshed = await f.restart().issueGrant(actor(), installationA, callId.toUpperCase(), room, later(60_000));
    expect(refreshed).toEqual(first); expect(first.identity).toMatch(new RegExp("^" + VOICE_GRANT_IDENTITY_PREFIX + "[0-9a-f-]{36}$", "u"));
    expect((await f.restart().assertAdmission(first.identity, room, later(120_000))).grantId).toBe(first.grantId);
    await expect(f.ledger.assertAdmission(first.identity, "other-room", now)).rejects.toMatchObject({ status: 403 });
    await expect(f.ledger.issueGrant(actor(), installationA, callId, "other-room", now)).rejects.toMatchObject({ status: 409, code: "VOICE_GRANT_ROOM_CHANGED" });
    for (const unknown of [VOICE_GRANT_IDENTITY_PREFIX + randomUUID(), VOICE_GRANT_IDENTITY_PREFIX + "bad-uuid", actor().subjectId]) {
      await expect(f.ledger.assertAdmission(unknown, room, now)).rejects.toMatchObject({ status: 403 });
    }
    await expect(f.ledger.assertAdmission(first.identity, room, later(24 * 60 * 60 * 1000))).rejects.toMatchObject({ status: 403 });
    await expect(f.ledger.issueGrant(actor(), installationA, callId, room, later(24 * 60 * 60 * 1000))).rejects.toMatchObject({ status: 403 });
    expect(await f.ledger.confirmsRevoked(first.identity)).toBe(false); // Expiry is not a provider revocation proof.
    await f.ledger.revokeInstallation(actor(), installationA, operationA, later(24 * 60 * 60 * 1000));
    expect(await f.ledger.confirmsRevoked(first.identity, room)).toBe(true);
    expect(await f.ledger.confirmsRevoked(first.identity, "other-room")).toBe(false);
  });

  it("honors the established Jizda app fence, including old records after a restart", async () => {
    const f = fixture(), owner = actor(); await f.ledger.attestInstallation(owner, installationA, now);
    const grant = await f.ledger.issueGrant(owner, installationA, callId, room, now);
    const fenceKey = "jizda-app-link:" + createHash("sha256").update(JSON.stringify([issuer, owner.subjectId, clientId])).digest("hex");
    await f.store.transact([], tx => tx.set(fenceKey, null)); // Even a malformed marker must never grant access.
    const restarted = f.restart();
    await expect(restarted.assertInstallation(owner, installationA, now)).rejects.toMatchObject({ status: 403 });
    await expect(restarted.assertAdmission(grant.identity, room, now)).rejects.toMatchObject({ status: 403 });
    await expect(restarted.issueGrant(owner, installationA, randomUUID(), room, now)).rejects.toMatchObject({ status: 403 });
    await expect(restarted.attestInstallation(owner, installationB, now)).rejects.toMatchObject({ status: 403 });
    expect(await restarted.confirmsRevoked(grant.identity)).toBe(true); // Only the local durable denial is confirmed.
  });

  it("persists app/installation revocations before caller handoff, with empty scopes and exact idempotency", async () => {
    const f = fixture(), owner = actor();
    const empty = await f.ledger.revokeInstallation(owner, installationA, operationA, now);
    expect(empty).toEqual({ operationId: operationA, scope: "installation", grants: [] });
    expect(await f.restart().revokeInstallation(owner, installationA, operationA.toUpperCase(), later(2000))).toEqual(empty);
    await expect(f.ledger.revokeInstallation(owner, installationA, operationB, now)).rejects.toMatchObject({ status: 409 });
    await expect(f.ledger.attestInstallation(owner, installationA, now)).rejects.toMatchObject({ status: 403 });
    await f.ledger.attestInstallation(owner, installationB, now);
    const grant = await f.ledger.issueGrant(owner, installationB, callId, room, now);
    const revoked = await f.ledger.revokeApp(owner, operationB, later(1000));
    expect(revoked.grants).toEqual([{ ...grant, revokedAt: later(1000).toISOString(), revocationOperationId: operationB }]);
    expect(await f.restart().revokeApp(owner, operationB, later(5000))).toEqual(revoked);
    await expect(f.ledger.revokeApp(owner, operationA, now)).rejects.toMatchObject({ status: 409 });
    await expect(f.restart().assertAdmission(grant.identity, room, later(2000))).rejects.toMatchObject({ status: 403 });
    expect(await f.ledger.confirmsRevoked(grant.identity)).toBe(true);
    expect(await f.ledger.confirmsRevoked(VOICE_GRANT_IDENTITY_PREFIX + randomUUID())).toBe(false);
  });

  it("serializes issue versus revoke across two instances and never admits a grant after the fence", async () => {
    for (const revokeFirst of [false, true]) {
      const f = fixture(), owner = actor(); await f.ledger.attestInstallation(owner, installationA, now);
      const second = f.restart(); await second.init();
      const tasks = revokeFirst ? [second.revokeApp(owner, operationA, now), f.ledger.issueGrant(owner, installationA, callId, room, now)]
        : [f.ledger.issueGrant(owner, installationA, callId, room, now), second.revokeApp(owner, operationA, now)];
      const results = await Promise.allSettled(tasks);
      const revocation = results[revokeFirst ? 0 : 1]!; expect(revocation.status).toBe("fulfilled");
      const issued = results[revokeFirst ? 1 : 0]!;
      if (issued.status === "fulfilled" && "identity" in issued.value) {
        await expect(f.restart().assertAdmission(issued.value.identity, room, now)).rejects.toMatchObject({ status: 403 });
        expect(await f.restart().confirmsRevoked(issued.value.identity)).toBe(true);
      } else if (issued.status === "rejected") expect(issued.reason).toMatchObject({ status: 403 });
      await expect(f.restart().issueGrant(owner, installationA, callId, room, now)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("keeps admission and revocation enforcement with intake disabled, but refuses new attestations and issuance", async () => {
    const f = fixture(); await f.ledger.attestInstallation(actor(), installationA, now);
    const grant = await f.ledger.issueGrant(actor(), installationA, callId, room, now), paused = f.restart({ intakeEnabled: false });
    await paused.assertInstallation(actor(), installationA, now);
    expect((await paused.assertAdmission(grant.identity, room, now)).identity).toBe(grant.identity);
    await expect(paused.attestInstallation(actor(), installationB, now)).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_INTAKE_DISABLED" });
    await expect(paused.issueGrant(actor(), installationA, callId, room, now)).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_INTAKE_DISABLED" });
    await paused.revokeApp(actor(), operationA, now);
    await expect(paused.assertAdmission(grant.identity, room, now)).rejects.toMatchObject({ status: 403 });
    expect(await paused.confirmsRevoked(grant.identity)).toBe(true);
  });

  it("rejects secret/issuer/client changes and missing permanent configuration even in an already initialized instance", async () => {
    const f = fixture(); await f.ledger.attestInstallation(actor(), installationA, now);
    const grant = await f.ledger.issueGrant(actor(), installationA, callId, room, now);
    for (const change of [{ identitySecret: "synthetic-rotated-server-secret-32-characters" }, { issuer: issuer + "/changed" }, { clientId: "other-dedicated-client" }]) {
      await expect(f.restart(change).init()).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_CONFIGURATION_CHANGED" });
    }
    const saved = await f.store.transact([], tx => tx.get(VOICE_GRANT_CONFIG_KEY));
    await f.store.transact([], tx => tx.remove(VOICE_GRANT_CONFIG_KEY));
    await expect(f.ledger.assertAdmission(grant.identity, room, now)).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_CONFIGURATION_MISSING" });
    await expect(f.restart().init()).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_CONFIGURATION_MISSING" });
    expect(await f.store.transact([], tx => tx.get(VOICE_GRANT_CONFIG_KEY))).toBeUndefined();
    await f.store.transact([], tx => tx.set(VOICE_GRANT_CONFIG_KEY, saved));
    expect((await f.restart().assertAdmission(grant.identity, room, now)).identity).toBe(grant.identity);
  });

  it("sanitizes storage outages to503 and never stores raw account, installation, credential or token data", async () => {
    class FaultStore extends MemoryMobilityStore {
      unavailable = false;
      override async transact<T>(keys: string[], work: (tx: MobilityTransaction) => Promise<T>) {
        if (this.unavailable) throw new Error("private-token-SYNTHETIC_RAW_SUBJECT_A@example.test");
        return super.transact(keys, work);
      }
    }
    const store = new FaultStore(), f = fixture({ store }); await f.ledger.attestInstallation(actor(), installationA, now);
    const grant = await f.ledger.issueGrant(actor(), installationA, callId, room, now);
    const rows = JSON.stringify(await store.transact([], tx => tx.scan("voice-grant-ledger:v1:")));
    for (const raw of [actor().subjectId, actor().username, actor().displayName, installationA, secret, issuer, clientId, "private-token"]) expect(rows).not.toContain(raw);
    expect(grant).not.toHaveProperty("jizdaFenceKey"); expect(grant).not.toHaveProperty("token");
    store.unavailable = true;
    await expect(f.ledger.assertAdmission(grant.identity, room, now)).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_STORE_UNAVAILABLE", message: "VOICE_GRANT_STORE_UNAVAILABLE" });
    await expect(f.ledger.revokeApp(actor(), operationA, now)).rejects.toMatchObject({ status: 503 });
    store.unavailable = false; await f.ledger.revokeApp(actor(), operationA, now);
    expect(await f.restart().confirmsRevoked(grant.identity)).toBe(true);
  });

  it("bounds retained issue capacity without deleting old grants or claiming retention/provider cleanup", async () => {
    const f = fixture(); await f.ledger.attestInstallation(actor(), installationA, now);
    for (let index = 0; index < 128; index++) await f.ledger.issueGrant(actor(), installationA, randomUUID(), room, now);
    await expect(f.ledger.issueGrant(actor(), installationA, randomUUID(), room, now)).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_CAPACITY_UNAVAILABLE" });
    expect((await f.store.transact([], tx => tx.scan("voice-grant-ledger:v1:identity:"))).length).toBe(128);
    expect(() => fixture({ maxGrantAgeMs: 24 * 60 * 60 * 1000 + 1 })).toThrow();
    expect(() => fixture({ maxGrantAgeMs: 0 })).toThrow();
    await expect(f.ledger.assertInstallation(actor(), installationA, new Date("bad-date"))).rejects.toMatchObject({ status: 400 });
  });

  it("preserves first-issuance accepted gateway provenance without backfilling old grants or trusting control-body scope", async () => {
    const f = fixture(); await f.ledger.attestInstallation(actor(), installationA, now);
    const beforeAcceptance = await f.ledger.issueGrant(actor(), installationA, callId, room, now);
    expect(beforeAcceptance).not.toHaveProperty("admissionEpoch");
    const firstEpoch = randomUUID(), laterEpoch = randomUUID(), newerCall = randomUUID();
    await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, { fingerprint: "synthetic-gateway-fingerprint", acceptedEpoch: firstEpoch.toUpperCase(), active: false }));
    const issuedWhileInactive = await f.ledger.issueGrant(actor(), installationA, randomUUID(), room, now);
    expect(issuedWhileInactive).not.toHaveProperty("admissionEpoch");
    await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, { fingerprint: "synthetic-gateway-fingerprint", acceptedEpoch: firstEpoch.toUpperCase(), active: true }));
    const accepted = await f.ledger.issueGrant(actor(), installationA, newerCall, room, later(1000));
    expect(accepted.admissionEpoch).toBe(firstEpoch);
    expect(await f.restart().issueGrant(actor(), installationA, callId, room, later(1000))).toEqual(beforeAcceptance);
    await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, { fingerprint: "synthetic-gateway-fingerprint", acceptedEpoch: laterEpoch, active: true }));
    expect(await f.restart().issueGrant(actor(), installationA, newerCall, room, later(2000))).toEqual(accepted);
    expect(await f.ledger.readRevokedGrant(accepted.identity, room)).toBeUndefined();
    await f.ledger.revokeInstallation(actor(), installationA, operationA, later(3000));
    expect(await f.restart().readRevokedGrant(accepted.identity, room)).toEqual({ ...accepted, revokedAt: later(3000).toISOString(), revocationOperationId: operationA });
    expect(await f.restart().readRevokedGrant(beforeAcceptance.identity, room)).not.toHaveProperty("admissionEpoch");
    expect(await f.ledger.readRevokedGrant(accepted.identity, "forged-room")).toBeUndefined();
    expect(await f.ledger.readRevokedGrant(VOICE_GRANT_IDENTITY_PREFIX + randomUUID(), room)).toBeUndefined();
    const other = actor("SYNTHETIC_OTHER"); await f.ledger.attestInstallation(other, installationA, now);
    await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, { fingerprint: "synthetic-gateway-fingerprint", acceptedEpoch: "not-an-epoch", active: true }));
    await expect(f.ledger.issueGrant(other, installationA, randomUUID(), room, now)).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_STATE_UNAVAILABLE" });
  });

  it("counts preemptively fenced installation scopes toward capacity without denying accepted revocation retries", async () => {
    const f = fixture(), owner = actor(); await f.ledger.attestInstallation(owner, installationA, now);
    const firstUnknown = randomUUID(), accepted = await f.ledger.revokeInstallation(owner, firstUnknown, operationA, now);
    for (let index = 0; index < 126; index++) await f.ledger.revokeInstallation(owner, randomUUID(), randomUUID(), now);
    await expect(f.restart().revokeInstallation(owner, randomUUID(), randomUUID(), now))
      .rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_CAPACITY_UNAVAILABLE" });
    await expect(f.ledger.attestInstallation(owner, installationB, now)).rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_CAPACITY_UNAVAILABLE" });
    expect(await f.restart().revokeInstallation(owner, firstUnknown, operationA, later(1000))).toEqual(accepted);
    await expect(f.ledger.revokeInstallation(owner, firstUnknown, operationB, now)).rejects.toMatchObject({ status: 409 });
    await expect(f.ledger.attestInstallation(owner, firstUnknown, now)).rejects.toMatchObject({ status: 403 });
    // An attested scope at the same capacity must still be revocable.
    await f.ledger.revokeInstallation(owner, installationA, operationB, now);
    const reservations = await f.store.transact([], tx => tx.scan("voice-grant-ledger:v1:app:"));
    expect(reservations.filter(row => row.key.endsWith(":installation-count")).map(row => row.value)).toEqual([128]);
    expect(reservations.filter(row => row.key.includes(":installation:")).length).toBe(128);
    await f.ledger.attestInstallation(actor("SYNTHETIC_OTHER"), installationB, now);
  });

  it("requires an active current admission epoch for production issuance and refuses historical reused identities", async () => {
    const f = fixture(); await f.ledger.attestInstallation(actor(), installationA, now);
    const older = await f.ledger.issueGrant(actor(), installationA, callId, room, now);
    const enforced = f.restart({ requireAdmissionEpoch: true }), acceptedEpoch = randomUUID(), freshCall = randomUUID();
    await expect(enforced.issueGrant(actor(), installationA, freshCall, room, now))
      .rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_ADMISSION_UNAVAILABLE" });
    await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, { fingerprint: "synthetic", acceptedEpoch, active: false }));
    await expect(enforced.issueGrant(actor(), installationA, freshCall, room, now)).rejects.toMatchObject({ status: 503 });
    await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, { fingerprint: "synthetic", acceptedEpoch, active: true }));
    const fresh = await enforced.issueGrant(actor(), installationA, freshCall, room, now);
    expect(fresh.admissionEpoch).toBe(acceptedEpoch);
    expect(await enforced.issueGrant(actor(), installationA, freshCall, room, later(1000))).toEqual(fresh);
    await expect(enforced.issueGrant(actor(), installationA, older.callId, room, now))
      .rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_ADMISSION_UNAVAILABLE" });
    await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, { fingerprint: "synthetic", acceptedEpoch: randomUUID(), active: true }));
    await expect(enforced.issueGrant(actor(), installationA, freshCall, room, now)).rejects.toMatchObject({ status: 503 });
    expect((await f.store.transact([], tx => tx.scan("voice-grant-ledger:v1:identity:"))).length).toBe(2);
    // Epoch enforcement changes neither owner fingerprint nor existing fences.
    await enforced.revokeInstallation(actor(), installationA, operationA, later(1000));
    expect(await enforced.confirmsRevoked(fresh.identity, room)).toBe(true);
  });

  it("rechecks current accepted epoch at admission after issuance while leaving canonical cleanup available", async () => {
    const f = fixture({ requireAdmissionEpoch: true }), acceptedEpoch = randomUUID();
    await f.ledger.attestInstallation(actor(), installationA, now);
    await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, { fingerprint: "synthetic", acceptedEpoch, active: true }));
    const grant = await f.ledger.issueGrant(actor(), installationA, callId, room, now);
    expect((await f.ledger.assertAdmission(grant.identity, room, now)).identity).toBe(grant.identity);
    for (const changed of [{ fingerprint: "synthetic", acceptedEpoch, active: false },
      { fingerprint: "synthetic", acceptedEpoch: randomUUID(), active: true }]) {
      await f.store.transact([], tx => tx.set(VOICE_GRANT_GATEWAY_CONFIG_KEY, changed));
      await expect(f.restart().assertAdmission(grant.identity, room, later(1000)))
        .rejects.toMatchObject({ status: 503, code: "VOICE_GRANT_ADMISSION_UNAVAILABLE" });
    }
    await f.store.transact([], tx => tx.remove(VOICE_GRANT_GATEWAY_CONFIG_KEY));
    await expect(f.ledger.assertAdmission(grant.identity, room, now)).rejects.toMatchObject({ status: 503 });
    const revoked = await f.ledger.revokeInstallation(actor(), installationA, operationA, later(1000));
    expect(revoked.grants).toHaveLength(1);
    expect(await f.restart().readRevokedGrant(grant.identity, room)).toEqual(revoked.grants[0]);
    expect(await f.ledger.confirmsRevoked(grant.identity, room)).toBe(true);
  });
});
