# Server data inventory for Jízda App Privacy

Updated: 2026-10-14 for source integration. The runtime observations below are
dated 2026-10-10, not a fresh readback of the current deployment. Current source
and acceptance boundaries are in `../integration/43_ACCOUNT_SAFETY_COMPLETION.md`.
The confirmed operator is VCode (Jiří Volek); public support is
`podpora@zeleznalady.cz`. The approved communication-report policy is evidence
for at most 90 days and at most 30 days after closure, plus content-free audit
for 180 days. This does not establish retention for the other stores or backups.

Historical source and selected runtime evidence only. No raw user records,
GPS samples, message content, tokens or secret values were read or logged.
This is a release gate inventory, not a declaration that erasure is implemented.

Runtime readback: COP API is running on docker.home.cz; Messaging image revision
`d311b2c`, its deployment checkout `2246290`. Messaging PostgreSQL backend,
secret-encryption configuration and live APNs/WebPush were observed. Matrix's
public version endpoint on the configured comm.home.cz service is reachable.
Actual Synapse storage/retention on that different host was not inspected.
COP driver measurements are false. COP's current chat release and its unchanged
AI flags are documented in runbooks/22_COP_CHAT_RELEASE_20261010.md.

| Area | Data and purpose / account relationship | Actual retention observed in source or runtime | Erasure/acceptance gap |
| --- | --- | --- | --- |
| Identity/profile/session | OIDC issuer/subject, username/display name, optional email/verification, avatar and preferences; canonical authentication and account display. BFF stores encrypted OAuth tokens and profile. | `cop_user_profiles` has no automatic age-based erasure. Production BFF max age2592000s=30days; session expiry is not a whole-account deletion or proof all expired SQL rows have been physically purged. | The owner superseded the earlier COP-only scope on 2026-10-17: new explicit v2 removes COP/SIM data and the shared Keycloak identity/access. Production intake is still disabled; new whole-service acceptance and deployment remain pending. The one-time test-user reset is approved without creating a new old-data backup. |
| COP mobility account/invitations | Stable account binding, membership/roles, invite issuer/recipient/contact metadata, operation receipts and invitation notification outbox. | `MobilityService.pruneRetainedData`: 30days after invite/outbox expiry; operation bodies are reduced after30days, dedup hash/createdAt remain. Actual cleanup execution/old SQL rows not inspected. | Remove own invitations, identity links, tickets and receipts; preserve other users' independently authored records. Hash/receipt retention needs a specific purpose and approved policy. |
| Shared vehicles | Shared vehicle descriptions, membership, routing profiles and user-authored maintenance/expense/energy/ride/odometer records, audit/corrections and receipts. Linked to canonical account IDs. | Active records have no blanket TTL. Deleted vehicle state is eligible for removal after30days in existing cleanup. This is not a promise that all user content is erased30days after account deletion. | Human approved removal of own contributions and personal links, preservation of other authors' records and actual transfer of active owned vehicles to another authorized existing member first. Local SharedVehicleErasureService candidate removes records/historical copies and invalidates cross-account cached results with a permanent local fence; it is not the complete mobility_dispatch adapter. Unknown provenance, current own edits of another author's record and cross-author correction/source references block. No financial/shared-history retention exception or production activation is approved. |
| Dispečink | Group/member/device/share/consent metadata and encrypted location packets for an active audience. COP keeps latest packets in RAM, not durable plaintext tracks. | Latest RAM points expire after180s, checked on read and periodically (5s); restart invalidates shares/points. Expired share metadata becomes eligible for cleanup30days after expiry. Group/member/device metadata has separate durable persistence. | Stop shares, revoke devices/consents/tickets, remove personal metadata and apply ownership choice. A location TTL does not erase durable group metadata. |
| Matrix chat/attachments | E2EE message/attachment ciphertext, sender/room/event/device IDs, membership, account data, profile and operational session metadata. Messaging keeps conversation/member/map-link metadata and an encrypted server-managed Matrix password. | No fixed message/media TTL is verified. Messaging metadata stores have capacity limits, not a deletion deadline. Actual Synapse retention and old-room coverage are unknown. | `deactivate(erase=true)` is insufficient: old members can still see messages; media is not deleted. Own events must be redacted, media removed, credentials/pushers revoked and reprovisioning prevented. Recipient copies already downloaded cannot be remotely recalled. |
| Voice | COP call ID/room/title, exact participants, state, claim endpoint and times; LiveKit credentials/media relay. COP source has no call recording persistence. | Invitation90s; production media JWT600s. `cop_voice_calls` has no automatic history erasure in source. LiveKit recording/egress, media/log retention and grant revocation were not independently verified. | End active calls, revoke/expire grants, remove own identifying history while preserving others' necessary records. Do not claim a block instantly revokes an already issued JWT. |
| APNs/VoIP/WebPush | Per-device encrypted token/subscription, owner, environment/bundle, categories/preferences; notification title/body/metadata/audience and delivery/idempotency evidence. | Device delete marks inactive and does not remove token/history in current implementation. Notification/device metadata has limits but no verified age-based purge. Live delivery modes observed. | Remove device secrets, tickets and identifying delivery records under approved policy; clear Matrix pushers; test all installations. Notification expiry is not physical ledger deletion. |
| Traffic/community reports/drawings | User-supplied location/time/direction/text, publication state, author account, confirmations, attachments and sketches/audit. Public UGC remains authored data. | Validity/visibility expiry does not physically delete SQL/media. `cop_community_reports`, attachments, confirmations and `cop_user_drawings` have no verified whole-account purge. Derived current/history/domain/federation objects have separate persistence. | Remove own UGC/media and corresponding owned derived records/outbox projections. Keep other users' records; unknown legacy ownership must not be guessed or blanket deleted. |
| Voluntary traffic measurements | Actual short GPS input transiently processed; day-scoped pseudonymous contribution, interval/ETA and receipt in SIM. COP stores consent/revocation progress and, in the new source candidate, immutable new-row issuer plus keyed erasure fence/checkpoint. | COP production intakefalse. SIM contract20 specifies derived intervals/ETA/receipts7days and one-minute expiry cleanup; raw GPS not written to DB/cache/X5/log/response. Candidate local day inventory persists only while deletion is pending; actual completed SIM proof and local absence atomically delete consent and clear dates. Minimum fence/proof metadata has no new automatic expiry; production policy/continuity acceptance remains open. | Revoke all outstanding days, wait for actual deletion, distinguish202pending. Null historical issuer stays unresolved. GET-only completed retry verifies the prior proof without re-creating a contributors manifest. SIM backups/restore revocation remain a separate policy. This source contract is not production acceptance; keyed fences/contributions are pseudonymous, not declared anonymous. |
| Place search/routing | Query/address/bounds, route start/end/waypoints and profile sent via COP to configured geocoding/SIM/Valhalla, to calculate navigation. | Production geocoder RAM cache604800s=7days; cache key includes query/bounds, not account ID. No navigation-request history store was identified in COP's routing adapter. SIM/Valhalla/provider/proxy request logging and retention not independently verified in this inventory. | Verify raw-coordinate/query logging at every hop before App Privacy labels; clearing a cache does not erase upstream logs or backups. Route speed/ETA data is not a legal speed limit or evidence of GPS tunnel passage. |
| Diagnostics/audit | Request correlation, path/status, source health; calls and business audit IDs can link back to an account. COP request serializer excludes query/body/credentials. | No single approved retention covers all API/proxy/DB/Synapse/LiveKit/observability logs. Report evidence encryption is prepared in source. The public contact and report-specific 90/30/180-day policy are approved; moderator role, operating process and activation remain unaccepted. | Name each actual log owner/retention; do not call all diagnostics anonymous merely because names are absent. No raw GPS, message bodies or credentials in new diagnostics. |
| Backups/archives | COP X5 backups/archives and off-server Proxmox host backups may include historic identifiers/data/secrets. Active DB, external S3 and Matrix on comm.home.cz are separate owners. | User confirmed off-server Proxmox coverage of docker.home.cz includingX5. Its retention is managed by Proxmox and is not verified here. X5 protected verified backups are not an account-specific erasure mechanism. Legacy Messaging backup JSON files are present on docker.home.cz; their contents/retention were not read. | Account-specific erasure must define expiry/access restrictions and replay durable deletion tombstones before a restored service is exposed. Do not claim server deletion instantly purges historical backups or that docker.home backup covers every external DB/Matrix host. |

## Evidence and approval required

Source owners: COP user-profile/web-session/mobile-device/voice-call/community/
sketch/track-history/federation stores; mobility-service, invitation outbox,
dispatch-service, driver-measurement routes/consent; Messaging Conversations,
DeviceRegistry, Notifications, MatrixIdentityStore and PersistentStore; SIM
`docs/integration/20_JIZDA_DRIVER_MEASUREMENTS_CONTRACT.md:219–247`.

No legal retention periods are invented. Actual unknown storage/log/backups
must be confirmed by their owner. App Privacy must account for identifiers,
contact/profile data, user content, location and diagnostics according to actual
use. The native host's local/CloudKit/passenger data and SDK behavior are the
Jízda owner's separate inventory; this document does not decide App Store labels
from a mock or a single library build.

Scope decisions are resolved: one existing COP account and the current
`csm-mobile` login with explicit local Jízda activation. Local disable is not
verified server revocation. Dedicated Jízda OAuth provisioning is not authorized.
Whole-account management/removal remains a separate action; moderation owner is
the COP administrator. The shared-vehicle decision is approved in
[ADR 0052](../adr/0052_APPROVED_SHARED_VEHICLE_ERASURE_POLICY.md); actual transfer
must precede full-account deletion. Active Dispatch group ownership has no
approved transfer policy/API. Claimed notification work can still be in flight,
and current email alone cannot prove historical invitation/provider ownership.
Local vehicle cleanup does not erase the mobility identity or establish full
Dispatch/provider completion; the complete domain adapter is not connected.
Pending decisions: exact role assignment and specific
retention/exception/backup policies. Shared SDK source `85d79966` is published and
its targeted and mandatory native gates passed. Jízda host integration, real
Synapse/APNs/LiveKit flows and physical iPhone acceptance remain pending.
Pending implementation:
actual coordinated erasure and accepted filtering/moderation operating process.
These gates prevent a misleading App Review or privacy claim.

Official references: [Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/),
[App Review1.2](https://developer.apple.com/app-store/review/guidelines/),
[Synapse erasure limits](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html).
