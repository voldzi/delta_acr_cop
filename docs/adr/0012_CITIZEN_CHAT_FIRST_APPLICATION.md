# ADR-0012: Citizen Chat-First Application

## Status

Accepted

## Context

CSM must be useful to citizens before a crisis, otherwise it cannot establish
the identity, trust and communication network needed when a crisis occurs. A
map-first operational shell is valuable for specialist work but is not a
credible everyday entry point for the general public.

Private chat content must not become situation data implicitly. Citizens need a
clear action that turns an observed event into a structured report with an
explicit location, validity, severity and publication decision.

## Decision

- The installed PWA starts at `/chat/`; the map remains available at `/` and as
  a first-class navigation action.
- Chat and map are the primary citizen surfaces. Specialist data, source,
  radio and replay workspaces remain available under secondary navigation.
- `cop-chat:report-draft` transfers only conversation identifiers and a title
  to COP. It never transfers plaintext messages. COP opens an editable report
  draft and publishes only after explicit user submission.
- Published/submitted community reports can be read by the audited read-only
  MCP tool `cop.community.reports.search`. The result excludes chat messages,
  author identities and media URLs.
- Emergency-service roles and role-specific workflows are deferred. The
  citizen information architecture must not depend on them.

## Consequences

- Everyday engagement is built around a full Matrix/E2EE chat rather than an
  operational dashboard.
- Crisis information retains provenance and an intentional publication step.
- MCP can provide shared situation facts to authorized agents without becoming
  a chat transport or bypassing COP policy.
- PWA release management must keep both chat and map shells valid across a
  deployment because either can be the active client at upgrade time.

## Alternatives Considered

- Start on the map: rejected as the default citizen flow because it has little
  everyday utility when no incident is active.
- Automatically mine private chats into COP: rejected because it violates user
  intent, E2EE expectations and data minimization.
- Expose the community database directly to agents: rejected because it would
  bypass policy filtering and audit.
