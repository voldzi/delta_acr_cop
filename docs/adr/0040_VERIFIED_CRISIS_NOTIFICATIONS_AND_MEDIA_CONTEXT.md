# ADR 0040: Verified crisis notifications and separate media context

## Status

Accepted design; implemented release candidate. Production activation and
physical delivery acceptance remain pending.

Date: 2026-10-10.

## Context

The visible COP safety overview refreshes while the app is open, but foreground
polling is not automatic notification delivery after the app closes. The
existing manual evaluation used map features and explicit audiences, and its
feature/time/layer key could suppress another recipient or duplicate a source
incident in another rendering layer. Expanded verified municipal alerts and
ČT24 editorial context have different provenance and notification eligibility.

The approved change must preserve private messaging, infrastructure/secrets,
other applications and the existing community-report lifecycle. It must not
present technical failures, broad centroids or news stories as precise nearby
crisis alerts.

## Decision

1. Run a bounded COP API worker against persisted, explicit per-account safety
   consent and saved watched areas. Derive each recipient from the primary COP
   profile; do not manufacture an access token or accept recipient identity from
   a request body. Missing consent is disabled.
2. Fetch only SIM `sim-safety-notification-candidates-v1` from
   `/notifications/candidates`. Require the verified eligibility policy and a
   fresh `inputReadiness.status=ready`; refuse missing, stale, unavailable or
   incomplete inputs. Do not use map-feature cache fallback for dispatch.
3. Resolve actual circle/Polygon/MultiPolygon intersection, including holes.
   Bounding boxes narrow the query only; centroids and unknown/approximate
   locations are not authoritative nearby-event evidence.
4. Recheck current consent, profile severity, areas and device capability under
   a subject lock before dispatch. Revocation and dispatch are serialized. The
   recipient audience contains one persisted subject only. A notification
   already accepted by Messaging cannot be retracted by a later revocation.
5. Use PostgreSQL worker leases and a durable opaque per-recipient incident
   ledger. Exclude rendering layer and language from incident identity. Use a
   canonical `incidentId` if the source contract provides one, otherwise
   `featureId`; generic `sourceIncident` labels are not unique identifiers.
   Hydro notifications additionally use severity-aware keys and persistent
   per-recipient/station-feature/severity cooldowns.
6. Treat Messaging intake and physical delivery separately. Retry failed intake
   with bounded attempts/backoff before expiry only while SIM still provides
   the eligible candidate. COP stores no complete notification payload queue.
   Messaging owns downstream APNs/Web Push delivery and redelivery.
7. Keep ČT24 in an informational panel with original links and attribution.
   `regionCode` identifies an editorial feed, not an event location. Require
   `informationalOnly=true`, `notificationEligible=false`, `location=null` and
   `locationStatus=unresolved`; never feed it into crisis notifications.
8. Keep source bodies, private messages, raw GPS and push secrets out of the
   worker ledger and diagnostics. Existing account profiles necessarily hold
   watched areas; device eligibility holds authenticated capability references.
   Do not automatically delete delivery/cooldown/audit evidence without an
   independently approved retention policy.

## Consequences

- Automatic decisions continue with the browser closed. Delivery still depends
  on registered devices and external push infrastructure.
- One recipient cannot suppress another. Restarts preserve accepted keys.
- A degraded source is distinguishable from a known empty result. No result is
  a promise of nationwide completeness or personal safety.
- Manual evaluation keeps its endpoint/version/default dry run, but cannot
  broadcast to groups or other users. Real dispatch needs current consent and
  the same durable claim path.
- Additive PostgreSQL tables remain after rollback. No persistent domain is
  migrated and no audit/history is deleted in this release.
- Open-ended official candidates may be visible in dry-run evaluation, but the
  worker requires explicit expiry for bounded durable dispatch/retry.

## Alternatives considered

- Client-only foreground polling: cannot deliver while the app is closed.
- Per-user loopback HTTP calls or manufactured tokens: unnecessary identity
  indirection and an authentication boundary risk.
- Arbitrary map warnings, stale cache fallback, news classification or centroid
  proximity: lacks verified alert/location/readiness evidence.
- An in-memory production ledger or consent fallback: loses isolation and
  restart deduplication during outages.
- Persistent candidate payload queue: would add source content/geometries and
  require a separate retention and delivery architecture.

## Follow-up and evidence

Current contract, consent and delivery semantics:
[integration 12](../integration/12_COP_NOTIFICATION_DECISION_AND_PUSH.md).
Configuration, scoped release/rollback and pending physical acceptance:
[runbook 21](../runbooks/21_COP_CRISIS_NOTIFICATIONS.md).

Record actual deployed COP/SIM revisions and gate outcomes before changing the
status above. A build or Messaging `notificationId` is not phone-delivery proof.
