# ADR-0017: Server-Owned Canonical Messaging Conversations

## Status

Accepted

## Context

COP web and COP Mobile previously assembled a conversation from two independent
sources: COP/CSM Messaging metadata and whatever Matrix rooms happened to be
visible locally. Both clients could create a Matrix room and bind it later.
Retries, delayed metadata, token expiry and client-specific AI heuristics then
produced duplicate messages, duplicate groups, opaque room identifiers, wrong
avatars and different behavior between web and iOS.

Matrix room identity, COP conversation identity and visual presentation are
different concerns. They need one authoritative lifecycle rather than eventual
client-side reconciliation.

## Decision

CSM Messaging is the only authority that creates or reuses a canonical
conversation and provisions its encrypted Matrix room. Create is idempotent by
the server-generated `canonicalKey`; direct conversations are unique by member
set and each user has at most one `personal_ai` conversation. COP API returns
success only after the provider returns a ready encrypted room binding.

Every conversation carries an explicit `conversationKind` with one of
`direct`, `group` or `personal_ai`. Clients must not infer AI behavior from a
title, member ID, room name or legacy metadata. COP metadata is the only source
for the conversation list. Raw Matrix rooms can supply timeline state after a
known binding is selected, but they never become list entries on their own.

The empty-body Matrix-room endpoint is an idempotent ensure operation. Supplying
a client-created room ID remains temporarily supported for migration only; new
web and native clients do not use it.

E2EE uses normal trusted Matrix devices, cross-signing and automatic key backup.
Clients do not enable all-device key sharing and do not expose recovery or
service secrets through COP APIs.

## Consequences

- A retry cannot create a second direct or personal AI conversation.
- Web and native clients render the same canonical metadata, peer avatar and
  group identity.
- A conversation is either ready with an encrypted room or creation fails; no
  half-created row is presented to the user.
- Pre-production data may be reset once when this contract is deployed. No
  compatibility migration of old message history is required.
- Contract tests must cover idempotent create, server-owned room provisioning,
  explicit AI kind and rejection of orphan Matrix rooms in client lists.
