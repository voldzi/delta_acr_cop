# ADR0064: Automatic preparation of the existing vehicle conversation

Date: 2026-11-09. Status: deployed on 2026-11-09; native device acceptance remains separate.

## Decision

Use the existing global vehicle communication admission flag for automatic
source enrollment. Confirmed vehicle creation and accepted vehicle membership
queue the existing immutable projection intent in the same source transaction.
There is no new vehicle, logical conversation namespace, token or Matrix join.
Native preparation uses the existing deterministic logical ID, durable CAS,
lease, current principal/identity/fence validation and provider enforcement.

A bounded worker enrolls at most four existing active, eligible cars per pass.
It skips deleted, fenced, invalid/foreign-issuer and already enrolled sources;
never replaces an existing intent or binding. New backfill pauses when admission
is OFF. Already committed cutover/revocation/closure work keeps its existing
cleanup semantics when intake is disabled. After a partial batch, backfill is
checked every30seconds rather than performing another full scan every tick.

Creation confirms the vehicle, not native chat membership or delivery. Existing
accepted membership may still return202 while its native cutover is pending;
overlapping changes remain fenced. Pending/outage work retains the same intent.
No old image that omits enrollment may be blindly restored after publication.

## Discovery and consent

Existing Messaging summaries include managed current-roster members even before
Matrix join. They identify source cop.shared_vehicle and externalId=vehicleUUID.
The COP provider retains those safe metadata fields. The COP list rechecks
current identity/account, readVehicle membership and source projection before
returning each managed row. Its title uses the current already-shared vehicle
name; there is no Matrix room rename. Unknown/stale/removed rows are omitted;
authority outage degrades the list while retaining ordinary conversations.
List status room_bound is
not proof that the viewer joined. Current vehicle/account scope and the existing
typed conversation endpoint distinguish join_required202 from joined200.
The host must explicitly ask to join, then obtain a fresh joined receipt before
selection. Sending, calls, GPS consent, keys, prejoin history policy and server
revocation remain unchanged. No new public endpoint/schema is needed.

## Evidence and activation

Targeted tests cover atomic enrollment/idempotence, accepted membership, same-room
reconciliation, provider outage/replacement worker, concurrent bounded backfill,
fences, foreign issuer, deleted cars, existing binding and OFF cleanup behavior.
Actual-image checks, immutable review and healthy Messaging are prerequisites
for production activation. Current Messaging startup replay failure is separate;
no fail-closed startup decision, journal or watermark may be bypassed to ship.
