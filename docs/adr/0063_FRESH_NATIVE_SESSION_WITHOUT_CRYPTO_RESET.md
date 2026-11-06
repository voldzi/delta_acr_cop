# ADR0063: Fresh native session without crypto reset

Date: 2026-11-06. Decision implemented; native owner acceptance remains separate.

A recreated login can leave an expired Matrix token, pending notification removal
and no scoped original-device routing record. Ordinary provisioning bootstrap or
clearing all pending state would confuse account authority with crypto ownership.

Separate exact notification withdrawal from explicit creation of a new isolated
session for the already mapped user. Require recent verified same-owner OIDC,
strict typed inputs, existing owner/issuer/registration evidence, durable operation
CAS and active app/owner checks. Use short-lived no-device delegation solely for
exact pusher removal, with absence readback and logout. Never infer original
crypto ownership from a registration or the absence of a routing record.

Prepare reserves metadata only. Native proves the exact new namespace unused,
persists issued credentials before use, verifies whoami and commits a separate
journal. Old stores, keys, unsent records and local vehicle history are retained.
A new session does not promise recovery of earlier encrypted history. Unknown
issuance permits only explicit same-operation fresh reissue; expiry is absolute
from the saved request time. No ordinary-bootstrap fallback for CSMIOS.S.

Use the existing owner-serialized DeviceRegistry for minimal operation provenance;
existing account erasure removes that row. No new credential store in COP, schema,
role or secret. Access to owned vehicle records depends on verified identity and
vehicle authorization, independently of notification/chat repair. Dispatch, GPS
and communication producer permissions remain separately guarded.

Operational flags and complete contracts are in
[the recovery runbook](../integration/messaging-recovery/20261106_CURRENT_SESSION_RECOVERY.md).
Code tests, actual server deployment and physical phone acceptance remain distinct.
