# ADR0045: Read-only conversation-scoped Matrix identity lookup

Decision: expose an additive authenticated lookup of existing COP–Matrix pairs, bounded by current conversation membership, with exact opaque IDs and short expiry. Never reuse the existing provisioning resolver for passive presentation. Missing pairs stay unknown. SDK retains authoritative COP metadata when transports cannot be joined safely; names and guessed localparts never establish identity. Call responses add an optional viewer-specific peer from a read-only exact profile lookup so a shared callee title cannot label incoming calls.

Compatibility: old endpoints and stored data stay unchanged; no schema migration, account/password writes, service tokens or network changes. Rollout/rollback and actual acceptance evidence are in integration42.
