# ADR 0062: Explicit global vehicle chat admission

Status: accepted design; installation and runtime acceptance are separate.
Date: 2026-11-05.

The owner requested ordinary shared vehicle chat for every authorized vehicle
member until explicitly disabled. This supersedes the proposed synthetic-only
activation window as an activation prerequisite. Membership authorization,
revocation, account erasure and room generations remain enforced.

Use a distinct `cop-global-vehicle-admission-release-v1` authority. Its one-hour
entry deadline limits the enable operation, not the lifetime of enabled chat.
The Root installer seals a public manifest, exact images and current runtime
bindings. It installs only four fixed operations: status, enable, disable and
contain. It neither enables admission nor restarts an application. The ordinary
image-release broker remains code-only; historical proof readers are preserved.

Enable Messaging admission before COP intake. Verify each accepted runtime,
flag, health and restart count. Uncertain transitions cannot be replayed as
successful; preserve their evidence and contain only positively bound COP
intake. No old writer image is restored. Disable does not delete conversations.

The grant supports only its reviewed image lineage. A later code-only image
release preserves the accepted historical admission proof, but this old grant
cannot turn that later image off. Such a release requires a fresh OFF-only grant
bound to its actual image, generation and cleanup implementation, retaining the
historical decoder. This future grant is not implemented by this bundle.

Server activation is independent of phone availability. Server ON is not proof
of native acceptance, owner acceptance, notification delivery or completion of
the thirteen-case device scenario. No API schema changes are introduced.

See the [activation runbook](../deployment/shared-vehicle-communication/global-activation.md).
