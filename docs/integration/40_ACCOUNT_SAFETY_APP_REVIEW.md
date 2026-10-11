# COP/Jízda account safety – candidate handoff

Date: 2026-10-11. No production activation, restart, account deletion, reset,
real test message or real APNs delivery was performed for this change.

Current completion delta and approved contact/retention are documented in
[integration43](43_ACCOUNT_SAFETY_COMPLETION.md). The first-phase test and
transfer evidence below remains historical evidence for that exact revision.

## Coordination revisions and decisions

The source candidate starts from COP `78d4f87`, Messaging `05dac88` and COP
Mobile `dd3a83f`; SDK transfer base is Jízda's pinned `09493a0`. The earlier
SDK transfer does not include the later correction and scoped unlink delta.
Use the complete transfer manifest and exact published revision, rather than
copying the earlier three-file patch. Publication is not deployment.

Current production was read back on 11 October: COP source
`e99401213efbf9d6a7685443adc318eeeb422c15`, API image
`sha256:8c61839a458ca82cfc79725b4763759c90d66ffcd31e1e24e2ff5defe9724741`,
healthy; Messaging image
`sha256:ff80ec9a89155aae5081b118c6e9900dfccfce6187b90f4a90432c45b04d2079`,
revision `d311b2c`, healthy. The candidate COP files are absent from deployment
and the new safety/unlink flags are absent. The older candidate base
`d4eec834` is not the current production baseline; integrate only the accepted
scoped delta onto the production source before any release.

Human decisions verified in Jízda on 11 October: unlink only Jízda; moderation
by the COP administrator; a separately approved whole-account management/removal
action. Later direct human approvals selected contact podpora@zeleznalady.cz,
90/30/180day retention and exact installed Xcode27.1 build27A9275. These
approvals do not activate production or establish completed account erasure.

- [Scoped unlink, exact SDK integration and proposed deployment](41_JIZDA_SCOPED_DISCONNECT.md).
- [Separate real whole-account removal plan and canonical URL gate](42_COP_ACCOUNT_REMOVAL_PLAN.md).

## Delivered interface

Binding source for the candidate: `openapi/openapi.json` (generated YAML export).

| Operation | Endpoint | Exact boundary |
| --- | --- | --- |
| Capability | GET `/api/v1/me/account-safety/capabilities` | Verified OIDC; `cop-account-safety-v1`; unavailable flags are false. Account deletion is false and its URL is null. |
| Report | POST `/api/v1/me/communication/reports` | Mandatory stable `Idempotency-Key` 16–128 ASCII chars (SDK UUID); caller never supplies reporter. Same actor/key/body returns the existing receipt, conflicting body 409. |
| Own status | GET `/api/v1/me/communication/reports/{reportId}` | Other users' reports are 404. Receipt contains status/revision, no excerpt, target or reporter. |
| Block state | POST `/api/v1/me/communication/blocks/query` | Body only `peerSubjectId`. POST keeps peer IDs out of request URLs. |
| Block/unblock | PUT `/api/v1/me/communication/blocks` | Body only `peerSubjectId`, `blocked`; real canonical Matrix state, not local hide. |
| Operator queue/read/review | `/api/v1/moderation/communication/reports` and `/{reportId}` | Configured verified moderator role; 100 oldest unresolved summaries. Read may reveal the explicitly submitted excerpt. PATCH requires current revision and resolution for a resolved case. |

Report example (synthetic references):

```json
{
  "target": { "kind": "message", "peerSubjectId": "synthetic-peer", "conversationId": "synthetic-conversation", "eventId": "$synthetic-event" },
  "reason": "harassment"
}
```

Target is exactly one of user+conversation, message+conversation+event, or
call+peer+callId (UUID). Peer references are at most 256 UTF-8 bytes;
conversation/event references at most 255 UTF-8 bytes. Both server and SDK
enforce bytes; OpenAPI maxLength alone measures characters. COP verifies conversation/call access and the canonical event
sender. The browser/native host cannot choose a Matrix room or use a raw Matrix
identity instead of a canonical peer. Optional evidence is exactly
`{selectedText, explicitlyConfirmed:true}`, at most 4096 UTF-8 bytes. The host
must show the selected text and receive confirmation. It must never attach
history, live location, a voice transcript or decrypted content automatically.

Status `submitted` is accepted for review, not resolved. `reviewing` is active
review, `resolved` carries an operator resolution. `action_taken` records an
operator attestation, not an automatic redaction or ban performed by this API.
The actual operating process, filters, role assignment and any automated action
must be accepted before use as an App Review claim. Contact and retention are
approved; see integration43 for enforced source behavior and production gates.

Reports are capped at 20 new cases per actor/hour and 10,000 retained cases. The
pending index is bounded and queue reading does not decrypt every historical
case. Exhausted capacity is 503; actor rate limit is 429 with Retry-After. The approved policy now removes evidence at min(created+90days,
firstclosure+30days) and report details/audit by180days. A content-free own
receipt remains; global erasure, backup replay and evidence-key rotation still
need acceptance.

Unknown/unavailable upstream state fails 503. No direct OpenAI, shared-key,
local-block-only or unauthenticated fallback is added. Reports are not MCP tools
and are forbidden automatic AI context.

## SDK delta for pinned 09493a0

Add the account-safety/Jízda-link DTOs and owned native safety sheet, and append the
optional `idempotencyKey` parameter to the existing internal `mobilityRequest`.
All existing calls preserve their signature through the nil default. The helper
validates the operation UUID and adds the header. The existing actor/scope and
session-generation checks, HTTPS, no redirects and ephemeral no-cookie session
are preserved.

Public methods:

- `copAccountSafetyCapabilities(expectedScope:)`
- `copCommunicationReport(_:operationId:expectedScope:)`
- `copCommunicationReportStatus(reportId:expectedScope:)`
- `copCommunicationBlockState(peerSubjectId:expectedScope:)`
- `copCommunicationSetBlocked(_:peerSubjectId:expectedScope:)`

DTOs include strict target factories, encoder/decoder validation, reason, explicit evidence, status receipt and
canonical block state. Capabilities and unlink receipts are also validated
during standalone encoding/decoding; false erasure flags, arbitrary deletion
URLs or a malformed completed receipt fail. Plain JSONEncoder and JSONDecoder cannot bypass target
validation or evidence confirmation/UTF-8 limits; every submission is revalidated
before HTTP. Default report has no evidence. Keep the UUID across
retries. On account change, discard the deferred operation, rather than retrying
as the new actor. On a block, hide that peer's cached history and explicitly
remove their queued drafts; keep other group members. A failed/offline block is
not locally reported as a confirmed server block. Do not imply that already
issued media credentials, active call audio or copied old history are revoked.

Capability=false or an older server's 404/503 must not be presented as an
implemented report/block/delete feature. The native conversation surface now
contains report and direct-block UI; it is source-only and not natively accepted.
Unlink remains separate from actual account removal. Its POST response preserves
HTTP status for validation: 202 requires disconnecting/nonempty remaining; 200
requires disconnected/empty remaining. Any mismatch fails before local
completion/fence notifications. GET may recover a pending receipt with HTTP 200.
App Review account-creation acceptance stays blocked until the separate real
deletion flow exists.

## Current runtime and tests

The 11 October production readback above is read-only. `/health/ready` returns
200; an unauthenticated capabilities request returns 401. That 401 proves the
general authentication guard, not implementation or activation of this
candidate endpoint. No authenticated report/block/unlink was performed against
production. The `/srv/csm-messaging` checkout remains `2246290`; the running
image is `d311b2c`, so checkout identity alone is not release proof.

Matrix is reached through `comm.home.cz`, public `msg.zeleznalady.cz`; its public
version endpoint is reachable. Declared federation flag is false; actual
Synapse retention/federation configuration and old-room redaction completeness
were not inspected. There was no SSH access or mutation on comm.home.cz.

Earlier candidate regression: COP 1,603 passed / eight skipped; Messaging 83
passed; Foundation 18 checks passed. Those runs predate the latest encoder and
HTTP-status corrections and are not full regression evidence for the new
transfer. Fresh focused verification: COP 31 tests passed, including five actual
buildServer/OIDC target-authority cases; Messaging 9 tests passed; OpenAPI
receipt/status/reference contract 9 tests passed; Foundation 128 model/codec/preflight and
receipt checks passed. API typecheck/focused lint and syntax parsing of all seven
Swift files passed. The SDK contains 15 XCTest cases, unexecuted as a native
suite. Static SDK skeleton/device 19 fixtures/project checks passed. Exact file
hashes are recorded in the transfer manifest.
Foundation model/preflight checks are not native SDK/XCTest, UI or HTTP tests.
A direct isolated XCTest attempt returned `no such module XCTest`.

The first-phase verifier required Xcode27.1 build27A9269 while installed
build was27A9275. After explicit human approval, published SDK6e4b028 pins
exact build27A9275 and its cheap verifier passed. Jízda's owner subsequently
reported248nativeSDKtests, twoexplicit skips and zero failures for its frozen
first-phase candidate. These results do not verify the newer lifecycle delta;
no toolchain was downloaded or gate bypassed.
Apply this minimal delta to the frozen Jízda candidate and run its accepted
full toolchain/tests. SDK skeleton, 19 device-contract fixtures and project
configuration validators passed; the full SDK XCTest suite was not run here.
Physical iPhone and real Matrix/APNs/LiveKit acceptance of
this candidate are not performed.

## Exact proposed deployment order – not executed

The unlink/report/block sequence is [plan 41](41_JIZDA_SCOPED_DISCONNECT.md).
It requires the separate Jízda OIDC client, attested legacy migration, real
Matrix/live permission adapters, accepted native tests, COP moderator role/
contact/retention and dedicated evidence-key approval. Keep all new flags false
for initial smoke. No new public port, network, Docker data-root, SIM setting,
other application, real user account or frozen Jízda build is changed.

The separately approved whole COP deletion is [plan 42](42_COP_ACCOUNT_REMOVAL_PLAN.md).
It has no verified canonical URL or working production erasure flow; capability
is false/URL null. Its impact, exceptions/retention, adapter permissions,
restoration replay and explicit production plan are separate gates. Whole-account
erasure is not a prerequisite that silently widens the unlink operation, and
unlink never calls it. App Review registration requirements remain open.

Before activation, rollback is the previous verified images with flags false.
After a real block/deletion is used, retain enforcement, evidence encryption and
revocation/tombstones when rolling back UI or code. Never undo a deletion by
restoring an unfiltered old backup. This candidate has no production erasure
and no destructive migration.

## App Review and review-account status

No accepted review-account pair with real report/block/unlink acceptance is
provided by this source transfer. Do not repurpose a driver's live pilot
account or expose existing credentials. Use separately approved synthetic
accounts, with least-privilege user roles, fresh history and both app scopes;
record availability and reviewer instructions without putting passwords in Git.

COP administrator is the selected moderation owner. The approved public contact
is podpora@zeleznalady.cz and retention is90/30/180days. Actual moderator-role
assignment, operating acceptance and dedicated evidence-key lifecycle remain
unfilled production gates. They cannot be
inferred from an account email or a successful build. No deletion URL is
available and no working global erasure is claimed. CarPlay submission receipt
is separate from Apple entitlement approval; this candidate does not activate it.
