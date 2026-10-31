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
one proof version and the existing seven dispatch sites. Reverse substitution
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
There is no automatic return. An interrupted, uncommitted forward remains blocked
by ordinary `pending.json`; preserve all journals and use a separately reviewed
Root recovery. This source does **not** claim to implement that pending recovery.

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
