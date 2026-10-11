# ADR 0047: scoped voice grants and signaling admission

Status: source candidate; provider/topology/native/production acceptance pending.
Date: 2026-10-11.

## Decision

New Jízda voice grants belong to the verified OIDC issuer, dedicated authorized
party, subject, online-attested per-account installation and canonical call.
A client UUID/header alone is never ownership proof. Successful authenticated
Matrix bootstrap attests an installation; a stable opaque LiveKit identity then
belongs to that installation and call. Existing `csm-mobile` calls keep their
current contract. Unlink does not remove the common COP account.

The ledger uses the existing persistent COP store and a domain-separated HMAC
with the existing LiveKit server secret. It stores neither raw OIDC subjects nor
installation UUIDs, credentials or media encryption keys. Configuration changes
and lost markers fail closed. Signing a token rechecks the durable admission
fence; app/installation revocation is serialized against grant issuance.

A separate signaling gateway checks reserved scoped identities on every join
and rejoin. The provider may refresh JWTs; their stable signed participant/room
binding remains the authority. Self-hosted provider participant removal alone
does not prevent reuse of a signed token. Gateway coverage must include all four
LiveKit signaling/validation routes and close direct/alternative signaling
ingress. The same SFU retains cross-app calls and legacy signed identities.

Every dispatched scoped handshake is persisted before forwarding. HTTP101,
stream closure, elapsed time, an empty inventory or gateway restart cannot prove
remote quiescence. Completion requires a recognized positive Join/typed Reconnect,
verified `signal_relay.connect_attempts: 1`, no admission retry, successful exact
provider removal and subsequent absence. Unknown dispatch stays pending. A
durable proof of a completed participant cleanup permits safe idempotent retry.

Fresh grants and completion proofs bind the currently active accepted gateway
epoch. Intake requires accepted topology/single-attempt flags and a matching
active persisted epoch. If either acceptance becomes false, the marker becomes
inactive; a later acceptance creates a new epoch. Older/reused grants are never
backfilled and old checkpoints do not provide proof in the new epoch. A grant
issued in the current accepted epoch with no dispatch can complete with verified
provider absence. Historic acknowledged grants with removal404 remain pending
until a separately accepted reconciliation proves provider quiescence.

The gateway has one continuously monitored primary PostgreSQL session owner.
Lease loss closes connections and ends ownership; it never reconnects/adopts an
old owner's in-memory connections. Persistent unresolved dispatch evidence
survives restart. Provider and ownership outages are503, never user403.

## Contract and release boundary

JSON OpenAPI documents `x-cop-installation-id`, optional
`media.participantIdentity`, installation revocation and the separate gateway
paths. An installation receipt is200 only with provider proof;202 means durable
join denial with provider verification pending. No account deletion is implied.
The `joinDenied` field describes the durable COP admission fence; with
`providerVerified=false` it does not claim proven production SFU enforcement.
Internal control uses a short-lived existing LiveKit service JWT bound to the
exact request body. Browser-selected identity, role or app is never authoritative.

New intake and provider completion acceptance default tofalse. The separate
gateway defaults tolocalhost and is not started by the normal COP API. No
production secret, network topology or deployment is changed by this candidate.
Accepted ledger/fences and maintenance must survive an intake rollback.

Legacy Matrix/push/live grants require provider ownership evidence; prefixes,
UUIDs, apparent age and account names cannot migrate them to Jízda ownership.
Unknown grants keep unlink pending. Whole-account cleanup across all11 domains,
moderator process and physical device acceptance remain separate release gates.
See [integration45](../integration/45_JIZDA_VOICE_GRANTS_AND_LEGACY_MIGRATION.md).
