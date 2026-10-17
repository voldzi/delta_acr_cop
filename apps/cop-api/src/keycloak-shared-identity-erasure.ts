import { createHash } from "node:crypto";
import type { AccountErasureAdapter, AccountErasureOperationContext } from "./account-erasure.js";
import { readBoundedBody } from "./bounded-upstream.js";
import type { MobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

export const KEYCLOAK_SHARED_IDENTITY_SCOPE = "cop_sim_shared_identity_v1" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface Config {
  issuer: string; clientId: string; clientSecret: string; authorityAccepted: boolean;
  assertCopAccessFenced(actor: AuthenticatedActor, context: { accountKey: string; operationId: string }): Promise<boolean>;
}
interface Checkpoint {
  scope: typeof KEYCLOAK_SHARED_IDENTITY_SCOPE; operationId: string; requestedAt: string;
  identityFingerprint: string; deleteRequested: boolean; completed?: true;
}
const pending = () => ({ status: "pending", remaining: "cleanup_pending" } as const);
/** Explicit whole-identity scope. Never selected by the former COP-only grant.
 * Durable controller calls this LAST, after COP/SIM owner cleanup. */
export function createSharedIdentityErasureAdapter(config: Config, store: MobilityStore): AccountErasureAdapter {
  const issuer = new URL(config.issuer);
  const realm = issuer.pathname.match(/^(.*)\/realms\/([A-Za-z0-9_.-]+)$/u);
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.hash || issuer.search || !realm || realm[2] !== "cop" ||
    config.clientId !== "cop-account-erasure-worker" || !config.clientSecret) throw Error("Invalid shared identity erasure configuration");
  const admin = new URL(`${realm[1]}/admin/realms/${realm[2]}/`, issuer.origin);
  const tokenUrl = new URL(issuer.pathname + "/protocol/openid-connect/token", issuer.origin);
  function owner(actor: AuthenticatedActor) {
    if (actor.authMode !== "oidc" || actor.issuer !== config.issuer || !uuid.test(actor.subjectId)) throw Error("Verified identity required");
  }
  async function token(signal: AbortSignal) {
    const r = await fetch(tokenUrl, { method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-store" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }) });
    if (r.status !== 200) { await r.body?.cancel(); throw Error("IDENTITY_PROVIDER_UNAVAILABLE"); }
    const v = JSON.parse((await readBoundedBody(r, 65536)).toString("utf8")) as Record<string, unknown>;
    if (typeof v.access_token !== "string" || !v.access_token || v.access_token.length > 16384 ||
      typeof v.token_type !== "string" || v.token_type.toLowerCase() !== "bearer") throw Error("IDENTITY_PROVIDER_UNAVAILABLE");
    return v.access_token;
  }
  async function request(subject: string, method: "GET" | "DELETE", bearer: string, signal: AbortSignal) {
    return fetch(new URL("users/" + encodeURIComponent(subject), admin), { method, redirect: "error", signal,
      headers: { authorization: "Bearer " + bearer, "cache-control": "no-store" } });
  }
  async function identity(actor: AuthenticatedActor, bearer: string, signal: AbortSignal): Promise<string | undefined> {
    const r = await request(actor.subjectId, "GET", bearer, signal);
    if (r.status === 404) { await r.body?.cancel(); return undefined; }
    if (r.status !== 200) { await r.body?.cancel(); throw Error("IDENTITY_READBACK_UNAVAILABLE"); }
    const v = JSON.parse((await readBoundedBody(r, 65536)).toString("utf8")) as Record<string, unknown>;
    if (v.id !== actor.subjectId || v.serviceAccountClientId || !Number.isSafeInteger(v.createdTimestamp) || Number(v.createdTimestamp) < 0)
      throw Error("IDENTITY_BINDING_UNPROVEN");
    return digest([config.issuer, v.id, v.createdTimestamp]);
  }
  function bound(cp: Checkpoint, context: AccountErasureOperationContext) {
    if (cp.scope !== KEYCLOAK_SHARED_IDENTITY_SCOPE || cp.operationId !== context.operationId || cp.requestedAt !== context.requestedAt)
      throw Error("IDENTITY_OPERATION_CONFLICT");
  }
  return {
    id: "keycloak",
    async ready() { return config.authorityAccepted && typeof config.assertCopAccessFenced === "function"; },
    async preflight(actor, { signal }) {
      owner(actor);
      if (!config.authorityAccepted) return { ready: false, reason: "adapter_unavailable" };
      try {
        const s = AbortSignal.any([signal, AbortSignal.timeout(10000)]), fingerprint = await identity(actor, await token(s), s);
        return fingerprint ? { ready: true, version: digest([KEYCLOAK_SHARED_IDENTITY_SCOPE, fingerprint]) }
          : { ready: false, reason: "ownership_unresolved" };
      } catch { signal.throwIfAborted(); return { ready: false, reason: "adapter_unavailable" }; }
    },
    async erase(actor, context) {
      owner(actor);
      if (!config.authorityAccepted || !await config.assertCopAccessFenced(actor, context)) return pending();
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10000)]), bearer = await token(signal);
      const key = "keycloak-shared-identity-erasure:" + context.accountKey;
      let cp = await store.transact([], tx => tx.get<Checkpoint>(key));
      if (cp) bound(cp, context);
      const current = await identity(actor, bearer, signal);
      const witness = context.identityPreflightVersion;
      if (witness !== undefined && !/^[0-9a-f]{64}$/u.test(witness)) throw Error("IDENTITY_BINDING_UNPROVEN");
      if (current && witness && digest([KEYCLOAK_SHARED_IDENTITY_SCOPE, current]) !== witness) throw Error("IDENTITY_CHANGED");
      if (!cp) {
        if (!current && !witness) return pending(); // A404 alone is never a recovery witness.
        cp = await store.transact([key], async tx => {
          const previous = await tx.get<Checkpoint>(key);
          if (previous) { bound(previous, context); return previous; }
          const next: Checkpoint = { scope: KEYCLOAK_SHARED_IDENTITY_SCOPE, operationId: context.operationId,
            requestedAt: context.requestedAt, identityFingerprint: current ?? digest(["original-preflight", witness]), deleteRequested: !current };
          await tx.set(key, next); return next;
        });
      }
      if (current && current !== cp.identityFingerprint) throw Error("IDENTITY_CHANGED");
      if (!current && !cp.deleteRequested) return pending();
      if (current) {
        if (!await config.assertCopAccessFenced(actor, context)) return pending();
        cp = await store.transact([key], async tx => {
          const value = await tx.get<Checkpoint>(key); if (!value) throw Error("IDENTITY_CHECKPOINT_MISSING"); bound(value, context);
          if (value.identityFingerprint !== current) throw Error("IDENTITY_CHANGED");
          const next = { ...value, deleteRequested: true }; await tx.set(key, next); return next;
        });
        const r = await request(actor.subjectId, "DELETE", bearer, signal); await r.body?.cancel();
        if (r.status !== 204 && r.status !== 404) return pending();
      }
      if (await identity(actor, bearer, signal)) return pending();
      await store.transact([key], async tx => {
        const value = await tx.get<Checkpoint>(key); if (!value) throw Error("IDENTITY_CHECKPOINT_MISSING"); bound(value, context);
        if (value.identityFingerprint !== cp!.identityFingerprint || !value.deleteRequested) throw Error("IDENTITY_CHECKPOINT_CHANGED");
        await tx.set(key, { ...value, completed: true });
      });
      return { status: "completed", proofId: digest([KEYCLOAK_SHARED_IDENTITY_SCOPE, context.accountKey, context.operationId,
        context.requestedAt, cp.identityFingerprint, "provider404"]) };
    }
  };
}
