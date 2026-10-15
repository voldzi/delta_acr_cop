/** Root-only identity derivation and actual COP consent/journal readback.
 * Principals, historical secrets and candidate joins exist in RAM only. The
 * permanent fence journal contains only the existing pseudonymous account MAC. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { canonical, canonicalJson, exact, hex, uuid, sha256, readRootFile, readPublicVerificationKeys,
  requireGuard, requireRootCodeTree, verifyRootRecord } from './root-records.mjs';
import { issueRootRecord, storeRootRecord } from './root-record-issuer.mjs';
import { connectionProfile } from './root-driver-runtime.mjs';
import { RootFenceJournal } from './root-fence-journal.mjs';
import { readClientRegistration } from './driver-root-channel.mjs';
import { readAiClientRegistration } from './ai-root-inspect.mjs';
import { copAccountMac, copRouterAlias, driverDailyIdentity, driverContributorHash, deriveDriverCandidateInventory } from './root-cop-identity.mjs';

const ETC = '/etc/cop-account-safety/root', STATE = '/var/lib/cop-account-safety';
const safeText = (v, max = 512) => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const mac = (secret, purpose, value, encoding = 'hex') => createHmac('sha256', secret).update(purpose).update(value).digest(encoding);
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function root() { requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED'); requireRootCodeTree('/opt/cop-account-safety'); }
function identity() {
  root();
  const p = canonicalJson(readRootFile(join(ETC, 'cop-identity.json'), { secret: true }));
  requireGuard(exact(p, ['contractVersion', 'issuer', 'identitySecret', 'routerUserIdSecret', 'applicationStoreId', 'protectedConfigId', 'configurationFingerprint']) &&
    p.contractVersion === 'cop-root-cop-identity-v1' && safeText(p.issuer, 2048) && p.issuer.startsWith('https://') &&
    safeText(p.identitySecret, 4096) && p.identitySecret.length >= 32 && safeText(p.routerUserIdSecret, 4096) && p.routerUserIdSecret.length >= 32 &&
    uuid(p.applicationStoreId) && uuid(p.protectedConfigId) && hex(p.configurationFingerprint) &&
    sha256('cop-account-erasure-config-v1\0' + p.identitySecret) === p.configurationFingerprint, 'GUARD_COP_IDENTITY_PROFILE');
  const url = new URL(p.issuer); requireGuard(!url.username && !url.password && !url.search && !url.hash, 'GUARD_COP_IDENTITY_PROFILE'); return p;
}
function driverIdentity() {
  const p = canonicalJson(readRootFile(join(ETC, 'driver-identity.json'), { secret: true }));
  requireGuard(exact(p, ['contractVersion', 'serviceToken', 'actorSecret', 'issuer', 'hashSecret']) &&
    p.contractVersion === 'cop-root-driver-identity-v1' && ['serviceToken', 'actorSecret', 'hashSecret'].every(k => safeText(p[k], 4096) && p[k].length >= 32) &&
    safeText(p.issuer, 2048), 'GUARD_DRIVER_IDENTITY_PROFILE'); return p;
}
function registeredPeer(peer, keys) {
  try { return readClientRegistration(peer, keys); }
  catch { return readAiClientRegistration(peer, keys); }
}
async function database(profile, name, user, work) {
  const require = createRequire('/opt/cop-account-safety/package.json'), { Client } = require('pg');
  const client = new Client(connectionProfile(profile, name, user));
  let failed = false, ended = false, closing = false;
  client.on('error', () => { failed = true; }); client.on('end', () => { ended = true; if (!closing) failed = true; });
  try { await client.connect(); return await work(client); }
  finally {
    closing = true; let timer;
    try {
      await Promise.race([client.end(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GUARD_COP_DATABASE_END_UNKNOWN')), 15000); })]);
      requireGuard(ended && !failed, 'GUARD_COP_DATABASE_END_UNKNOWN');
    } catch { throw new Error('GUARD_COP_DATABASE_END_UNKNOWN'); }
    finally { clearTimeout(timer); }
  }
}
async function readOnlyDatabase(profile, name, user, work) {
  return database(profile, name, user, async client => {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
    try {
      await client.query("SET LOCAL statement_timeout='3000ms'"); await client.query("SET LOCAL lock_timeout='1000ms'");
      if (profile === 'cop-consent-reader') {
        const actual = await client.query(`SELECT current_user AS current_role,session_user AS session_role,
          count(c.oid)::integer AS tables,coalesce(bool_and(c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
            AND c.relowner<>r.oid AND NOT has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE')
            AND NOT has_table_privilege(current_user,c.oid,'DELETE') AND NOT has_table_privilege(current_user,c.oid,'TRUNCATE')
            AND NOT has_any_column_privilege(current_user,c.oid,'INSERT') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')
            AND NOT has_any_column_privilege(current_user,c.oid,'REFERENCES')),false) AS surface,
          coalesce(bool_and(NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication),false) AS restricted,
          (SELECT count(*)::integer FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS memberships
          FROM pg_catalog.pg_roles r LEFT JOIN pg_catalog.pg_class c ON c.oid IN
          (to_regclass('public.cop_driver_measurement_config'),to_regclass('public.cop_driver_measurement_consents'),to_regclass('public.cop_driver_consent_erasure_fences'))
          WHERE r.rolname=current_user`);
        const a = actual.rows[0];
        requireGuard(actual.rows.length === 1 && a.current_role === user && a.session_role === user && a.tables === 3 && a.surface === true &&
          a.restricted === true && a.memberships === 0, 'GUARD_COP_CONSENT_READ_SURFACE');
      }
      const value = await work(client); await client.query('COMMIT'); return value;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  });
}
function actorIdentity(actor, p) {
  requireGuard(exact(actor, ['iss', 'sub', 'operationId', 'routerUserId']) && actor.iss === p.issuer && safeText(actor.sub) && uuid(actor.operationId), 'GUARD_COP_ACTOR');
  requireGuard(equal(actor.routerUserId, copRouterAlias(p.routerUserIdSecret, actor.sub)), 'GUARD_COP_ACTOR_ALIAS');
  return copAccountMac(p.identitySecret, actor.iss, actor.sub);
}
export async function assertCopJournalActor(peer, actor, businessOperationId) {
  const p = identity(), keys = readPublicVerificationKeys(), registration = registeredPeer(peer, keys);
  const accountKey = actorIdentity(actor, p);
  requireGuard(businessOperationId === actor.operationId, 'GUARD_COP_BUSINESS_OPERATION');
  const result = await readOnlyDatabase('registry-probe', 'cop_account_safety_guard', 'cop_guard_root_reader', async client => {
    const journal = new RootFenceJournal(client, keys, { ...p, guardStoreId: registration.guardStoreId, continuityEpoch: registration.continuityEpoch });
    // Root's caller may already hold the actual exclusive owner session.
    // snapshot() would acquire 904214 on ANOTHER connection and self-deadlock.
    // Immutable signed manifests and two actual observations need no writer
    // lock or frontier refresh. A concurrent append between reads is denied.
    const first = await journal.observe(), replay = await journal.observe();
    requireGuard(canonical({ entries: first.entries, frontier: first.frontier }) ===
      canonical({ entries: replay.entries, frontier: replay.frontier }), 'GUARD_COP_JOURNAL_CHANGED');
    const entry = replay.entries.find(e => e.accountKey === accountKey);
    requireGuard(entry?.job.operationId === businessOperationId, 'GUARD_COP_JOURNAL_ACTOR');
    const rows = await client.query('SELECT sequence::text,entry_digest,coverage_manifest_ref FROM cop_guard.fence_journal WHERE fence_operation_id=$1::uuid', [businessOperationId]);
    requireGuard(rows.rows.length === 1, 'GUARD_COP_JOURNAL_ACTOR');
    const r = rows.rows[0], [recordId, digest] = r.coverage_manifest_ref.split(':');
    requireGuard(recordId === businessOperationId && hex(digest) && hex(r.entry_digest) && Number.isSafeInteger(Number(r.sequence)), 'GUARD_COP_JOURNAL_REFERENCE');
    return Object.freeze({ accountKey, operationId: businessOperationId, requestedAt: entry.job.requestedAt,
      journalSequence: Number(r.sequence), entryDigest: r.entry_digest, frontierSequence: replay.frontier.sequence,
      frontierDigest: replay.frontier.digest, reference: Object.freeze({ recordId, digest }) });
  });
  requireGuard(canonical(readPublicVerificationKeys()) === canonical(keys), 'GUARD_KEYRING_CHANGED'); return result;
}
function contributorKeys(p, registration, keys) {
  const file = canonicalJson(readRootFile(join(ETC, 'driver-contributor-keys.json'), { secret: true }));
  requireGuard(exact(file, ['contractVersion', 'currentVersion', 'keys']) && file.contractVersion === 'cop-root-driver-contributor-keys-v1' &&
    safeText(file.currentVersion, 64) && Array.isArray(file.keys) && file.keys.length >= 1 && file.keys.length <= 4 &&
    file.keys.every(k => exact(k, ['version', 'secret']) && safeText(k.version, 64) && safeText(k.secret, 4096) && k.secret.length >= 32) &&
    new Set(file.keys.map(k => k.version)).size === file.keys.length && file.keys.some(k => k.version === file.currentVersion), 'GUARD_DRIVER_KEY_HISTORY');
  const accepted = verifyRootRecord(readRootFile(join(STATE, 'authority', 'driver-key-history.json'), { secret: true }), keys, 'driver-key-history', { historical: true });
  const h = accepted.payload;
  requireGuard(exact(h, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'guardStoreId', 'continuityEpoch', 'protectedConfigId', 'keys']) &&
    h.guardStoreId === registration.guardStoreId && h.continuityEpoch === registration.continuityEpoch && h.protectedConfigId === p.protectedConfigId &&
    Array.isArray(h.keys) && h.keys.length === file.keys.length, 'GUARD_DRIVER_KEY_HISTORY');
  const nowDay = new Date().toISOString().slice(0, 10);
  return { reference: { recordId: h.recordId, digest: accepted.digest }, currentVersion: file.currentVersion,
    keys: file.keys.map(k => {
      const matches = h.keys.filter(v => v.version === k.version); requireGuard(matches.length === 1, 'GUARD_DRIVER_KEY_HISTORY');
      const v = matches[0];
      requireGuard(exact(v, ['version', 'secretFingerprint', 'firstIssuableDay', 'lastIssuableDay']) && v.secretFingerprint === sha256(k.secret) &&
        day(v.firstIssuableDay) && v.firstIssuableDay <= nowDay && (v.lastIssuableDay === null || day(v.lastIssuableDay) && v.lastIssuableDay >= v.firstIssuableDay && v.lastIssuableDay <= nowDay), 'GUARD_DRIVER_KEY_HISTORY');
      return { ...k, firstDay: v.firstIssuableDay, lastDay: v.lastIssuableDay ?? nowDay };
    }) };
}
function ephemeral(kind, facts, keys) {
  const record = issueRootRecord(kind, facts, { lifetimeMs: 5000, expectedKeyringDigest: sha256(canonical(keys) + '\n') });
  storeRootRecord(join('/run/cop-account-safety/private/owner-authority', record.payload.recordId + '.json'), record.bytes);
  return Object.freeze({ recordId: record.payload.recordId, digest: record.digest });
}
/** Complete historical identity derivation requires independently accepted key
 * issuance bounds plus actual retained hash matches; receipt upload time is
 * deliberately never treated as the GPS/contributor day. */
export async function assertCopDriverErasureManifest(peer, actor, request, originalAcceptedAt) {
  const journal = await assertCopJournalActor(peer, actor, request.operationId), p = identity(), keys = readPublicVerificationKeys();
  const registration = readClientRegistration(peer, keys), driver = driverIdentity(); requireGuard(driver.issuer === p.issuer, 'GUARD_COP_ISSUER');
  requireGuard(exact(request, ['contractVersion', 'operationId', 'contributors', 'attestation']) && request.contractVersion === 'sim-account-erasure-v1' &&
    request.attestation === 'cop-account-erasure-contributors-reviewed-v1' && Array.isArray(request.contributors) && request.contributors.length >= 9 && request.contributors.length <= 40 &&
    typeof originalAcceptedAt === 'string' && Number.isFinite(Date.parse(originalAcceptedAt)) && new Date(originalAcceptedAt).toISOString() === originalAcceptedAt &&
    Date.parse(originalAcceptedAt) <= Date.now(), 'GUARD_DRIVER_MANIFEST');
  const history = contributorKeys(p, registration, keys), candidates = deriveDriverCandidateInventory(history.keys, actor.sub, driver.hashSecret);
  const retained = await readOnlyDatabase('driver-inventory', 'sim_driver_measurements', 'sim_driver_guard_control', async client => {
    const r = await client.query('SELECT sim_driver_guard_source.read_inventory_candidates($1::jsonb) AS value', [JSON.stringify([...candidates.keys()].sort())]);
    const v = r.rows[0]?.value;
    requireGuard(r.rows.length === 1 && exact(v, ['contractVersion', 'observedAtUTC', 'storeIncarnation', 'candidateCount', 'matchedHashes']) &&
      v.contractVersion === 'sim-driver-inventory-candidates-v1' && uuid(v.storeIncarnation) && v.candidateCount === candidates.size &&
      typeof v.observedAtUTC === 'string' && Number.isFinite(Date.parse(v.observedAtUTC)) && new Date(v.observedAtUTC).toISOString() === v.observedAtUTC &&
      Date.parse(v.observedAtUTC) <= Date.now() && Date.now() - Date.parse(v.observedAtUTC) <= 5000 &&
      Array.isArray(v.matchedHashes) && v.matchedHashes.length <= candidates.size && v.matchedHashes.every(h => hex(h) && candidates.has(h)) &&
      new Set(v.matchedHashes).size === v.matchedHashes.length && canonical(v.matchedHashes) === canonical([...v.matchedHashes].sort()), 'GUARD_DRIVER_RETAINED_INVENTORY');
    await readOnlyDatabase('registry-probe', 'cop_account_safety_guard', 'cop_guard_root_reader', async registry => {
      const binding = await registry.query(`SELECT target_incarnation_id::text FROM cop_guard.dataset_bindings
        WHERE dataset_binding_id=$1::uuid AND guard_store_id=$2::uuid AND continuity_epoch=$3::uuid AND owner_id='sim_driver_measurements'`,
      [registration.datasetBindingId, registration.guardStoreId, registration.continuityEpoch]);
      requireGuard(binding.rows.length === 1 && binding.rows[0].target_incarnation_id === v.storeIncarnation, 'GUARD_DRIVER_INVENTORY_STORE');
    });
    return v.matchedHashes.map(h => candidates.get(h));
  });
  const outbox = await readOnlyDatabase('cop-consent-reader', 'cop', 'cop_guard_consent_reader', async client => {
    const r = await client.query(`SELECT c.owner_issuer,c.pending_days,f.owner_issuer AS fence_issuer,f.operation_id::text,f.pending_days AS fence_days
      FROM (SELECT 1) seed LEFT JOIN public.cop_driver_measurement_consents c ON c.subject_id=$1
      LEFT JOIN public.cop_driver_consent_erasure_fences f ON f.subject_hash=$2`,
    [actor.sub, mac(history.keys.find(k => k.version === history.currentVersion).secret, 'cop-driver-consent-erasure-v1\0', actor.sub)]);
    requireGuard(r.rows.length === 1, 'GUARD_COP_CONSENT_INVENTORY'); const v = r.rows[0];
    requireGuard((v.owner_issuer === null || v.owner_issuer === actor.iss) && (v.fence_issuer === null || v.fence_issuer === actor.iss && v.operation_id === request.operationId), 'GUARD_COP_CONSENT_OWNER');
    const dates = [...(v.pending_days ?? []), ...(v.fence_days ?? [])]; requireGuard(dates.every(day), 'GUARD_COP_CONSENT_INVENTORY'); return dates;
  });
  const days = new Set([...retained, ...outbox]), anchor = Date.parse(originalAcceptedAt);
  const first = Date.parse(new Date(anchor - 8 * 86_400_000).toISOString().slice(0, 10));
  const last = Date.parse(new Date(anchor + 30_000).toISOString().slice(0, 10));
  for (let ms = first; ms <= last; ms += 86_400_000) days.add(new Date(ms).toISOString().slice(0, 10));
  const expected = history.keys.flatMap(k => [...days].map(d => ({ contributorDay: d, contributorIdDay: driverDailyIdentity(k.secret, actor.sub, d) })))
    .sort((a, b) => a.contributorDay.localeCompare(b.contributorDay) || a.contributorIdDay.localeCompare(b.contributorIdDay));
  requireGuard(expected.length <= 40 && request.contributors.every(v => exact(v, ['contributorDay', 'contributorIdDay']) && day(v.contributorDay)) &&
    canonical(expected) === canonical(request.contributors), 'GUARD_DRIVER_MANIFEST_IDENTITY');
  await assertCopJournalActor(peer, actor, request.operationId);
  return ephemeral('cop-driver-manifest-attestation', { businessOperationId: request.operationId, accountKey: journal.accountKey,
    journalRef: journal.reference, keyHistoryRef: history.reference, manifestDigest: sha256(canonical(request)), originalAcceptedAt }, keys);
}
export async function assertCopRevocationIntent(peer, scope) {
  const p = identity(), keys = readPublicVerificationKeys(), registration = readClientRegistration(peer, keys), driver = driverIdentity();
  requireGuard(driver.issuer === p.issuer && equal(scope.authorization, 'Bearer ' + driver.serviceToken) &&
    scope.method === 'DELETE' && scope.path === '/api/v1/internal/driver-measurements/v1/contributions' &&
    exact(scope.body, ['contractVersion', 'contributorIdDay']) && scope.body.contractVersion === 'sim-driver-measurements-v1' &&
    typeof scope.actor === 'string' && /^[A-Za-z0-9_-]{20,2048}$/.test(scope.actor) && hex(scope.actorSignature) &&
    equal(scope.actorSignature, mac(driver.actorSecret, '', scope.actor)), 'GUARD_REVOCATION_ACTOR');
  const raw = Buffer.from(scope.actor, 'base64url'); requireGuard(raw.toString('base64url') === scope.actor, 'GUARD_REVOCATION_ACTOR');
  const claim = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  const now = Math.floor(Date.now() / 1000);
  requireGuard(exact(claim, ['iss', 'sub', 'aud', 'iat', 'exp', 'contributorDay', 'contributorIdDay', 'actorSource']) && claim.iss === p.issuer &&
    safeText(claim.sub) && claim.aud === 'sim-driver-revocation' && Number.isSafeInteger(claim.iat) && Number.isSafeInteger(claim.exp) &&
    claim.iat <= now && now < claim.exp && claim.exp - claim.iat > 0 && claim.exp - claim.iat <= 60 && day(claim.contributorDay) &&
    ['verified_session', 'consent_ledger'].includes(claim.actorSource) && claim.contributorIdDay === scope.body.contributorIdDay &&
    JSON.stringify({ iss: claim.iss, sub: claim.sub, aud: claim.aud, iat: claim.iat, exp: claim.exp,
      contributorDay: claim.contributorDay, contributorIdDay: claim.contributorIdDay, actorSource: claim.actorSource }) === raw.toString('utf8'), 'GUARD_REVOCATION_ACTOR');
  const history = contributorKeys(p, registration, keys), current = history.keys.find(k => k.version === history.currentVersion);
  requireGuard(equal(claim.contributorIdDay, driverDailyIdentity(current.secret, claim.sub, claim.contributorDay)), 'GUARD_REVOCATION_IDENTITY');
  const intent = await readOnlyDatabase('cop-consent-reader', 'cop', 'cop_guard_consent_reader', async client => {
    const r = await client.query(`SELECT c.owner_issuer,c.revoked_at,c.pending_days,
      (SELECT secret_fingerprint FROM public.cop_driver_measurement_config WHERE id=true) AS secret_fingerprint,
      EXISTS(SELECT 1 FROM public.cop_driver_consent_erasure_fences WHERE subject_hash=$2) AS account_fenced
      FROM public.cop_driver_measurement_consents c WHERE c.subject_id=$1`,
    [claim.sub, mac(current.secret, 'cop-driver-consent-erasure-v1\0', claim.sub)]);
    requireGuard(r.rows.length === 1 && r.rows[0].owner_issuer === claim.iss && r.rows[0].revoked_at !== null &&
      Array.isArray(r.rows[0].pending_days) && r.rows[0].pending_days.includes(claim.contributorDay) && r.rows[0].account_fenced === false &&
      r.rows[0].secret_fingerprint === sha256('cop-driver-secret-v1\0' + current.secret), 'GUARD_REVOCATION_INTENT');
    return { contributorHash: driverContributorHash(driver.hashSecret, claim.contributorIdDay), contributorDay: claim.contributorDay,
      consentRevokedAt: new Date(r.rows[0].revoked_at).toISOString(), actorSource: claim.actorSource };
  });
  requireGuard(canonical(readPublicVerificationKeys()) === canonical(keys), 'GUARD_KEYRING_CHANGED');
  return ephemeral('cop-driver-revocation-intent', { guardStoreId: registration.guardStoreId, continuityEpoch: registration.continuityEpoch,
    datasetBindingId: registration.datasetBindingId, runtimeBindingId: registration.runtimeBindingId, ...intent }, keys);
}
