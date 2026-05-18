# 03 Development Workflow

Vývoj hlavního COP systému bude veden documentation-first a API-first. Cílem je umožnit paralelní vývoj hlavního COP a externího SIM projektu bez sdílené interní implementace.

## Doporučený postup změny

1. Aktualizovat relevantní dokumentaci a otevřené otázky.
2. Upravit OpenAPI nebo JSON Schema, pokud změna ovlivňuje kontrakt.
3. Doplnit nebo aktualizovat ADR pro architektonické rozhodnutí.
4. Přidat contract tests pro integrace.
5. Implementovat změnu v příslušném modulu.
6. Ověřit quality gates, bezpečnostní dopady a auditovatelnost.

## Branching a review

Každá změna integračního kontraktu, AI vrstvy, bezpečnostního modelu nebo NATO rendereru vyžaduje review architektury. Security-impact změny vyžadují aktualizaci threat modelu nebo risk registeru.

## SIM koordinace

SIM projekt nesmí používat interní typy, databáze ani messaging hlavního COP systému. Stabilním rozhraním je pouze Shared Integration Contract v1 a publikované OpenAPI/JSON Schema.
