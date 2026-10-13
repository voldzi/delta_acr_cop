# COP measurement-only release candidate — 2026-10-13

## State and source boundary

Prepared and tested source only. No production image has been built or replaced,
and no runtime flag changed in this preparation. The global infrastructure
maintenance window is released, but the measurement slot and its user acceptance
are still pending. Auth/lab removal and COP PgBouncer cutover remain separate.

This candidate starts directly at the deployed application source
`3a0101270bfb59b9bcf61eb2126588fc1f688fe7` and cherry-picks only the measurement
delta from `991b038c8e9af07641ae2485b914881ebe4e9d69`. It does not include the
`f84fe6f` nullable-expiry change, the `49204b` lease routes, or their configurations.
The original 991 branch must not be deployed as the whole candidate because its
parent includes the still undeployed expiry followup.

The current read-only baseline at **2026-10-13 09:33:35 CEST** confirms container
`7e83bac61b720bef264db39058de3ab7acacefe2b2edc53dd62aeb21013a2400`, image
`sha256:6d3fedf34265e4697fcea6dc23c38fc531a2d0f0eae45451671f71b86561b5a3`.
All seven selected compiled module hashes match the recorded 3a source stage:
server, security, pool wrapper, stream, SIM search/page and situation adapters.
This binds the selected unchanged modules to the current runtime, not a complete
build provenance attestation. The receipt contains no secrets or user data:
[baseline](../archive/20261013_COP_MEASUREMENT_BASELINE.json).

## Bounded application delta

Only the four existing native driver measurement operations change:

| Operation | Change | Preserved boundary |
| --- | --- | --- |
| GET consent | Optional fixed `userStatus`; one UTC snapshot | Own verified identity, `canGrant`, pending deletion |
| POST consent | Optional status receipt | Explicit individual grant; strict body |
| DELETE consent | Optional pending/completed status | 202 pending versus 200 completed deletion |
| POST batches | Optional accepted/partial/duplicate/unusable status and fixed error messages | Strict batch, per-user IDs, limits and `shadow_only` |

JSON OpenAPI and generated YAML add only optional receipt fields. No endpoint,
database schema, upload history or raw GPS storage/logging is introduced.
Server registration, authentication/service bindings, browser/native clients,
AI/model routing, Messaging, database targets/pools, Dockerfiles, lockfile and
deployment scripts are unchanged against 3a.

## Current and proposed flags

| Setting | Current effective value | Planned value after joint acceptance |
| --- | --- | --- |
| `COP_DRIVER_MEASUREMENTS_ENABLED` | `true` | `true` |
| `COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED` | `true` | `true` |
| `COP_DRIVER_MEASUREMENTS_PILOT_ENABLED` | `true` | `false` |
| `COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID` | `csm-mobile` | `csm-mobile` |
| `COP_AUTH_MODE` | `hybrid` | `hybrid` |
| `COP_ALLOW_LAB_TOKEN` | `true` | `true` |
| `COP_WEB_BFF_SESSION_ENABLED` | `true` | `true` |

The global OIDC required-role restriction is absent in the effective baseline.
Do not modify its authentication policy. The pilot list can remain untouched
when its filter is explicitly false; no subject identifiers are part of this
handoff. Existing HMAC, SIM service credentials, networks, volumes and database
routes stay in place. Opening intake never grants consent automatically.

## Verification and staged acceptance

On this actual runtime base, 35 measurement/contract tests pass; one optional
PostgreSQL test is skipped because no isolated test DB is attached to this run.
API TypeScript build, selected ESLint and skeleton validation pass. The original
delta's schema/OpenAPI/YAML and independent review results remain applicable;
only its application parent changed, with no merge conflict or code edit.

Before release, agree one slot and the exact published source pin with SIM and
infrastructure. Preserve the current login path and direct DB. The standard
release procedure is `scripts/deploy-production.sh cop-api`, with all four
production overlays, X5 checks, an exclude-env snapshot, Sharp/storage guards
and the unchanged health comparator. Record the resolved base image and actual
new runtime: unchanged source/lockfile alone does not prove unchanged base OS
or packages. Do not rebuild another COP service.

First release the compatible API with the pilot filter still true. Verify
unchanged web/native login and the native user's own consent/status receipt.
The Mac was locked during this preparation, so the refreshed web profile is
not accepted here. A service token or synthetic JWT test does not replace user
acceptance. Confirm SIM's deployed report and unchanged v1 contract before
opening the filter to all accounts.

The activation stage changes only the pilot-filter flag. Jointly check two
ordinary native accounts: no automatic grant, individual consent, own receipt,
isolation, 429/retry, 503, revocation/pending completion and absence from SIM
aggregates. Jízda's receipt UI and production collection gate are separate
client work; server activation cannot enable either. No live-speed or ETA use
is activated by this release.

## Rollback

Preserve the exact baseline image and all overlays. To stop new intake set only
`COP_DRIVER_MEASUREMENTS_ENABLED=false`; keep cleanup true, HMAC and SIM access
so revocation and pending deletion continue. Restore the verified baseline API
image without rebuilding or replacing other services. Do not restore a whole
secrets file, weaken auth or silently switch a database endpoint. Recheck health,
login and pending cleanup independently.

Full mobile semantics and acceptance checklist:
[measurement handoff](../integration/22_JIZDA_DRIVER_MEASUREMENTS_COP_HANDOFF.md).
