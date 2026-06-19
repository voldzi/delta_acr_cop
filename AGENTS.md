# Project Agent Guide

## Mission

This repository contains the Civil Situation Map (CSM/COP): a production web
client, Fastify API, provider adapters, map catalog, community reporting,
messaging bridge, media handling, sketch drawings and documentation used by the
native iOS/iPadOS client.

The repository uses the local Chroma retrieval stack maintained on this
workstation. Prefer retrieval before broad repository scans when the tools are
available.

## Working Style

- Prefer retrieval-first workflow over broad file scanning.
- Before reading many files, use available Chroma MCP tools:
  - `search_code` for implementation lookup,
  - `search_docs` for documentation lookup,
  - `search_all` when the location is unclear,
  - `get_file_context` only after selecting a relevant hit.
- If MCP tools are not exposed, use the CLI fallback:
  - `"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" search-all "<query>" --root . --limit 5`
  - then read only the selected files or ranges directly.
- If retrieval tools are unavailable, Chroma is down, or the index returns no
  useful hits, fall back to direct repository inspection and state that retrieval
  was unavailable or insufficient.

## Source of Truth

- `README.md`
- `docs/README.md` for the standard topic mapping.
- Numbered COP documentation under `docs/` for detailed product,
  architecture, security, operations, UX, API and runbook material.
- `openapi/openapi.json` for the REST API contract.
- `docs/api/openapi-main-cop.yaml` only as generated compatibility export.
- `apps/cop-api/src/` for the backend.
- `apps/cop-web/src/` for the web client.
- `CLAUDE.md` and `AGENTS.md` must stay aligned unless a
  platform-specific difference is intentional.

## Environment

- Runtime: Node.js 24.x, pnpm 10.x.
- Install: `pnpm install`
- Local development: `pnpm dev`
- API only: `pnpm dev:api`
- Web only: `pnpm dev:web`
- Build: `pnpm build`
- Type-check/lint: `pnpm lint`
- Tests: `pnpm test`
- Contract tests: `pnpm test:contracts`
- Full local check: `pnpm check`
- Skeleton validation: `bash scripts/validate-skeleton.sh`

The local default ports are:

- API: `http://localhost:4310`
- Web: `http://localhost:4311`

Production pilot deployment runs from `/srv/cop` on `docker.home.cz`.

## Permissions

- `git push` is allowed when the change has been intentionally prepared and the
  task requires publishing or syncing the branch.
- `ssh docker.home.cz` is allowed when the task requires access to the
  production or remote environment on that host.
- The correct production host name is `docker.home.cz`.
- Do not manipulate VPN, VLAN, firewall, or network segmentation unless the user
  explicitly asks for those infrastructure steps.

## Application Skeleton Standards

This repository follows the central application standards maintained in the
chromadb tooling repository under `docs/standards/`. Binding summary:

- The mandatory file set must stay present: `README.md`, `AGENTS.md`,
  `CLAUDE.md`, `.env.example`, `docs/README.md`, `docs/architecture.md`,
  `docs/api.md`, `docs/security.md`, `docs/operations.md`,
  `docs/observability.md`, `docs/runbook.md`, `docs/adr/`.
- This repository keeps its established numbered documentation convention. The
  standard topics are mapped in `docs/README.md`, and the decision is recorded
  in an ADR.
- JSON-first OpenAPI: `openapi/openapi.json` is the binding API contract. Never
  change the API without updating it. YAML may exist only as a generated export.
- Existing live endpoints must not be renamed. COP exposes `/health/live`,
  `/health/ready` and `/health/dependencies`; these are documented in OpenAPI.
- Error responses currently use the COP envelope with `correlationId`. Do not
  change response shape without a compatibility-safe migration and ADR.
- Logging must remain structured and carry correlation/request context where
  applicable.
- Never commit secrets; keep `.env.example` in sync with configuration
  documentation.
- Do not create undocumented endpoints, delete documentation without
  replacement, or introduce an incompatible structure without an ADR.
- `scripts/validate-skeleton.sh` must pass; CI runs it.

## Documentation Rules

- Keep current-state documentation under `docs/` and update
  `docs/README.md` when the active set changes.
- Historical analyses, audits and superseded designs go to `docs/archive/`.
- Record significant technical decisions in `docs/adr/`.
- If a change affects API, configuration, deployment, testing, security, data
  handling, operations or the iOS integration contract, update the matching
  document in the same change.

## Validation

Use the smallest reliable verification set for the change:

- `bash scripts/validate-skeleton.sh`
- `pnpm validate:schemas`
- `pnpm validate:openapi`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

If retrieval scope changed, run:

- `"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" reindex --root .`

If a check cannot be run, state that explicitly with the observed error.

## Change Discipline

- Do not silently change config semantics.
- Update docs when behavior changes.
- Keep documentation current-state, name where archived notes belong, and avoid
  mixing active runbooks with historical working notes.
- Do not invent production deployment behavior unless the repository explicitly
  defines it.
