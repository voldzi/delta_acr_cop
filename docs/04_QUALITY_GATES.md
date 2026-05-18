# 04 Quality Gates

Quality gates chrání dokumentační baseline, integrační kontrakty i budoucí implementaci.

## Dokumentace

- Každý adresář má `00_INDEX.md`.
- Každý dokument je nalinkovaný z příslušného indexu.
- Žádné zásadní `TBD` nesmí zůstat bez zápisu v [06 Open Questions](06_OPEN_QUESTIONS.md).
- Mermaid diagramy musí být syntakticky validní a čitelné.
- ADR jsou číslované a obsahují status, context, decision, consequences, alternatives a follow-up actions.

## API a data

- OpenAPI musí být validní YAML a používat OpenAPI 3.1.
- JSON Schema soubory musí být validní JSON Schema.
- Každá breaking změna kontraktu vyžaduje novou major verzi, ADR a migrační poznámku.
- `eventId`, `correlationId`, `sourceSystemId`, `adapterVersion`, `producerTimestamp`, `classification`, `synthetic` a `idempotency` musí být zachovány jako kontraktové koncepty.

## Security a AI

- Každá bezpečnostní změna aktualizuje threat model nebo risk register.
- Každá AI změna popisuje bezpečnostní dopad, guardrails, audit a data redaction.
- Externí AI provider musí být vypnutelný.
- Zakázané AI use-cases se nesmí obcházet prompt template ani tool voláním.

## Operace

- Health endpoints musí rozlišovat liveness, readiness a dependencies.
- Auditní stopa musí pokrývat ingest, Source Registry, policy decisions, distribuci a AI dotazy.
- Offline/degraded režim musí explicitně označit stale data.
