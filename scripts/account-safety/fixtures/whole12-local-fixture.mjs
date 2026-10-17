/** Whole12 shared-identity projection; real 404 is the identity removal proof. */
/** COP-owned fixture seed and actual provider readback. No adapter replacements. */
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { Pool } = createRequire("/app/apps/cop-api/package.json")("pg");
const { RoomServiceClient } = createRequire("/app/apps/cop-api/package.json")("livekit-server-sdk");
const api = "file:///dev/shm/cop-whole/apps/cop-api/dist/";
const { PostgresUserProfileStore } = await import(api + "user-profile-store.js");
const { PostgresWebSessionStore } = await import(api + "web-session-store.js");
const { PostgresMobileDeviceStore } = await import(api + "mobile-device-store.js");
const { PostgresVoiceCallStore } = await import(api + "voice-call-store.js");
const { createVoiceCallMediaIssuerFromEnv } = await import(api + "voice-call-media.js");
const { PostgresMobilityStore } = await import(api + "mobility-store.js");
const { PostgresDriverMeasurementConsentStore } = await import(api + "driver-measurement-consent-store.js");
const { MobilityService } = await import(api + "mobility-service.js");
const { mobilityIdentityDigest } = await import(api + "mobility-erasure-guard.js");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function actor(f, name) {
  const original = f.actors[name], claims = JSON.parse(Buffer.from(original.cop.access_token.split(".")[1], "base64url"));
  assert.equal(claims.sub, original.subjectId); assert.equal(claims.iss, f.issuer);
  return { authMode: "oidc", issuer: f.issuer, subjectId: original.subjectId, username: claims.preferred_username,
    displayName: claims.name, email: claims.email, emailVerified: claims.email_verified };
}
function livekit(env) {
  assert(env.COP_LIVEKIT_API_KEY && env.COP_LIVEKIT_API_SECRET, "Actual owned LiveKit fixture required");
  return new RoomServiceClient("http://127.0.0.1:7880", env.COP_LIVEKIT_API_KEY, env.COP_LIVEKIT_API_SECRET, { requestTimeout: 5, failover: false });
}
export async function seedCopLocalOwners({ manifest: f, environment: env }) {
  const config = { connectionString: f.database.businessRuntimeUrl, max: 2 },
    profiles = new PostgresUserProfileStore(config), sessions = new PostgresWebSessionStore({ ...config, encryptionSecret: env.COP_WEB_SESSION_SECRET }),
    devices = new PostgresMobileDeviceStore(config), voice = new PostgresVoiceCallStore(config), store = new PostgresMobilityStore(config, {}, undefined, true);
  const consents = new PostgresDriverMeasurementConsentStore(config);
  const resources = [profiles, sessions, devices, voice, store];
  const result = { sessionIds: {}, deviceIds: {}, mobilityAccountIds: {}, callIds: [], mediaGrants: {}, baselineFence: undefined };
  try {
    for (const value of resources) await value.init();
    await consents.init(env.COP_DRIVER_MEASUREMENTS_HASH_SECRET);
    const mobility = new MobilityService(store), now = new Date().toISOString();
    for (const key of ["a", "b"]) {
      const user = actor(f, key), expiry = new Date(Date.now() + 3 * 3600000);
      await profiles.upsertProfile({ subjectId: user.subjectId, issuer: user.issuer, username: user.username,
        displayName: user.displayName, email: user.email, preferences: {}, alertPreferences: {} });
      result.sessionIds[key] = (await sessions.create({ accessToken: f.actors[key].cop.access_token, accessTokenExpiresAt: expiry,
        profile: { issuer: user.issuer, subjectId: user.subjectId, username: user.username, name: user.displayName, email: user.email } }, expiry)).sessionId;
      const deviceId = randomUUID(); result.deviceIds[key] = deviceId;
      await devices.upsertDevice({ ownerIssuer: user.issuer, subjectId: user.subjectId, deviceId, deviceSessionId: randomUUID(),
        appVersion: "synthetic-whole-acceptance", platform: "ios", capabilities: [], pushTokenRegistered: false, registeredAt: now }, "paired", now);
      result.mobilityAccountIds[key] = (await mobility.account(user)).accountId;
      assert.ok(await consents.grant(user.subjectId, new Date(), { issuer: f.issuer, subjectId: user.subjectId }));
      const owner = hash([user.issuer, user.subjectId]);
      // This is actual COP-owned rate metadata, not a positive moderation proof.
      await store.transact([], tx => tx.set("communication-safety:rate:" + owner + ":" + now.slice(0, 13), 1));
    }
    const call = await voice.create({ ownerIssuer: f.issuer, initiatorSubjectId: f.actors.a.subjectId,
      participantSubjectIds: [f.actors.b.subjectId], kind: "direct", roomId: "synthetic-shared-voice-room", title: "Synthetic shared call",
      now, expiresAt: new Date(Date.now() + 60000).toISOString() });
    await livekit(env).createRoom({ name: "cop-call-" + call.callId, emptyTimeout: 10800, departureTimeout: 10800 });
    const accepted = await voice.transition(call.callId, { action: "accept", actorSubjectId: f.actors.b.subjectId, now: new Date().toISOString() });
    assert.equal(accepted?.record.phase, "accepted");
    const mediaIssuer = createVoiceCallMediaIssuerFromEnv(env);
    assert.equal(mediaIssuer.enabled, true);
    for (const name of ["a", "b"]) {
      const user = actor(f, name), issuedAt = new Date(), credentials = await mediaIssuer.issue(accepted.record, user, issuedAt);
      assert(Date.parse(credentials.expiresAt) - issuedAt.getTime() > 3_500_000, "WHOLE_ONE_HOUR_ACTUAL_TOKEN_REQUIRED");
      await voice.recordMediaGrant({ issuer: f.issuer, subjectId: user.subjectId }, call.callId, credentials.expiresAt, issuedAt.toISOString());
      const validation = await fetch("http://127.0.0.1:7880/rtc/validate?" + new URLSearchParams({ access_token: credentials.token }), { signal: AbortSignal.timeout(10000), redirect: "error" });
      assert.equal(validation.status, 200, "ACTUAL_ISSUED_LIVEKIT_JWT_NOT_ACCEPTED"); await validation.body?.cancel();
      result.mediaGrants[name] = { token: credentials.token, expiresAt: credentials.expiresAt };
    }
    const ended = await voice.transition(call.callId, { action: "end", actorSubjectId: f.actors.a.subjectId, now: new Date().toISOString() });
    assert.equal(ended?.record.phase, "ended");
    result.callIds.push(call.callId);
    return result;
  } finally { await Promise.all([...resources, consents].map(value => value.close())); }
}
async function keycloakState(f, subject) {
  const token = await fetch(f.issuer + "/protocol/openid-connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: f.erasureClient.id, client_secret: f.erasureClient.secret }), signal: AbortSignal.timeout(10000) });
  assert.equal(token.status, 200); const auth = (await token.json()).access_token;
  const request = async path => { const response = await fetch("https://cop-erasure-keycloak.invalid/admin/realms/cop/" + path,
    { headers: { authorization: "Bearer " + auth }, signal: AbortSignal.timeout(10000) }); if (response.status === 404 && /^users\/[0-9a-f-]{36}$/u.test(path)) return null; assert.equal(response.status, 200); return response.json(); };
  const user = await request("users/" + subject);
  if (!user) return { user: null, consentClients: [], clients: {}, realmRoleIds: [] };
  const realmRoles = await request("users/" + subject + "/role-mappings/realm");
  const consents = await request("users/" + subject + "/consents"), clients = {};
  for (const id of ["cop-web", "csm-mobile"]) {
    const uuid = f.clientUuids[id];
    const roles = await request("users/" + subject + "/role-mappings/clients/" + uuid), offline = await request("users/" + subject + "/offline-sessions/" + uuid);
    clients[id] = { roleIds: roles.map(role => role.id).sort(), offlineIds: offline.map(session => session.id).sort() };
  }
  return { user: { id: user.id, username: user.username, enabled: user.enabled, firstName: user.firstName, lastName: user.lastName, email: user.email },
    realmRoleIds: realmRoles.map(role => role.id).sort(), consentClients: consents.map(value => value.clientId).filter(id => ["cop-web", "csm-mobile"].includes(id)).sort(), clients };
}
export async function readCopLocalOwners({ manifest: f, environment: env, operationId, seed }) {
  const pg = new Pool({ connectionString: f.database.businessRuntimeUrl, max: 2 }), guard = new Pool({ connectionString: f.database.guardRuntimeUrl, max: 2 });
  try {
    const snapshots = {};
    for (const grant of Object.values(seed.local.mediaGrants)) {
      const validation = await fetch("http://127.0.0.1:7880/rtc/validate?" + new URLSearchParams({ access_token: grant.token }), { signal: AbortSignal.timeout(10000), redirect: "error" });
      const now = Date.now(), expiresAt = Date.parse(grant.expiresAt);
      if (now >= expiresAt + 90000) assert.equal(validation.status, 401, "ACTUAL_LIVEKIT_JWT_EXPIRY_UNPROVEN");
      else if (now < expiresAt) assert.equal(validation.status, 200, "ACTUAL_LIVEKIT_JWT_PREEXPIRY_UNPROVEN");
      else assert([200, 401].includes(validation.status), "ACTUAL_LIVEKIT_JWT_LEEWAY_UNPROVEN");
      await validation.body?.cancel();
    }
    const participantInventory = [], rooms = await livekit(env).listRooms();
    for (const room of rooms) participantInventory.push(...(await livekit(env).listParticipants(room.name)).map(participant => ({ room: room.name, identity: participant.identity })));
    assert(rooms.length <= 10000);
    for (const key of ["a", "b"]) {
      const user = actor(f, key), subject = user.subjectId, owner = hash([user.issuer, subject]), identity = mobilityIdentityDigest(user.issuer, subject);
      const sessionKey = createHash("sha256").update(env.COP_WEB_SESSION_SECRET).digest(),
        sessionOwner = createHmac("sha256", sessionKey).update("cop-web-session-owner-v1\0").update(JSON.stringify([f.issuer, subject])).digest("hex");
      const read = async (sql, params = [subject]) => (await pg.query(sql, params)).rows;
      const profile = await read("SELECT subject_id,issuer,username,display_name,email,preferences,alert_preferences FROM cop_user_profiles WHERE subject_id=$1");
      const session = await read("SELECT session_id,owner_hash,token_payload FROM cop_web_sessions WHERE owner_hash=$1 ORDER BY session_id", [sessionOwner]);
      const devices = await read("SELECT subject_id,device_id,device_session_id,status FROM cop_mobile_devices WHERE subject_id=$1 ORDER BY device_id");
      const pairings = await read("SELECT code,status FROM cop_mobile_pairing_sessions WHERE created_by_subject_id=$1 OR claimed_by_subject_id=$1 ORDER BY code");
      const mesh = await read("SELECT envelope_id,status FROM cop_mobile_mesh_acks WHERE subject_id=$1 ORDER BY envelope_id");
      const calls = await read("SELECT call_id,phase,participant_subject_ids,initiator_subject_id,accepted_by_subject_id FROM cop_voice_calls WHERE initiator_subject_id=$1 OR participant_subject_ids ? $1 OR accepted_by_subject_id=$1 ORDER BY call_id");
      const grants = await read("SELECT owner_hash,call_id FROM cop_voice_media_grants WHERE subject_hash=$1 ORDER BY call_id", [createHash("sha256").update(subject).digest("hex")]);
      const mobility = await read("SELECT key,value FROM cop_mobility_v1 WHERE key=$1 OR key=$2 OR key=$3 ORDER BY key",
        ["identity:" + identity, "account:" + seed.local.mobilityAccountIds[key], "account-provenance:" + seed.local.mobilityAccountIds[key]]);
      const moderation = await read("SELECT key,value FROM cop_mobility_v1 WHERE left(key,length($1))=$1 OR left(key,length($2))=$2 ORDER BY key",
        ["communication-safety:rate:" + owner + ":", "communication-safety:operation:" + owner + ":"]);
      const kc = await keycloakState(f, subject), kcCount = Number(kc.user !== null) + kc.realmRoleIds.length + kc.consentClients.length + Object.values(kc.clients).reduce((sum, value) => sum + value.roleIds.length + value.offlineIds.length, 0);
      const externalVoice = participantInventory.filter(value => value.identity === subject);
      snapshots[key] = {
        keycloak: { count: kcCount, state: kc },
        cop_sessions_profiles: { count: profile.length + session.length, state: [profile, session] },
        cop_devices: { count: devices.length + pairings.length + mesh.length, state: [devices, pairings, mesh] },
        voice_livekit: { count: calls.length + grants.length + externalVoice.length,
          state: [calls.map(value => ({ callId: value.call_id, phase: value.phase, includesSubject: value.participant_subject_ids.includes(subject), accepted: value.accepted_by_subject_id === subject })), grants, externalVoice] },
        mobility_dispatch: { count: mobility.length, state: mobility },
        moderation_audit: { count: moderation.length, state: moderation },
        backup_restore: { count: 0, state: "no_removable_content_in_independent_journal" }
      };
    }
    const accountKey = createHmac("sha256", env.COP_ACCOUNT_ERASURE_SECRET).update("cop-account-erasure-identity-v1\0")
      .update(JSON.stringify([f.issuer, f.actors.a.subjectId])).digest("hex");
    const journal = (await guard.query("SELECT account_key,operation_id,requested_at,entry,digest FROM cop_safety_v2.fences WHERE account_key=$1", [accountKey])).rows;
    if (journal.length) {
      assert.equal(journal.length, 1); assert.equal(journal[0].operation_id, operationId);
      assert.equal(journal[0].entry.accountKey, accountKey); assert.equal(journal[0].entry.job.operationId, operationId);
      if (seed.local.baselineFence) assert.deepEqual(journal, seed.local.baselineFence); else seed.local.baselineFence = journal;
    }
    return Object.fromEntries(Object.keys(snapshots.a).map(id => [id, { removableA: snapshots.a[id].count, removableB: snapshots.b[id].count,
      preservedBFingerprint: hash(snapshots.b[id].state) }]));
  } finally { await pg.end(); await guard.end(); }
}

/** The COP half of the actual SIM measurement owner: consent metadata is
 * checked in addition to the independent SIM provider readback. */
export async function readCopMeasurementConsent({ manifest: f }) {
  const pg = new Pool({ connectionString: f.database.businessRuntimeUrl, max: 1 });
  try {
    const result = {};
    for (const name of ["a", "b"]) {
      const rows = (await pg.query("SELECT subject_id,owner_issuer,granted_at,revoked_at,last_revoked_day,pending_days FROM cop_driver_measurement_consents WHERE subject_id=$1", [f.actors[name].subjectId])).rows;
      result[name] = { count: rows.length, fingerprint: hash(rows) };
    }
    return result;
  } finally { await pg.end(); }
}
