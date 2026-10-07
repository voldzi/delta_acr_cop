# ADR 0039: Canonical publication boundary

Status: accepted for the code audit branch; production activation is separate.
Date: 2026-10-07.

## Context

The canonical COP ingest is a source integration feed consumed by map, stream,
history and derived evidence readers. Authentication alone did not restrict
which actor could publish under a registered source. Event classification was
not consistently retained by current objects; a read path could consequently
assume unclassified data without checking the original envelope or release
policy. The user requested an application security and performance audit and
authorized fixing concrete issues.

## Decision

Authenticate before parsing protected request bodies. Require a nonempty OIDC
subject and an explicit canonical-ingest role (COP_OPERATOR,
INTEGRATION_ADMIN or SYSTEM_CLIENT), or the existing configured service lab
token. Do not infer integration rights from a missing actor or generic fallback
subject. Keep the registered source/type/synthetic validation and apply it to
every batch item before mutating state.

The current canonical feed accepts only verified UNCLASSIFIED events and
public, unexpired release policy without targeted access restrictions. This
does not redefine classifications or release policies of community reporting,
messaging and private Dispatch. Reject incompatible canonical input with the
existing correlation-aware error envelope.

Store server-owned event classification in object provenance. Current, history,
stream and derived conflict-evidence readers must check the verified original
classification and public release policy. A provenance event may authorize only
the object identified by that event. Unknown or malformed classification denies
publication. A legacy current row without classification remains unknown until
updated by a validated event. A legacy history point without a matching verified
event remains stored but is withheld from readers. Never relabel or delete old
data merely to make it visible.

### Source registry and federation roles

Source registration, metadata/permission updates and revocation require an
authenticated actor with `INTEGRATION_ADMIN` or `SECURITY_ADMIN`, or the existing
configured service lab token. `COP_OPERATOR` and `SYSTEM_CLIENT` alone cannot
change the source registry. Reject unauthorized mutations before parsing their
bodies with HTTP 403 `SOURCE_MANAGEMENT_FORBIDDEN`. Validate a partial source
update after merging it with the current source; reject unknown/invalid fields
and changes to `sourceSystemId` with HTTP 400 `VALIDATION_ERROR` before mutating
state.

Federation heartbeat, domain-event publication and replay, edge outbox flush,
edge replay and replay-cursor acknowledgement, and dead-letter listing, detail,
redrive and resolution require `INTEGRATION_ADMIN`, `SECURITY_ADMIN` or
`SYSTEM_CLIENT`, or the configured service lab token. An authenticated citizen
session or `COP_OPERATOR` alone does not grant these integration rights. Apply
the same boundary to the MCP tools `cop.events.replay` and
`cop.events.dead_letters.list` so an alternate transport cannot expose raw
domain or rejected-event payloads. Other allowlisted MCP tools retain their
existing access rules. REST denial uses HTTP 403 `INTEGRATION_FORBIDDEN` in the
correlation-aware COP error envelope; the MCP JSON-RPC transport preserves its
error format and returns `-32003` Forbidden with `INTEGRATION_FORBIDDEN` detail.

These guards establish explicit integration roles, not a new binding between an
actor and a particular `nodeId` or source. The canonical-ingest role set above
remains separate and unchanged.

## Consequences

Public canonical data remains usable after a fresh valid event. An old row
without sufficient classification evidence may disappear from the published
view after restart until its source refreshes it. Protected data cannot be
published through history or inferred conflict evidence. Supporting additional
classes or durable legacy history requires an explicit source/authorization
contract and migration, rather than a permissive fallback.

This change does not establish retention or delete audit/history. Long-running
event/idempotency memory and durable stream retention require a separately
approved policy and durable index plan. Existing data and production deployment
are preserved while the candidate is validated.
