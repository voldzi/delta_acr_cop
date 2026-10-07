# ADR 0038: COP operational storage boundary on X5

Status: accepted; production API guard, dedicated builder and daily maintenance deployed.
Date: 2026-10-07.

## Context

COP deployment archives and temporary work consume space and writes on the
internal filesystem of `docker.home.cz`. A mounted X5 ext4 filesystem is
available, identified by UUID `2f93f595-b61b-4eea-9054-7afa9b275b5b`.
The user authorized inventory, safe movement of suitable COP files and
integration with subsequent releases. Active persistent application state
requires a separate migration plan.

## Decision

Keep active deployment/configuration under `/srv/cop`. Separate COP backups,
archives, rebuildable cache and staging under their corresponding
`/srv/x5-production/<category>/cop` paths. Preserve owners, permissions,
secrets and required metadata; remove an original only after integrity and
isolated restore verification.

Every host storage operation verifies the exact X5 mount, UUID, ext4, separate
device, writability and COP permissions. A shared operation lock coordinates
deployment, snapshot and cleanup. A missing X5 fails closed, with no internal
replacement directory.

Media conversion uses an opt-in runtime guard requiring an explicit existing
directory, expected `stat.dev` and a protected regular marker with the exact
UUID on the same device. Reject symlink paths and incomplete configuration.
Production binds the marker read-only and disables automatic host-path
creation. Check before every job; deployment preflight alone cannot protect
an automatically restarted container. Refresh the expected device number only
after renewed UUID/mount verification.

Snapshots back up deployment configuration and Git only. They explicitly
exclude databases, active queues, media and untracked contents. Keep manifests
private and verify an isolated configuration restore plus a standalone Git
bundle. Do not interpret this as a database or whole-host recovery test.

Prepare 7 daily, 4 weekly and 3 monthly snapshot retention and current plus
two verified rollback releases. Backup deletion remains preview; legacy and
historical backups stay protected. Images are never deleted automatically: a
targeted removal must first verify its archived copy and repeat the check of
all current containers, protected rollback images and concurrent releases.
Cleanup applies only to tool-owned, completed,
rebuildable, unlocked jobs: 14 days and 10 GiB across such completed jobs.
Unknown, active, held, audit and historical user data remain protected.

Use a dedicated COP builder on X5 with separate bounded GC. Preserve shared
builders and Docker `data-root`; never use broad prune, remove volumes or edit
Docker's internal files. The normal deployment wrapper preserves all approved
Compose overrides, snapshots configuration and verifies health.

Rollback targets only the affected API. If old code cannot enforce the guard,
disable media conversion and retain X5 binding/configuration. Never re-enable
the internal temporary-directory path as production fallback.

## Consequences and evidence limits

The deployment archive was moved and verified, with 2 799 202 304 B of internal
allocation freed. Legacy copies remain at their original sources pending
further acceptance. PostgreSQL, active queues, external S3 and edge volume
are unchanged.

An immutable, tagless archive of 51 COP images was verified and loaded back
without changing current tags before targeted removal of 41 obsolete images
(58 tags). Ten protected COP images remain. Physical Docker space savings
cannot be independently attributed because layers are shared and other
applications were being maintained concurrently. COP X5 directories use
approximately 7.1 GiB; the file-archive saving above is independently measured.

X5 itself is not an independent backup. The user confirmed Proxmox backups of
the whole host including X5 and delegated recovery-point management to Proxmox.
A specific Proxmox recovery point is not an acceptance prerequisite for this
COP change. Full-host restoration was not tested here. The dedicated builder has verified X5 backing and
restart disabled. Its isolated build and COP-only GC with 336 hours and 10 GB
passed; the first GC released 0 B. Daily maintenance is installed at 03:17
Europe/Prague and a complete manual run passed. The deployed API-only overlay
preserves the exact prior image layers and changes the three compiled media
conversion files. Runtime code/hash, device and read-only marker were checked
in production. Two isolated jobs in the same image used real ffmpeg on X5;
wrong-device and missing-marker cases failed without internal fallback.

Post-deployment snapshots have verified isolated configuration/Git restoration;
database restoration is explicitly outside that evidence. Current and two
previous API/web versions passed isolated starts and bounded endpoint/assets
checks. This does not establish recovery of all user data. Container json-file
logs have no documented per-container size/retention options; classify audit
requirements before proposing a separate retention or migration change.

See [current operations, retention and rollback runbook](../runbooks/19_COP_X5_STORAGE.md).
