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

Shared vehicle records use account ownership/authorship, not an automatically
accepted company retention category. Preserve other authors' records; present
transfer/removal choices for owned resources and define any minimal retained
business facts explicitly before activation. No new retention period or blanket
shared-history exception is invented. See [plan 42](42_COP_ACCOUNT_REMOVAL_PLAN.md).

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

Final COP P1 source gate: 165 synthetic/regression tests passed, 4 real PostgreSQL tests skipped because COP_ERASURE_TEST_DATABASE_URL was not configured. Typecheck, scoped ESLint, JSON schema validation, binding OpenAPI lint (24 existing warnings), generated YAML, skeleton and diff validation passed. The gate includes the actual buildServer BFF outage path (503 preserves session/cookie), signed bearer/JWKS/service-auth, mobility-off guard/retention wiring and registered pool checks. Six cases against a real local loopback HTTP OIDC fixture cover expired-token refresh with rotation, 503 recovery, changed issuer/subject, purge during refresh, confirmed fence and callback 503. Verified rotated credentials are saved only into the existing same-owner session; an unavailable guard grants no API access. Callback 503 preserves any prior session but creates no new one and consumes the one-use transaction. No real provider, database, production deployment or physical erasure acceptance was performed.
