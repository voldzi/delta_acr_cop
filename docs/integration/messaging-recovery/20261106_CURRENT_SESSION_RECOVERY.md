# Fresh native login and exact notification reconciliation

Implemented 2026-11-06 for COP and Messaging, paired with Jízda build 84 source.
Production activation and actual owner acceptance must be recorded separately.

## Contract and sequence

Binding JSON schemas are in `openapi/openapi.json`. COP derives subject, issuer,
client and recent `auth_time` from verified OIDC. No caller-selected Matrix user,
server URL, credential or original crypto device is accepted. COP calls Messaging
only through its existing server credential; it does not persist session tokens.

1. Fresh same-owner SSO (maximum authentication age 300 seconds), host OFF,
   serialized recovery and positive detached-client proof.
2. Remove only exact known device-registration targets. Persist individual ACKs.
3. POST `/api/v1/mobile/host-pushers/reconcile` with the exact old app/pushKey.
   Matching owned registration may be inactive. Persist its strict receipt before
   acknowledging that pending target. No blanket pending clear.
4. POST `/api/v1/mobile/host-chat-sessions/prepare` with a durable new operation
   UUID and its derived `CSMIOS.S.<uuid-without-hyphens>` device ID. Server looks
   up the existing uniquely mapped Matrix user and reserves metadata only.
5. Native proves this exact new hashed crypto-store directory absent. Existing,
   unreadable or symlink paths fail closed; no recursive discovery or deletion.
6. POST `/api/v1/mobile/host-chat-sessions`. Server binds the installation and
   logs into only that existing user/reserved new device. Native persists the
   response before use, verifies exact whoami, then commits its additive journal.
7. Explicit normal host ON may use this committed namespace. Existing keys,
   stores, local vehicle/history and unsent records remain untouched. Earlier
   encrypted history may require the existing verified key-recovery workflow;
   new login does not promise historical decryption.

A missing/expired `CSMIOS.S` cache never calls ordinary provisioning bootstrap.
Unknown issuance requires explicit fresh same-operation reissue. A committed
session can be renewed after APNs registration advances revision, using its
immutable original cleanup provenance; it does not delete the new pusher or
claim an arbitrary existing Matrix device. Stale cleanup still returns 409.
Credentials use saved request time plus expiry duration, not cold-start time.
A healthy Rust transport is not destroyed solely because its initial bootstrap
pair expired after Rust refreshed autonomously. Unreadable journal is not no intent.

## Server boundaries and operation state

Messaging uses its existing owner-serialized DeviceRegistry and AccountSafety.
Operation metadata is stored inside the same owned row and removed by existing
account erasure. It contains no access/refresh token or raw pushKey. CAS binds
registration revision, actor scope, exact target and operation. The short-lived
admin cleanup token creates no Matrix device and is logged out after exact
pusher absence readback. Other devices, pushers, rooms and crypto keys are untouched.

COP limits each owner to six recovery mutations per minute. Responses are
`no-store`. Invalid/stale identity, changed registration, limits and dependency
failure remain errors; no direct Matrix or ordinary-bootstrap fallback exists.
App revocation blocks session issuance before and after upstream work. Exact
notification withdrawal remains reachable after app-only disconnect; account
removal still blocks both. Cleanup alone never restores chat.

## Activation and return

No new COP environment setting is introduced. Existing Messaging provider must
be enabled. Messaging defaults both new flags OFF. A scoped application release
must explicitly enable only these three non-secret booleans:

```
CSM_APP_DEVICE_LEDGER_ENABLED=true
CSM_HOST_PUSHER_RECONCILIATION_ENABLED=true
CSM_HOST_CURRENT_SESSION_ENABLED=true
```

No schema/role, credential, mount, network or firewall broadening is needed.
Capability is true only with ledger and both recovery paths enabled. Preserve
all other effective environment and immutable deployment evidence. Return:
first disable the two recovery flags to stop new work, retain persisted journals
and existing devices, then restore the exact previous image/config only after
checking that no accepted operation needs the newer reader. Never roll back by
resetting users, tokens, registration rows or crypto. No automatic fallback.

## Verified evidence

- COP: 62 focused tests, including actual backend wire-fixture consumption;
  typecheck, targeted lint, OpenAPI validation and skeleton checks.
- Messaging: 27 focused owner/CAS/revocation/transport/controller tests, plus
  actual authenticated route → Matrix HTTP → strict receipt paired fixture.
- Jízda: actual SDK fixture consumer and filesystem/journal/cold-resume checks
  passed; native whole-app and device acceptance are separate.
- Existing notification suite has five identical failures on untouched production
  source and candidate (fixture policy assumptions); these were not hidden or
  made to pass by weakening policy.
- Firewall: deployed exact DELETE method correction; see
  `docs/deployment/messaging-device-delete-20261106/README.md`.

No real-owner recovery request or historical decryption is claimed by these tests.
