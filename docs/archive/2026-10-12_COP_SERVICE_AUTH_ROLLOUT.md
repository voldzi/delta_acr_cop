# COP service-auth rollout attempt — 12 October 2026

## Result

The production migration is **not complete**. A staged API rollout failed the
unchanged dependency health gate twice and was returned to the exact previous
API image. Edge/MCP authentication and public lab removal were not activated.
The original API then passed the original health/public-demo comparison.

This is bounded acceptance evidence, not proof of long-term stability or of
the cause of the failed gates. No PG limits, roles, sessions, WAF, SIM runtime,
user data or other application containers were changed.

## Source and running artifacts

- Auth candidate: `8ae9c0033e4e7fdf27d198d3b7f125a200eb1727`.
- Separate audit assertion/docs followup: `3567d0fc8ca8778dfab56edd1922add350b1848f`.
- Standard snapshot protection, reviewed and published:
  `4901b1b5b4f3244145107a1942b88f8b95c02ce1`.
- Host source stays at `4901b1b` so ordinary deployment and daily maintenance
  explicitly exclude `.env`; its application code is identical to `8ae9c003`.
- Attempted API image:
  `sha256:0d491a3f9e557e493b4ccf1a1918edc39303a04bcbbb9853a4b9ffd8a7761a05`.
- Restored API image, application baseline `e994012`:
  `sha256:8c61839a458ca82cfc79725b4763759c90d66ffcd31e1e24e2ff5defe9724741`.
- Web/chat/Edge/MCP images were unchanged. Five original images are protected
  by `rollback-e994012-20261012` tags; rollback selected the exact digest.

Rollback runtime: API `hybrid`, lab allowed, BFF enabled,
allowed clients `cop-web,csm-mobile`, no service bindings. Both service-client
auth modes remain static. The two new secrets remain only in the protected
production `.env` and authorized server process memory; no plaintext `.env`
backup or temporary secret copy was created by this attempt.

## Completed evidence

| Gate | Actual result |
| --- | --- |
| Original candidate checks | 1762 tests passed, 8 skipped; build/lint/format/schema/OpenAPI/skeleton and release guards passed. |
| Corrected policy audit assertion | 79/79 tests passed on separate followup; runtime code unchanged. |
| Final snapshot-protection tests | 24/24 passed on Linux in an isolated X5 staging job; Bash syntax, diff and skeleton passed. |
| Keycloak provisioning | Two distinct confidential service accounts; no roles, full scope disabled, exact audience/tenant and 300-second lifespan, no client-credentials refresh token. |
| Real signed grants | Both RS256 signatures, issuer/client/subject/audience/tenant, empty roles, expiry and TTL passed against issuer JWKS. Tokens/credentials never emitted. |
| Snapshot secrecy | Standard snapshot reported `environmentIncluded=false` and isolated Compose/Git restore verified. `.env` and its Git history are guarded against inclusion. |
| Staged API | Exact candidate image healthy, restart count 0; two bindings with own-node INTERNAL Edge and four public MCP tools, lab still enabled. |
| User web flow | Human confirmed login and own profile in infrastructure's COP panel before rollback; no network/header collection. This is UI confirmation, not a captured HTTP proof in COP's separate panel. |
| Dependency gate | Failed twice. Search/situation later recovered, while track-history also degraded in an independent sample. All HTTP 200 alone did not clear the gate. |
| Scoped rollback | Only API recreated, no rebuild. Original X5 guard and real Sharp conversion checked offline; all four Compose overlays preserved. Original compiled security/server fingerprints restored. |
| New grants on old API | Both cryptographically valid new service tokens returned 401 on an authenticated registry request after removal from allowed clients. No tool invocation, profile creation or test domain writes. |
| Post-rollback gate | Original baseline comparison passed: all three health URLs and public demo HTTP 200; 26 dependencies OK, including the previously degraded incident store. |

The API candidate started at 19:09:23 CEST; the original image was restored at
19:32:53 CEST. These were planned recreations, not unexplained crashes. The
previous API restart count 1 was already present before this attempt.

## Unresolved diagnosis

The failed response's original source timestamps, page warning/stale counts
and per-store database pool counters were not captured. Later green samples
cannot reconstruct that earlier state. No causal regression of the auth
candidate has been proved: the PG-store modules, pool creation, source fetch
and health routines were unchanged from `e994012` to `8ae9c003`.

Independent PG metadata at 19:34:50 and 19:35:29 CEST showed 83 then 90 idle
ordinary client backends out of 97 slots, with headroom 14 then 7. No active or
idle-in-transaction backends were observed. Most lacked application names, so
the connections cannot be attributed to COP. No session was terminated and no
global limit changed. COP's existing configured pool maximum is 5 per eligible
store and its stream pool maximum is 2; neither was tuned in this attempt.

SIM's read-only review found a separate diagnostic contract gap: search
observability's `status=ok` means service reachability, while optional
`dataQualityStatus`, `degradedSourceCount`, `sources` and `cache` carry other
scoped information. COP currently expects `sourceCaches/summary/warnings` and
does not preserve those quality fields. An observability timestamp is a
request time, not entity freshness. Entities cache hits preserve the old feed
metadata; collection stale counts and page stale counts have different scopes.
These findings require a separate, tested contract/diagnostic change; they do
not identify the provider or cause of the earlier gate failures.

## Remaining gates

1. Diagnose source-quality and database-pool stability from bounded, correctly
   scoped metadata captured during normal processing, without raw queries,
   entities, identity, provider URLs, credentials or unclassified warning text.
   Agree retention before adding any new durable diagnostic store.
2. Accept any necessary mitigation independently; do not widen roles, raise
   global PG limits, terminate other sessions or weaken the health comparator.
3. Repeat the reviewed API stage only after the causal diagnosis/stability gate.
4. Deploy renewing Edge/MCP clients with an empty owned outbox; prove actual
   restricted access, denials, renewal across two five-minute lifetimes and an
   isolated provider-outage failure without static fallback.
5. Reconfirm actual web and native read-only use, then disable lab and remove
   public lab build values as the final coordinated step, with post-cutover
   checks. No final activation or physical acceptance is claimed here.

## Sanitized evidence fingerprints

- Initial signed-grant JSONL: `c1393501eecba396aec3f400bc2c1b29f275b3b8612a0162a5b67f371d6b4ca2`.
- Final Linux storage tests: `83f2ad9e23978d7495234505fe7ae099c760b874f3ef00a085299631c881de25`.
- Nonsecret original image/auth rollback metadata: `10d7bfc101c2409d20855be0be56459ee9b57205d5e841e8876c53aef1fd4311`.
- New-grant rejection after rollback: `8d6943edda7ad52c4a09e03349d33d237c25b7dd0a4013bd920725693940ad70`.

These identify sanitized evidence only, never a token or secret value/hash.
