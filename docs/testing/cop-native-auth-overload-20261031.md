# Native authentication overload, 2026-10-31

Status: source candidate and both actual image fixtures passed. One bounded
production native CPU sample and a fatal V8 heap marker are recorded below.
Production API activation and a bounded warm-workload check passed.
Authenticated/native acceptance remains pending. No routing canary or TestFlight upload is authorized
by this record. The native owner separately verifies login on the existing app.

## Observed production failure

Read-only inspection targeted `cop-cop-api-1`, container
`73dd42a369db2ee118fdc0a98bc01e7dd1faac89e5968c55c2eda18acd5a43df`, image
`sha256:6cdf302ea305e7fa58a11a1f9139deccd9f5b70cd0982a7ce87cd6b70d9d5c30`.
At the initial inspection it had started on 2026-10-29 at 23:21:31 UTC;
restart count was zero. This observation predates the later restart below.

The 09:15:00–09:28:59 UTC log window contained **three distinct**
`GET /api/v1/mobile/bootstrap` requests returning 503. One was rejected with
`FST_UNDER_PRESSURE` after 0.5 ms. Two completed after 14,491.3 and 13,647.9 ms;
their application failure codes were not established from these logs.
Request IDs were used only in RAM for deduplication and were not exported.
The earlier count of four counted response log events, not distinct requests.

Across all paths, 132 pressure error log events represented 66 distinct requests.
Public OIDC discovery, the anonymous login form, and COP live/ready checks
returned 200 around 09:20 UTC. This did not establish healthy authenticated
bootstrap: a subsequent dependency check returned 503 and another exceeded its
10-second observation timeout. WAF causation is not established by these facts.

At 09:37 UTC, one Docker resource sample showed 227.24% CPU and 4.198 GiB RAM.
A separate 1.001-second OS counter sample measured 98.9% main-thread CPU and
146.9% across other threads. These are finite samples, not sustained percentiles.
Seven existing pool snapshots showed a maximum of 14 waiters for the two-client
`account-safety-guard` pool. Other recorded pools had no waiting clients in those
snapshots. Zero recorded idle/client error events does not rule out SQL failures.

The infrastructure operator's three later DB samples found no blocked locks or
disk-read increase; the guard clients were idle or waiting on `ClientRead`.
The database application name is `cop-account-safety-v2`. The reported count of
80 `pg_stat_activity` entries included all backend types and must not be called
80% client-slot utilization.

## Later restart and bounded native CPU sample

A server-side fixed-marker aggregate over 09:28:59–12:29:00 UTC counted 8,186
log lines, one `JavaScript heap out of memory` marker and one `FATAL ERROR`
marker. The heap marker timestamp was 09:55:52.495122157 UTC. Root metadata later
showed the same container starting at 09:55:54.436128133 UTC, restart count one,
and `OOMKilled=false`. A fatal V8 heap failure is compatible with this flag:
it is not proof of a kernel OOM kill. Raw logs were not exported.

The separately approved one-off native sample completed once: 15 seconds,
49 Hz user-space CPU sampling with frame pointers, no heap dump, debug port,
restart or raw stack-memory recording. At 12:27 UTC its target PID/start ticks
remained unchanged before and after sampling. This was **after** the restart.
Selected native self-overhead was SHA-256 block processing 5.96%, V8 string hash
4.13%, ordered-hash-set lookup 2.29%, crypto decode 1.83%, JSON stringify 1.38%
and heap/scavenge 1.38%. These rows neither establish crypto dominance nor
attribute allocations to a precise JavaScript caller or to the earlier peak.

The Root receipt is under
`/srv/x5-production/staging/cop/auth-overload-perf-20261031-122707Z-ed70d336`:
`receipt.json` SHA-256 `60714e1b00fa3db888e05054284948685830f33ca6e95d34df6a5fe0b50e51dc`.
This is evidence of the observed restart and sampled work, not proof that the
candidate addresses every allocation or every original 503.

## Source paths and reproducible cost

Native authentication awaits mobile bootstrap, which also constructs a map
snapshot, history and conflict evidence. `refreshCachedGuard()` always awaits
the durable continuity check. Flight ingestion refreshes this guard between
chunks of 128 records. These call paths alone do not prove a production hotspot.

The existing projection owner rechecks every old history point during each
history replacement. For frozen points it retained parsed scalar references,
but still repeated subject/owner hashing. History supports 5,000 points.

On Node 24.22.0, a synthetic 5,000-point history and 128 attempted replacements,
with an unchanged five-second guard lease, produced:

| Source | Completed replacements | Synchronous block | One-second timer | Outcome |
| --- | ---: | ---: | ---: | --- |
| Original | 58 / 128 | 5,000.14 ms | 5,000.46 ms | `CONTENT_PROJECTION_UNAVAILABLE` |
| Candidate | 128 / 128 | 332.45 ms | 1,000.51 ms | completed |

These are local synthetic observations, not production performance claims.
A local baseline CPU profile attributed substantial self samples to hashing,
`runtimeOwnerHash`, projection code and GC. The separate native production
sample above has narrower attribution limits.

Reproduce the candidate's bounded fixture without accounts, SQL or network:

```sh
node --import tsx scripts/benchmark-cop-projection-admission.mjs
```

## Candidate boundary

Only records detached and deeply frozen by the actual projection owner may
reuse an admission. The witness is tied to the object's identity, durable guard
generation and a local fence generation. It is not keyed by a record ID or a
payload hash. It retains no parsed scalar-string array.

Every call still checks the live guard lease and an explicit caller before any
reuse. A missing guard version disables reuse. New local fences, reloaded fences
and changed durable frontiers invalidate old admissions. Mutable or externally
shallow-frozen inputs are always inspected again. No lease, pressure threshold,
pool capacity, identity rule, producer scope or database permission changes.

Local API TypeScript build and the six focused projection/continuity test files
passed: 66 tests. They cover lease expiry, durable revocation, local and reloaded
fences, changed payloads and state replacement, explicit callers and absent
versioning. A broader API run initially encountered local loopback `EPERM`;
that run is not a full-suite pass. The loopback-enabled rerun then completed:
143 API test files passed, 26 skipped; 1,766 tests passed and 108 were skipped.
Optional PostgreSQL-dependent suites were not turned into passes. Focused ESLint
and repository skeleton validation also passed. The versioned benchmark separately
completed 128 replacements in 316.73 ms, with the timer observed at 1,000.61 ms.

The compiled-module fixture is
`scripts/tests/cop-projection-admission-compiled-fixture.mjs`. It prevents socket,
fetch and database attempts and exercises the compiled module's lease, durable
frontier, resource fence, explicit caller and unversioned-guard boundaries.
The local baseline was rebuilt entirely from existing Git history; its module
and map hashes matched the separately observed production hashes. No production
source content was exported. The compiled baseline reproduced lease exhaustion
after 60/128 replacements; the compiled candidate completed 128/128 in 320.73 ms
and retained the negative boundaries. These local runs are not an actual image
test. The actual image runs are recorded below.

## Actual image fixture and synthetic retained heap

Root built image
`sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094`
from the exact production image above. It adds precisely the two compiled
`cop-state-erasure.js` / `.js.map` files, preserves their original metadata and
all image Config fields, and adds one filesystem layer. It is a verified partial
hotfix, not a claim of a canonical full-source rebuild.

Under CPU limit one and memory limit 768 MiB, the actual baseline completed
12/128 replacements before the unchanged five-second lease expired
(5,000.13 ms block). The actual repaired image completed 128/128 in 1,492.04 ms
(timer 1,492.70 ms), with no failure. All seven expected boundary groups passed
for both roles; socket/fetch/database/native calls and real DB writes were zero.
The production container, PID and complete container-configuration inventory
were unchanged. The build container was removed; production was not activated.

Root case:
`/srv/x5-production/root-cop-auth-projection-f65abfbf-d7d8-42e3-bd7a-0a628ff520d5`.
Acceptance SHA-256:
`d205f70ceb083fb1d3754ecff3e974bd5f86bf012ac15b4a665c08fe0f7838d8`.
The 1,492 ms isolated block still exceeds the source's 1,000 ms pressure threshold;
passing the five-second lease is not proof of eliminating pressure rejections.
Post-activation warmed workload and bootstrap latency/status remain required.

A separate local synthetic forced-GC observation retained 100 histories of 500
points each, after three warm replacements per history. Retained heap delta was
36,014,400 bytes in the baseline and 18,855,520 in the candidate. Cold seeded
histories had almost identical deltas (14,740,808 and 14,739,240 bytes). This
supports lower warm retained overhead for this dataset; it does not identify the
production allocation owner, establish long-term memory stability or replace
post-deployment observations. No production data, DB or network was used.

## Release and rollback boundary

The immutable runtime/test review patch has SHA-256
`bc01c8139172f6df3a91b6889192eed427168a90768b7a5575e1b3f13974c8f8`.
Candidate runtime source SHA-256:
`87eec44b3a3c8799e257d7b97b2a456139f1e43e500a2e4716fb885b3dabd35f`.
Compiled module SHA-256:
`20d3e85f5f48d6d2ded0f2d58e5383a2b9e159b93874e28c221498ff24cb5c45`.

Before production activation, bind the actual CPU evidence to the diagnosis,
freeze the release revision/image, and use the existing guarded image transition
with unchanged configuration, secrets, networks and mounts. No database migration
or user-data reset belongs to this change. Preserve the current guarded image
above as the rollback target; do not select an older image lacking account fences.

Final acceptance must include actual authenticated bootstrap and native identity
recovery, not just container health. Preserve local credentials on temporary 503;
never turn a failed bootstrap into a verified identity. Record production results
and the rollback binding here before declaring the incident resolved.


The APP-owned release boundary is versioned under
`scripts/projection-admission-release/`. Its pure constructor accepts only the
actual A56 guard, preserving all original bytes except the finite dispatch,
image authority and dedicated pending-return additions. Historical F847 readers
keep their original pin. Source tests cover accepted return and pending failure
before/after Up, uncertain command outcome, fresh explicit reconciliation,
health/restart rejection, crashes before/after CAS and partial archival. These
are synthetic temporary-file/fake-Docker tests; no production return is claimed.
Root independently reviews, seals and executes the source package. Source
publication itself is not a production activation or user-login acceptance.


## Actual production activation and bounded warm workload

Root activated the exact `51a1…` image through the separately reviewed controller,
after preparation/sealing succeeded. Actual active release is
`release-6f461a0bdca04292abb723c05ea3d5ad`, pointer generation
`9737d2f07bb64a16886234bbebb58bdc`, container
`a5c377010d9f8d476b6a52102112af4361623fd65b90204f61baa6890a2e7be2`.
The host guard is the exact derived
`593874714db6b35537ffe733a8f266483685f37a0d5e6c73abb4159f9503f9d2`.
Application environment, profile, source Compose, safety limits and peers were
preserved. The old image and both explicit Root return controllers remain
retained. Root case:
`/srv/x5-production/root-cop-auth-release-6d1dcc9a-01cb-4b5f-85c9-120a5e4c3bac`.
No real user, credential or database was reset.
The protected accepted receipt has SHA-256
`573e710406bf01316e203a06af77843c4d89aea382be6583158ef9d44c27e072`
and filesystem modification time 2026-10-31 14:14:51.811370 UTC. The runtime
uses the ordinary protected release override; host source Git and all four
source Compose files were preserved.

At 14:17:26, 14:17:52 and 14:18:17 UTC the same process (PID 2112491) remained
healthy with zero restarts. Uptime was 204/230/256 seconds, with the actual
15,000 ms flight poll configured. In-memory accepted events rose
1,227 → 1,454 → 1,683; current objects were 123/124/123. This establishes a
nonempty process after more than thirteen poll intervals, rather than merely an
empty post-restart state. RSS was 485,672/493,704/508,640 KiB, high-water 601,508
KiB; sampled CPU was 31.5/65.66/0.46%. These finite observations do not establish
long-term memory stability or eliminate the original two unexplained slow 503s.

Live/ready were 200/ok in approximately 1.3–1.8 ms. Anonymous bootstrap returned
the expected 401 in 109.7/62.1/48.4 ms. This verifies an anonymous boundary;
it is **not** successful signed-in bootstrap or native login.

The existing metrics endpoint took 4.27–4.69 seconds and counted approximately
55.97 million persisted history points. This is a separate observability-query
cost; no additional DB-count experiment or parallel fix belongs to this release.
The persisted count alone is not a measure of in-memory warm state.

## WAF planning boundary: already installed, freshly verified

On 31 October Root read back the existing active planning exception, rather than
reinstalling it. Configuration SHA-256 was
`d23a5d5d380ebf23a40fec153fbc2707898d662ff9835bf5f107a612d281fac3`,
matching the historical 29 October seal. The exact exception block SHA-256 was
`5d57487456300384dcb75be31291df758102908350a77ade7179b45868b7188b`,
present once as local rule 1000964. It excludes only the field **name**
`json.context.vehicleProfile.coverageAcknowledged` from rule 930120, only for
POST JSON on the COP host's `/api/v1/routing/planning-origin/candidates` and
`/api/v1/routing/planning-origin/preview`. It grants no authentication or value
exception and does not disable SQL/XSS protections or affect other sites.

At 14:27:13.117–14:27:13.369 UTC, four prepared synthetic boundary requests
(case `a77ad56382f349038a5ad9273bf32605`) returned expected results: both benign
requests reached the API and returned 401 `UNAUTHORIZED`; unrelated SQL payloads
on both paths returned 403. No credentials, private coordinates, authenticated
route or native request were used. Configuration changed: **false**. No duplicate
exception or old installer was applied. These checks verify the WAF boundary,
not successful signed-in route planning or native login.
