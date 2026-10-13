import { describe, expect, it } from "vitest";
import { createCOPSessionsProfilesErasureAdapter } from "./cop-sessions-profiles-erasure.js";
import { InMemoryUserProfileStore, userAvatarRevision } from "./user-profile-store.js";
import { InMemoryWebSessionStore, restoreWebSessionTokens, type WebSessionTokens } from "./web-session-store.js";

const issuer = "https://identity.test/realms/cop";
const owner = { issuer, subjectId: "synthetic-owner" };
const secondOwner = { issuer, subjectId: "synthetic-second" };
const actor = { ...owner, authMode: "oidc" as const, username: "Synthetic", displayName: "Synthetic" };
const profile = (principal = owner) => ({ ...principal, username: "Synthetic", displayName: "Synthetic",
  preferences: { theme: "dark" }, alertPreferences: {} });
const tokens = (principal: { issuer?: string; subjectId: string } = owner): WebSessionTokens => ({
  accessToken: "synthetic-server-only-access-token", refreshToken: "synthetic-server-only-refresh-token",
  accessTokenExpiresAt: new Date(Date.now() + 60_000),
  profile: { ...principal, name: "Synthetic", username: "Synthetic" }
});
const expiry = () => new Date(Date.now() + 60_000);
const context = () => ({ operationId: "a85c1e8c-358e-4e39-87a0-e0e9e09d8312",
  requestedAt: new Date().toISOString(), accountKey: "synthetic-opaque-account-key", signal: new AbortController().signal });

describe("actual COP session/profile erasure", () => {
  it("preserves verified issuer through encrypted payload restoration without inventing legacy ownership", () => {
    expect(restoreWebSessionTokens(JSON.parse(JSON.stringify(tokens()))).profile.issuer).toBe(issuer);
    expect(restoreWebSessionTokens(JSON.parse(JSON.stringify(tokens({ subjectId: owner.subjectId })))).profile.issuer).toBeUndefined();
  });

  it("revokes only exact issuer/subject sessions and fences late creation or refresh", async () => {
    const sessions = new InMemoryWebSessionStore();
    const first = await sessions.create(tokens(), expiry());
    const second = await sessions.create(tokens(secondOwner), expiry());
    const anotherIssuer = await sessions.create(tokens({ ...owner, issuer: "https://other.test" }), expiry());
    expect(await sessions.revokeActor(owner)).toEqual({ complete: true });
    expect(await sessions.get(first.sessionId)).toBeNull();
    expect(await sessions.get(second.sessionId)).not.toBeNull();
    expect(await sessions.get(anotherIssuer.sessionId)).not.toBeNull();
    await expect(sessions.create(tokens(), expiry())).rejects.toThrow("WEB_SESSION_ACCOUNT_ERASURE_FENCED");
    await expect(sessions.update(first.sessionId, tokens())).rejects.toThrow("WEB_SESSION_ACCOUNT_ERASURE_FENCED");
    expect(await sessions.revokeActor(owner)).toEqual({ complete: true });
  });

  it("never adopts unattributable legacy sessions and remains pending until expiry", async () => {
    const sessions = new InMemoryWebSessionStore();
    const legacy = await sessions.create(tokens({ subjectId: owner.subjectId }), expiry());
    expect(await sessions.update(legacy.sessionId, tokens())).toBeNull();
    expect(await sessions.revokeActor(owner)).toEqual({ complete: false });
    expect(await sessions.get(legacy.sessionId)).not.toBeNull();
    await sessions.revoke(legacy.sessionId);
    expect(await sessions.revokeActor(owner)).toEqual({ complete: true });
    await expect(sessions.create(tokens({ subjectId: owner.subjectId }), expiry())).rejects.toThrow("WEB_SESSION_ACCOUNT_ERASURE_FENCED");
  });

  it("purges owned profile and acknowledgements while preserving another account", async () => {
    const store = new InMemoryUserProfileStore();
    await store.upsertProfile(profile()); await store.upsertProfile(profile(secondOwner));
    await store.acknowledgeAlert(owner.subjectId, { alertId: "synthetic-alert", acknowledgedAt: new Date().toISOString() });
    expect(await store.purgeActor(owner)).toEqual({ complete: true });
    expect(await store.getProfile(owner.subjectId)).toBeNull();
    expect(await store.getAlertAcknowledgements(owner.subjectId)).toEqual(new Map());
    expect(await store.getProfile(secondOwner.subjectId)).not.toBeNull();
    await expect(store.upsertProfile(profile())).rejects.toThrow("PROFILE_ACCOUNT_ERASURE_FENCED");
    await expect(store.acknowledgeAlert(owner.subjectId, { alertId: "late", acknowledgedAt: new Date().toISOString() })).rejects.toThrow("PROFILE_ACCOUNT_ERASURE_FENCED");
    await expect(store.updateAvatar(profile(), null, userAvatarRevision(owner.subjectId, null))).rejects.toThrow("PROFILE_ACCOUNT_ERASURE_FENCED");
  });

  it("serializes a dispatch lease, cleanup and late profile/ack mutations without resurrection", async () => {
    const store = new InMemoryUserProfileStore(); await store.upsertProfile(profile());
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const dispatch = store.withSafetyNotificationProfile(owner.subjectId, async () => { enter(); await released; });
    await entered;
    const purge = store.purgeActor(owner);
    const lateProfile = store.upsertProfile(profile()).catch(error => error as Error);
    const lateAck = store.acknowledgeAlert(owner.subjectId, { alertId: "late", acknowledgedAt: new Date().toISOString() }).catch(error => error as Error);
    release(); await dispatch;
    expect(await purge).toEqual({ complete: true });
    expect((await lateProfile as Error).message).toBe("PROFILE_ACCOUNT_ERASURE_FENCED");
    expect((await lateAck as Error).message).toBe("PROFILE_ACCOUNT_ERASURE_FENCED");
    expect(await store.getProfile(owner.subjectId)).toBeNull(); expect(await store.getAlertAcknowledgements(owner.subjectId)).toEqual(new Map());
  });

  it("keeps legacy or conflicting profile provenance pending and hides fenced data from search/dispatch", async () => {
    const store = new InMemoryUserProfileStore();
    await store.upsertProfile({ ...profile(), issuer: undefined });
    await store.upsertProfile(profile()); // A later verified actor is not proof of the historical row's issuer.
    expect((await store.getProfile(owner.subjectId))?.issuer).toBeUndefined();
    expect(await store.purgeActor(owner)).toEqual({ complete: false });
    expect(await store.searchProfiles("Synthetic")).toEqual([]);
    await expect(store.withSafetyNotificationProfile(owner.subjectId, async () => true)).rejects.toThrow("PROFILE_ACCOUNT_ERASURE_FENCED");
    expect(await store.purgeActor(owner)).toEqual({ complete: false });
  });

  it("requires supported stores and returns completion only after primary, fallback and sessions are removed", async () => {
    const sessions = new InMemoryWebSessionStore(), primary = new InMemoryUserProfileStore(), fallback = new InMemoryUserProfileStore();
    const supported = createCOPSessionsProfilesErasureAdapter({ issuer, sessions, profiles: [primary, fallback] });
    expect(await createCOPSessionsProfilesErasureAdapter({ issuer, sessions: undefined, profiles: [primary] }).ready()).toBe(false);
    await sessions.create(tokens(), expiry()); await primary.upsertProfile(profile()); await fallback.upsertProfile(profile());
    expect(await supported.ready()).toBe(true);
    const receipt = await supported.erase(actor, context());
    expect(receipt).toMatchObject({ status: "completed" });
    expect(await primary.getProfile(owner.subjectId)).toBeNull(); expect(await fallback.getProfile(owner.subjectId)).toBeNull();
    await expect(supported.erase({ ...actor, issuer: "https://other.test" }, context())).rejects.toThrow();
    const another = createCOPSessionsProfilesErasureAdapter({ issuer, sessions: new InMemoryWebSessionStore(), profiles: [new InMemoryUserProfileStore()] });
    const signal = AbortSignal.abort();
    await expect(another.erase(actor, { ...context(), signal })).rejects.toThrow();
  });
});
