# 25. COP–SIM road-trip production deployment

Date: 2026-10-03. Server contract deployed; strict vehicle profiles NOT activated.
The user explicitly authorized deployment after [acceptance record 24](24_JIZDA_ROAD_TRIP_ACCEPTANCE.md).

## Released revisions

| Component | Deployed / published revision |
| --- | --- |
| COP API | `0311d4d6b362c70c90fa35b9c9787459db46edce` (ordinary closure validation follow-up) |
| SIM routing API | `3506663a70a32ecdab9ab2921656385dc998ea26` |
| Shared mobile SDK | Published `b1d47d09e86b475c6a4a792cf9d94d87caf6f726`; Jízda reports local adoption and simulator acceptance; physical acceptance pending |

Actual running images were verified against the built release. Later documentation
commits do not alter the released runtime. Operational image digests, configuration
fingerprints and rollback records are retained privately by the deployment owners.
Only server components were released; no mobile application binary was installed.

## Checks performed

- Production health/readiness passed after restart; a brief API restart occurred.
- Anonymous COP routing request returned 401.
- Running COP's configured adapter contacted actual production SIM: new
  `sim-road-trip-capabilities-v1` decoded, `strictRoutesEnabled=false`,
  `availability=disabled`.
- Complete strict request with fresh UUID returned 422
  `ROUTING_SAFETY_UNSUPPORTED`, with no unassessed route or substitute fallback.
- Existing ordinary-car request returned one `ok` route, actual Valhalla engine.
- Packaged COP image accepted two synthetic fixture variants at their fixed test
  time and rejected the expired assessment at current time.
- Isolated SIM image rejected disabled mode with 422 and missing closure source
  with 503. Synthetic engine status was used; this is not a production 503 test.
- Existing credentials, networking and unrelated services were preserved. The
  SIM deployment updated its release image selection. Voluntary collection and
  live aggregate-speed/ETA promotion remained inactive; revocation stayed available.
- Previous images and configuration selection were retained for rollback. A live
  rollback roundtrip was not performed.

The production adapter test is not an authenticated end-user OIDC/iPhone session.
Earlier 26 COP / 22 SDK / 361 SIM test results remain in record 24. Physical-device
acceptance and the two COP Mobile chat UI failures remain unresolved.

## Why new profiles remain inactive

Existing traffic sources provide events and reference lines. They do not provide
an approved complete closure snapshot with direction, geographic coverage,
expiry/revocation and exact routing-graph identity. Representative incident points
or an empty closure file cannot establish mandatory closed-road avoidance.
No synthetic closure was published as real production data.

A reviewed closure publisher and actual vehicle-limit/access tests are required.
Current v1 supports only both-direction closure polygons. Trailer, axles, planned
departure and approved entrances remain explicitly unsupported. Confirm the
reported III/44520 bridge and roundabout count against actual authoritative data.

Jízda can now test the server contract, capabilities and error handling. Adopt the
published SDK and [handoff 23](23_JIZDA_ROAD_TRIP_CONTRACT.md), preserve immutable
snapshots and reject expired/unverified variants. Keep new profiles inactive while
capabilities are disabled/unsupported. Strict errors must not become Apple/legacy
fallback. Then complete joint real-session and iPhone navigation acceptance.

## OIDC boundary follow-up (2026-10-03)

Implementation `6c018468cd0fd0db18d562c3eefa5b1ecd245064`, with a formatting-only
OpenAPI follow-up `b6c21322bbe26bdfc9414a39bfc62987864f01fd`, is now running in COP.
All routing endpoints require an actor from an already verified OIDC token or
server-side BFF session. Missing/malformed subjects fail before SIM is contacted.
Browser-supplied actor IDs are not accepted. Token-prefix diagnostic logging was
removed; malformed JWT claim types fail authentication instead of causing errors.

Verification:

- 35 targeted tests passed, including signed RS256 tokens, actual local HTTP JWKS
  retrieval, all route variants, expiry/hash/identity mismatch, upstream errors,
  revoked BFF session and cross-origin BFF rejection.
- Full suite before the final added BFF test: 1135 passed, one skipped. The final
  targeted run includes that BFF test; a second full-suite run was not performed.
- Final lint/type check, build, skeleton and OpenAPI validation passed. OpenAPI
  reports 18 warnings and no errors; web build has the existing chunk-size warning.
- Packaged production candidate passed a network-isolated signed-token fixture:
  valid identity 200, invalid claims 401, two variants retained, credentials not
  forwarded to SIM. This is synthetic acceptance, not a real identity-provider login.
- After API-only deployment: actual image verified, readiness and container health
  passed, anonymous/malformed routing identities returned 401. Runtime environment,
  existing networks, ports and secret files were unchanged.
- Running adapter contacted production SIM: ordinary Valhalla route 200, strict
  request 422 `ROUTING_SAFETY_UNSUPPORTED`, capabilities still disabled.
- Measurement intake remains off; cleanup remains on. Previous release retained
  for rollback; a live rollback roundtrip remains untested.

A real COP login currently requires user reauthentication. No password was accessed.
Real OIDC/iPhone end-to-end acceptance remains pending, as does authoritative closure
source/engine acceptance in SIM. This deployment does not activate strict profiles
or establish complete closure coverage. SIM is separately preparing the smallest
truthful ordinary-routing improvement with verified known closures; no new additive
contract is assumed until SIM publishes its binding schema and acceptance evidence.

The subsequent ordinary reviewed-closure release is active with incomplete coverage;
see [joint contract, SDK handoff and production acceptance26](26_JIZDA_KNOWN_CLOSURES.md).
Strict profiles remain inactive. Earlier deployment checks above are historical
release evidence and are superseded by the current revision table and record26.
