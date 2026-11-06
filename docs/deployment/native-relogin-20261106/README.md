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

## Standard guarded completion and follow-up

The exact initial target later became healthy with historical restartCount14.
The existing unmodified runtime CLI `recover` completed that same pending target,
with fresh health/parity/parent/CAS checks, without rollback or recreation. See
`cop-recovery-receipt.json`. No Root exception, policy edit or one-shot replacement
was used. The proposed one-shot readonly check correctly rejected a healthy target.

COP→Messaging actual server-only capability request then returned200/both true.
Public COP routes return application401 without authentication, including all
three full typed synthetic POST bodies (WAF permits their contract structure).
See the sanitized negative-path receipts. This is server connectivity evidence,
not authenticated owner recovery or historical decryption evidence.

The normal broker prepared the startup correction4878155 as
`release-5173ef88c637434ba8c975029061ed90`, exact sealed image
`sha256:733cc973b04c3357ab2dd9d84f81cd90d0ad7198bb97d6a4f4941feae876b327`.
A separate preliminary unprivileged build was not deployed; only the broker's
immutable-source build is eligible. Its fresh activation/readback is recorded
separately below when completed.

## Final production activation

The normal code-only broker activation completed successfully. COP runs source
`487815534b40d0e3257ec6c4e94d39850b9b82cd`, sealed image
`733cc973b04c3357ab2dd9d84f81cd90d0ad7198bb97d6a4f4941feae876b327`, release
`release-5173ef88c637434ba8c975029061ed90`, generation
`c12d27d6c16d444e84265bc0da204921`. The new actual container is healthy with zero
restarts. See `cop-final-status.json` and `cop-final-activation.json`.
Authenticated server-only capability from this final COP instance to Messaging
returned200 and both recovery flags true. No user, session or crypto was reset.

Jízda owns the signed build84 and its native integration. The phone was unavailable
at final handoff: installation, fresh same-owner login, actual chat/pusher repair,
vehicle access and historical decryption are not claimed as physical acceptance.
No owner recovery request was made by these production probes. No TestFlight upload.

## Subsequent physical-device investigation and audience correction

Jízda subsequently installed final build84 on the owner's iPhone. The explicit
recovery flow stopped at DeviceRegistry DELETE401 before any COP reconcile,
prepare or issue POST. Matching Keycloak events identified the exact cause:
the `csm-mobile` access token did not include `csm-messaging` in its audience.
This is distinct from the earlier missing introspection client and old Matrix
`M_UNKNOWN_TOKEN`; see `oidc-client-repair/device401-audience-hop.sanitized.json`.

Added exactly one Audience mapper to existing `csm-mobile-dedicated`, ID
`8ec32597-305f-4b38-ac81-5abe789c802f`. It includes only `csm-messaging` in access
tokens; ID-token, lightweight-token and introspection additions are disabled.
Fresh reload of the saved detail and independent mapper list confirmed the
configuration and exactly one mapper. Existing Full Scope Allowed remains true;
no roles, grants, credentials or audience-verification rules were changed.
The closed plan and sanitized readback are in `oidc-client-repair/`.

The change applies to newly issued access tokens. Jízda coordinates one fresh
same-owner login and native recovery acceptance; successful owner recovery is
still pending and must not be inferred from the configuration readback. No
vehicle, local history, crypto, pending records or registration was reset.
Rollback is limited to removing this exact new mapper after verifying its
unchanged name, provider and configuration; preserve all other settings.
