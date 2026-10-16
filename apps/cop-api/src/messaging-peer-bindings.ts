import type { AuthenticatedActor } from "./security.js";
import type { UserProfileStore } from "./user-profile-store.js";

/** Private COP -> Messaging attestation. Never accepted as browser authority. */
export interface MessagingPeerBindings {
  contractVersion: "cop-verified-peer-bindings-v1";
  actorUserId: string;
  issuer: string;
  source: "canonical_cop_profile";
  observedAt: string;
  validUntil: string;
  peers: Array<{ userId: string; issuer: string }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export async function deriveMessagingPeerBindings(options: {
  actor: AuthenticatedActor;
  authorityMode?: string;
  configuredIssuer?: string;
  targets: readonly string[];
  store: Pick<UserProfileStore, "name" | "getProfile">;
  ready: () => Promise<boolean>;
  now: () => Date;
  unavailable?: (error: unknown) => void;
}): Promise<MessagingPeerBindings | undefined> {
  const { actor, store } = options, issuer = options.configuredIssuer?.trim();
  if (options.authorityMode !== "database_v2" || store.name !== "postgres" || actor.authMode !== "oidc" ||
      !issuer || actor.issuer !== issuer || !uuid.test(actor.subjectId)) return undefined;
  const targets = [...new Set(options.targets)].filter(id => id !== actor.subjectId && uuid.test(id)).slice(0, 100);
  if (!targets.length) return undefined;
  try {
    if (!await options.ready()) return undefined;
    // The canonical store is the only witness. Missing provenance does not
    // inherit the caller's issuer and never consults the directory RAM fallback.
    const profiles = await Promise.all(targets.map(id => store.getProfile(id)));
    const peers = profiles.flatMap((profile, index) => profile && profile.subjectId === targets[index] && profile.issuer === issuer
      ? [{ userId: profile.subjectId, issuer: profile.issuer }] : []);
    if (!peers.length) return undefined;
    const observedAt = options.now();
    return { contractVersion: "cop-verified-peer-bindings-v1", actorUserId: actor.subjectId, issuer,
      source: "canonical_cop_profile", observedAt: observedAt.toISOString(),
      validUntil: new Date(observedAt.getTime() + 30_000).toISOString(), peers };
  } catch (error) {
    options.unavailable?.(error);
    return undefined;
  }
}
