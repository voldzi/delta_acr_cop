# 41 Jízda scoped disconnect – candidate, not activated

Decision verified in the human Jízda turn on 2026-10-11: **Odpojit Jízdu** only.
Preserve the shared COP account, COP Mobile, Matrix identity, shared history,
vehicles and local Jízda SwiftData. A separately approved whole-account removal
function is described in [plan 42](42_COP_ACCOUNT_REMOVAL_PLAN.md); it is not
called by unlink and is not yet a functioning production flow.

## Identity and public contract

`cop-jizda-link-v1` is in binding JSON OpenAPI. All operations require verified
OIDC and are no-store. No actor, app, device list or provider key is supplied in
the body. COP uses signed `azp`, issuer and subject. `aud`, a bundle string,
headers, language or local profile binding do not prove the calling app.

| Operation | Endpoint | Result |
| --- | --- | --- |
| Capability | GET `/api/v1/me/app-links/jizda/capabilities` | `disconnectAvailable=false` for shared `csm-mobile`, missing separate identity or disabled service. `accountDeletion=false`, `localDataDeleted=false`. |
| Status/recovery | GET `/api/v1/me/app-links/jizda` | `linked`, or receipt of the actor's pending/completed operation. No other actor lookup. |
| Explicit unlink | POST `/api/v1/me/app-links/jizda/disconnect` | Empty body; UUID `Idempotency-Key`. Durable app fence precedes downstream cleanup. 202=`disconnecting`; 200 only=`disconnected` with `remaining=[]`. |

Another operation UUID conflicts (409); recover the original with GET, then
reuse it for retries. An upstream outage returns 503 and leaves the durable
fence intact. Ordinary COP requests from that user's dedicated Jízda client
are denied after the fence, including refreshes of COP-mediated capabilities.
Other COP clients and users retain access. There is no automatic relink or
global logout. An explicit fresh-auth relink protocol must be accepted before
activation if the product offers relinking.

The real candidate cleanup adapter **cannot currently return completed**:
the coordinated Messaging source now removes and reads back exact attested Matrix
devices, while `live_permissions` remains unresolved. Unknown legacy installations
and unproven Matrix ownership additionally remain pending.
A successful APNs cleanup is not full unlink or account deletion.

```json
{
  "contractVersion": "cop-jizda-link-v1",
  "app": "jizda", "scope": "jizda_app_link",
  "operationId": "e6450609-cbe5-4c9c-adfa-598db1d125ef",
  "status": "disconnecting", "requestedAt": "2026-10-11T00:00:00.000Z",
  "accountDeleted": false, "localDataDeleted": false,
  "remaining": ["legacy_installations", "matrix_devices", "live_permissions"]
}
```

## Trusted registrations

When a verified separate Jízda client requests an APNs registration ticket,
COP signs `verifiedAppScope=jizda` and `appClientId` along with the existing
subject, bundle, installation UUID and short expiry. Messaging validates the
configured dedicated client, and derives immutable app/installation metadata
from that ticket. Request-body tags cannot promote a registration. An existing
COP Mobile row cannot be overwritten or promoted into Jízda, and another user's
device cannot be overwritten by a user registration.

Internal service-only POST `/api/v1/communication/jizda-disconnect` uses only
the verified COP-derived `x-csm-user-id`. It atomically disables and scrubs
push secrets only from that user's attested Jízda rows, persists a tombstone
that rejects stale/new Jízda registration retries, and reports whether legacy
rows remain. It neither guesses that unknown rows are Jízda nor modifies COP
Mobile, another user, global Matrix credentials, vehicles or shared history.
Cleanup and push handoff share the recipient lock; queued device snapshots are
rechecked before delivery. Already handed-off APNs cannot be recalled.

`CSM_JIZDA_DISCONNECT_ENABLED` requires communication safety enabled, so the
legacy unregistered push fallback is unavailable. The existing BEAM-cluster lock
is not a lock across unconnected replicas; that scaling gate remains.

## Jízda integration and SDK delta

Public methods: `copJizdaLinkCapabilities`, `copJizdaLinkStatus`,
`copDisconnectJizda(operationId:expectedScope:)`. Keep the operation UUID across
retry; a changed account/scope must discard the old operation. `isComplete`
requires `disconnected` and an empty remaining list. POST transport additionally
binds HTTP 202 to `disconnecting` with nonempty remaining, and HTTP 200 to
`disconnected` with empty remaining; mismatched responses fail. A GET recovery
may return the pending receipt with HTTP 200. Preserve SwiftData.

On explicit confirmation, pause Jízda Dispatch/location/measurement producers
before the handoff. Accepted pending/complete status pauses the local SDK chat
producer and emits process-local `.csmJizdaLinkFenceAccepted` with no identifiers
or content; the host must stop its own Dispatch and measurement queues. On a
503, recover status before resuming anything: the fence may already exist.
Status must also be checked before starting communication/push/voice producers
on cold start. Do not use `SelfProfileCoordinator.detach` as proof of server
unlink. Do not invoke the generic legacy unregister/global sign-out path.

Current Jízda `Jizda/Info.plist` uses `CSMOIDCClientId=csm-mobile` and redirect
scheme `csm`. `DriverMeasurementAdapter.swift:29` also hardcodes csm-mobile.
A separate registered client (proposed ID `jizda-mobile`) and exact app-specific
PKCE redirect must be accepted/provisioned first, then Jízda must deliberately
update these integration guards and sign in again. Do not copy an old refresh
token to the new client namespace. The COP allowlist must accept the new client;
COP Mobile's client and redirect remain unchanged. No Keycloak configuration or
production secret was changed here.

The owned SDK conversation surface now has native metadata report/explicit
excerpt confirmation and direct-peer block/unblock actions. It receives COP
member IDs from the current conversation. It does not infer a peer from a raw
Matrix author, create another chat or automatically attach decrypted history.
Direct blocking hides the local direct-chat surface and discards its pending
drafts; other group members/state remain. Group old-cache filtering, cold-start
canonical block synchronization and cancellation of a previously handed-off
Matrix send queue remain acceptance gates; this candidate does not claim those
complete. Native UI/source parsing is not a native build or device result.

## Plan requiring explicit production approval

1. Accept exact COP/Messaging/SDK revisions and this scope. Provision the separate
   Jízda OIDC client with PKCE and verified redirect; migrate only Jízda's own
   registrations using new signed tickets. Inventory legacy rows without secrets.
2. Bind individual Matrix devices, mobile/Dispatch records and media grants to
   the attested app/installation. Finish scoped revocation and prove that COP
   Mobile's sessions/permissions survive. Do not infer app ownership from ID
   prefixes or globally revoke user-level consent/voice/vehicle data.
3. The human approved exact Xcode27.1 build27A9275; its published verifier passes. Apply
   the minimal SDK delta to a new frozen Jízda snapshot; keep build 1.2 (30)
   unchanged. Complete native tests including cold-start fence and account switch.
4. Assign `cop_communication_moderator` (proposed dedicated realm role) only to
   the actual COP administrator team; verify signed role access/denial. Accept
   evidence-key rotation and moderation/filter process. Approved public contact is
   podpora@zeleznalady.cz; approved report retention is90/30/180days (integration43).
5. Build immutable COP API/Messaging images with existing deployment paths and
   all new flags false. Dedicated evidence-key creation in the production secret
   file, exact client configuration and feature activation need explicit approval.
   No public ports/network/Docker data-root/SIM modifications.
6. Isolated two-user, two-app and multiple-device tests: legacy/forged IDs, lost
   response/retry, registration/push race, real Matrix/media revocation, network
   outage, restart, cold start, SwiftData preservation and COP Mobile regression.
   Only after every cleanup proof passes may unlink return completed/activate.

Rollback before use: prior immutable images, new flags false. After a fence or
block is used: retain enforcement/tombstones/keys and recipient checks; never
roll back by reopening old credentials or loading an unfiltered old backup.

## Verification

Earlier candidate baseline: COP 1,603 tests passed / 8 dedicated-store skips;
Messaging 83 passed; Foundation 18 model/preflight checks passed. These runs
predate the latest encoder/HTTP-status correction. Fresh focused evidence: COP 31, Messaging 9, OpenAPI receipt/reference 9 and Foundation 128
checks passed; seven Swift files parse; the 15 native XCTest cases remain
unexecuted. Exact file hashes are in the current transfer manifest. Xcode 27.1 build
27A9275 / iPhoneOS SDK 27.1 is installed; hardpin requires 27A9269 and was not
changed or bypassed. No iPhone, real Matrix/APNs/LiveKit, global erasure or live
unlink acceptance was performed. No deployment, account reset or real push.

## Completion candidate, 11 October

[Integration 43](43_ACCOUNT_SAFETY_COMPLETION.md) defines the dedicated client,
secure installation UUID, mandatory uncached pre-bootstrap gate and default-off
activation sequence. New bootstrap attestation must wait for Messaging ledger
acceptance. Intake disablement preserves existing COP fences; removing scope
configuration or changing issuer/client requires an approved migration. A source
Matrix proof is not LiveKit revocation or physical acceptance.
