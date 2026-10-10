# COP/Jízda account safety – candidate handoff

Date: 2026-10-10. No production activation, restart, account deletion, reset,
real test message or real APNs delivery was performed for this change.

## Coordination revisions

All three candidates use `codex/account-deletion-moderation`; this is a
coordination branch, not a merged or deployed release.

- COP API/OpenAPI: this branch, based on the deployed COP source `d4eec834`.
- Messaging: `05dac885c35f11cb2e2eb24e32a3854a954ff36a`, based on production
  image source `d311b2c85c15e8f00cd62c5d3fdf83198d665e3d`.
- COP Mobile-owned SDK: `dd3a83f60f3e65c2010d6a0bf99e53ccc63bd85d`, based on
  Jízda's pinned `09493a0cc4aa2bcd45dae75c72f83db0ab37735f`.

The SDK delta is only the new `CSMAccountSafety.swift`, the optional idempotency
header in `CSMMobility.swift` and four XCTest cases. Merge those source changes
into the approved frozen host; keep its unrelated notification/voice/send-ack
patches. No shared toolchain pin was changed. The documentation in this handoff
does not establish native or live integration acceptance.

## Delivered interface

Binding source for the candidate: `openapi/openapi.json` (generated YAML export).

| Operation | Endpoint | Exact boundary |
| --- | --- | --- |
| Capability | GET `/api/v1/me/account-safety/capabilities` | Verified OIDC; `cop-account-safety-v1`; unavailable flags are false. Account deletion is false. |
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
call+peer+callId (UUID). COP verifies conversation/call access and the canonical event
sender. The browser/native host cannot choose a Matrix room or use a raw Matrix
identity instead of a canonical peer. Optional evidence is exactly
`{selectedText, explicitlyConfirmed:true}`, at most 4096 UTF-8 bytes. The host
must show the selected text and receive confirmation. It must never attach
history, live location, a voice transcript or decrypted content automatically.

Status `submitted` is accepted for review, not resolved. `reviewing` is active
review, `resolved` carries an operator resolution. `action_taken` records an
operator attestation, not an automatic redaction or ban performed by this API.
The actual operating process, filters, role assignment, public contact, retention
and any automated action must be accepted before use as an App Review claim.

Reports are capped at 20 new cases per actor/hour and 10,000 retained cases. The
pending index is bounded and queue reading does not decrypt every historical
case. Exhausted capacity is 503; actor rate limit is 429 with Retry-After. No
report is automatically deleted before a policy is approved. The rate/dedup and
report cleanup, key rotation and deletion linkage belong in that policy.

Unknown/unavailable upstream state fails 503. No direct OpenAI, shared-key,
local-block-only or unauthenticated fallback is added. Reports are not MCP tools
and are forbidden automatic AI context.

## SDK delta for pinned 09493a0

Add `CSMAccountSafety.swift` to `Sources/CSMCommunicationKit` and append the
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

DTOs include target factories, reason, explicit evidence, status receipt and
canonical block state. Default report has no evidence. Keep the UUID across
retries. On account change, discard the deferred operation, rather than retrying
as the new actor. On a block, hide that peer's cached history and explicitly
remove their queued drafts; keep other group members. A failed/offline block is
not locally reported as a confirmed server block. Do not imply that already
issued media credentials, active call audio or copied old history are revoked.

Capability=false or an older server's 404/503 must not be presented as an
implemented report/block/delete feature. Account removal UI and App Store
release remain blocked until actual deletion is ready.

## Current runtime and tests

COP API runtime was inspected read-only on docker.home.cz; it is running and
this candidate is absent. Messaging container runs image revision `d311b2c`;
its `/srv/csm-messaging` checkout still has `2246290`, so checkout identity alone
is not release proof. This candidate is based on the actual image's source
`d311b2c`. APNs/WebPush mode is live, PostgreSQL backend and secret-encryption
configuration are present. Neither new safety flag was present/enabled.

Matrix is reached through `comm.home.cz`, public `msg.zeleznalady.cz`; its public
version endpoint is reachable. Declared federation flag is false; actual
Synapse retention/federation configuration and old-room redaction completeness
were not inspected. There was no SSH access or mutation on comm.home.cz.

COP targeted tests: 12 passed (report/auth boundary and actual call start,
accept/media/termination routes). Full COP regression: 1,597 passed, 8 skipped;
build, type-check/lint, skeleton and 11 JSON Schemas passed. OpenAPI validation
passed with the existing 24 warnings. Messaging fixture tests: 78 passed on the
production source base, including existing delivery and serialization of a
recipient push handoff against a block mutation. SDK Foundation model
harness passed confirmation, UTF-8 size and metadata-only encoding. Added SDK
XCTest cases are not a claim of a full native run.

Pinned SDK verifier at `scripts/verify-apple-toolchain.sh:5` requires Xcode
27.1 build 27A9269; installed build is 27A9275 (iPhoneOS SDK 27.1). The exact gate was not bypassed and
no toolchain was downloaded. Jízda's owner reports its approved installed27.1
host tests; those results predate this delta and must not be attributed to it.
Apply this minimal delta to the frozen Jízda candidate and run its accepted
full toolchain/tests. SDK skeleton, 19 device-contract fixtures and project
configuration validators passed; the full SDK XCTest suite was not run here.
Physical iPhone and real Matrix/APNs/LiveKit acceptance of
this candidate are not performed.

## Exact proposed deployment order – not executed

1. Approve the shared-account deletion scope and moderation owner/contact.
   Approve concrete retention, exceptions, backup restore replay and key rotation;
   publish the accepted privacy text through the VCode owner. Do not activate
   reporting merely by inventing an arbitrary retentionPolicyId.
2. Finish actual erasure adapters and moderation/filter process; verify old and
   left Matrix rooms, >1,000 own events, media, sessions, tickets, metadata,
   financial/vehicle ownership choices and restored-backup tombstones. Add the
   public deletion contract and SDK only when this is an actual service.
3. Accept the prepared COP/Messaging revisions and exact immutable images. Keep
   both flags false for build/deployment smoke checks. Prepare a dedicated report
   evidence key only in an explicitly approved production secret file; no new
   secret has been created. Configure the accepted role/contact/policy.
4. In an isolated environment test two users/devices, block/unblock and reports,
   altered identity/event/room, retries, outages, state events/group consistency,
   pending drafts and active media. Verify APNs queue races and LiveKit grant
   revocation before feature activation. No real user history reset.
5. Deploy only the approved COP API and Messaging images using their existing
   deployment paths/networks/tokens. No ports, Docker data-root, shared builder,
   other app or SIM setting changes. Stage rollback images and read back image
   IDs, env hashes, health, contract and no-store/auth responses.
6. Enable only after acceptance; then install the matching Jízda/COP Mobile
   candidate on a real iPhone and test locked/background/multiple-device cases.
   App Store upload/submission is separately authorized by the Jízda owner.

Before activation, rollback is the previous verified images with flags false.
After a real block/deletion is used, retain enforcement, evidence encryption and
revocation/tombstones when rolling back UI or code. Never undo a deletion by
restoring an unfiltered old backup. This candidate has no production erasure
and no destructive migration.
