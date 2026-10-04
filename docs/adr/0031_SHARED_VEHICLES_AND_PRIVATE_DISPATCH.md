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

No capability is true until durable storage, email delivery, crypto and authorization
checks are ready. Dependency failures are 503, conflicts409, expired invitation410,
quota429, inaccessible objects404. No SIM fallback, arbitrary transport or generic
credential exposure. Public Swift DTO/facades are purpose-scoped and account-bound;
Jízda remains responsible for its explicit consent UI and physical acceptance.
Retention: audit/vehicle history retained for the active shared vehicle; cancelled
vehicle data purged after30 days, invitation secrets hash-only and expire7 days,
delivery outbox removed after delivery/expiry. Account-level deletion needs an
explicit authenticated request and cannot erase other authors' records. Private
Dispatch latest ciphertext expires180sec; old session metadata retained30 days.
These policies must be verified against actual DB/backups before release claims.
