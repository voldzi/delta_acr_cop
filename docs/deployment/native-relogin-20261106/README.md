# Native relogin release — 2026-11-06

## Published source

- COP `e4f4aa246e2218be70462b4047d9a5ae0c93a69f` (code-only broker).
- Messaging `401161224db1179374a07224c77bf2c6a9f35baf`, based on the actual
  production `19c9b39669877dfeacbe1bd996e9c8da7c4cd1ec`, not the unrelated dirty checkout.
- Jízda signed build 84: domain/SDK/paired-fixture checks passed in its own chat;
  actual device installation and owner recovery remain unverified.

## Messaging production evidence

`messaging-receipt.json` proves successful app-only activation, preserved peers,
HostConfig, mounts and network IDs, and only three explicit environment additions.
`messaging-readback.json` binds actual container, image, source revision, health,
zero restarts and authenticated HTTP capability to the same running instance.
Both recovery capabilities are true. No actual owner repair was performed.

`messaging-artifact-transport.json` records the independently verified archive
and loaded-image IDs. Docker archive import changed the outer image/config-blob
identity; canonical effective image Config, all four rootfs diffIDs, architecture
and source label match exactly. Do not describe the raw envelope as byte-identical.
The release validates these content hashes before selecting the imported image.

`release-messaging.py` is the precise already-used one-shot script. Repeating it
against the new source fails its before-image/pin CAS. Root backup and original
private configuration remain only on COMM under the case path in the receipt.
No secrets were exported. Disable the two new recovery flags to stop new actions;
retain journals and operation metadata. Restoring the earlier image requires
operation-reader compatibility review and its exact original pin, not data reset.

All four new public Messaging paths reject unauthenticated requests with HTTP401.

## COP preparation

Prepared exact release `release-25caec3d0195422a8ad6c0f0e3abbcb5`, image
`sha256:a1158594639fe698fa07a3483ada98766527c5acc061347228f0b16e77d211cd`.
The first prepare stopped before activation. Fresh read-only image/mount/parity,
parent erasure proof, health and environment metadata checks passed; subsequent
normal prepare passed. No parent proof, clock or policy was altered. The original
stop was sanitized and its precise transient cause is not established; do not
claim it was a code fix or suppress its evidence.

## Validation and limits

COP62 focused tests; Messaging28 focused/actual-HTTP paired tests; TypeScript
check, targeted lint, skeleton and both OpenAPI contracts pass. OpenAPI retains
existing warnings (61 combined). Five notification fixture failures are identical
on original production and candidate; no guard was weakened for those tests.
New expiry/cold-start/legacy-unbound-registration flows passed paired SDK/backend
checks. Owner historical decryption, notification delivery and actual vehicle/chat
recovery require the new native build and device acceptance.

Firewall exact DELETE method correction was deployed earlier; see the sibling
`messaging-device-delete-20261106` evidence. This release adds no WAF exception.

## Actual COP activation failure

The first activation did not complete: the process restarted with
`CONTENT_PROJECTION_UNAVAILABLE` from the unchanged state admission boundary
while the optional flight feed appended its startup audit. Original candidate
and pending evidence are retained. No automatic rollback was allowed.

The minimal correction starts optional polling asynchronously with single-flight
serialization and close fencing. Projection/continuity admission remains unchanged;
refused writes are not published and flight readiness remains degraded. Core
owner mutations remain guarded. Two new startup tests and the existing projection,
owner-readiness and recovery suites pass (49 tests); TypeScript check passes.
Production availability is not established until guarded repair and fresh readback.
