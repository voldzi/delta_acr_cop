# 43. Whole COP account removal — current completion evidence

Source work: 2026-10-14. Production still runs accepted image
`sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f`,
application source `b13fbdc71f3d9821f8b857c3f73255a75c46fa76`.
Read-only SSH and runtime validation succeeded: healthy, zero restarts, profile
`206c4507-5e00-458e-b0ee-4061309aa7a8`, generation
`7a351c5cb66e45cdbb845a76206fc282`. This source work is not yet deployed or
activated. No real account was deleted.
Earlier imports and vehicle-subset gates are [archived](../archive/2026-10-13_ACCOUNT_SAFETY_SOURCE_GATES.md);
they do not establish this candidate or live erasure.

## Authority and scope

The human requested completion with SIM and deployment after verification on
14 October. SIM's old proposal-only instruction is superseded. The human also
approved its concrete erasure operations/limited permissions and daily cost
carry-forward without user linkage until the end of the current UTC month,
expiring after reservations settle at the start of the next month. This is not
an anonymity claim or approval of other retention, broad rights, live restoration
or deletion of a real test account. SIM independently received its direct confirmation and resumed implementation.
Earlier automatic-review scope rejection is superseded; no rejected action was
bypassed. Independent native/provider acceptance remains a separate gate.

The approved vehicle policy remains: delete own contributions/personal links,
preserve other authors' records, transfer active owned vehicles to a distinct
existing authorized member first. No automatic reassignment or blanket financial
exception. Unresolved shared group ownership or cross-author dependencies block
before a permanent fence. See [ADR 0052](../adr/0052_APPROVED_SHARED_VEHICLE_ERASURE_POLICY.md).
The existing `csm-mobile` one-account login is preserved. Chat, BYOK activation,
measurement intake and live ETA policies are not changed. Approved reporting
retention stays `cop-communication-retention-90d-30d-180d-v1`, contact
`podpora@zeleznalady.cz`.

After finding the shared `csm-sim-web` realm client, the human explicitly chose
to delete COP/Jízda while preserving the account and access to SIM. The Keycloak
owner therefore revokes only the approved COP application grants; it must never
delete the realm user, globally log out SSO sessions, or alter SIM/realm roles.
The canonical confirmation explains this scope. COP's permanent fence denies
old COP tokens independently of retained SIM identity. No real account was
changed to test this policy.

## Controller and browser

All eleven owners remain mandatory. Missing/unknown/unavailable owner evidence
keeps capability false and creates no new fence. HTTP202 is pending; confirmation
HTTP200/accountDeleted=true requires every actual cleanup/readback proof.
Signed auth_time must be no older than300seconds. A300-second operation-bound
plan and read capability precede confirmation; the capability is hash-only at
rest and delivered to web in a scoped Secure/HttpOnly/SameSite=Strict cookie.
The browser stores only its operation UUID in session storage, never a principal
or capability in URLs/storage. Exact receipt GET remains readable after login
removal. Its30-day technical validity is not a personal-data retention policy.

The controller uses scope-bound configuration version3; old version2 is not
adopted. Preflight and receipt require `deletionScope=
cop_jizda_preserve_shared_identity_sim` in the new browser. The new
`COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED` defaults false and never reuses old
identity-delete acceptance. See [ADR0053](../adr/0053_COP_ERASURE_PRESERVES_SHARED_SIM_IDENTITY.md).

New private `/account/delete` does not mount the map/producers. It shows account,
scope, blockers, an unchecked confirmation, pending owners and final receipt.
Lost confirmation responses recover the same operation. Local browser credentials
clear after confirmed revocation; another phone's local deletion is not implied.
Service worker never supplies the cached map shell for this page. Analytics
rejects its page/API/receipts. Account-safety API offers the URL only when actual
deletion is ready.

Content reassessment and first global fence share actual writer admission locks.
Mobility local impact is compared inside the exact global-store transaction.
Lock order is content then global store; remote cleanup runs outside admission.
Queued writes and ownership created after initial preflight cannot slip through.

## Actual local owner source

- Sessions/profiles: every primary/fallback, exact issuer/subject and alert acks.
- Devices/pairing/mesh: immutable internal issuer, same-transaction permanent
  fences, purge/readback; provenance omitted from public DTOs. Confirmed denial
  is403, unknown/outage503; no replacement RAM store after guard acceptance.
- Voice: actual signed JWT expiry recorded before every response plus final
  actor/recipient check. LiveKit removes only exact participant and reads back.
  Unused grants still require waiting through maximum3,600seconds+30seconds
  then repeated removal. Current disabled voice is not historical zero proof.
- RAM/derived copies: actual per-state guarded collections, generation-bound
  account cache, SQL projection fences, private ownership witnesses and hydration
  without adoption. AI index/vector copies, queued writes and manual notification
  flights require actual settlement and readback. Concrete local cache ports are
  bound to the actual Situation, Safety, TAK and SIM Search instances before
  producers start. They clear reconstructible copies and wait for actual older
  fetch/body promises; timeout or cancel invocation alone is not settlement.
  Reference scans are denial checks and never assign authorship. Unknown source
  subclasses or missing external-stream owner keep readiness false. Local cache
  clearing does not acknowledge remote SIM/TAK or subscriber deletion.
- Mobility/Dispatch: routes/outbox/owner share exact guarded service. Identity,
  invitations, own records and cross-account caches are purged. Provider manifests
  survive local deletion. Claim+handoff check global fences. Future notices carry
  verified inviter identity; historical pilot attribution stays unresolved.
- Moderation: actual local evidence/reports/operations/rates and deleting-actor
  links in surviving reports are purged/read back. Matrix blocks belong to Messaging.
- Content: guarded community/sketch/incident stores, immutable provenance and
  original/derivative manifests. S3 erasure requires actual upload settlement before and after DELETE, plus
  repeated absence readback. URL expiry/HEAD404 alone are insufficient; default
  production readiness remains false without a real settlement owner. Unknown
  writes/versioned buckets remain pending. Projection owners are required.
- Keycloak: dedicated server authority and exact HTTPS realm/client identity.
  Scoped COP grants/repeated readback and an identity-generation checkpoint;
  shared SIM user and sessions are preserved. Unsupported scope, incorrect or
  service identity, false acknowledgement or generation change cannot complete.
  It runs last; no global user DELETE/logout is permitted by the selected policy.

## Actual external/production gates

SIM published implementation is frozen at
[`68e96e7`](https://github.com/voldzi/delta_acr_sim/tree/68e96e7ec19cbbd99b08c0eac865016082521186).
Its 586 application tests, 40 actual PostgreSQL18.3 cases and 62 contract cases
passed; six unrelated legacy PostgreSQL cases were skipped in the unit run.
Typecheck, build and skeleton passed. It is not deployed: actual independently
owned per-principal admission/drain/commit and completed-history restore replay
are still required. A healthy runtime or signed TTL document cannot replace
those operations. COP strict adapters use dedicated server-only erasure origins
and credentials, actual existing-alias review and complete retained/outbox/key
inventory; no normal Router token fallback or guessed retained-day completeness.
Exact existing Router aliases, all retained measurement days/key versions,
scoped readiness and actor preflight must be accepted; health is insufficient.
No OpenAI call is needed for erasure tests.
Messaging published source
[`ee3b464`](https://github.com/voldzi/csm_messaging/tree/ee3b4641962bf1a72e3709074d1ccc8a69e0ac44)
adds strict whole-owner v2, targeted mobility effects and actor namespace scope.
166 isolated tests, production compilation without warnings and binding
validation (six paths/nine schemas/33 references/13 negative cases) passed.
COP adds a strict server-only adapter; 70 targeted controller/HTTP cases passed.
Both preflight versions include the independently verified scopeVersion, so
namespace changes invalidate the confirmation plan even if provider readiness
version stays constant. Actual native resolver, Matrix
identity/devices/keys/media, protocol retention and restore acceptance remain
required; published source is not a production proof.
The new actor-specific scope boundary additionally requires an actual native
`cop_jizda_exclusive` witness for Matrix, notifications, conversations, devices
and policy metadata. Shared/unknown/matrix-only bindings block before the first
permanent provider fence. The exact scopeVersion is pinned in that fence and
rechecked through cleanup/readback. A changed scope stays pending; it never
authorizes global deactivation. COP exposes separate typed configured-owner and
actor-scope verifier ports; absence is unavailable, with no env boolean shortcut.
Local SQL/cache removal cannot stand in for external subscribers/copies.

Production safe metadata readback: no effective erasure secret/storeID/runtime
binding, dedicated Keycloak authority, explicit LiveKit admin URL or moderation
evidence config. No secret values were printed. Native guard binding, old-image
rollback rejection and restore quarantine/replay remain required; env labels
alone are not proof. Activation also requires OIDC-only account authentication
and an explicitly disabled lab token; current hybrid/lab compatibility cannot
prove all account writers fenced. No production authentication change was made.
Human-confirmed Proxmox off-server/X5 backup coverage is
accepted, but is not account erasure/replay acceptance. Do not ask again for a
backup-point identifier to repeat that confirmation. See [runbook25](../runbooks/25_ACCOUNT_SAFETY_GUARD_BINDING_PROPOSAL.md).
Keycloak's discovered shared realm has been resolved by the explicit COP-only
human policy above; its narrowly scoped authority still requires acceptance.

## Verification / release

Final verification on 2026-10-14:

- Full suite: **2,366 passed, zero failed, eight skipped**, 243 test files.
  Skipped cases use seven separate legacy test database configurations (profile,
  driver consent, mileage, mobility, receipt details, vehicle audit and safety
  notification). New account-erasure PostgreSQL/PostGIS and signed HTTP cases
  ran on the isolated actual database without skips.
- The actual local erasure lanes cover PostgreSQL17/PostGIS3.5 and a separate
  PostgreSQL18.3 cluster. Fences, late writes, immutable provenance, duplicate
  publication, recovery and the unaffected second user are exercised.
- The complete unit/contract/HTTP suite includes scoped Keycloak18, provider
  cache93, new actual four-instance server wiring/503 cases, strict SIM HTTP
  adapter37 and changed Messaging namespace impact. Counts overlap and must
  not be added to the full suite count.
- API/web typecheck, all changed code ESLint, skeleton,11 JSON schemas,
  OpenAPI JSON and generated YAML passed. OpenAPI retains24 existing warnings.
- All16 workspace builds passed. Bundle budgets, actual local static-runtime
  smoke and public-demo analytics release/privacy checks passed. Vite retains
  its existing Cesium large-chunk advisory; the separate bundle budget passed.

The final machine-readable source/test boundary is
[testing/account-erasure-20261014.json](../testing/account-erasure-20261014.json).
Provider mocks do not establish actual provider permissions, root resolver
coverage or production account removal. Actual shared SIM login/refresh after
scoped revoke, physical whole-account use, native restore quarantine and
completed-history replay acceptance remain unverified. No real account was
used or removed; no OpenAI call was needed.

Deploy reviewed immutable source with intakefalse first. Activate only after
actual two-synthetic-account owner/readback/restore acceptance and native binding
of exact source/image/store. After first accepted deletion preserve keys/fences/
checkpoints through rollback. Never run an old unguarded binary or expose restored
services before replay. No actual account erasure/production activation is claimed.
