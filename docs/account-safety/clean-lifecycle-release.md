# Clean COP/SIM lifecycle release

## Current evidence

2026-10-17: owner authorized clean deletion of all test-user data, no new backup of those test data. Reset and production activation have not yet run.

Read-only COP inventory: 11 profiles, 12 devices, 7 web sessions, 4 pairing sessions, 111 calls, 9 community reports, 10 groups/15 memberships, 21 drawings/920 drawing audit rows, 18 mobility KV entries. Attachment rows and driver consent rows are empty. The database also contains 54,012,548 track-history rows and 21,468 current tracks: these are outside the blanket user reset pending source classification and must not be truncated.

Preserve configuration, service accounts, map/provider data, secrets and other applications. SIM inventory and persistent cleanup work are coordinated with its owning task.

## Configuration

`COP_ACCOUNT_ERASURE_SCOPE=cop_sim_shared_identity_v1` selects the explicit v2 web contract. `COP_KEYCLOAK_SHARED_IDENTITY_DELETE_ACCEPTED=true` authorizes shared identity removal. `COP_USER_RESET_TOKENS_NOT_BEFORE` must equal the enrolled reset cutoff in Unix seconds; JWTs issued at or before it (or missing iat) are rejected even with a valid signature. This prevents an old native token recreating a test profile after reset. The new shared scope requires `COP_ACCOUNT_SAFETY_AUTHORITY_MODE=database_v2`; the uninstalled native alternative is not selected as a fallback. These flags alone do not bypass readiness or enroll a reset baseline. The v1 acceptance does not authorize v2.

## Acceptance required before activation

Two synthetic users; A deletion including identity/SIM access, B unchanged; immediate request fence; asynchronous retry after service outage and process restart; actual provider readback; removal of retained copies; data reset and epoch verified; normal login/chat/maps healthy. Report each actual test separately. A mock HTTP test or successful build is not production acceptance.

## Rollback

Disable new deletion intake if necessary; retain pending jobs, fences and original operation IDs. Deploy only a version which understands the new scope/epoch. Never restore the removed user data or silently start a v1 worker over v2 jobs.

## Implemented COP–SIM boundary

The clean adapter uses separate SIM endpoints, scope and headers. It never sends an old erasure claim to a new endpoint. `x-cop-clean-actor` is compact base64url JSON authenticated with the existing server signing secret and a 60-second HMAC. Exact claims: `iss`, `aud`, stable opaque `sub`, verified `oidcIssuer`, canonical `oidcSubject`, `resetEpoch`, immutable `operationId` and `requestedAt`, `iat`, `exp`, `jti`, `resourceId`, original signed `oidcIat`. The same assertion is attached to actual BYOK/chat writes and driver batches. Driver resource ID must match COP's existing daily HMAC derivation; raw positions are not in the assertion. No key, question, payer or model is included in these claims.

AI endpoint prefix: `/api/v1/ai-router/internal/user-lifecycle/v1`; driver prefix: `/api/v1/internal/user-lifecycle/v1`. Read-only `GET /capabilities`; durable `POST /deletions`; owner-bound `GET /deletions/:operationId`. A component `deleted` receipt is accepted only for the exact operation, epoch and component with no extra fields and `Cache-Control: no-store`. It is not a whole-account completion claim. The COP driver adapter separately fences and removes its local consent/outbox after verified SIM cleanup.

## Current local verification

- Keycloak shared-identity adapter: 12 mock-HTTP tests, including false204 and lost-response recovery. No live Keycloak identity was deleted.
- COP/SIM transport and writer assertion tests: pending receipt, exact claim/epoch/component binding, outage, no unexpected context, per-user opaque IDs and correct driver contributor. These are HTTP mocks, not production acceptance.
- Reset tool: 42 assertions on an owned Unix-socket-only PostgreSQL cluster, including a real restart, rollback after TRUNCATE failure, unexpected FK refusal, plan drift refusal, configuration/provider sentinel preservation and issuer-required new profiles. No production data touched.
- Full initial regression revealed web test fixtures still used v1; they were corrected to the explicit v2 contract, and all 11 account-deletion UI tests now pass.

## Reset tool boundary

`scripts/account-safety/clean-user-reset.mjs` exposes no HTTP endpoint and has no automatic apply. It lists 19 user tables and finite mobility prefixes; there is no wildcard table truncation, CASCADE, volume deletion or backup creation. It requires operator confirmation that writers are stopped and old identity admission is closed; performs a single transaction; locks planned tables; rejects changed counts or unplanned foreign keys; verifies zero user rows and preserved configuration; then records a new nonsecret reset epoch. The complete deployment controller must provide and verify those operator conditions and clear other provider/file copies before reopening admission.


Additional actual verification: 76 offline runtime/deployment tests pass, including rejection of an old v1 proof for new clean flags, mismatched epoch and missing joint acceptance. A separate Root-only proof contract (`cop-api-account-erasure-clean-config-v1`) binds the reset epoch, cutoff and reset-receipt digest to the exact runtime/profile. Existing actor secrets, networks and mounts remain outside that configuration permission.

The real COP adapter was also exercised against SIM HTTP and owned PostgreSQL (35 assertions; two lanes; A/B data, no-resource user, pending/completion/readback, outage). Business writer in that test is explicitly synthetic, not an OpenAI call. SIM separately reports actual bootstrap/business-handler tests; the joint test does not claim whole-account acceptance.

The actual independent PostgreSQL journal fixture passed 10 tests (one separate whole-service fixture skipped). It includes `cop-erasure-fence-entry-v2` and loss of the complete local job/config: the encrypted original principal resumes cleanup without another login, actually removes restored synthetic A data and preserves B. The Keycloak adapter in this case is the actual shared-identity adapter against a synthetic HTTP provider; the other domain cleanup ports are synthetic. The accepted immutable journal stores the original preflight identity fingerprint, so a missing identity after local checkpoint loss can be verified without another login, while a recreated identity is refused before DELETE. This is not Matrix or live Keycloak production acceptance.

A Keycloak reset component has four HTTP-mock tests. It enumerates native service-account IDs through clients before classifying humans, disables/removes only the approved test humans, requires actual GET404, preserves clients/realm/service accounts, and rejects inventory drift. Production credentials and users have not been used by those tests.

Final source regression after the recovery-witness fix: 2,571 tests passed, 106 skipped; typecheck/lint and build passed. The joint COP/SIM fixture was rerun against SIM 6238345 using native restricted AI/driver login roles and the actual grant migrations; 35 assertions passed. No administrator runtime or disabled privilege check was used. Production activation remains pending whole-service acceptance and the protected Root install.
