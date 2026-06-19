# ADR 0009: Standard Documentation Mapping and JSON OpenAPI

## Status

Accepted

## Context

The central application standards require a flat documentation entry set and a
JSON-first OpenAPI contract at `openapi/openapi.json`.

COP already has a mature numbered documentation convention with product,
architecture, application, integration, API, data, security, UX, testing and
runbook sections. Renaming that set would create churn and break references
used by the web repository and native iOS/iPadOS integration work.

The existing API contract was maintained as `docs/api/openapi-main-cop.yaml`.

## Decision

COP keeps the established numbered documentation convention and adds standard
flat entry points that map to the existing canonical documents:

- `docs/README.md`
- `docs/architecture.md`
- `docs/api.md`
- `docs/security.md`
- `docs/operations.md`
- `docs/observability.md`
- `docs/runbook.md`

The binding OpenAPI contract is now `openapi/openapi.json`. The existing YAML
path remains as a generated compatibility export for older documentation links
and tools.

## Consequences

- Agents and CI can validate the central skeleton without forcing a disruptive
  documentation rename.
- Existing links remain usable.
- Future API changes must update `openapi/openapi.json` first.
- YAML must not be edited by hand; regenerate it from JSON.
- Current COP error responses keep the existing `correlationId` field until a
  compatibility-safe migration is designed.
