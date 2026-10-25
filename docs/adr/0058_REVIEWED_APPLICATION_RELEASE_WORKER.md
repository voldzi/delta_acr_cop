# ADR 0058: Reviewed application release worker

Status: source candidate; the infrastructure broker is installed unarmed, and
the application package is not yet installed or activated.

COP owns application fixes, candidate builds, compatibility checks, release
workers and live verification. Infrastructure owns installation of the narrow
Root broker and sudo policy. SIM reviews its service boundaries.

The broker permits only status, read-only evidence and execution of an exact
Root-sealed API/web pair. It runs application code as the existing deployment
user. It does not expose a Root shell, arbitrary command, path, environment or
self-update operation. The application worker retains the existing API runtime
guard, profile, topology and account-erasure authority.

For this image-only maintain operation, accepted historical joint/restore
evidence retains its original timestamp and image bindings. It is not a new
candidate joint/restore test. A fresh Root review must establish its actual
accepted proof lineage, unchanged erasure code/dependencies/configuration and
current bounded owner-readiness observation. New deletion permission is not
derived from a public health response.

The candidate is a derivative of the actual accepted image. Its single added
layer must contain exactly the reviewed server file and regression test, with
unchanged parent directory metadata. Configuration changes only the source
revision label. Broader application changes require their own review.

Root sealing performs a nonmutating worker preflight under the broker lock.
Only a final Root commit marker permits ordinary preflight/activation. Caught
publication failures and termination requests remove only this attempt's exact
new grants/index and restore its previous web pin. SIGKILL or power loss still
requires inspection; no automatic adoption, reset or pending deletion is allowed.

The broker/worker review window does not replace the existing deployment user's
separate runtime-guard authority. New image pairs still require a legitimate
Root seal. This is not general passwordless sudo or autonomous approval of
arbitrary future versions.

See [the runbook](../runbooks/32_REVIEWED_COP_RELEASE_WORKER.md).
