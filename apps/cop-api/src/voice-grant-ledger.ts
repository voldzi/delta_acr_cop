import { createHash, createHmac, randomUUID } from "node:crypto";
import type { MobilityStore, MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

export const VOICE_GRANT_IDENTITY_PREFIX = "cop-jizda-voice-v1-";
export const VOICE_GRANT_GATEWAY_CONFIG_KEY = "voice-signaling-gateway:v1:configuration";
export class VoiceGrantError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export interface VoiceScopedGrant {
  identity: string;
  grantId: string;
  callId: string;
  room: string;
  appKey: string;
  installationKey: string;
  createdAt: string;
  validUntil: string;
  /** Immutable provenance: accepted gateway epoch present at first issuance only. */
  admissionEpoch?: string;
  revokedAt?: string;
  revocationOperationId?: string;
}
export interface VoiceGrantRevocation {
  operationId: string;
  scope: "app" | "installation";
  grants: VoiceScopedGrant[];
}
export interface VoiceGrantLedgerOptions {
  store: MobilityStore;
  issuer: string;
  clientId: string;
  /** The existing server-only LiveKit secret, used with separate HMAC domains. */
  identitySecret: string;
  intakeEnabled?: boolean;
  maxGrantAgeMs?: number;
  /** Production issuance requires the current accepted gateway epoch. */
  requireAdmissionEpoch?: boolean;
}
interface Installation {
  appKey: string;
  installationKey: string;
  jizdaFenceKey: string;
  attestedAt: string;
}
interface StoredGrant extends VoiceScopedGrant { jizdaFenceKey: string }
interface GrantIndex { identity: string; installationKey: string }
interface RevocationFence { operationId: string; requestedAt: string }
const prefix = "voice-grant-ledger:v1:";
export const VOICE_GRANT_CONFIG_KEY = prefix + "configuration";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ownerKeyPattern = /^[0-9a-f]{64}$/u;
const maxAgeMs = 24 * 60 * 60 * 1000;
const maxInstallations = 128;
const maxGrantsPerInstallation = 128;

/** Durable local grant denial, not a provider admission/revocation proof.
 * All actors must come from verified COP authentication. attestInstallation must
 * be called only after a server-attested, successful online Matrix bootstrap.
 * A client UUID or prefix alone is never installation ownership evidence.
 */
export class VoiceGrantLedger {
  readonly options: Readonly<VoiceGrantLedgerOptions>;
  private readonly grantAgeMs: number;
  private readonly fingerprint: string;
  private initialized?: Promise<void>;
  constructor(options: VoiceGrantLedgerOptions) {
    const age = options.maxGrantAgeMs ?? maxAgeMs;
    if (typeof options.identitySecret !== "string" || options.identitySecret.length < 32 ||
        typeof options.issuer !== "string" || !options.issuer || options.issuer !== options.issuer.trim() || options.issuer.length > 1024 ||
        typeof options.clientId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(options.clientId) || ["csm-mobile", "cop-web"].includes(options.clientId) ||
        !Number.isSafeInteger(age) || age < 60_000 || age > maxAgeMs) {
      throw new Error("Scoped voice grants require a stable dedicated OIDC client, issuer, server secret and bounded grant age.");
    }
    this.options = Object.freeze({ ...options });
    this.grantAgeMs = age;
    this.fingerprint = this.hash("configuration", JSON.stringify([options.issuer, options.clientId, age]));
  }
  owns(actor: AuthenticatedActor): boolean {
    return actor.authMode === "oidc" && actor.issuer === this.options.issuer && actor.authorizedParty === this.options.clientId &&
      typeof actor.subjectId === "string" && !!actor.subjectId && Buffer.byteLength(actor.subjectId, "utf8") <= 512;
  }
  async init(): Promise<void> {
    if (!this.initialized) this.initialized = this.options.store.transact([VOICE_GRANT_CONFIG_KEY], async tx => {
      const saved = await tx.get<{ fingerprint: string }>(VOICE_GRANT_CONFIG_KEY);
      if (saved) this.checkFingerprint(saved);
      else {
        if ((await tx.scan(prefix)).length) throw new VoiceGrantError(503, "VOICE_GRANT_CONFIGURATION_MISSING");
        await tx.set(VOICE_GRANT_CONFIG_KEY, { fingerprint: this.fingerprint });
      }
    }).catch(error => { this.initialized = undefined; throw safeError(error); });
    await this.initialized;
  }
  async attestInstallation(actor: AuthenticatedActor, installationId: string, now: Date): Promise<void> {
    const scope = this.scope(actor, installationId), at = validNow(now);
    this.requireIntake(); await this.init();
    await this.transact([this.installationRow(scope.installationKey)], async tx => {
      await this.assertConfiguration(tx);
      await this.assertNoFence(tx, scope);
      const key = this.installationRow(scope.installationKey), saved = await tx.get<Installation>(key);
      if (saved) { this.checkInstallation(saved, scope); return; }
      await this.reserveInstallation(tx, scope);
      await tx.set(key, { ...scope, attestedAt: at } satisfies Installation);
    });
  }
  /** Pure current attestation/fence check; callers gate new-call intake separately. */
  async assertInstallation(actor: AuthenticatedActor, installationId: string, now: Date): Promise<void> {
    const scope = this.scope(actor, installationId); validNow(now); await this.init();
    await this.transact([], async tx => {
      await this.assertConfiguration(tx); await this.assertNoFence(tx, scope);
      const installation = await tx.get<Installation>(this.installationRow(scope.installationKey));
      if (!installation) throw new VoiceGrantError(403, "VOICE_INSTALLATION_NOT_ATTESTED");
      this.checkInstallation(installation, scope);
      if (now.getTime() < Date.parse(installation.attestedAt)) throw new VoiceGrantError(403, "VOICE_GRANT_DENIED");
    });
  }
  async issueGrant(actor: AuthenticatedActor, installationId: string, callId: string, room: string, now: Date): Promise<VoiceScopedGrant> {
    const scope = this.scope(actor, installationId), at = validNow(now), canonicalCall = validUuid(callId);
    if (!validRoom(room)) throw new VoiceGrantError(400, "VOICE_GRANT_INVALID_REQUEST");
    this.requireIntake(); await this.init();
    const reuseKey = `${prefix}call-install:${this.hash("call-install", JSON.stringify([scope.installationKey, canonicalCall]))}`;
    return this.transact([reuseKey], async tx => {
      await this.assertConfiguration(tx); await this.assertNoFence(tx, scope);
      const installation = await tx.get<Installation>(this.installationRow(scope.installationKey));
      if (!installation) throw new VoiceGrantError(403, "VOICE_INSTALLATION_NOT_ATTESTED");
      this.checkInstallation(installation, scope);
      if (now.getTime() < Date.parse(installation.attestedAt)) throw new VoiceGrantError(403, "VOICE_GRANT_DENIED");
      const admissionEpoch = await this.requiredGatewayEpoch(tx);
      const previousIdentity = await tx.get<string>(reuseKey);
      if (previousIdentity) {
        const previous = await tx.get<StoredGrant>(this.identityRow(previousIdentity));
        if (!previous) throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
        this.checkStoredGrant(previous);
        if (previous.appKey !== scope.appKey || previous.installationKey !== scope.installationKey || previous.callId !== canonicalCall)
          throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
        if (previous.room !== room) throw new VoiceGrantError(409, "VOICE_GRANT_ROOM_CHANGED");
        if (this.options.requireAdmissionEpoch && previous.admissionEpoch !== admissionEpoch)
          throw new VoiceGrantError(503, "VOICE_GRANT_ADMISSION_UNAVAILABLE");
        this.assertValid(previous, now);
        return publicGrant(previous);
      }
      const counterKey = `${prefix}installation:${scope.installationKey}:grant-count`, count = await tx.get<number>(counterKey) ?? 0;
      if (!Number.isSafeInteger(count) || count < 0) throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
      if (count >= maxGrantsPerInstallation) throw new VoiceGrantError(503, "VOICE_GRANT_CAPACITY_UNAVAILABLE");
      const grant: StoredGrant = { ...scope, identity: VOICE_GRANT_IDENTITY_PREFIX + randomUUID(), grantId: randomUUID(),
        callId: canonicalCall, room, createdAt: at, validUntil: new Date(now.getTime() + this.grantAgeMs).toISOString(),
        ...(admissionEpoch ? { admissionEpoch } : {}) };
      await tx.set(this.identityRow(grant.identity), grant);
      await tx.set(reuseKey, grant.identity);
      await tx.set(`${prefix}app:${scope.appKey}:grant:${grant.grantId}`, { identity: grant.identity, installationKey: scope.installationKey } satisfies GrantIndex);
      await tx.set(counterKey, count + 1);
      return publicGrant(grant);
    });
  }
  /** Looks up the durable identity, including refreshed JWTs without the original jti/token. */
  async assertAdmission(identity: string, room: string, now: Date): Promise<VoiceScopedGrant> {
    if (!scopedIdentity(identity) || !validRoom(room)) throw new VoiceGrantError(403, "VOICE_GRANT_DENIED");
    validNow(now); await this.init();
    return this.transact([], async tx => {
      await this.assertConfiguration(tx);
      const grant = await tx.get<StoredGrant>(this.identityRow(identity));
      if (!grant) throw new VoiceGrantError(403, "VOICE_GRANT_DENIED");
      this.checkStoredGrant(grant);
      if (grant.identity !== identity || grant.room !== room) throw new VoiceGrantError(403, "VOICE_GRANT_DENIED");
      await this.assertNoFence(tx, grant);
      const installation = await tx.get<Installation>(this.installationRow(grant.installationKey));
      if (!installation) throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
      this.checkInstallation(installation, grant);
      if (now.getTime() < Date.parse(installation.attestedAt)) throw new VoiceGrantError(403, "VOICE_GRANT_DENIED");
      this.assertValid(grant, now);
      if (this.options.requireAdmissionEpoch && grant.admissionEpoch !== await this.requiredGatewayEpoch(tx))
        throw new VoiceGrantError(503, "VOICE_GRANT_ADMISSION_UNAVAILABLE");
      return publicGrant(grant);
    });
  }
  async revokeApp(actor: AuthenticatedActor, operationId: string, now: Date): Promise<VoiceGrantRevocation> {
    const scope = this.scope(actor), operation = validUuid(operationId), at = validNow(now);
    await this.init();
    return this.revoke(scope, "app", operation, at);
  }
  async revokeInstallation(actor: AuthenticatedActor, installationId: string, operationId: string, now: Date): Promise<VoiceGrantRevocation> {
    const scope = this.scope(actor, installationId), operation = validUuid(operationId), at = validNow(now);
    await this.init();
    return this.revoke(scope, "installation", operation, at);
  }
  /** True means local durable admission denial only; this method never calls a provider. */
  async confirmsRevoked(identity: string, room?: string): Promise<boolean> {
    return (await this.readRevokedGrant(identity, room)) !== undefined;
  }
  /** Canonical persisted scope/provenance for provider proof; never adopts caller body fields. */
  async readRevokedGrant(identity: string, room?: string): Promise<VoiceScopedGrant | undefined> {
    if (!scopedIdentity(identity)) return undefined;
    await this.init();
    return this.transact([], async tx => {
      await this.assertConfiguration(tx);
      const grant = await tx.get<StoredGrant>(this.identityRow(identity));
      if (!grant) return undefined;
      this.checkStoredGrant(grant);
      if (grant.identity !== identity || (room !== undefined && grant.room !== room)) return undefined;
      return grant.revokedAt || await this.hasFence(tx, grant) ? publicGrant(grant) : undefined;
    });
  }
  private async revoke(scope: { appKey: string; jizdaFenceKey: string; installationKey?: string }, kind: "app" | "installation", operationId: string, at: string): Promise<VoiceGrantRevocation> {
    const fenceKey = kind === "app" ? this.appFence(scope.appKey) : this.installationFence(scope.installationKey!);
    return this.transact([fenceKey], async tx => {
      await this.assertConfiguration(tx);
      const existing = await tx.get<RevocationFence>(fenceKey);
      if (existing && existing.operationId !== operationId) throw new VoiceGrantError(409, "VOICE_GRANT_IDEMPOTENCY_CONFLICT");
      if (kind === "installation" && !existing) await this.reserveInstallation(tx, { ...scope, installationKey: scope.installationKey! });
      // This durable commit precedes every provider operation performed by the caller.
      if (!existing) await tx.set(fenceKey, { operationId, requestedAt: at } satisfies RevocationFence);
      const revokedAt = existing?.requestedAt ?? at, grants: VoiceScopedGrant[] = [];
      for (const entry of await tx.scan<GrantIndex>(`${prefix}app:${scope.appKey}:grant:`)) {
        if (kind === "installation" && entry.value.installationKey !== scope.installationKey) continue;
        const key = this.identityRow(entry.value.identity), grant = await tx.get<StoredGrant>(key);
        if (!grant) throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
        this.checkStoredGrant(grant);
        if (grant.appKey !== scope.appKey || grant.installationKey !== entry.value.installationKey)
          throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
        if (!grant.revokedAt) {
          grant.revokedAt = revokedAt; grant.revocationOperationId = operationId;
          await tx.set(key, grant);
        }
        grants.push(publicGrant(grant));
      }
      return { operationId, scope: kind, grants: grants.sort((a, b) => a.identity.localeCompare(b.identity)) };
    });
  }
  private scope(actor: AuthenticatedActor): { appKey: string; jizdaFenceKey: string };
  private scope(actor: AuthenticatedActor, installationId: string): { appKey: string; jizdaFenceKey: string; installationKey: string };
  private scope(actor: AuthenticatedActor, installationId?: string) {
    if (!this.owns(actor)) throw new VoiceGrantError(403, "VOICE_SCOPE_NOT_PROVEN");
    const appKey = this.hash("app-owner", JSON.stringify([actor.issuer, actor.subjectId, this.options.clientId]));
    // Matches the existing app-link fence without changing its established key.
    const jizdaFenceKey = "jizda-app-link:" + createHash("sha256").update(JSON.stringify([actor.issuer, actor.subjectId, this.options.clientId])).digest("hex");
    return { appKey, jizdaFenceKey, ...(installationId === undefined ? {} : {
      installationKey: this.hash("installation", JSON.stringify([appKey, validUuid(installationId)])) }) };
  }
  private hash(domain: string, value: string) {
    return createHmac("sha256", this.options.identitySecret).update("cop-jizda-voice-ledger-v1\0").update(domain).update("\0").update(value).digest("hex");
  }
  private identityRow(identity: string) { return prefix + "identity:" + identity; }
  private installationRow(key: string) { return prefix + "installation:" + key; }
  private appFence(key: string) { return `${prefix}app:${key}:revoked`; }
  private installationFence(key: string) { return `${prefix}installation:${key}:revoked`; }
  /** At most128 installation scopes, including preemptive fences. Existing
   * accepted retries never allocate a new scope or lose their durable denial. */
  private async reserveInstallation(tx: MobilityTransaction, scope: { appKey: string; installationKey: string; jizdaFenceKey: string }): Promise<void> {
    const reservationKey = `${prefix}app:${scope.appKey}:installation:${scope.installationKey}`;
    const saved = await tx.get<{ appKey: string; installationKey: string }>(reservationKey);
    if (saved !== undefined) {
      if (!saved || saved.appKey !== scope.appKey || saved.installationKey !== scope.installationKey)
        throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
      return;
    }
    const counterKey = `${prefix}app:${scope.appKey}:installation-count`, count = await tx.get<number>(counterKey) ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > maxInstallations) throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
    // Earlier source rows already counted attested installations. Do not count
    // them twice or turn capacity into an inability to revoke an accepted scope.
    const installation = await tx.get<Installation>(this.installationRow(scope.installationKey));
    if (installation !== undefined) {
      this.checkInstallation(installation, scope);
      if (count === 0) throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
    } else {
      if (count >= maxInstallations) throw new VoiceGrantError(503, "VOICE_GRANT_CAPACITY_UNAVAILABLE");
      await tx.set(counterKey, count + 1);
    }
    await tx.set(reservationKey, { appKey: scope.appKey, installationKey: scope.installationKey });
  }
  private requireIntake() {
    if (this.options.intakeEnabled === false) throw new VoiceGrantError(503, "VOICE_GRANT_INTAKE_DISABLED");
  }
  private checkFingerprint(value: { fingerprint: string }) {
    if (value.fingerprint !== this.fingerprint) throw new VoiceGrantError(503, "VOICE_GRANT_CONFIGURATION_CHANGED");
  }
  private async assertConfiguration(tx: MobilityTransaction) {
    const saved = await tx.get<{ fingerprint: string }>(VOICE_GRANT_CONFIG_KEY);
    if (!saved) throw new VoiceGrantError(503, "VOICE_GRANT_CONFIGURATION_MISSING");
    this.checkFingerprint(saved);
  }
  private async requiredGatewayEpoch(tx: MobilityTransaction): Promise<string | undefined> {
    const gateway = await tx.get<{ fingerprint: string; acceptedEpoch?: string; active?: boolean }>(VOICE_GRANT_GATEWAY_CONFIG_KEY);
    if (gateway !== undefined && (!gateway || typeof gateway.fingerprint !== "string" || !gateway.fingerprint ||
        (gateway.active !== undefined && typeof gateway.active !== "boolean") ||
        (gateway.active === true && gateway.acceptedEpoch === undefined) ||
        (gateway.acceptedEpoch !== undefined && (typeof gateway.acceptedEpoch !== "string" || !uuidPattern.test(gateway.acceptedEpoch))))) {
      throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
    }
    const epoch = gateway?.active === true ? gateway.acceptedEpoch?.toLowerCase() : undefined;
    if (this.options.requireAdmissionEpoch && !epoch) throw new VoiceGrantError(503, "VOICE_GRANT_ADMISSION_UNAVAILABLE");
    return epoch;
  }
  private async hasFence(tx: MobilityTransaction, scope: { appKey: string; installationKey: string; jizdaFenceKey: string }) {
    return await tx.get(scope.jizdaFenceKey) !== undefined || await tx.get(this.appFence(scope.appKey)) !== undefined ||
      await tx.get(this.installationFence(scope.installationKey)) !== undefined;
  }
  private async assertNoFence(tx: MobilityTransaction, scope: { appKey: string; installationKey: string; jizdaFenceKey: string }) {
    if (await this.hasFence(tx, scope)) throw new VoiceGrantError(403, "VOICE_GRANT_DENIED");
  }
  private checkInstallation(value: Installation, expected: { appKey: string; installationKey: string; jizdaFenceKey: string }) {
    if (value.appKey !== expected.appKey || value.installationKey !== expected.installationKey || value.jizdaFenceKey !== expected.jizdaFenceKey ||
        !Number.isFinite(Date.parse(value.attestedAt))) throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
  }
  private checkStoredGrant(value: StoredGrant) {
    const created = Date.parse(value.createdAt), until = Date.parse(value.validUntil);
    if (!scopedIdentity(value.identity) || !uuidPattern.test(value.grantId) || !uuidPattern.test(value.callId) || !validRoom(value.room) ||
        !ownerKeyPattern.test(value.appKey) || !ownerKeyPattern.test(value.installationKey) ||
        !/^jizda-app-link:[0-9a-f]{64}$/u.test(value.jizdaFenceKey) || !Number.isFinite(created) || !Number.isFinite(until) ||
        until <= created || until - created > this.grantAgeMs ||
        (value.admissionEpoch !== undefined && (typeof value.admissionEpoch !== "string" || !uuidPattern.test(value.admissionEpoch))) ||
        (value.revokedAt !== undefined && (!Number.isFinite(Date.parse(value.revokedAt)) || !uuidPattern.test(value.revocationOperationId ?? "")))) {
      throw new VoiceGrantError(503, "VOICE_GRANT_STATE_UNAVAILABLE");
    }
  }
  private assertValid(grant: StoredGrant, now: Date) {
    if (grant.revokedAt || now.getTime() < Date.parse(grant.createdAt) || now.getTime() >= Date.parse(grant.validUntil))
      throw new VoiceGrantError(403, "VOICE_GRANT_DENIED");
  }
  private async transact<T>(keys: string[], action: (tx: MobilityTransaction) => Promise<T>): Promise<T> {
    try { return await this.options.store.transact(keys, action); } catch (error) { throw safeError(error); }
  }
}
function scopedIdentity(value: string): boolean {
  return typeof value === "string" && value.startsWith(VOICE_GRANT_IDENTITY_PREFIX) && uuidPattern.test(value.slice(VOICE_GRANT_IDENTITY_PREFIX.length));
}
function validUuid(value: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new VoiceGrantError(400, "VOICE_GRANT_INVALID_REQUEST");
  return value.toLowerCase();
}
function validRoom(value: string): boolean { return typeof value === "string" && /^[\x21-\x7e]{1,255}$/u.test(value); }
function validNow(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new VoiceGrantError(400, "VOICE_GRANT_INVALID_REQUEST");
  return value.toISOString();
}
function publicGrant(value: StoredGrant): VoiceScopedGrant {
  return { identity: value.identity, grantId: value.grantId, callId: value.callId, room: value.room, appKey: value.appKey,
    installationKey: value.installationKey, createdAt: value.createdAt, validUntil: value.validUntil,
    ...(value.admissionEpoch ? { admissionEpoch: value.admissionEpoch } : {}),
    ...(value.revokedAt ? { revokedAt: value.revokedAt } : {}),
    ...(value.revocationOperationId ? { revocationOperationId: value.revocationOperationId } : {}) };
}
function safeError(error: unknown) {
  return error instanceof VoiceGrantError ? error : new VoiceGrantError(503, "VOICE_GRANT_STORE_UNAVAILABLE");
}
