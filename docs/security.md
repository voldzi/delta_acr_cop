# Security

The reviewed general AI endpoint uses server-owned fixed questions and an
empty `internal_minimized` context. It never derives external prompts from
chat messages, user questions, incident records or attachments. The SIM
Router's disabled-by-default class gate, service token, budget and audit remain
required. Arbitrary chat content stays on the local-only path.

This is the standard security entry point for COP. Detailed security
documentation remains in:

- [Security index](security/00_INDEX.md)
- [Security architecture](security/01_SECURITY_ARCHITECTURE.md)
- [RBAC/ABAC](security/02_RBAC_ABAC.md)
- [Identity and access](security/03_IDENTITY_AND_ACCESS.md)
- [Source and device identity](security/04_SOURCE_AND_DEVICE_IDENTITY.md)
- [Audit](security/05_AUDIT.md)
- [MDM/MAM endpoint trust](security/06_MDM_MAM_ENDPOINT_TRUST.md)
- [Continuous ATO](security/07_CONTINUOUS_ATO.md)
- [Threat model](security/08_THREAT_MODEL.md)
- [Integration risk register](security/09_INTEGRATION_RISK_REGISTER.md)

Operational rule: do not commit secrets. `.env.example` contains placeholders
only; real secrets are configured outside the repository.

Jízda traffic measurements are disabled by default. The COP API derives a
day-scoped pseudonym and stable user-scoped retry IDs only from an authenticated
OIDC subject, and it attests consent from durable server state. The mobile
client never receives the SIM service token. Raw GPS is forwarded only to the
internal SIM endpoint, is not persisted by COP, and a failed SIM call has no
direct fallback. Revocation blocks new uploads before asynchronous SIM deletion;
pending deletion blocks regrant. See
[ADR 0033](adr/0033_CONSENTED_JIZDA_MEASUREMENT_BOUNDARY.md).

Community media rule: an attachment access update is owner-only, validates the
requested users and groups, and produces an audit event. Public list and map
responses expose only the audience and bounded counts; raw ACL subject/group
identifiers are returned only to the owner. Media content authorization is
evaluated on every request, so an older content URL cannot bypass a later
revocation. Stable idempotency keys prevent retries from creating duplicate
reports or attachments and reject conflicting reuse.

Community confirmation rule: confirmation is authenticated, scoped to an
active readable report and stored as one replaceable value per actor and
report. Public responses expose only aggregate counts, confidence and the
current actor's own value; they never expose the identities of confirming
users. Every change produces a bounded audit event. Expired, draft, resolved
or otherwise inactive reports cannot receive new confirmations.

Client-side chat rule: COP Chat may keep a per-device, per-room last-known
readable Matrix timeline cache in browser storage so the PWA does not degrade
already displayed E2EE messages to undecryptable placeholders after restart or
sync refresh. This plaintext cache stays on the user's device/browser origin and
is not sent to COP API; Matrix access tokens, recovery keys and room keys remain
out of logs, commits and server-side COP storage.

Pending encrypted room events stay in the Matrix SDK timeline until decryption
succeeds. They are excluded from message bubbles, chat previews and local
readable-history storage so a crypto diagnostic is never attributed to a human
sender. An active device crypto session may send new E2EE messages while key
backup recovery is pending; the recovery warning remains visible because older
history may still be unavailable.

Voice-call rule: COP API authorizes a call only for a canonical direct
conversation containing the authenticated actor and exactly one other active
member. The durable call record and revision are authoritative. Clients cannot
choose an arbitrary recipient, transition another user's call or reuse a
credential for a different call.

LiveKit credentials are issued server-side, expire quickly and grant join,
publish and subscribe only in `cop-call-<callId>`. COP derives a stable
call-scoped media encryption key from the independent
`COP_VOICE_CALL_E2EE_SECRET`; web and native clients enable LiveKit E2EE before
joining. Neither that deployment secret nor a call key enters the durable call
record or logs. The LiveKit API secret, PushKit tokens, Matrix credentials and
chat content never enter the call record. CSM Messaging receives only bounded
lifecycle metadata for incoming, ended and missed notifications.

CallKit actions map to revision-checked COP API transitions. After foreground
restore, clients fetch the server record rather than trusting local UI state.
There is no hidden web media process or Matrix VoIP compatibility path in COP
Mobile. Group calls and arbitrary participant invitations are not supported.
See ADR-0019.

Matrix credential renewal for the same user and device updates only the active
client access token. It does not recreate or clear the Rust crypto store. Full
session replacement is generation-guarded and limited to identity/device change,
logout or explicit account-store recovery as recorded in ADR-0014.

A targeted browser-device repair rotates only that browser's Matrix device id
and creates a separate Rust crypto store. It preserves the previous store and
does not reset account-wide recovery metadata or other devices. The sealed
recovery key remains scoped to Matrix user and homeserver; direct database
deletion of Matrix one-time/fallback keys is not an approved repair path.

The LiveKit deployment can observe call membership, timing, IP addressing and
encrypted media transport metadata, but cannot decrypt call media. It receives
no Matrix room keys or chat content. Its public WSS and media ports, API keys
and retention policy belong to the audited production infrastructure boundary.

## Webové přihlášení (BFF)

Produkční COP může používat serverovou BFF relaci (`COP_WEB_BFF_SESSION_ENABLED=true`). OAuth kód se vymění pouze v COP API a přístupový i obnovovací token zůstávají šifrované v PostgreSQL. Prohlížeč pracuje pouze s relací v cookie `Secure`, `HttpOnly`, `SameSite=Lax`; tokeny proto nejsou dostupné skriptům stránky ani rozšířením prohlížeče. Relace nelze spustit bez databáze a tajného `COP_WEB_SESSION_SECRET` o minimálně 32 znacích.

Driver confirmation support excludes the original reporter's own vote. Counts
represent distinct authenticated subjects, not proof of distinct physical
people. The heuristic is not calibrated truth or authorization for a closure.
No road closure or automatic reroute is created from these confirmations.

## Vlastní AI klíč uživatele (připravená větev)

Při zapnutí `COP_AI_CHAT_BYOK_ENABLED` je COP API pouze průchodem pro vložení
a odebrání klíče. Nepíše jej do profilu, auditu ani odpovědi. Identitu uživatele
odvozuje z přihlášené relace a Routeru ji předává jako krátkodobé HMAC podepsané
tvrzení. SIM Router klíč ukládá šifrovaně a odděleně podle stabilního
neprůhledného ID uživatele.
Samotné vložení klíče nepovoluje odeslat dešifrované zprávy, nepřijatá hlášení
ani interní incidenty externímu modelu. Pravidla a podmínky aktivace uvádí
[ADR 0031](adr/0031_USER_FUNDED_AI_CHAT_CREDENTIAL_STAGING.md).
Při `COP_AI_CHAT_BYOK_ROUTING_ENABLED` se externě předává výhradně přesně
napsaná otázka; automatický kontext se zatím neposílá. Chyby nemají přímý ani
sdíleným klíčem placený fallback.

The immutable routing boundary forwards only typed trip fields and authenticates through the existing COP session. Request/applied/geometry hashes bind every variant; no emergency-access downgrade or fallback may discard mandatory requirements. Public errors do not expose private upstream endpoint or content; trip/GPS bodies are not logged or persisted by this boundary. Activation of real driver measurements is separate.

Routing verifies the signed OIDC/BFF actor before forwarding and never logs or forwards bearer tokens: [routing identity boundary](integration/23_JIZDA_ROAD_TRIP_CONTRACT.md#authenticated-identity-boundary).

Shared mobility owns a separate PostgreSQL domain and active-only private roster.
No public/pending community member receives private data. Receipt replay is scoped
to account plus operation fingerprint; old operation tombstones reject reexecution.
See [ADR0031](adr/0031_SHARED_VEHICLES_AND_PRIVATE_DISPATCH.md) for authenticated
recipient encryption, key-directory trust, consent invalidation and real retention.
No request body/GPS/key value is serialized into diagnostics. Coordinates are never
persisted in server SQL or sent to SIM; only latest ciphertext exists in RAM.

## Dispatch ownership recovery boundary

Dispatch verifies an exclusive session advisory lock on the database primary.
Private requests are fenced by a local lease generation before/after work and
transaction callbacks; obsolete responses and late point writes fail503.
Lease loss clears all in-memory point ciphertext; acquisition invalidates
previous share metadata before ready. Recovery grants no new consent and never
restores positions. Shared vehicle/account authorization remains independent.
Lease diagnostics contain only state and generation, never DSNs, tokens,
account identifiers or location payloads. Availability metadata is not an ACL
or permission to resume collection.

## Invitation alert boundary

Atomic durable recipient-bound jobs, current verified email/ACL checks, fixed
generic APNs text and fresh account/inbox validation prevent push links from
granting access or GPS consent. Unknown emails are not disclosed and later
registration receives inbox-only delivery. No location or private names appear
in alerts. See integration/35_MOBILITY_INVITATION_NOTIFICATIONS.md.

Own avatar writes decode/re-encode bounded images without metadata and use verified OIDC ownership; [self-profile boundary](integration/36_COP_SELF_PROFILE.md).

Shared receipt details retain existing vehicle/cost ACL and prohibit structured GPS; older incomplete edits are rejected. [Boundary](integration/38_SHARED_VEHICLE_RECORD_DETAILS.md).

Shared odometer snapshot exposes only kilometer value/date/source-record reference to readVehicle members. Original cost payloads, notes and authors remain separately protected; no GPS or automatic private history transfer is added. See [handoff39](integration/39_SHARED_VEHICLE_ODOMETER_SNAPSHOT.md).

Completed shared rides expose coarse distance/time/author to existing readVehicle members, without GPS traces/destination/passengers. Current membership and role remain strict for commutative insert; owner-only initial seeding and readCosts boundaries remain enforced. See [handoff40](integration/40_SHARED_VEHICLE_COMPLETED_RIDE_MILEAGE.md).

Shared owner binding is authenticated owner-only, independent of name/plate; profile changes require owner and cost audit remains readCosts gated. See [integration41](integration/41_SHARED_VEHICLE_PROFILE_AUDIT_RECOVERY.md).
