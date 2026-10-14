import { createHash } from "node:crypto";
import type { AccountErasureAdapter, AccountErasureAssessment } from "./account-erasure.js";
import { readBoundedBody } from "./bounded-upstream.js";
import type { MobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

export const KEYCLOAK_COP_ERASURE_SCOPE = "cop_jizda_only_preserve_identity_sim" as const;
const targetClientIds = ["cop-web", "csm-mobile"] as const;
type TargetClientId = typeof targetClientIds[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export interface KeycloakErasureConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Reviewed, scoped service-account authority with complete COP client-role
   * visibility. Acceptance of former whole-identity deletion is insufficient. */
  authorityAccepted: boolean;
  /** Actual durable COP controller fence, bound to this account and operation.
   * Existing JWTs/SSO are not globally revoked to preserve access to SIM. */
  assertCopAccessFenced?(actor: AuthenticatedActor, context: { accountKey: string; operationId: string }): Promise<boolean>;
}
interface UserIdentity { id: string; createdTimestamp: number }
interface ClientIdentity { id: string; clientId: TargetClientId }
interface Role { id: string; name: string }
interface TargetState { client: ClientIdentity; roles: Role[]; effectiveRoles: Role[]; consent?: string; offline: string[] }
interface Snapshot { identity: UserIdentity; targets: TargetState[] }
interface TargetCheckpoint { roleFingerprints: string[]; consent?: string; offline: string[]; grantsRevoked?: true; rolesRevoked?: true }
interface Checkpoint {
  operationId: string;
  scope: typeof KEYCLOAK_COP_ERASURE_SCOPE;
  identityFingerprint: string;
  clientsFingerprint: string;
  targets?: Record<TargetClientId, TargetCheckpoint>;
  completed?: true;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pending = () => ({ status: "pending", remaining: "cleanup_pending" } as const);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("KEYCLOAK_RESPONSE_UNPROVEN");
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 512) throw new Error("KEYCLOAK_RESPONSE_UNPROVEN");
  return value;
}

/** Only COP client grants and direct, non-composite COP client roles are changed.
 * The shared identity, realm/group roles, SIM clients and global SSO survive.
 * Primary contract: https://www.keycloak.org/docs-api/latest/rest-api/index.html
 * UserResource.revokeConsent uses the public clientId, while offline-sessions
 * and client role-mappings use the resolved internal UUID. Consent revocation
 * does not prove all active client tokens invalid; the COP fence is mandatory. */
export function createKeycloakAccountErasureAdapter(config: KeycloakErasureConfig, store: MobilityStore): AccountErasureAdapter {
  const issuer = new URL(config.issuer);
  const realm = issuer.pathname.match(/^(.*)\/realms\/([A-Za-z0-9_.-]+)$/u);
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash || !realm ||
      !config.clientId || !config.clientSecret || targetClientIds.includes(config.clientId as TargetClientId)) throw new Error("Invalid server-owned Keycloak erasure configuration");
  const admin = new URL(`${realm[1]}/admin/realms/${realm[2]}/`, issuer.origin);
  const tokenUrl = new URL(issuer.pathname + "/protocol/openid-connect/token", issuer.origin);
  const requireActor = (actor: AuthenticatedActor) => {
    if (actor.authMode !== "oidc" || actor.issuer !== config.issuer || !actor.subjectId || actor.subjectId.length > 512 ||
      actor.subjectId === "." || actor.subjectId === ".." || /[\u0000-\u001f\u007f]/u.test(actor.subjectId)) throw new Error("Verified owner required");
  };
  const json = async (response: Response): Promise<unknown> => JSON.parse((await readBoundedBody(response, 65536)).toString("utf8"));
  async function token(signal: AbortSignal): Promise<string> {
    const response = await fetch(tokenUrl, { method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-store" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }) });
    if (response.status !== 200) { await response.body?.cancel(); throw new Error("KEYCLOAK_ERASURE_UNAVAILABLE"); }
    const value = object(await json(response));
    if (typeof value.access_token !== "string" || !value.access_token || value.access_token.length > 16384 ||
      typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer") throw new Error("KEYCLOAK_ERASURE_UNAVAILABLE");
    return value.access_token;
  }
  async function request(path: string, method: "GET" | "DELETE", bearer: string, signal: AbortSignal, body?: Role[]) {
    return fetch(new URL(path, admin), { method, redirect: "error", signal,
      headers: { authorization: `Bearer ${bearer}`, "cache-control": "no-store", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function get(path: string, bearer: string, signal: AbortSignal): Promise<unknown> {
    const response = await request(path, "GET", bearer, signal);
    if (response.status !== 200) { await response.body?.cancel(); throw new Error("KEYCLOAK_ERASURE_UNAVAILABLE"); }
    return json(response);
  }
  async function clients(bearer: string, signal: AbortSignal): Promise<ClientIdentity[]> {
    const result: ClientIdentity[] = [];
    for (const clientId of targetClientIds) {
      const query = new URLSearchParams({ clientId, search: "false", first: "0", max: "2" });
      const rows = list(await get("clients?" + query, bearer, signal));
      if (rows.length !== 1) throw new Error("KEYCLOAK_COP_CLIENT_UNPROVEN");
      const row = object(rows[0]);
      if (row.clientId !== clientId || typeof row.id !== "string" || !UUID.test(row.id) || row.protocol !== "openid-connect") throw new Error("KEYCLOAK_COP_CLIENT_UNPROVEN");
      result.push({ id: row.id, clientId });
    }
    if (result[0]!.id === result[1]!.id) throw new Error("KEYCLOAK_COP_CLIENT_UNPROVEN");
    return result;
  }
  function roles(value: unknown, client: ClientIdentity): Role[] {
    const result = list(value).map(value => {
      const row = object(value);
      if (typeof row.id !== "string" || !UUID.test(row.id) || typeof row.name !== "string" || !row.name || row.name.length > 512 ||
        row.clientRole !== true || row.containerId !== client.id || typeof row.composite !== "boolean") throw new Error("KEYCLOAK_COP_ROLE_UNPROVEN");
      // Removing a composite COP role could also remove a SIM entitlement.
      if (row.composite) throw new Error("KEYCLOAK_SHARED_ENTITLEMENT_UNRESOLVED");
      return { id: row.id, name: row.name };
    }).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(result.map(role => role.id)).size !== result.length) throw new Error("KEYCLOAK_COP_ROLE_UNPROVEN");
    return result;
  }
  async function snapshot(actor: AuthenticatedActor, bearer: string, signal: AbortSignal): Promise<Snapshot> {
    const row = object(await get(`users/${encodeURIComponent(actor.subjectId)}`, bearer, signal));
    if (row.id !== actor.subjectId || !Number.isSafeInteger(row.createdTimestamp) || Number(row.createdTimestamp) < 0 || row.serviceAccountClientId) throw new Error("KEYCLOAK_IDENTITY_UNPROVEN");
    const identity = { id: actor.subjectId, createdTimestamp: Number(row.createdTimestamp) };
    const resolved = await clients(bearer, signal), consentRows = list(await get(`users/${encodeURIComponent(actor.subjectId)}/consents`, bearer, signal));
    const consents = new Map<string, Record<string, unknown>>();
    for (const value of consentRows) {
      const consent = object(value);
      if (typeof consent.clientId !== "string" || !consent.clientId || consents.has(consent.clientId)) throw new Error("KEYCLOAK_GRANTS_UNPROVEN");
      consents.set(consent.clientId, consent);
    }
    const targets: TargetState[] = [];
    for (const client of resolved) {
      const base = `users/${encodeURIComponent(actor.subjectId)}/role-mappings/clients/${client.id}`;
      const direct = roles(await get(base, bearer, signal), client), effective = roles(await get(base + "/composite", bearer, signal), client);
      // Extra effective roles come from realm/group/composite inheritance. They
      // cannot be removed without a separate choice affecting shared identity.
      if (hash(direct) !== hash(effective)) throw new Error("KEYCLOAK_SHARED_ENTITLEMENT_UNRESOLVED");
      const offline = list(await get(`users/${encodeURIComponent(actor.subjectId)}/offline-sessions/${client.id}`, bearer, signal)).map(value => {
        const session = object(value), sessionClients = object(session.clients);
        if (typeof session.id !== "string" || !session.id || session.userId !== actor.subjectId || !Number.isSafeInteger(session.start) ||
          Number(session.start) < 0 || sessionClients[client.id] !== client.clientId) throw new Error("KEYCLOAK_GRANTS_UNPROVEN");
        return hash([session.id, session.start]);
      }).sort();
      if (new Set(offline).size !== offline.length) throw new Error("KEYCLOAK_GRANTS_UNPROVEN");
      const consent = consents.get(client.clientId);
      targets.push({ client, roles: direct, effectiveRoles: effective, offline, ...(consent ? { consent: hash(consent) } : {}) });
    }
    return { identity, targets };
  }
  const identityFingerprint = (value: Snapshot) => hash([config.issuer, value.identity]);
  const clientsFingerprint = (value: Snapshot) => hash(value.targets.map(target => target.client));
  const absent = (target: TargetState) => !target.consent && target.offline.length === 0 && target.roles.length === 0 && target.effectiveRoles.length === 0;
  async function save(key: string, operationId: string, update: (checkpoint: Checkpoint) => Checkpoint): Promise<Checkpoint> {
    return store.transact([key], async tx => {
      const previous = await tx.get<Checkpoint>(key);
      if (!previous || previous.operationId !== operationId || previous.scope !== KEYCLOAK_COP_ERASURE_SCOPE) throw new Error("KEYCLOAK_ERASURE_CONFLICT");
      const next = update(previous); await tx.set(key, next);
      const readback = await tx.get<Checkpoint>(key);
      if (JSON.stringify(readback) !== JSON.stringify(next)) throw new Error("KEYCLOAK_CHECKPOINT_UNPROVEN");
      return next;
    });
  }
  return {
    id: "keycloak",
    async ready() {
      if (!config.authorityAccepted || !config.assertCopAccessFenced) return false;
      try { const signal = AbortSignal.timeout(10000); await clients(await token(signal), signal); return true; } catch { return false; }
    },
    async preflight(actor, { signal }): Promise<AccountErasureAssessment> {
      requireActor(actor);
      if (!config.authorityAccepted || !config.assertCopAccessFenced) return { ready: false, reason: "adapter_unavailable" };
      try {
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]), state = await snapshot(actor, await token(bounded), bounded);
        signal.throwIfAborted();
        return { ready: true, version: hash([KEYCLOAK_COP_ERASURE_SCOPE, config.issuer, state]) };
      } catch (error) {
        signal.throwIfAborted();
        return { ready: false, reason: error instanceof Error && error.message === "KEYCLOAK_SHARED_ENTITLEMENT_UNRESOLVED" ? "ownership_unresolved" : "adapter_unavailable" };
      }
    },
    async erase(actor, context) {
      requireActor(actor);
      if (!config.authorityAccepted || !config.assertCopAccessFenced || !await config.assertCopAccessFenced(actor, context)) return pending();
      const key = "keycloak-cop-erasure:" + context.accountKey;
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10000)]), bearer = await token(signal);
      let current = await snapshot(actor, bearer, signal);
      let checkpoint = await store.transact([key], async tx => {
        const previous = await tx.get<Checkpoint>(key);
        if (previous && (previous.operationId !== context.operationId || previous.scope !== KEYCLOAK_COP_ERASURE_SCOPE)) throw new Error("KEYCLOAK_ERASURE_CONFLICT");
        if (previous && previous.identityFingerprint !== identityFingerprint(current)) throw new Error("KEYCLOAK_IDENTITY_CHANGED");
        if (previous && previous.clientsFingerprint !== clientsFingerprint(current)) throw new Error("KEYCLOAK_COP_CLIENT_CHANGED");
        if (previous?.completed && current.targets.some(target => !absent(target))) throw new Error("KEYCLOAK_COP_GRANTS_REAPPEARED");
        const next: Checkpoint = previous ?? { operationId: context.operationId, scope: KEYCLOAK_COP_ERASURE_SCOPE,
          identityFingerprint: identityFingerprint(current), clientsFingerprint: clientsFingerprint(current),
          targets: Object.fromEntries(current.targets.map(target => [target.client.clientId, {
            roleFingerprints: target.roles.map(role => hash(role)), offline: target.offline,
            ...(target.consent ? { consent: target.consent } : {})
          }])) as Record<TargetClientId, TargetCheckpoint> };
        await tx.set(key, next);
        if (JSON.stringify(await tx.get(key)) !== JSON.stringify(next)) throw new Error("KEYCLOAK_CHECKPOINT_UNPROVEN");
        return next;
      });
      if (!checkpoint.completed) {
        for (const target of current.targets) {
          const saved = checkpoint.targets?.[target.client.clientId];
          if (!saved || target.roles.some(role => !saved.roleFingerprints.includes(hash(role))) || target.offline.some(value => !saved.offline.includes(value)) ||
            (target.consent && target.consent !== saved.consent) || (saved.grantsRevoked && (target.consent || target.offline.length > 0)) ||
            (saved.rolesRevoked && target.roles.length > 0)) throw new Error("KEYCLOAK_COP_GRANTS_REAPPEARED");
          if (!await config.assertCopAccessFenced(actor, context)) return pending();
          if (!saved.grantsRevoked) {
            if (target.consent || target.offline.length > 0) {
              const response = await request(`users/${encodeURIComponent(actor.subjectId)}/consents/${target.client.clientId}`, "DELETE", bearer, signal);
              await response.body?.cancel();
              if (response.status !== 204 && response.status !== 404) throw new Error("KEYCLOAK_REVOCATION_UNPROVEN");
            }
            const observed = await snapshot(actor, bearer, signal), readback = observed.targets.find(value => value.client.clientId === target.client.clientId)!;
            if (identityFingerprint(observed) !== checkpoint.identityFingerprint || clientsFingerprint(observed) !== checkpoint.clientsFingerprint) throw new Error("KEYCLOAK_IDENTITY_CHANGED");
            if (readback.consent || readback.offline.length > 0) return pending();
            checkpoint = await save(key, context.operationId, value => ({ ...value, targets: { ...value.targets!, [target.client.clientId]: { ...value.targets![target.client.clientId], grantsRevoked: true } } }));
          }
          if (!saved.rolesRevoked) {
            if (target.roles.length > 0) {
              // Explicit observed id/name list, never null (= delete all) and no
              // browser input. Composite/shared roles were rejected before writes.
              const response = await request(`users/${encodeURIComponent(actor.subjectId)}/role-mappings/clients/${target.client.id}`, "DELETE", bearer, signal, target.roles);
              await response.body?.cancel(); if (response.status !== 204) throw new Error("KEYCLOAK_REVOCATION_UNPROVEN");
            }
            const observed = await snapshot(actor, bearer, signal), readback = observed.targets.find(value => value.client.clientId === target.client.clientId)!;
            if (identityFingerprint(observed) !== checkpoint.identityFingerprint || clientsFingerprint(observed) !== checkpoint.clientsFingerprint) throw new Error("KEYCLOAK_IDENTITY_CHANGED");
            if (!absent(readback)) return pending();
            checkpoint = await save(key, context.operationId, value => ({ ...value, targets: { ...value.targets!, [target.client.clientId]: { ...value.targets![target.client.clientId], rolesRevoked: true } } }));
          }
        }
      }
      // Repeat exact-client/identity readback after all mutations; neither an
      // HTTP acknowledgement nor one stale read is a completed scoped proof.
      current = await snapshot(actor, bearer, signal);
      if (identityFingerprint(current) !== checkpoint.identityFingerprint || clientsFingerprint(current) !== checkpoint.clientsFingerprint) throw new Error("KEYCLOAK_IDENTITY_CHANGED");
      if (current.targets.some(target => !absent(target)) || !await config.assertCopAccessFenced(actor, context)) return pending();
      signal.throwIfAborted(); context.signal.throwIfAborted();
      await save(key, context.operationId, value => ({ operationId: value.operationId, scope: value.scope,
        identityFingerprint: value.identityFingerprint, clientsFingerprint: value.clientsFingerprint, completed: true }));
      return { status: "completed", proofId: hash([KEYCLOAK_COP_ERASURE_SCOPE, context.accountKey, context.operationId, checkpoint.identityFingerprint, checkpoint.clientsFingerprint]) };
    }
  };
}
