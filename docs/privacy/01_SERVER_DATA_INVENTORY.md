# Server data inventory for Jízda App Privacy

Date: 2026-10-10. Source and selected runtime evidence only. No raw user records,
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
| Identity/profile/session | OIDC issuer/subject, username/display name, optional email/verification, avatar and preferences; canonical authentication and account display. BFF stores encrypted OAuth tokens and profile. | `cop_user_profiles` has no automatic age-based erasure. Production BFF max age2592000s=30days; session expiry is not a whole-account deletion or proof all expired SQL rows have been physically purged. | Own profile, preferences/acknowledgements, all browser/native/OIDC sessions and identity issuer must be coordinated. User must choose shared-account scope. |
| COP mobility account/invitations | Stable account binding, membership/roles, invite issuer/recipient/contact metadata, operation receipts and invitation notification outbox. | `MobilityService.pruneRetainedData`: 30days after invite/outbox expiry; operation bodies are reduced after30days, dedup hash/createdAt remain. Actual cleanup execution/old SQL rows not inspected. | Remove own invitations, identity links, tickets and receipts; preserve other users' independently authored records. Hash/receipt retention needs a specific purpose and approved policy. |
| Shared vehicles | Shared vehicle descriptions, membership, routing profiles and user-authored maintenance/expense/energy/ride/odometer records, audit/corrections and receipts. Linked to canonical account IDs. | Active records have no blanket TTL. Deleted vehicle state is eligible for removal after30days in existing cleanup. This is not a promise that all user content is erased30days after account deletion. | Explicit transfer/archive choice for ownership. Erase own content unless a specific approved exception applies; keep other authors' content. Do not retain the whole history merely because it was shared. |
| Dispečink | Group/member/device/share/consent metadata and encrypted location packets for an active audience. COP keeps latest packets in RAM, not durable plaintext tracks. | Latest RAM points expire after180s, checked on read and periodically (5s); restart invalidates shares/points. Expired share metadata becomes eligible for cleanup30days after expiry. Group/member/device metadata has separate durable persistence. | Stop shares, revoke devices/consents/tickets, remove personal metadata and apply ownership choice. A location TTL does not erase durable group metadata. |
| Matrix chat/attachments | E2EE message/attachment ciphertext, sender/room/event/device IDs, membership, account data, profile and operational session metadata. Messaging keeps conversation/member/map-link metadata and an encrypted server-managed Matrix password. | No fixed message/media TTL is verified. Messaging metadata stores have capacity limits, not a deletion deadline. Actual Synapse retention and old-room coverage are unknown. | `deactivate(erase=true)` is insufficient: old members can still see messages; media is not deleted. Own events must be redacted, media removed, credentials/pushers revoked and reprovisioning prevented. Recipient copies already downloaded cannot be remotely recalled. |
| Voice | COP call ID/room/title, exact participants, state, claim endpoint and times; LiveKit credentials/media relay. COP source has no call recording persistence. | Invitation90s; production media JWT600s. `cop_voice_calls` has no automatic history erasure in source. LiveKit recording/egress, media/log retention and grant revocation were not independently verified. | End active calls, revoke/expire grants, remove own identifying history while preserving others' necessary records. Do not claim a block instantly revokes an already issued JWT. |
| APNs/VoIP/WebPush | Per-device encrypted token/subscription, owner, environment/bundle, categories/preferences; notification title/body/metadata/audience and delivery/idempotency evidence. | Device delete marks inactive and does not remove token/history in current implementation. Notification/device metadata has limits but no verified age-based purge. Live delivery modes observed. | Remove device secrets, tickets and identifying delivery records under approved policy; clear Matrix pushers; test all installations. Notification expiry is not physical ledger deletion. |
| Traffic/community reports/drawings | User-supplied location/time/direction/text, publication state, author account, confirmations, attachments and sketches/audit. Public UGC remains authored data. | Validity/visibility expiry does not physically delete SQL/media. `cop_community_reports`, attachments, confirmations and `cop_user_drawings` have no verified whole-account purge. Derived current/history/domain/federation objects have separate persistence. | Remove own UGC/media and corresponding owned derived records/outbox projections. Keep other users' records; unknown legacy ownership must not be guessed or blanket deleted. |
| Voluntary traffic measurements | Actual short GPS input transiently processed; day-scoped pseudonymous contribution, interval/ETA and receipt in SIM. COP stores consent/revocation progress. | COP production intakefalse. SIM contract20 specifies derived intervals/ETA/receipts7days and one-minute expiry cleanup; raw GPS not written to DB/cache/X5/log/response. This source contract is not a new live pilot result. | Revoke all outstanding days, wait for actual deletion, distinguish202pending. SIM backups/restore revocation are a separate policy. Pseudonymous contributions are not declared anonymous. |
| Place search/routing | Query/address/bounds, route start/end/waypoints and profile sent via COP to configured geocoding/SIM/Valhalla, to calculate navigation. | Production geocoder RAM cache604800s=7days; cache key includes query/bounds, not account ID. No navigation-request history store was identified in COP's routing adapter. SIM/Valhalla/provider/proxy request logging and retention not independently verified in this inventory. | Verify raw-coordinate/query logging at every hop before App Privacy labels; clearing a cache does not erase upstream logs or backups. Route speed/ETA data is not a legal speed limit or evidence of GPS tunnel passage. |
| Diagnostics/audit | Request correlation, path/status, source health; calls and business audit IDs can link back to an account. COP request serializer excludes query/body/credentials. | No single approved retention covers all API/proxy/DB/Synapse/LiveKit/observability logs. New report evidence is encrypted; moderation roles/contact/retention are not approved or enabled. | Name each actual log owner/retention; do not call all diagnostics anonymous merely because names are absent. No raw GPS, message bodies or credentials in new diagnostics. |
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

Pending decisions: shared-account deletion scope; moderation owner/public
contact; specific retention/exception/backup policies. Pending tests: full native
SDK delta, real Synapse/APNs/LiveKit and physical iPhone. Pending implementation:
actual coordinated erasure and accepted filtering/moderation operating process.
These gates prevent a misleading App Review or privacy claim.

Official references: [Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/),
[App Review1.2](https://developer.apple.com/app-store/review/guidelines/),
[Synapse erasure limits](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html).
