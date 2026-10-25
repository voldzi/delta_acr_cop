# Jízda communication repair — 25 October 2026

## Server cause and production repair

The live COP guard was enabled, while the Messaging container and its effective
Compose configuration lacked `CSM_COMMUNICATION_SAFETY_ENABLED`. Messaging
therefore rejected policy requests with `503 COMMUNICATION_POLICY_UNAVAILABLE`
before peer validation. Matrix configuration and its TURN readiness passed.
This was a COP–Messaging configuration mismatch; no SIM change was needed.

The final existing overlay on COMM,
`/srv/csm-messaging/account-safety/disabled-runtime-portable.compose.json`, now
sets the flag to `true`. Its stale image pin was aligned with the image already
running before the repair:
`sha256:531a5282d086300df960f270e5e17d4aa928abc3180af4d14a23d3edc18d9d25`
(source `6908586125b6610416a20257e0eb5899fc61ee2c`). The previous effective pin
resolved to `e0ac7f6…`; restarting from it would have changed code accidentally.
Only the Messaging API was recreated. No token, Matrix key, account, message,
blocking choice, erasure setting, network or live-media service was changed.

The finite helper in `scripts/communication/enable-messaging-policy.py` is bound
to the original container and overlay digest. It is historical, single-use
migration source, not a generic deployment command. Do not rerun it against the
current container or restore the stale image pin.

## Evidence and limits

- Existing COP service token: invalid self-pair changed from 503 to the expected
  400 `VALIDATION_ERROR`; an invalid token returns 401.
- A contact already present for the user's account was selected in server RAM.
  Canonical policy reads in both directions returned HTTP 200,
  `csm-communication-safety-v1`, `result=true`. No identities or conversation
  content were printed or saved; no call or message was created.
- Current Messaging is healthy. Effective configuration and runtime both have
  the flag enabled and resolve to the same immutable image. A Compose dry-run
  left its container unchanged.
- Nineteen COP communication safety/voice/rollback tests pass, including denied
  calls, unavailable policy and preserved authorization. Eight helper tests and
  four transport-check tests pass.
- The helper stopped after recreation with `HOST_CONFIG_DRIFT`: full image,
  application configuration and environment comparisons had passed, but the
  exact old HostConfig difference was not retained. This attempt is not reported
  as a fully successful deployment transaction. Independent functional checks
  above passed; the infrastructure reviewer found no exact old-container baseline. The difference
  remains unproven; the safety comparison was not relaxed. No blind retry
  or rollback was performed.

The read-only transport readiness check is
`scripts/communication/check-policy-transport.mjs`. Run it inside COP API with
its existing environment; never copy a token to a developer machine. It uses a
fixed invalid self-pair and checks both authentication and validation. A generic
healthy container does not replace this policy-boundary check.

## Shared SDK and Jízda handoff

Jízda's local 1.2 (62) contains client repairs for exact transaction aliases,
incoming decryption/delivery presentation, bounded local decrypt retries,
actual own-device verification and readable call errors. The frozen source
manifest SHA256 is
`01b0432911feb63e309c0f0567d89a8b42913c0c3198739c8d66aabeb445a283`.

The mobility branch `661027c` is not the communication foundation: it lacks the
exact per-part Matrix acknowledgement journal. Selective canonical adoption
uses published `7bf711e` on `codex/matrix-send-ack-safety`, preserving that
journal and all account/session fences. Do not replace the package with the
whole Jízda Vendor snapshot or introduce heuristic content/time acknowledgements.
Canonical transfer and publication are still pending in the coordinated work.

Phone/TestFlight delivery is separate. No phone was updated during the server
repair. Two-phone acceptance must still demonstrate one encrypted message each
way, refresh/reopen without duplicate bubbles, actual decryption or truthful
unavailable-history state, and an outgoing/incoming call with real audio. Never
reset keys, delete history/outbox, or treat the server policy read as audio proof.
