# ADR0038: Recover private Dispatch ownership and report availability

- Status: accepted
- Date:2026-10-05

## Context

The production session lease disappeared after a temporary recovery while
process health stayed200. Shared vehicles do not depend on that lease.

## Decision

Manage one dedicated primary-session connection with heartbeat, bounded retries
and one acquisition flight. Clear volatile ciphertext on loss; invalidate all
previous shares before publishing ready. Fence prior-generation private work.
Do not resume consent. Report unavailable readiness503 and a degraded dependency
body. Extend wire-v1 capabilities with optional per-service availability; keep
existing fields/endpoints/error envelopes and older-client decoding compatible.
No configuration, secrets, networks, measurement or client collection flags
change. SDK exposes optional states with nil meaning unknown.

## Consequences

A second instance is unready until it owns the exclusive primary lease. Recovery
restores service, not live shares. Readiness includes enabled Dispatch ownership
while liveness remains process-only. Physical two-device acceptance is a
separate gate; isolated PostgreSQL termination tests are not device evidence.
