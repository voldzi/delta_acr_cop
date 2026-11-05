# Global vehicle chat activation

Current evidence: 2026-11-05 preparation; NOT installed or enabled by this record.
Owner scope: all authorized vehicle members, until explicitly disabled.
No allowlist, synthetic-account or phone-readiness prerequisite applies to server
activation. Membership and generation checks remain mandatory.

## Frozen public bundle v1

Local: `/private/tmp/COP-global-chat-20261105-v1`.
Docker staging: `/srv/x5-production/staging/cop/work/global-vehicle-admission-2de05258-d5da-43a2-bb6b-162b33e0cc21`.

- Payload SHA256: `bb74d7041f5ab60d36dcc411cd4942d38fb2d00ab80fb584a32098fad2bcca72`.
- Installer SHA256: `f6aba6ef50b45efb65711ab02ca5b08c59bc5eaafd8f60d5c90cbc7b09d5312a`.
- Kernel SHA256: `357bea652b731c3edada0819337b65d6cdbbc99b281d5cd1d4a3f28e7b3e7581`.
- Guard SHA256: `0b1bfd37806b7fb8c46690d13396d581ff33deaefaed3f0fb26e027f2b23eef8`.
- Policy SHA256: `2944097adf1d85fff5dd9beb75bd85d279251226713dabbe2d1c1925163405ad`.

The public payload contains ten reviewed Python source assets and exact runtime
bindings, no secrets. Preserve the review manifest rather than replacing frozen
assets. New assets require a fresh bundle and fresh preview.

## Installation and execution

The one-click attended installer verifies the staged installer bytes and payload
hash before Root execution. Root authentication is required once on Docker:
its existing code-only broker deliberately cannot change configuration. The
installer installs `/usr/local/sbin/cop-vehicle-admission` with only status,
enable, disable and contain commands, no arbitrary arguments, images or shell.
COMM uses its existing app-scoped administrative access. Neither installer
changes admission flags or restarts services. Installation starts a one-hour
enable-entry clock; enabled chat has no automatic deadline. Reinstallation does
not renew that clock.

Observe both fixed status commands, enable Messaging first, read back its
accepted flag and healthy runtime, then enable COP and verify accepted flag,
health and zero restarts. COP changes only its admission flag and one Compose
mapping. Secrets are compared in RAM and never printed or backed up as plaintext.
Profiles, images, historical evidence, networks and account protections remain
bound to the reviewed state.

On failure stop activation; preserve pending evidence. Disable the accepted
Messaging stage when appropriate. If COP intake is uncertain, use contain only
for its positively verified current/pending lineage, persist OFF, and report
Root reconciliation required. Containment is not successful runtime acceptance.
Never restore an old image or delete data to clear a guard.

## Evidence and remaining acceptance

- 98 isolated Python tests passed, including historical c74 proof-reader
  compatibility, expired enable entry versus later disable, image-only child
  preservation, exact source permissions, CAS rejection and fixed scope.
- Jízda independently checked all ten frozen assets and the 98-test suite.
- Actual UID1000 on-server preview parsed existing accepted proof with the new
  reader, matched actual runtime/source/lock permissions, and verified that the
  only planned source differences are one flag and one Compose mapping. All
  other dotenv bytes were preserved in RAM. Production remained unchanged.
- Root installation, both runtime enable receipts and phone/owner/notification
  acceptance remain distinct outstanding claims until recorded after execution.

A later image update retains the historical admission proof. This bundle's OFF
operation rejects a different image rather than restoring an older writer. A
new OFF-only grant for that later current image is required before such an
update can claim complete operational disable coverage; see ADR 0062.
