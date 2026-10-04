# ADR 0031: Shared vehicles and private Dispatch

Date: 2026-10-04. Status: accepted contract; implementation and release in progress.
Authorization: human Jízda turn `01a1068c-b105-7503-bbde-2bbe51824d72` explicitly
requests implementation including COP/SIM production delivery. Driver consent
and separate traffic collection are not granted by that authorization.

## Decision

Publish JSON-first additions to existing COP bearer-authenticated API. Private
mobility has its own durable domain, not community public/pending membership,
traffic intake or SIM. A stable random account UUID is mapped uniquely to verified
OIDC issuer+sub; email is an invitation address, never account identity. Verified
email claims are required to accept the matching invitation. Normal PKCE IdP login
provides registration only where the actual IdP login page offers it; availability
must remain unverified until tested. Never accept client emailVerified assertions.

Vehicles are server UUIDs, max owner+four drivers, with explicit capability ACL.
Plate/VIN cannot merge vehicles. No historical/private rides, people or attachments
are imported by vehicle creation. Every mutation has an account-bound operation
UUID, immutable canonical request fingerprint and concrete receipt. Data and
membership revisions are independent; concurrent writes reject stale revisions.
Vehicle records are shared summaries only. Monetary minor units and decimal
quantities are strings, not floating-point sums. Odometer observations/corrections
are explicit; a lower value needs an identified correction and reason. Revisioned
corrections/tombstones keep original authors/audit; departure never deletes another
member's personal rides. Incremental sync filters records by current capabilities.

Private Dispatch has independent active-only groups and explicit per-device
consent, never a public/pending audience. Authenticated device X25519 keys determine
an exact recipient set and audience hash. Readiness requires keys for all current
active accounts. Key/member changes invalidate shares. This trusts COP's
authenticated key directory; it is not independent manual device verification or
a promise of protection against a malicious directory server. Shared map points
use per-recipient X25519/HKDF-SHA256/AES-GCM envelopes with bound metadata.
No coordinate is accepted by the plaintext server API or sent to SIM.

Dispatch ciphertext points are transient RAM-only/latest-only, not database,
audit, logs, backups or Matrix chat timeline. Only account/group/device/share
metadata and revocations are durable. Restart invalidates all existing shares;
never restore consent or points. This first delivery supports a single dispatch
API instance; multi-instance RAM/lease semantics must not be silently enabled.
Recipients hide points after 180 seconds observed age or earlier share expiry.
Sender fixes: actual GPS, <=15 seconds old, future<=5 seconds, >=5 seconds spacing,
monotonic sequence/time; accuracy 0..100 m inside encrypted payload. Server can
verify metadata/ACL, not physically attest GPS origin or hidden accuracy. SDK checks
both before encryption and after decryption. Session lifetime: 900/3600/28800sec,
ride_end max28800sec, explicit stop on ride end. Stop receipts mean confirmed
server removal; offline stop is pending and blocks another share on that device.
A remote offline client cannot be instantly erased; age-hide bounds apply.

## Delivery gates

No capability is true until durable storage, verified-account invitation inbox, crypto and authorization
checks are ready. Dependency failures are 503, conflicts409, expired invitation410,
quota429, inaccessible objects404. No SIM fallback, arbitrary transport or generic
credential exposure. Public Swift DTO/facades are purpose-scoped and account-bound;
Jízda remains responsible for its explicit consent UI and physical acceptance.
Retention: audit/vehicle history retained for the active shared vehicle; cancelled
vehicle data purged after30 days, email-addressed inbox invitations expire after7 days and are purged30 days
after expiry; no bearer invitation secret or SMTP delivery is provided.
Operation response bodies expire after30 days; a retained opaque operation/hash
tombstone rejects old retries with410 rather than applying them again. Account-level deletion needs an
explicit authenticated request and cannot erase other authors' records. Private
Dispatch latest ciphertext expires180sec; old session metadata purged30 days after its expiry.
Cleanup runs at startup and hourly; database backups have their own existing
retention and must not be described as instantly erased. All domain transactions
are serialized using a database advisory lock for this bounded single-instance
pilot. Ciphertext RAM cleanup runs every5sec; serving always rejects age>180sec.
These policies must be verified against actual DB/backups before release claims.


## Authenticated encrypted envelope

The SDK derives AES256-GCM keys from concatenated ephemeral-recipient X25519 DH
and sender-static-recipient X25519 DH (64bytes), HKDF-SHA256 with salt
SHA256(lowercase shareUUID UTF8), info `cop-dispatch-point-v1-authenticated`.
This authenticates the sender against the current COP device directory. Each
recipient gets a fresh ephemeral key and AES-GCM nonce. Combined format is
12byte nonce + ciphertext +16byte tag, base64. AAD is sorted-key compact JSON
without escaped slashes: protocol,groupId,shareId,senderDeviceId,recipientDeviceId,
audienceHash,membershipRevision,sequence,observedAt. UUIDs lowercase; observedAt
is exact UTC millisecond ISO8601 string. The SDK owns ThisDeviceOnly non-syncing
Keychain keys; a session-change notification permanently invalidates its facade.
A fresh facade may register the same device but never restores location consent.
Create/accept return exact operationId,confirmed and assigned vehicle/group.
Owned-share metadata recovery exists only for finding/stopping orphaned starts.

## Timed-out start barrier

`dispatchCancelStart` serializes an account/start-operation cancellation tombstone
against every start transaction. It also stops a committed matching share. A GET
of owned shares alone cannot prove a pending start will not commit later. Clients
persist only operation/share/device identifiers for cancellation recovery, no GPS
or renewed consent, and block a new start until the exact cancellation receipt is
confirmed. Minimal cancellation tombstones are durable across restart and retained
to prevent later replay. Another account cannot cancel a user's operation.

## Existing participant communication

A purpose-scoped participant endpoint checks the current private roster and same
verified issuer, resolves the peer only on the server, and requires an encrypted
E2EE-required direct conversation with exactly the two actual subjects. A wrong
or unbound room fails503. Replay after participant removal fails404. No new group
conversation, group voice or PTT is created. SDK-owned navigation selects the
existing conversation. Explicit direct calls reuse the existing server-authorized
LiveKit/native path; map E2EE does not establish server-blind voice media.
