# COP planning: fresh one-flag enable, source V4

This is a source and operator protocol, not a production acceptance receipt.
Root alone installs or executes it after the directly approved scope and actual
live tests. COP source authors perform no host operations.

## Exact scope and historical boundary

COP remains image `6cdf302ea305e7fa58a11a1f9139deccd9f5b70cd0982a7ce87cd6b70d9d5c30`,
derived source `7c43b690edf687fefc04e17533894d118f457276`. SIM is image
`d33daddc75101cf1e137545ca76613fc861497066197b39eed75e8c96ba7a489`, source
`84b85cd94051095eb6038f8501ca8f411e1cc37e`.

The only application configuration mutation is the existing assignment
`COP_ROUTING_PLANNING_ENABLED=false` to `true` in `/srv/cop/.env`.
All four Compose files remain byte-identical. Existing token, URL, accounts,
roles, models, erasure guards, networks, ports, mounts and resources cannot change.
COP API is recreated once through the existing guarded prepare/activate path.

The old A0 V3 case, its clock, producer proof and kernel remain untouched.
V3 fixes SIM 224dd and limits each new proof to the old case's one-hour window;
therefore a fresh GO alone cannot lawfully enable the new SIM after that window.
V4 adds a separate immutable case/reference and preserves V3 historical readers.
It does not extend an expired case or change the meaning of an old PASS/FAIL.

## Frozen source

Revision 2 below replaces the unused E0d5/92b source after the pre-write 8bd
failure described below. Original failed records and protected files remain.

Under `scripts/planning-enable-v4/`:

| File | SHA-256 |
| --- | --- |
| `kernel.py` | `f847d23d9200fa80b98bbefef6214c4a0048c041a43dbe8b83faded1ae33142d` |
| `constructor.py` | `8b891393f30b2e9aa481409f32c8fc7e76c75fd492877e483a35d8994010d226` |
| `proposal.py` | `184891efd8f2f2db82dbf7188402560f1a2f72a331bf48af22748641d93d284e` |
| `test_kernel.py` | `b7d740fe9dc1949e1753b597061d6169d3fbaedcd1f53764553883f86a109437` |

The pure constructor accepts only the actual deployed guard
`7ad48b1ba4f83ec78b287e14308a78e663a62408d8e2b3b40a8513cbd36e098f`.
It derives candidate
`a56a57532e6ce4a6a8dc15ba608fbbe63f1f10fe4d80c3540bd08e4c67bb7390`.
It changes the fixed kernel pin and adds one proof version to the seven existing
dispatch branches and the accepted version set. No other original guard byte
changes; a reversal test reconstructs the complete original byte sequence.

Protected targets are `/srv/cop/scripts/cop-api-runtime.py` and the new
hash-named kernel under
`/etc/vcode-cop-api-runtime/206c4507-5e00-458e-b0ee-4061309aa7a8/`.
Original source line 721 is the kernel pin; dispatch sites are original lines
878, 1874, 2001, 2069, 2080, 2194 and 2695. The old protected kernel
`78efa038f2f49893502c9d62d2724881c744d124d95aec915a7a0a0bb37f5acd`
must remain present for all historical readers.

Health uses the unchanged adapter `e7eb01a0b41dcbbcfda0652a4d322c5f0d5d0eb4b6c411e1e6db174d8a596066`,
which itself verifies the original health gate `010f32…`. These two pins are
different objects. The complete health function body, adapter constant and
actual adapter bytes are tested against V3; 120-second readiness, zero restarts
and original endpoint/parser criteria remain mandatory.

## Concrete Root protocol

Root owns `operations/cop_enable_v4_root_once.py` in the infrastructure checkout.
Preparation and execution must be separately sealed under approval reference
`call_28f207b0e628412cb562380817407b57`. The source package itself supplies no GO.
Initial operation `8bd8a6fe-4406-43cd-8e16-58a9cb04c174` stopped before guard or
environment writes: its first kernel incorrectly passed the complete three-field
parent binding to the unchanged legacy two-field reference validator. Guard 7ad,
original environment bytes, healthy COP, pointer and pending absence were
independently confirmed afterward. That failed operation is not replayed.

Revision 2 validates the exact optional `cleanScope= cop_sim_shared_identity_v1`
and projects only path/hash into the real unchanged legacy validator, while
retaining the **complete** reference for case/proof/lineage comparisons and inverse
parent reads. Unknown fields/scope and stripping the original scope are rejected.
The actual public parent filename/hash shape is now a regression fixture. No
regex rewrite or historical-reader change was necessary. A new Root operation,
fresh GO and exact candidate pin are required for execution.

1. Independently pin the complete source bundle/controller and derived guard.
   Verify the original guard, current COP pointer/CID, source files and modes,
   healthy zero-restart COP/SIM, unchanged SIM lifecycle/configuration and actual
   sealed live evidence. Create a fresh Root-owned operation and at most
   900-second GO. Never retime C211, C5 or A0.
2. Under the existing storage lock and pinned `InstallDirectory`, recheck the
   pointer, pending absence, original environment metadata, all Compose hashes,
   full runtime and receiver bindings. Preserve a Root-private original guard
   and authorized environment backup. Neither backup nor its contents may be
   transferred to a workstation, log or Git.
3. Use `proposal.propose(r, store, k, 'enable')`, or the identical exported
   `toggle_flag`/`env_plan`/`compose_plan` functions. `proposal.py` does not load a
   credential adapter. Rendering injects only the public flag, retaining the
   existing token from the same production environment. Compare all other
   rendered service, network, volume and resource fields exactly.
4. Capture the fixed source health using the original bounded collector and
   UID1000 child path under the parent's already-held lock. The Root capture
   clone changes only the case UUID to the new exact operation. Record the
   original source/pointer and require unchanged receiver state after capture.
5. Build and validate a RAM preview of the new case, acceptance and proof,
   including actual parent lineage, **before** installing or changing the flag.
   Publish only new protected files. Install the exact derived guard through the
   existing `h.install`; that helper backs up the original guard and performs
   owner/mode/inode CAS. Original case/proof/module files are never overwritten.
6. Use the existing `io.atomic_replace` for the single environment change with
   original byte/inode metadata CAS. Read back exact target bytes, unchanged
   Compose bytes and render. Fill the actual target metadata in the new proof;
   validate it and publish `account-erasure-<new UUID>.json` plus the fixed health
   baseline before delegation.
7. Existing `worker_bootstrap` and `forward_worker.prepare/activate/read-active`
   remain the child interface. The wrapper supplies their existing
   `need/IMAGE/SOURCE/PROFILE/evidence/read_proof/health_scope` interface. Each
   attempt gets an immutable started record; uncertain outcomes stop without
   retry or automatic reverse.
8. Confirm live pointer/image, actual flag, zero restarts, pending absence and
   unchanged token/other environment. Require the original
   `routing_release_inventory.reviewed_peer_state` policy before final
   acceptance. A raw `peer_same=false` must not accompany an unconditional PASS;
   existing allowed restart loops remain explicitly reported as existing issues.

Case JSON contains a distinct Root approval reference, source pointer and parent
proof, original environment metadata and full-map hash, source Compose/spec
hashes, kernel hash and its own finite lifetime. The proof binds exactly that
case, unchanged Compose, inherited checks/clean-reset, parent reference, new
environment metadata, baseline and actual acceptance reference. Historical
readback is separate from permission for a new mutation.

The Root acceptance must describe evidence scopes honestly: ordinary adapter
functional results are `14455a…`/`3ed396…`; C5 has four successful planning API
operations and a complete global 18-of-36 counting window. The original ordinary
20-count frame failed and remains failed. Neither a combined-64 PASS, end-user
OIDC nor phone acceptance follows from those receipts. Preserve original test
times; a new Root readback/enable authority is not an extension of the old canary
admission or a still-valid route preview.

## Return and tests

### Actual deployment status

Root reports the separately sealed E941 operation completed successfully:
COP CID `73dd42a369db2ee118fdc0a98bc01e7dd1faac89e5968c55c2eda18acd5a43df`,
same image/source, flag true, healthy with zero restarts, current pointer matching
the live CID, no pending transition and strict unchanged peer state. Guard A56a
and kernel F847 are the revision-2 bytes above. No credentials were exported.
Actual Root case:
`/srv/x5-production/root-cop-planning-enable-v4-e94178a9-ef0d-4613-bd24-1650735b42d4`.
Accepted receipt SHA-256:
`10de451922025a9413c05662538f6e528343c421d948794486476dd06777748f`.
Official prepare, activate and read-active receipt hashes are respectively
`e4213aedd5796fdc431bc3084f4dd0e8d62d8eed8545cec616b9d0f68ac88bdf`,
`859dd8fd2eba6d0b6fcdead2dda988ff99c9ff15fde3c32ade672bd3a0531d74`,
`27dd1dfd2f052305c4e141024c7bf2bac7402f9e661fbdb867718a5f2c76a643`.
Peer comparison is
`3b368938e110d4c431ab88fb94a000f4288f10e7471ba5afa5d569163949ec39`.
Phone and positive user OIDC acceptance are not implied by this server completion.

Root also performed the separate actual read-only inverse preview at
2026-10-29 23:24:25 UTC: original environment backup bytes matched, the complete
desired runtime environment matched the original enable-case hash, token and
all other render fields remained unchanged, and parent scope/lineage validated.
No inverse write, recreation, API request or native action was performed. This
establishes an actual preview, not a successfully executed production rollback.

There is no automatic rollback. If only the guard was installed and no new
configuration/proof/pending operation exists, Root can separately review an exact
restoration of its saved original guard. After a **committed** V4 enable, the
kernel supports only its exact inverse under a separate fresh Root case/GO:
`stage=disable`, parent version V4/stage enable, `true` to `false`, same token and
all other fields unchanged. The resulting complete runtime environment must
match the immutable original enable case's full pre-enable environment hash.
It cannot remove provisioning, change the image or enable again from disable.

Root must seal and verify that finite disable controller before treating return
as operationally ready. A failure in the middle of an uncommitted activation
must retain pending records and be handled by the existing owned recovery or a
separately reviewed finite repair; restoring old metadata or rerunning activation
blindly is prohibited. Source unit tests alone do not prove crash recovery.

Actual source verification: 23 synthetic tests passed, plus syntax, skeleton and
diff checks. These cover complete constructor byte reversibility; actual health
pin and function parity; exact legacy byte functions; fresh/historical/expired
cases; parent lineage; old/wrong SIM, failed workflows, foreign paths and extra
keys; duplicate JSON; token/auth/other environment, Compose/service/network/
resource changes; no credential-adapter loading in the proposal; and exact
whole-environment inverse. These tests performed no host/native/provider action.
Inert public-source fixtures carry the exact old guard 7ad, kernel 78e and health
adapter e7eb as `.txt`, so the tests no longer depend on temporary workstation
paths. No environment values or production secrets are test fixtures.
