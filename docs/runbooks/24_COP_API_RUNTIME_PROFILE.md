# 24. COP API immutable image and runtime profile

## Scope and state

This is a prepared deployment mechanism, not production activation evidence.
It changes scripts and operational metadata only. The exact reviewed API image
can be activated without rebuilding it. See [ADR 0049](../adr/0049_API_IMAGE_RUNTIME_PROFILE_BINDINGS.md)
and the existing [X5 gates](19_COP_X5_STORAGE.md).

## Owner-controlled layout

| Path | Owner and permissions | Contents |
| --- | --- | --- |
| `/etc/vcode-cop-api-runtime` and `<UUID>/` | root:GID1000, 0750 | Root-controlled generations |
| `<UUID>/runtime.env` | root:GID1000, 0640 | Exactly three private namespaced DSNs |
| `<UUID>/attestation-<image-sha256-without-prefix>.json` | root:GID1000, 0640 | Public compatibility acceptance for this image/source/generation |
| `/srv/cop/runtime/api` and children | deployment owner, 0700 | Active pointer, releases and pending operation journal |
| Files below `/srv/cop/runtime/api` | deployment owner, 0600 | Safe references and metadata; no DSNs |
| `releases/<release-id>/accepted-health.json` | deployment owner, 0600 | Previously accepted public health statuses bound to the exact DIRECT pair and historical CID |

Root provisions these paths before use. Files must be regular, singly linked
and non-symlinked; the generation parents must satisfy the root ownership and
mode checks. The helper neither reads root's complete 0600 proof nor changes its
permissions. The runtime generation file is never mounted into the API,
snapshotted, committed, logged or copied into a build context.

`runtime.env` has exactly these names, one single-quoted value per line:

```text
COP_API_RUNTIME_DATABASE_URL='<root-provisioned URI>'
COP_API_RUNTIME_LEASE_DATABASE_URL='<root-provisioned URI or empty>'
COP_API_RUNTIME_STREAM_BUS_DATABASE_URL='<root-provisioned URI or empty>'
```

This is a shape example, not a usable configuration. URI quotes must be percent
encoded. Never source this file. Single quotes preserve literal `$` and
`${...}`. Pool mode and immutable image ID are public per-release interpolation
values in `image.env`. Existing Compose `environment` entries override
`env_file`, so the generated API overlay explicitly selects all profile fields.
Compose config serialization doubles dollar signs; the helper decodes that
serialization once in RAM for verification and never feeds the resolved model
back to Compose.

Unresolved `config --no-interpolate --no-env-resolution` may serialize a
service environment as a string list instead of a map. The source reader
normalizes that legitimate list by splitting only the first `=`, retaining
unresolved expressions and literal dollar/equal signs exactly. Every list entry
must contain `=`; bare list keys are rejected. Existing map `null` values retain
their semantics. Missing environment blocks stay missing; malformed entries,
invalid names and duplicate keys cause STOP before release copies are written.
The resolved-config dollar decoder is never used on these unresolved values.

Main `/srv/cop/.env` is unchanged. Migrations and CLI keep its direct database
route. Global SSL and memory-stream flags are preserved; the profile replaces
only `COP_DATABASE_URL`, `COP_DATABASE_POOL_MODE`, `COP_LEASE_DATABASE_URL` and
`COP_STREAM_BUS_DATABASE_URL` in the API container.

## Exact public attestation

The following synthetic example shows all allowed fields. Unknown fields at
any schema level are rejected. Root must replace the synthetic generation,
image, source and public CA fingerprint with its verified values. A public
attestation is acceptance evidence, not an automatic deployment GO.

```json
{
  "contractVersion": "cop-api-runtime-attestation-v1",
  "application": "cop",
  "service": "cop-api",
  "profileGeneration": "00000000-0000-0000-0000-000000000001",
  "imageId": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  "sourceRevision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "kind": "candidate",
  "ownerAcceptance": true,
  "driverContract": {
    "poolMode": "transaction",
    "streamMode": "memory",
    "mainEnvAndMigrations": "direct",
    "frontend": "unix",
    "socketPath": "/run/vcode-cop-pgbouncer",
    "socketPort": 6432,
    "supplementaryGid": 982,
    "caPath": "/etc/vcode-cop-pgbouncer/postgres-ca.crt",
    "caSha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "leasePath": "direct_verify_full",
    "backendBudget": 10,
    "clientBudget": 80
  },
  "checks": {
    "x5RuntimeGuard": true,
    "sharpConversion": true,
    "databaseRouting": true,
    "acceptedBaselineRollback": false
  },
  "legacyContainerId": null,
  "legacyEnvPresence": null
}
```

For `direct`/`session`, `frontend` equals `poolMode`, `leasePath` is `direct`
and socket/port/GID/CA/fingerprint/budget fields are `null`. The memory stream
and direct main `.env` declaration remain mandatory.

For original legacy adoption only: `kind=accepted-baseline`, source is `null`,
pool mode is `direct`, `acceptedBaselineRollback=true`, and root supplies the
actual original 64-hex container witness. `legacyEnvPresence` is exactly the
four boolean fields. The witnessed origin has database URL and stream URL
present, pool mode and lease URL absent. A whole `environment: !override` map
preserves those absences, including when base Compose or shell supplies them.
Only this saved accepted baseline can bypass the newer image capability gate.
The witness never invents an OCI source label for the original image.

The release records the SHA256 of these exact public attestation bytes. It
never records a hash of DSNs or of root's private proof. Every future image
needs fresh source/image compatibility proof and its own public attestation,
even when it reuses the same immutable profile generation.

## Fixed runtime gates

The project is `cop`; files are used in this exact order:

1. `docker-compose.yml`
2. `docker-compose.driver-measurements.yml`
3. `docker-compose.x5.yml`
4. `docker-compose.ai-router.yml`

The helper pins the existing three network identities in source. Missing any
file or changing a network stops the operation. All Docker calls are explicitly
bound to the local Unix daemon; foreign host/context and TLS overrides cannot
redirect build or activation.

Before replacement, inspect the actual current API and compare intended target
environment (including image defaults), port bindings, resources, command,
health check, security, restart, mounts, supplementary groups and labels in RAM.
Only the accepted image/profile delta is permitted. Changed auth/BFF/lab values,
an unknown runtime option, a foreign CID/image/label, altered source metadata,
pending journal or pointer CAS mismatch causes STOP. Do not print raw Compose
config, container environment or subprocess stderr to diagnose a rejection.

The known original image lacks `org.opencontainers.image.base.name`; the
reviewed compatibility image has exactly
`node@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a`.
Transition comparison permits only that image-provenance addition/removal,
without a Compose label override. Post-up label equality remains strict.

Transaction mode adds only read-only socket directory and CA leaf bind mounts
with `create_host_path:false`, plus API group 982. Deployment UID1000 requires
no host traversal grant: a fixed metadata-only container probe uses the exact
attested image, `--network none --read-only --cap-drop ALL --group-add 982`,
read-only `--mount` sources and Node built-ins. It checks socket type/group,
directory permissions, CA file metadata and public certificate SHA. It receives
no DSN/env, loads no application module, and never connects to the socket. A
missing source fails instead of creating a host directory. Root's protected
proof must establish host parent/path integrity before acceptance.

## Coordinated workflow on docker.home.cz

Root first provisions and attests the original direct profile. Under the common
storage lock, prepare its accepted baseline with `--baseline --expect-active
absent`, then `activate --adopt`. This records the pair without recreation;
the actual image/container/environment/networks must match the root witness.

For an already reviewed immutable image, use the standard entry point:

```bash
bash scripts/deploy-production.sh --api-image "$reviewed_image" \
  --api-source "$reviewed_source" --api-attestation "$public_attestation"
```

The shell variables above are public metadata, not secrets. This mode is
API-only and does not bootstrap a builder or build/pull an image. It prepares a
fresh binding, preserves the active profile and invokes exactly
`up -d --no-build --pull never --no-deps cop-api`. Use `--api-profile` only for
an explicitly accepted generation; first move the reviewed compatibility image
to direct mode, then change its route using the same image.

For a future release:

1. Commit/review clean application source; untracked build input is rejected.
2. Run `bash scripts/deploy-production.sh --build-only cop-api` under build-only
   authority. The API build label overlay stamps its actual Git source. Other
   services and the API remain running. Record the resulting immutable image.
3. Root reviews that new image/source/profile and publishes its fresh public
   attestation; no initial-image or old-proof reuse is allowed.
4. Use the immutable deploy-only command above after runtime GO. The active
   profile is preserved while the newly built image gets a new binding.

The normal `cop-api` service build path also validates active state first and
requires fresh acceptance before activation. It never selects the saved
manifest image instead of the new build. Mixed service requests complete API
preparation before any service update; invalid API state blocks the whole mixed
mutation. X5 mount/UUID gates, FD9 common lock and FD8/7 job locks remain in place.
Jobs are completed only after terminal worker commands and health acceptance.

## Interruption and whole-pair rollback

`pending.json` blocks all further deployment. Recovery inspects one API
container including stopped/exited containers; it validates previous or owned
target image/profile/labels, saved CID when available, runtime parity and CAS.
A foreign instance is never overwritten. Health failure does not weaken gates.
For explicit restoration of an accepted DIRECT pair, source TX socket/CA
availability is not required: protected source profile/attestation integrity,
actual CID/image/labels, full runtime parity and accepted ancestry still apply.
The availability probe remains mandatory for any target TX activation or
completion. Completion of an interrupted DIRECT restoration verifies its
accepted ancestry without requiring the failed source TX endpoint. A failed
broker therefore cannot block owned DIRECT recovery.

Successful DIRECT acceptance records a health witness from the real post-up
health verification. Its closed envelope contains only public status metadata,
release/image/source/profile references, the actually observed container ID and
UTC acceptance time. `acceptedHealthSha256` in the private release manifest
binds the exact 0600 witness bytes; no DSNs or secret-dependent digests are
stored. The original observation is preserved across later recreations. Its
historical CID is separate from the current live CID/CAS requirement.

Legacy adoption obtains its witness only through real capture and verification
on the unchanged original container, with CID/image/profile/runtime checks
before and after. It creates no replacement container and proves no offline
restore capability. Capture or verification failure causes STOP, with no
invented/default health witness. Prepared releases initially have a null health
hash; they cannot serve as completed DIRECT rollback targets without actual
acceptance evidence.

Completed DIRECT rollback uses that previously accepted, hash/scope-checked
witness as its health baseline. It does not attempt to capture an exited or
unobservable source API. After replacement, health verification against the
stored baseline remains mandatory before publishing the new active pointer.
Witness tampering, missing evidence or failed post-restore verification causes
STOP. Interrupted completion also checks the copied baseline against the bound
witness. Ordinary pending recovery retains its existing previous health
snapshot. Source availability exemptions do not weaken ownership, protected
profile/attestation integrity, ancestry or full runtime parity.

After explicit recovery GO, `recover --expect-active <generation>` completes an
owned healthy target without another recreation. Add `--rollback` to restore
the recorded previous image/profile pair. If it is already restored, recovery
does not recreate it. A successful rollback records the actual new container
ID, preserving the origin witness only as historical adoption evidence.

After a completed operation, `activate --release <accepted-ancestor-release>
--expect-active <generation> --rollback` restores a previously accepted whole
pair. Unaccepted prepared releases cannot be rollback targets. It preserves the
original profile, absence of legacy environment fields, original mounts and
direct route, and uses the saved accepted baseline exception only where needed.

The primary rollback after the first transaction change is the reviewed
compatibility image with its accepted direct profile. Its package-manager
cache was independently verified offline by the infrastructure owner. The
legacy R0 image is retained only as a coherent last-resort pair: its original
running container has a mutable package-manager cache, while an independent
immutable-image `pnpm --version` check failed. Restoring that image depends on
availability of the required public Corepack/NPM package-manager artifact.
Neither an alive original container nor adoption of its witness proves an
offline-restorable legacy image. Coordinate that dependency before a legacy
rollback; it is not the primary transaction rollback or an automatic fallback.

If live non-profile configuration has drifted, both recovery and rollback STOP.
Coordinate that drift separately; do not overwrite `.env`, guess the old values,
clear a pending journal or use plain mutable Compose up to bypass the gate.

## Local verification and remaining gates

```bash
python3 -B scripts/tests/test-cop-api-runtime.py
python3 -B scripts/tests/test-cop-api-runtime-compose.py
bash -n scripts/deploy-production.sh
bash scripts/validate-skeleton.sh
git diff --check
```

The fault suite uses a complete fake and no real Docker or network. The separate
Compose test invokes only `config` on synthetic files, with no Docker daemon,
server, images or real secrets. It proves literal-dollar serialization handling
and true legacy key omission despite conflicting shell/base values.

Local verification on 2026-10-13: 50 offline fault tests passed, plus two
Compose-client tests (source list normalization and candidate/legacy rendering) on Compose
5.5.1. Shell syntax, skeleton validation and diff whitespace checks passed.
The existing public analytics release guard separately passed in the owner
operations workspace. No web, collector or analytics activation change is part
of this patch. Server Compose compatibility must still pass the same fail-closed
render gate before deployment.

The independent review accepts the current immutable API deploy-only path.
The standard build branch has not been verified under SSH disconnection or
signals; foreground CLI exit alone is not independent BuildKit terminal proof.
Use the infrastructure owner's separately reviewed build runner and terminal
receipt for such controlled builds. Do not interpret this source acceptance as
proof of build-worker recovery or safe concurrent redispatch.

Production permissions/provisioning, exact current runtime parity, root private
proof, real broker affinity/TLS, direct compatibility rollout, transaction
activation and live rollback remain owner gates. Local tests do not establish
any of those facts. Off-server backups and X5 restore gates remain in the X5
runbook; this mechanism deletes no images, backups, volumes or application data.
