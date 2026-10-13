# 42 Separate whole COP account removal – implementation/activation plan

Current source integration on 2026-10-13 preserves this separate workflow. The
host uses one existing `csm-mobile` account and explicit local feature consent;
dedicated OAuth provisioning is not authorized. Local feature disable is neither
server revocation nor whole-account deletion. The real factory still connects
only `cop_sessions_profiles`; the other ten domain adapters remain missing.

Human approval in Jízda on 2026-10-11 permits adding a separate **Správa /
odstranění účtu COP** action. It does not authorize testing on a real account,
production deployment, an invented retention policy or global deletion as part
of **Odpojit Jízdu**.

On 2026-10-13 the human approved the shared-vehicle rule: remove own contributions
and personal links, preserve other authors' records, and first complete transfer
of active owned vehicles to another authorized existing member. The policy is
recorded in [ADR 0052](../adr/0052_APPROVED_SHARED_VEHICLE_ERASURE_POLICY.md).
It approves neither production deletion nor a retention exception. The local
`SharedVehicleErasureService` candidate is not connected as the complete
`mobility_dispatch` adapter; all ten missing domain adapters remain required.

## Truthful capability now

No functioning direct production deletion workflow or canonical initiation URL
has been verified/delivered. The candidate account-safety capability returns
`accountDeletion=false`, `accountDeletionUrl=null`,
`accountDeletionUnavailableReason=erasure_adapters_not_accepted`.
Jízda must keep the second row unavailable, or clearly marked as not yet
available; it must not open a generic support page/account console as deletion.
Build 1.2 (30) does not contain these new flows. Do not enable registration/review
claims based on an unlink acknowledgement or merely on a future URL.

Apple requires actual account deletion when account creation is supported;
unlink/deactivation alone is insufficient. If a web step is necessary the app
must link directly to that functioning deletion page, and may explain actual
pending/completed status. See [Apple's guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/).

## Proposed direct flow and boundaries (not deployed)

Proposed COP route: `/account/delete` on the existing canonical COP HTTPS origin.
This is a reserved design path, **not a confirmed working URL**; do not return it
in capabilities until acceptance of the exact live form and backend.

1. A same-origin COP web/BFF form derives the user from its verified session;
   reauthenticate recently with the identity provider (verified `auth_time`,
   not just a newly refreshed `iat`). Preserve origin/CSRF controls. No user ID,
   moderator privilege, arbitrary redirect or identity-provider URL chosen by
   the browser. Native opens only the accepted canonical HTTPS form.
2. Show the shared impact: COP/Jízda/COP Mobile login, shared communications,
   own published content, owned/shared resources and their ownership choices.
   Show approved retained records/purposes/durations and actual backup handling.
   Require explicit confirmation of **the entire COP account**, independent of
   unlink. The UI cannot preselect global deletion from an unlink action.
3. A dedicated server job uses a stable operation UUID and a durable account
   revocation fence. Its actor is issuer/subject from verified fresh auth.
   Own job read/retry is isolated; other users receive 404. No destructive work
   runs while a required impact choice/policy/owner adapter is unresolved.
4. Stop new account activity before deletion. The job checkpoints each exact
   adapter's progress, retries bounded/idempotently and survives worker restart.
   Service outage is 503 or an explicitly pending job; 202 is never completed.
   No global token, raw credential, GPS or message body in logs/audit.
5. Return completed only after the owner-specific verification below. Revoke
   authentication credentials and prevent bootstrap/recreation. Keep only the
   approved minimum restore fence/audit; do not preserve account content under
   the label of an audit. Publish the canonical URL/capability only after actual
   authenticated synthetic-account acceptance, then integrate Jízda's second row.

The current source implements the additive deletion/preflight/receipt endpoints
and schemas in the binding OpenAPI. The canonical account-management page,
any SDK launch helper and production activation remain pending actual owner
adapters and acceptance. This plan does not create a fake successful DELETE or
a support-only deletion endpoint.

## Required owner adapters and proof

The current data inventory is [privacy 01](../privacy/01_SERVER_DATA_INVENTORY.md).
These are distinct from unlink's app-specific operations:

| Owner | Work and completion proof |
| --- | --- |
| COP web sessions / Keycloak | Fence account and revoke all its sessions/tickets/refresh grants; verify old access/refresh/bootstrap are denied. Never revoke another account. Accepted credential/admin permissions required. |
| COP profiles / invitations / preferences | Remove user profile/contact/preferences/invites and pending identity mappings; verify persistent SQL/JSON stores, not only RAM. |
| COP/Messaging native devices / push | Remove credentials/subscriptions/pushers for the whole account and all installations; stale tickets/queue handoffs cannot restore them. Unlink's smaller scope is unchanged. |
| Matrix/Synapse | Enumerate current and left rooms, all own events (paginate beyond 1,000), redact own UGC, delete owned uploads/media and personal metadata; verify jobs across restart/failure. `deactivate(erase=true)` alone is insufficient. Revoke credentials only after required owner work is tracked. Other people's identities/state are preserved. Actual federation/remote-copy limits must be stated. |
| LiveKit / voice stores | Revoke outstanding media grants, remove that account's participation and personal call metadata using accepted ownership/history rules; verify old grants denied. Do not end unrelated users' rooms/calls. |
| Community / sketches / media / tracks | Remove/redact own UGC and owned attachments in durable COP and object stores. Enumerate by verified ownership; no guessed prefix deletion or orphaned uploads. Preserve only specifically approved nonpersonal/shared structure. |
| Mobility / vehicles / ownership | Approved policy: physically remove own contributions/historical copies and personal links, preserve other authors' records, and complete existing owner-only transfer of active owned vehicles to a valid distinct member before the fence. Clear stale local owner binding; do not autoassign or delete others' records. Local vehicle cleanup/fencing and cached-result invalidation are not completion of the mobility identity, Dispatch or provider domain. Unresolved current edits of another author's record or cross-author correction/source references block; never silently roll history back or rewrite another author's record. No financial retention exception is approved. |
| Dispatch / location | Stop producers/devices/grants, remove identity/contact/consent metadata and account-linked packets. RAM TTL is not proof of durable erasure. Verify restart/queue races. |
| SIM measurements | Revoke and confirm deletion of every contributor day still retained. 202 remains pending until SIM confirms; restore must replay revocations. This is a whole-account adapter, not implicit unlink deletion. |
| AI Router BYOK / linked usage | Revoke/remove the account's stored provider key and linked profile/limits/cache. Inventory usage/cost audit and retain only the specifically accepted evidence; never fall back to a shared key. No actual OpenAI call needed to test deletion. |
| COP moderation / audit / logs | Resolve personal evidence/reporter/target links under the approved90/30/180day policy (integration43). Public contact is podpora@zeleznalady.cz; operational role/access and account-erasure adapter still require acceptance. Infrastructure logs require owner-specific retention proof. |
| Backups / restoration | User-confirmed Proxmox coverage is accepted as off-server backup, not instant account erasure or coverage of every external Matrix/DB/object store. Approve expiry/restricted access and durable deletion-fence replay before any restored service is exposed. Test an isolated restore; never resurrect the erased account. |

## Decisions/permissions and deployment approval required

- Approve each retained category's purpose, exact duration, access and deletion
  rule, including financial/moderation exceptions, logs and backup expiry/replay.
  Do not invent a blanket 30-day/indefinite legal exception.
- The shared-vehicle choice is approved as described above. Resolve other owned
  resources and own shared UGC/media separately. Active Dispatch group ownership
  has no approved transfer policy/API; do not infer automatic reassignment,
  deletion of the group or permission to erase other authors' data. Historical
  invitation/email provenance and in-flight provider work still require proof.
- Provide narrowly scoped server-side permissions for Keycloak, Synapse/media,
  object storage and SIM/Router adapters through approved secret files. No new
  production secret or permission was created by this candidate.
- Approve exact immutable service revisions, migrations/checkpoints, worker
  ownership/limits, canonical form, privacy wording and rollout/rollback plan.
  Deploy flags false first; enable only after isolated synthetic-user acceptance
  and explicit production approval. No test deletion of a real account.
- Physical/native acceptance: two accounts, old tokens, multiple apps/devices,
  pending upload/message/call/measurement, interrupted deletion, restart,
  operator exceptions and isolated restoration. App Review wording must match
  the new actual build, not the frozen 1.2 (30) export.

Rollback after deletion is UI/code rollback that retains revocation/checkpoints
and erasure fences. It must never restore deleted account data/credentials from
an old backup. If an adapter is unavailable, stop at pending and report the exact
remaining owner; do not pretend that the account has been erased.

## Implemented source boundary, 11 October

The durable `cop-account-erasure-v1` orchestrator, strict authenticated routes,
signed fresh `auth_time`, trusted restart worker and real local BFF/profile
adapter are implemented in the completion candidate. PostgreSQL race/restart
tests passed. All 11 domains remain mandatory; missing/unaccepted adapters fail
503 before intake. No global complete flow is activated or claimed. See
[integration 43](43_ACCOUNT_SAFETY_COMPLETION.md) for exact endpoints, current
provider blockers, provenance migration, flags and rollback rules.
