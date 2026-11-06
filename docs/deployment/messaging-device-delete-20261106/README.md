# Messaging device DELETE: production deployment, 6 November 2026

COP deployed the reviewed exact policy through the existing DMZ guest-agent
transport. No administrator-thread delegation, new SSH permissions, network
connection, identity change or account reset was involved.

## Live result

Only `/etc/modsecurity/crs/REQUEST-900-HOME-APP-METHODS.conf` changed.
The exact before/after hashes, immutable review/release references, native syntax
check, graceful reload, readback and health GET 200 are recorded in
[normalized receipt](deployment-receipt.normalized.json). The other five pinned
configuration files were unchanged. Temporary staging inputs were removed.

The [policy fragment](candidate.conf) is byte-for-byte the reviewed candidate.
Its historical REVIEW ONLY header describes its original review provenance;
actual deployment authorization and results are in the release and deployment
receipts. It appends DELETE to the per-transaction method list only for the exact
Messaging host and canonical device-removal path, without query or extra path
segments. CRS method and anomaly rules remain active. OIDC and device ownership
checks are unchanged.

After deployment, one unauthenticated DELETE to a newly generated nonexistent
synthetic item returned application JSON `401 UNAUTHORIZED`:
[negative boundary receipt](postdeploy-unauthorized-test.json). No real device or
registration was removed. This establishes WAF passage and continued application
authentication, not successful owner cleanup or Matrix-token recovery.

## Raw receipt interpretation

[Raw apply receipt](apply-receipt.json) includes staging-only fields
`productionConfigWritten=false`, `reload=false`, `httpRequests=0`. Its final
operation state separately records `applied`, `configWritten`, `reloadVerified`
and exact live hashes. The normalized receipt preserves this distinction; it
does not rewrite the raw evidence.

## Rollback and persistence

Root backup: `/var/backups/cop-msg-device-delete-method-v2`. Restore only the
recorded app-methods file after verifying the exact current after-hash and backup
before-hash. Run native nginx syntax validation before reload, then verify
readback and health. Do not restore all six configuration files or remove CRS
protections. Rollback was prepared, not exercised in production.

The fragment and exact hashes here are the application release record. Any
subsequent DMZ configuration deployment must preserve or explicitly supersede
this policy; this repository does not claim control of another repository's
configuration management.

## Separate native blocker

Jízda 1.2 (82) read-only owner preflight returned `cacheMissing`. This means the
specific selected/derived cache lookup was absent, not that all encrypted stores
or original credentials are gone. Matrix `401 M_UNKNOWN_TOKEN` and restoration
are not declared fixed. No ordinary bootstrap/relogin, device recreation,
pending reset, local history removal or owner cleanup retry was performed.

## Implemented native repair handoff

The shared lookup has now been integrated by Jízda and passed 75 actual SDK
tests, including the model path from missing selected key to exact recorded
original cache, refresh/whoami and exact-pusher removal, without new bootstrap
or configuration. [Source/test handoff](native-recovery-handoff.json) records
actual source hashes and the test-log digest. The completed/prepared/resumable
journal semantics remain preserved. Debug, Release and signed iPhone application builds also passed (their log
digests are in the handoff). Owner-phone acceptance remains separate: build 83
was prepared, but the owner recovery outcome is not asserted by these tests or
builds. The first phone step is read-only route/lookup/original-pair diagnostics;
no cleanup retry is allowed without the exact prerequisites.
