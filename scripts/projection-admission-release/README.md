# Closed COP admission image transition

Source proposal only. Root owns fresh custody, GO and execution. No CLI or
production installer is supplied here; ordinary guard prepare/activate remains
the only application runtime mutation.

- Exact guard parent: A56a (the accepted V4 guard, not its historical 7ad parent).
- Forward: `6cdf… / 7c43…` → `51a1… / b8d…`; accepted return is the inverse.
- Image Config is unchanged; only the two verified admission module/map files
  differ in one layer. This is a partial hotfix, not a full-source rebuild.
- Source Compose files and `.env` bytes remain unchanged. Generated release
  Compose/image and runtime release labels have their existing guarded image-only
  differences; do not claim those generated artifacts are byte-identical.
- No account, credential, database, network, port, mount, role, model, planning
  flag, pressure threshold, pool capacity or erasure-fence change is allowed.

`constructor.py` accepts exactly the existing guard and adds one image authority,
one proof version, the existing seven dispatch sites and a separately pinned
pending-return method with its normal-operation latch. Reverse substitution
reconstructs every original guard byte. Its new hash-named kernel is a multiplexer:
historical V3/V4 readers execute original F847 with its original kernel pin in a
separate namespace. Original F847 and historical case files remain unchanged.

Root must publish the new kernel as
`planning-config-v3-kernel-<SHA256>.py` under the existing protected profile. It
must separately copy the exact built/acceptance receipts as
`admission-image-{built,acceptance}-f65abfbf-d7d8-42e3-bd7a-0a628ff520d5.json`.
All protected documents use existing Root custody (Root, group 1000, mode 0640);
the existing health adapter E7eb remains unchanged.

`proposal.propose(...)` accepts only Root-local inspected state and returns new
case, proof, original baseline bytes and (forward only) attestation metadata. It
never exports environment values or modifies a file. Forward compatibility
checks must be supplied by Root with an honest provenance receipt; the proposal
does not invent a database SELECT or a Sharp test. Inherited compatibility of
unchanged accepted-base dependencies must be distinguished from fresh checks.
Before publication, Root must validate the RAM preview using the new kernel,
retain the original guard and verify full current/peer inventory and CAS.

Under the existing storage/build locks, Root installs through the existing
pinned custody helper, then `worker.prepare(...)` and `worker.activate(...)` use
ordinary guard operations. Source CID/process, actual spec, original environment
metadata/hash, source Compose hashes, exact parent lineage and receipts are
checked under a fresh case/proof of at most 900 seconds. No operator may select
a URL, health script, image, account or credential from the browser.

Forward uses fresh source and target health. An accepted return uses exactly the
original healthy forward baseline without redating it; return target health,
zero restarts and the unchanged 120-second budget remain mandatory. The return
requires a separate fresh Root case/GO and the existing immutable old attestation.
There is no automatic return. An interrupted, uncommitted forward is handled
only by the separate `pending_return.py` authority below. Generic
`recover(rollback=True)` remains prohibited and its original body is unchanged.

## Pending return

Publish the separately hash-pinned worker as
`admission-pending-return-worker-<SHA256>.py` in the same protected profile.
`pending_return.propose(...)` is read only and emits no GO. Root must independently
review and publish its exact new `admission-pending-return-<UUID>.json` authority,
under the existing locks and a fresh window of at most 900 seconds. The child
transport must explicitly call `worker.return_pending(...)`, which calls the
new `Store.revert_admission_pending` hash-pinned method; it cannot call ordinary
recover or supply a different action silently.

Both pre-up failure (original old CID still present) and post-up/failed health
(new image present with the old active pointer) require the exact original
pending/health SHA, forward proof and parent, source pointer, physical source
CID/full spec/process/labels, peers, environment metadata and source Compose
hashes. A new private return journal latches normal operations. The initial
operation makes exactly one explicit **COP API only** forced recreation through
the old guarded release/profile (`--no-build --pull never --no-deps`). It
preserves all original parity/mount/image checks, requires new old-target health
using E7eb within the same 120-second budget and requires zero target restarts.
Original pending and health bytes are renamed into private history only after
health and pointer CAS succeed; they are never deleted or rewritten.

An explicit new Root `finish` authority can complete a known returned CID without
another recreation, including after CAS. An uncertain Up result or crash before
target-CID journaling cannot use ordinary finish: a separate, explicitly chosen
Root `adopt-finish` reconciliation must bind the exact actual CID/full spec,
release/profile labels, process and original immutable authorization/journal SHA,
with the first start inside the original operation's Up authorization window.
It performs no Up. Foreign, old or unproven targets remain blocked.

Archive ID is persisted before the first rename. An interrupted archive reads
only the same bound private history directory and revalidates original hashes;
finish moves only remaining files. The latch moves last. A crash after that final
rename leaves an already restored pointer, healthy target and all original bytes
in history, with no pending/latch: Root verifies those facts read only rather than
rerunning an operation. No fault handler automatically retries or recreates.

After activation, retain the old image and verify actual protected state and
warm workload (not only empty restart state), bootstrap latency/503 and the
existing signed-in native client. Anonymous 401 is a negative boundary, not
successful user login. The two original slow 503s remain without precise causal
attribution until evidence resolves them. No routing canary or TestFlight upload.

Synthetic checks (no host commands, accounts, DB or network):

```sh
python3 -m unittest discover -s scripts/projection-admission-release -p 'test_*.py'
```

Current results and actual image fixture evidence are in
[the incident record](../../docs/testing/cop-native-auth-overload-20261031.md).
