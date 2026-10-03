# 25. COP–SIM road-trip production deployment

Date: 2026-10-03. Server contract deployed; strict vehicle profiles NOT activated.
The user explicitly authorized deployment after [acceptance record 24](24_JIZDA_ROAD_TRIP_ACCEPTANCE.md).

## Released revisions

| Component | Deployed / published revision |
| --- | --- |
| COP API | `166c270b061cfd0a24ef6883c4ee83ec64473bc9` |
| SIM routing API | `ffc49d83d78167610741fbd248eb039bee47459a` |
| Shared mobile SDK | Published `b1d47d09e86b475c6a4a792cf9d94d87caf6f726`; Jízda adoption pending |

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
