# ADR0061: Application-owned, code-only COP API releases

Date:2026-11-04. Decision installed; successful candidate activation is a separate
acceptance surface and has not been established by this ADR.

COP needs to own normal application releases without repeated administrator
password prompts or delegation to infrastructure maintenance. The old fixed
login/location broker cannot authorize a different candidate merely by changing
its pins. General sudo and infrastructure maintenance authority are unnecessary.

Use a Root-owned broker with exactly status,prepare,activate and no shell,
caller-supplied path, image, environment or Docker arguments. Its unprivileged
request contains only a published approved source revision and expected runtime
generation. Root copies source by file descriptors, checks every Git blob and
read-only custody, pins the Dockerfile and Node base, verifies the dedicated X5
builder, runs actual image tests plus compatibility probes and seals a fresh
image-only case. Initial immutable source/image/build evidence is separately
pinned. Builds run as the existing application account. The worker runs as that
account; it cannot edit Root policy, cases or keys.

The extension dispatches historical proof versions to their unchanged reader.
It preserves the exact previous release bytes, environment metadata, full
effective environment, mounts, networks, profile, driver contract and erasure
checks. Fresh case evidence binds source generation, container/process, baseline,
target, actual tests and compatibility. It cannot change configuration, rotate
credentials, grant roles or deploy another service. Missing X5 refuses work.

Install only three NOSETENV NOPASSWD command forms. No generic sudo, Docker
permission expansion, root shell API or persistent terminal bridge is added.
The attended temporary Root session is separate and must close after use.
Root library changes require their own attended installation; publishing a Git
commit cannot update privileged host code.

There is no automatic rollback. A failed guarded activation leaves pending
state for explicit reconciliation. Manual recovery needs a specific approved
scope, paused intake, proof of no new vehicle enrollment and fresh bound checks;
it preserves original failed evidence. Health failures are not positive evidence.
The4November candidate and the attempted prior-image return both encountered
cold-start failure. The paired release document records actual state and gaps.

Validation includes proof mutation/expiry, full environment and source CAS,
private-file/command scope, healthy exact instance/no-pending status, the exact
legacy volume exception and PostgreSQL diagnostic callback interoperability.
Synthetic tests, actual image tests, guarded live activation and native phone
acceptance remain distinct claims.
