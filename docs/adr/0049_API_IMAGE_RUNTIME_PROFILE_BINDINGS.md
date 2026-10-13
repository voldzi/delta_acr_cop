# 0049: COP API image and runtime profile bindings

## Status

Accepted for isolated script preparation on 2026-10-13. No production
provisioning, image build, database migration or runtime activation is claimed.
This follows [ADR 0048](0048_SESSION_AFFINE_DATABASE_ROUTES.md).

## Decision

The API database profile and the application image are separate inputs. Every
release binds an immutable image, its proven source revision, an immutable
root-controlled profile generation and the exact public owner attestation.
An atomic pointer selects the pair. A new release reuses the active profile
unless an explicitly accepted profile is selected; it always uses the newly
prepared image, never the image recorded by an earlier release.

Root keeps DSNs and the complete private compatibility proof. The deployment
owner reads only the approved `runtime.env` and public attestation under
`/etc/vcode-cop-api-runtime/<UUID>/`, root:GID1000, directories 0750 and files
0640. Public metadata contains no DSN, password, private-proof digest or hash
derived from secrets. `/srv/cop/runtime/api` contains private 0600 manifests,
unresolved Compose sources and operation records, but no secret environment.
There is no new signing secret, sudo rule, host group grant or permission
downgrade.

The API-only override uses namespaced interpolation and explicit environment
overrides. `.env`, migrations and CLI remain on the original direct path. The
four approved Compose files, project `cop`, existing networks, X5 guards,
storage lock, image guard, Sharp conversion and health gate remain mandatory.
Only image, the four profile environment fields, the approved socket/CA mounts,
GID 982 and owned provenance labels may change. Inspected live API configuration
is compared with the intended target in RAM before replacement. Drift stops the
operation without exporting configuration or secret-dependent evidence.

The original image may be adopted without recreation only with root's exact
legacy image/container/configuration witness. Its unproven source is `null`;
actual absent environment fields remain absent even after rollback. The
original container ID is an adoption witness, not a permanent requirement on a
recreated rollback container.

First deploy the reviewed compatibility image using its direct profile. A
normal route change uses the same accepted image. Explicit rollback may restore
an already accepted ancestor image/profile pair. Interrupted operations keep a
journal and block further deployment; recovery validates actual ownership,
runtime parity and CAS before any API replacement. There is no automatic
fallback to an old mutable image or to main `.env`.

## Consequences

Building a future image, obtaining fresh root compatibility acceptance, and
activating it are distinct steps. The standard wrapper has explicit build-only
and immutable deploy-only paths. OCI source labels are stamped by an API-only
build overlay, so no application Dockerfile/image change is required for this
script preparation. Other service builds do not select the API profile.

The metadata-only socket/CA probe runs in the exact root-attested immutable
image with no network, read-only mounts, capabilities dropped and GID 982. It
uses Node built-ins only, opens no database connection and receives no runtime
environment or credentials. Root's private proof owns host path integrity.

Offline fault tests and client-only Compose rendering do not prove broker
behavior, TLS, production deployment or recovery. Those remain separate owner
gates. Procedures and exact attestation shape:
[runtime profile runbook](../runbooks/24_COP_API_RUNTIME_PROFILE.md).
