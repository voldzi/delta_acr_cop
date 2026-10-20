# 40. Account safety release boundary — source integration

Current-state correction (2026-10-20): account deletion is production enabled and
verified for two synthetic accounts; see integration 43 and the lifecycle release.
Communication safety was configured and enabled on 2026-10-20; authenticated end-user delivery acceptance must be distinguished from deployment health. The source
interface/default descriptions below are historical preparation, not live flags.

Status on 2026-10-13: source prepared on the accepted a06/b13 COP line; no
deployment, secret, role, flag, account deletion or live provider test was made
by this integration. The historical candidate is preserved in
[the archive](../archive/2026-10-11_ACCOUNT_SAFETY_APP_REVIEW_CANDIDATE.md).
Current completion gates are in [integration 43](43_ACCOUNT_SAFETY_COMPLETION.md)
and [ADR 0050](../adr/0050_ACCOUNT_SAFETY_AND_ERASURE_BOUNDARY.md).

## Prepared interfaces

The binding authority remains `openapi/openapi.json`. All operations derive
identity from verified authentication and preserve no-store, correlation-aware
errors, existing service authorization and tenant boundaries.

| Operation | Endpoint | Boundary |
| --- | --- | --- |
| Safety capability | GET `/api/v1/me/account-safety/capabilities` | Disabled functions are false; account deletion false/URL null. |
| Report | POST `/api/v1/me/communication/reports` | Stable Idempotency-Key, verified target, bounded explicit evidence. |
| Own receipt | GET `/api/v1/me/communication/reports/{reportId}` | Other actors get 404; no excerpt in the receipt. |
| Block lookup | POST `/api/v1/me/communication/blocks/query` | Canonical policy; no peer ID in the URL. |
| Block/unblock | PUT `/api/v1/me/communication/blocks` | Verified peer, actual Matrix policy and readback. |
| Moderator queue/detail/review | `/api/v1/moderation/communication/reports` and `/{reportId}` | Accepted verified moderator role; revision CAS. |
| Whole-account erasure | `/api/v1/me/account-deletion` and its preflight/capability/receipt paths | Preflight and confirmation require fresh signed auth_time; the exact receipt GET uses an operation-bound read capability after session removal. All 11 real proofs are required for completion. |

Default report evidence is absent. Optional evidence is the explicitly selected
and confirmed plain-text excerpt, at most 4096 UTF-8 bytes. No automatic history,
decrypted messages, location or voice transcript is attached. Targets bind the
actual conversation/event sender or call participants; the caller chooses
neither reporter identity nor a raw Matrix identity. New reports are capped at
20 per actor/hour; 429/Retry-After and upstream 503 remain distinguishable.

## One account and one login

Jízda keeps its existing `csm-mobile` account and login entry in Já. The published
SDK activation contract is
[`5b346c5`](https://github.com/voldzi/COP-Mobile/blob/5b346c517e7d993ad948fdd00132eefbc953352c/packages/CSMCommunicationKit/HOST_COMMUNICATION_ACTIVATION.md):
`CSMCommunicationActivationPolicy=explicit_host_consent` separates authentication
and routing from optional Matrix/APNs/outbox/Dispatch/measurement producers.
Host voice shutdown and lazy creation require their separate host/voice
acceptance. This SDK publication is not proof of Jízda installation or production
cleanup. Dedicated OAuth provisioning is not the current approved path.

Local disable, server installation revocation and whole-account erasure are
different results. See [integration 41](41_JIZDA_SCOPED_DISCONNECT.md).

## Retention and moderation acceptance

The approved contact is `podpora@zeleznalady.cz`. The source policy is
`cop-communication-retention-90d-30d-180d-v1`: evidence expires at the earlier of
90 days from receipt and 30 days from first closure; text-free audit expires by
180 days. Blocking lasts until unblock or account deletion. Retention and
existing enforcement/retries remain active when new intake is disabled.

The source queue and `action_taken` receipt do not implement automatic filtering,
redaction or bans. Actual moderator assignment, review/filter procedure, evidence
key lifecycle and provider/native acceptance must be established before these
functions are claimed in App Review. No real review-account pair or destructive
acceptance was created by this integration. TestFlight upload and App Review
submission are separate; this source work does not authorize App Review.

Historical test counts are in the archived candidate and do not verify this
merge. Preserve accepted fences, keys, policy and checkpoints on rollback;
never restore deleted data without applying deletion fences before exposure.
