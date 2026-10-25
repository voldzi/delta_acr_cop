# Reviewed COP release worker

Current status is recorded in
[the candidate report](../testing/catalog-auth-location-candidate-20261025.json).
Source/test success is not production activation.

The 25 October candidate pair is API `c06c6080…` (source `07664a7`) and web
`3606a772…` (source `8afa082`). The earlier full-source API `f9f9081…` is rejected:
its launch metadata/provenance differed from the accepted runtime. Do not arm it.

The application-owned implementation is in `scripts/release/`:

- `cop-catalog-maintain-review.py`: UID1000 read-only checks, exact final-layer
  allowlist, actual accepted Root proof reference, new generic-maintain overlay
  environment parity, native dependencies, isolated tests and bounded readiness.
- `cop-catalog-maintain-seal.py`: exact personal-Root package sealing. It retains
  historical evidence as historical and changes no accounts, database, token,
  role, network or running container.
- `cop-catalog-maintain-worker.py`: validates package integrity, index, review
  expiry and final commit marker; then uses the existing API guard. Web follows
  only after accepted API activation and fresh login/readiness checks.

The infrastructure broker has three fixed no-argument operations. Its evidence
reader correction and exact candidate-identity change require a personal Root
bootstrap; the broker deliberately cannot update its own code. No general sudo
permission is added. An authenticated operator must explicitly accept the
generic guard's lack of automatic rollback before sealing.

Run focused source tests:

```sh
python3 -I -B -m unittest discover -s scripts/release -p 'test_*.py'
```

The first personal seal attempt stopped because the worker searched for the
approval index under `releases/`; the producer writes it in the broker base
directory. The repaired common-path test uses full absolute paths, not basename
lookup. An isolated Linux integration reproduces the old failure and cleanup,
then verifies actual Root publication and UID1000 package authorization at the
correct paths. It stubs provider I/O and is not production/provider acceptance.
The fixture sources are in `scripts/release/tests/`; run them only in their
disposable container, never on a host. No host mounts, socket or network are
needed. A separate local test exercises the actual runtime guard's attestation,
configuration-proof and environment-binding consumers over synthetic files.

If sealing fails, no API/web transition has started. The sealer compares exact
owned bytes before removing its newly created index/proofs/commit marker or
restoring its previous web pin. Existing attestations and baseline evidence are
preserved. A missing commit marker prevents broker-worker activation even if an
unfinished index survived an uncatchable interruption. Do not invent an accepted
marker, extend timestamps, adopt partial state or delete the API's pending state.

If API activation fails, the existing guard may retain a pending operation. No
automatic return to an old image is authorized by this worker. Preserve its
evidence and prepare a separately reviewed recovery. A committed API followed
by a web failure likewise needs an exact diagnosis, not a whole-stack restart.

After success, verify immutable API/web identities, public/demo behavior,
anonymous/invalid-token rejection, login redirect and signed-in profile. Browser
GPS permission and a successful physical-device position remain distinct from
the automated location pending/error tests.

Build contexts, OCI exports and logs are in the COP staging area on verified X5.
They contain no production secrets or user data. Remove only owned duplicate
exports after integrity/reproducibility checks; do not prune shared builders or
images. Public analytics scope remains unchanged.
