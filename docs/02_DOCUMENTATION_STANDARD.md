# 02 Documentation Standard

Dokumentace je psaná profesionálně česky. Technické termíny se ponechávají anglicky, pokud jsou v oboru běžné: `ingest`, `event bus`, `snapshot`, `delta`, `provider`, `schema`, `guardrails`, `policy enforcement`.

## Pravidla

- Každý adresář dokumentace má vlastní `00_INDEX.md`.
- Každý dokument má jednoznačný název a udržuje jeden hlavní účel.
- Architektonická rozhodnutí se zapisují jako ADR.
- API kontrakty se udržují v OpenAPI a JSON Schema.
- Mermaid diagramy se používají pro systémové, datové a sekvenční pohledy.
- Nejasnosti se zapisují do [06 Open Questions](06_OPEN_QUESTIONS.md).
- Dokumentace nesmí přidávat targeting, navádění, řízení zbraní ani doporučování použití síly.

## Stavové značky

- `Proposed` znamená návrh k potvrzení.
- `Accepted` znamená platné baseline rozhodnutí.
- `Deprecated` znamená nahrazený návrh.

## Verzionování

Kontrakty používají major/minor přístup. Breaking změna vyžaduje novou major verzi, aktualizaci OpenAPI/JSON Schema, ADR a dopadovou analýzu pro SIM projekt.
