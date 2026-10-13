# 43. Common-account safety and erasure — current source gates

Status on 2026-10-13: the four source commits ending at
`6b6d80ce8b7975375d12e2b90ec0e3575d114644` are integrated onto the accepted
a06 application source `b13fbdc71f3d9821f8b857c3f73255a75c46fa76` and its current
immutable deployment documentation. This change is not a production deployment.
It creates no secrets, roles, network link, data deletion or activation. Source
integration preserves service authorization, registered PostgreSQL pool
factories, consent transaction routing and immutable deployment operations.

The earlier completion/provisioning plan and its executed test counts are
[archived](../archive/2026-10-11_ACCOUNT_SAFETY_COMPLETION_CANDIDATE.md).
They are not current-merge or real-provider evidence.

## Identity and clients

Jízda uses its existing `csm-mobile` account and one login entry in Já. The
published shared SDK `85d79966a4674f4888f57ff022e219b4c65a8953` includes authentication-only
startup and explicit local host consent. Voice/host integration remains separately
accepted. A new dedicated OAuth client has not been authorized; no provisioning
manifest is included. Future server installation PoP grants are planned, not
accepted. Local off is not server unlink or whole-account deletion.

The imported optional installation headers/old unlink DTOs remain compatibility
source behind disabled configuration. They neither prove that a common-client
request came from Jízda nor authorize adopting an unknown Matrix device. See
[integration 41](41_JIZDA_SCOPED_DISCONNECT.md).

Measurement replies remain `shadow_only`. Own consent GET/DELETE cleanup must
stay available after disabling producers; no consent is automatically granted
and no old queue is uploaded by login. The cleanup-client list defaults to the
existing `csm-mobile`; no dedicated-client migration is performed.

## Reports, blocking and approved retention

Prepared `cop-account-safety-v1` includes verified targets, stable idempotency,
canonical Matrix block state, own receipts and moderator operations. Report
evidence is only explicitly selected/confirmed text, at most 4096 UTF-8 bytes;
no history, GPS or transcript is automatically attached. The contact is
`podpora@zeleznalady.cz`. Policy
`cop-communication-retention-90d-30d-180d-v1` enforces evidence expiry at
`min(created+90days, firstclosure+30days)` and audit without text by 180 days.
Block state lasts until unblock or account deletion. These already approved
durations are not changed by integration.

Reads/retries and startup/60-second nonsimultaneous maintenance enforce the
policy. Intake off retains maintenance, accepted blocks, existing receipts,
idempotent retry, unblock and moderation. Missing or mismatched evidence-key
configuration cannot silently take over a saved marker. Content-free own
receipts/HMAC links remain; account-erasure handling and backup replay need
their actual owner adapter. They are not asserted anonymous.

Remaining production gates: moderator role and accepted operating/filtering
process, evidence-key lifecycle, verified provider policy/push/call readback,
multiple-device tests and physical native acceptance. An `action_taken` receipt
does not itself redact content or ban an account. Already issued LiveKit JWTs
and active audio are not claimed revoked.

## Whole-account erasure

`cop-account-erasure-v1` is a separate explicit operation. Actor-aware preflight
and confirmation require signed `auth_time` no older than 300 seconds, not
refreshed `iat`. A positive preflight issues a hash-only operation-bound read
capability before the permanent fence. The additive exact capability GET remains
readable after BFF/OIDC removal; legacy authenticated read is unchanged. The
strict v1 receipt/body remain unchanged. Plans last 300 seconds and read grants
30 days as technical validity, not personal-data retention. Readiness and
actor-specific provenance checks require all actual domains before accepting the first
request; missing adapters return 503 without a new fence. After acceptance,
durable checkpoints/fences survive restart and disabled intake. HTTP 202 and
nonempty remaining mean pending, not deleted.

The source factory currently connects only the actual
`cop_sessions_profiles` adapter. It removes provably owned BFF sessions, every
configured profile store and alert acknowledgements; unknown historical
issuer ownership remains pending. The other ten adapters are absent:

- `keycloak`;
- `cop_devices`;
- `messaging_matrix`;
- `voice_livekit`;
- `cop_content_media`;
- `mobility_dispatch`;
- `sim_measurements`;
- `ai_router`;
- `moderation_audit`;
- `backup_restore`.

The current published Messaging source `d61e632eed069a888b5e91b0bf02fb7d6cad7782`
adds bounded account/device lifecycle jobs alongside selective device cleanup.
It remains source-only disabled; v1 whole-account receipts are always HTTP 202
pending with wholeAccountErased=false. Actual Synapse/version/admin HTTPS, store
identity, restore replay and shared/retained identity policy remain unverified.
It is not a completed COP provider adapter. No absent domain is represented by a synthetic completed
proof. Account deletion capability stays false and its usable URL is absent.

### Approved shared-vehicle policy and local source scope

On 2026-10-13 the human approved deletion of own contributions and personal
links, preservation of other authors' records, and an actual transfer of every
active owned shared vehicle to another authorized existing member before
whole-account deletion. This resolves the vehicle policy choice; it authorizes
no automatic reassignment, deletion of other authors' history or new financial
retention exception. A sole owner without an eligible member must resolve the
transfer first. See [ADR 0052](../adr/0052_APPROVED_SHARED_VEHICLE_ERASURE_POLICY.md)
and [plan 42](42_COP_ACCOUNT_REMOVAL_PLAN.md).

The local `SharedVehicleErasureService` source candidate assesses the verified
actor, removes own vehicle records and historical copies, scrubs personal links
from surviving snapshots and invalidates cross-account cached results that
would otherwise expose those records or derived projections. A permanent local
identity/account fence prevents new local vehicle writes and stale receipt
replay. It is deliberately not registered as a completed `mobility_dispatch`
adapter: mobility identity, Dispatch and provider cleanup are separate unfinished
boundaries. The ten missing adapters above, false global deletion capability
and absent usable deletion URL are unchanged.

Unresolved mapping, ownership and record provenance block before a new local
fence. An owner's latest edit of another author's current record cannot be
silently rolled back or retained under the original author's ID to claim erasure.
Current projections use surviving records. Another author's correction/reference
to an owned record blocks cleanup until the dependency is explicitly resolved;
neither that record nor its personal source link is silently rewritten. Every
affected vehicle invalidates prior sync cursors through its membership revision.
An active Dispatch group owner has no approved transfer policy/API
from this vehicle decision. Claimed invitation notifications may be in flight
outside SQL, and current email does not establish all historical invitation or
provider ownership. Those checks remain pending actual owner proof. No
production deletion, deployment, secret or grant is performed.

## Rollout and rollback

Safety, old unlink and account-erasure flags remain false in source defaults.
No production `.env`, database, provider or real account was changed. Future
activation requires an exact reviewed image/contract, actual owner adapters,
isolated synthetic-account acceptance and a separately coordinated rollout.
After use, rollback must preserve keys, policy, fences and checkpoints; restored
services must replay deletion fences before exposure. Proxmox off-server backup
coverage does not by itself establish account erasure or replay completion.

The initial source import used JSON semantic merge, generated YAML and
source/skeleton checks while the shared voice gate was running. The subsequent
COP P1 validation below includes typecheck and targeted tests; it does not
establish production, real-database, provider or physical acceptance. No App
Review submission is authorized by this document.

The new preflight/tracking source is described in [ADR 0051](../adr/0051_ERASURE_PREFLIGHT_AND_RECEIPT_TRACKING.md). Identity cleanup waits for every other owner proof. Accepted workers continue with intake off; fair retries rotate beyond blocked jobs. The independent guard loader and stable-store checks do not establish native old-image rollback enforcement. The current legacy helper remains an explicit blocker, detailed in [runbook 25](../runbooks/25_ACCOUNT_SAFETY_GUARD_BINDING_PROPOSAL.md). The completed source validation below does not activate account deletion.

Current SDK pin 85d79966 also adds a noncreating authentication snapshot and payloadless authentication-change signal over Voice pin 7fbe8878. SDK source/simulator gates were accepted by its owner; this is not proof of the final Jízda host build, physical two-application provider flows, production erasure or account deletion. One existing csm-mobile/COP login remains the integration boundary.

Previous published COP P1 source gate (`9d58cfa`, before the local shared-vehicle component): 165 synthetic/regression tests passed, 4 real PostgreSQL tests skipped because COP_ERASURE_TEST_DATABASE_URL was not configured. Typecheck, scoped ESLint, JSON schema validation, binding OpenAPI lint (24 existing warnings), generated YAML, skeleton and diff validation passed. The gate includes the actual buildServer BFF outage path (503 preserves session/cookie), signed bearer/JWKS/service-auth, mobility-off guard/retention wiring and registered pool checks. Six cases against a real local loopback HTTP OIDC fixture cover expired-token refresh with rotation, 503 recovery, changed issuer/subject, purge during refresh, confirmed fence and callback 503. Verified rotated credentials are saved only into the existing same-owner session; an unavailable guard grants no API access. Callback 503 preserves any prior session but creates no new one and consumes the one-use transaction. No real provider, database, production deployment or physical erasure acceptance was performed.

Current shared-vehicle source gate (2026-10-13): **116 tests passed and 4 opt-in
real PostgreSQL tests skipped**, across 14 files. The 26 new component/race
cases cover actual ownership transfer, exact two-account/issuer isolation,
physical record/tombstone/history purge, unchanged other-author and unrelated
vehicle data, cross-author dependency blocking, expired cached receipts,
cursor invalidation after leaving, writer/retry/restart fences, readback failure,
outage and vehicle-subset versus whole-account status. Actual service tests also
hold a Dispatch publication after SQL commit and fence the sender or recipient;
late RAM writes are rejected. Competing publications obey the 512-point bound;
the unchanged 32-MiB byte ceiling was not separately stress tested. New invitation
emission is prevented after the inviter/recipient fence;
an already captured external send is not claimed cancelled.

API TypeScript build/typecheck, scoped ESLint (9 files), 11 JSON schema files,
binding OpenAPI validation (24 existing warnings), generated YAML, skeleton and
diff checks passed. The OpenAPI change consists only of two descriptions mirrored
in the shared mobility artifact; methods, paths and DTO shapes are unchanged.
The first HTTP-fixture run was blocked by sandbox `listen EPERM` on 127.0.0.1;
the final local-only synthetic run passed with that test permission. The schema
CLI's sandbox-blocked IPC was avoided with the Node import loader. No test
protection, authentication rule or production network boundary was weakened.

No whole-repository web build/full test suite, real PostgreSQL lock/restore,
provider, physical iPhone or production erasure acceptance was performed in this
local phase. The component is not invoked by a public route or production worker.
One existing account/login, the ten missing adapters and disabled whole-account
deletion remain unchanged. SIM currently has approval for contract/proposal only;
this vehicle decision creates no SIM implementation or deployment authority.
