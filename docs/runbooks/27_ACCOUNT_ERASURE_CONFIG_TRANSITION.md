# 27. Account-erasure runtime configuration transition

Status: source implementation and isolated tests; not production acceptance.

## Authority and purpose

The existing immutable API deployment intentionally rejects all non-profile
configuration drift. Account-erasure installation needs one explicit reviewed
configuration transition. The human approved this exact extension in direct
reply `call_17a39e4de9084ac7ba10c28251141e97`, index0, on16October2026:
"Ano, schvaluji tento konkrétní konfigurační přechod". It does not authorize a
generic environment override or remove the existing deployment checks. The
additional three COP Edge fields were independently approved in direct reply
`call_a0644ecf51224deb8dd3066a55b3d5e6`, index0: "Ano, schvaluji tento přesný
rozsah COP Edge".

ADR0055 trusts reviewed backends and administrators. Root reviews the actual
final `.env`, source, provider closure and test evidence; a deployment user may
neither issue that review nor replace it with a caller-supplied true flag.
This mechanism does not claim protection against a malicious Root administrator.

## Fixed configuration scope

The only eligible names are:

- `COP_ACCOUNT_ERASURE_ENABLED`
- `COP_ACCOUNT_ERASURE_SECRET`
- `COP_ACCOUNT_SAFETY_GUARD_REQUIRED`
- `COP_ACCOUNT_SAFETY_AUTHORITY_MODE`
- `COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL`
- `COP_ACCOUNT_SAFETY_GUARD_STORE_ID`
- `COP_ACCOUNT_SAFETY_INCARNATION_ID`
- `COP_ACCOUNT_SAFETY_STORE_ID`
- `COP_ACCOUNT_SAFETY_RUNTIME_ATTESTATION`
- `COP_KEYCLOAK_ERASURE_CLIENT_ID`
- `COP_KEYCLOAK_ERASURE_CLIENT_SECRET`
- `COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED`
- `COP_SIM_ERASURE_ROUTER_URL`
- `COP_SIM_ERASURE_ROUTER_TOKEN`
- `COP_SIM_ERASURE_DRIVER_URL`
- `COP_SIM_ERASURE_DRIVER_TOKEN`
- `COP_LIVEKIT_ADMIN_URL` — must be empty when using the relay
- `COP_LIVEKIT_ERASURE_RELAY_URL`
- `COP_MEDIA_UPLOAD_TRANSPORT`
- `COP_MEDIA_S3_ACCESS_KEY_ID`
- `COP_MEDIA_S3_SECRET_ACCESS_KEY`
- `COP_ACCOUNT_ERASURE_EDGE_URL` — exactly `http://cop-edge:4312`
- `COP_EDGE_ADMIN_TOKEN` — the existing edge credential, forwarded without rotation
- `COP_EDGE_NODE_ID` — exactly `node_edge_pilot_01`

The existing `COP_SIM_ERASURE_ACTOR_SECRET`, Router user-ID derivation secret,
OIDC/BFF/auth settings, main/session database routes and unrelated features are
outside this scope. There are no prefix wildcards. All networks, mounts, port
bindings, supplementary groups, commands, security settings and other services
retain the existing runtime parity checks.

## Root manifest

Root installs a new regular, singly linked, non-symlinked file, mode0640,
root:GID1000, under the existing protected profile directory:

```text
/etc/vcode-cop-api-runtime/<profile UUID>/account-erasure-<transition UUID>.json
```

Its exact fields are:

| Field | Meaning |
| --- | --- |
| `contractVersion` | Exactly `cop-api-account-erasure-config-v1`. |
| `transitionId` | UUID matching the filename. |
| `operation` | `prepare`, `enable`, `pause` or `maintain`, as defined below. |
| `previous` | The complete actual `cop-api-runtime-active-v1` pointer, including generation, release, image, profile and container ID. |
| `target` | Exactly `imageId`, `sourceRevision`, `profileGeneration`, matching the separately attested target image/source and the same existing profile. |
| `changedKeys` | Sorted unique list of the exact effective environment differences between the actual old container and the intended target. Must be a subset of the fixed list above. |
| `environmentMetadata` | Exactly integer `device`, `inode`, `size`, `mtimeNs`, `ctimeNs` from the final existing `/srv/cop/.env`. |
| `composeHashes` | SHA256 of the exact four unresolved Compose files already used by the immutable deployment. No resolved configuration or inline secret is accepted. |
| `ownerAcceptance` | `true`, issued by Root after the concrete review. |
| `checks` | Exactly `jointSyntheticAcceptance`, `providerClosureVerified`, `preservesSharedIdentity`, `restoreReplayVerified`; all must reflect actual passed evidence. |

Neither the manifest nor release journal contains credential values or a digest
of credential values. The release stores the protected manifest path and its
public, non-secret SHA256. File metadata is a CAS for the approved existing
secrets file, not a cryptographic protection from administrators. A metadata
change requires a new review. Do not write a second copy of `.env` for this step.

Account-erasure environment names exported by the calling shell are rejected:
the approved final `.env` must remain the source of these values.

## Allowed operations

| Operation | Allowed difference and target |
| --- | --- |
| `prepare` | First transition only, while existing intake and guard are false/absent. Exact reviewed eligible differences; target intake false, guard true. |
| `enable` | Only `COP_ACCOUNT_ERASURE_ENABLED`: false to true. |
| `pause` | Only `COP_ACCOUNT_ERASURE_ENABLED`: true to false. Guard and all providers remain configured. |
| `maintain` | No effective configuration change. New separately reviewed image/source using the same profile and guard configuration. |

Every target requires `database_v2`, guard-required true,
`COP_ACCOUNT_SAFETY_RUNTIME_ATTESTATION=account-safety-guard-v1`, the approved
Keycloak worker `cop-account-erasure-worker`, Keycloak authority true,
`COP_MEDIA_UPLOAD_TRANSPORT=cop_api`, actual store/incarnation UUIDs, the required
server credentials and the explicit LiveKit relay. The first preparation additionally reads the
actual existing `cop-edge` peer in RAM and requires its unchanged admin token
and node ID; neither is printed or copied into evidence. The application still
performs its own real database/provider checks. These fixed labels cannot
manufacture a successful provider cleanup or restore checkpoint.

After the first accepted transition, an ordinary image-only preparation is
rejected. Every later release requires its own exact protected review. A stock
rollback, including recovery rollback, is refused after this guard boundary.
Operational return is a reviewed `pause`, retaining the guard-capable version,
permanent fences and pending operations. An older compatible guard-capable
image can only be reviewed as a fresh `maintain` release; never select the legacy
image that lacks replay protection.

## Closed installation sequence

1. Finish the shared two-synthetic-account/provider and isolated restore tests.
   Root verifies the current CID/generation and the separately reviewed candidate
   image/source. Preserve `/srv/cop` operational changes and its existing profile.
2. Under the existing deployment/storage locks, complete DB enrollment, scoped
   Keycloak/SIM credentials and real media closure. Write only the existing
   approved production secrets destinations, keeping intake false.
3. Root reviews the final `.env`, exact unresolved Compose bytes and actual
   evidence, then writes the protected manifest. Also publish the normal fresh
   `cop-api-runtime-attestation-v1` for that exact image/source/profile. The new
   manifest does not replace that normal attestation.
4. Prepare through the existing runtime helper with the additional explicit
   `--account-erasure-config` argument. `--expect-active` is the actual generation
   pinned in the protected manifest. Activate the returned release through the
   existing `activate --release … --expect-active …` path.
5. Activation checks the exact old CID, manifest/environment/Compose CAS,
   complete actual environment difference and every previous parity gate. The
   temporary exception is bound to the old CID only. Post-start checks require
   the complete target configuration, unchanged peers and the existing health
   gate before publishing the new active pointer.
6. Verify production readiness and synthetic behavior. Enabling intake is a
   separate `enable` manifest/activation in the same coordinated release run.
   Jízda physical acceptance remains necessary before a product-completion claim.

The ordinary initial `validate` cannot validate an old running container against
a newly approved, changed `.env`. The explicit configuration branch uses the
protected manifest's previous generation and the full preparation/activation
checks above; it must not weaken ordinary `validate` or use plain Compose `up`.
The normal image-only branch remains unchanged.

No installer command for a real production release is implied by this document.
Its exact images, commits, current CID, Root manifest and test evidence must be
filled from the completed shared run. Historical image attestations and copied
true booleans are not acceptance for a new version.

## Interruption and verified scope

An interrupted target retains the existing durable pending journal. Recovery
can finalize the same owned target after full parity and health checks without
another recreation. An env/proof/CID mismatch remains pending; it cannot silently
rebase or fall back to the legacy image. Changed `.env` during health acceptance
prevents publication of the new active pointer.

Local verification on16October2026:

- Existing53 offline runtime faults remain passing.
- Nineteen new offline fault groups cover the explicit transition, pause/enable,
  maintained image, proof and `.env`/Compose tampering, changed identity/auth,
  wrong image/source/profile/CID, unsafe shell overrides, missing credentials,
  mount changes, interrupted recovery, acceptance-time config mutation and exact
  edge credential/origin binding. Pausing intake does not require a fresh edge
  provider probe because that operation cannot change its credentials. Initial
  preparation pins the same actual edge container until API activation.
- Two real Compose-client configuration tests pass; they render only synthetic
  values and do not contact Docker or production services.

These are deployment-mechanism tests, not shared provider effects, privileged
production installation, whole-account deletion, physical restore or iPhone
acceptance. No production mutation was performed by this source work.
