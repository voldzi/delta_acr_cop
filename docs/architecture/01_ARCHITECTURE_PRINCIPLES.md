# 01 Architecture Principles

## Documentation-first

Kontrakty, hranice systému, security požadavky a ADR vznikají před implementací. Cílem je snižovat integrační riziko a umožnit paralelní práci COP a SIM týmů.

## Data-first

Zdrojem pravdy je datová platforma a COP state, ne mapový klient. Každý vizuální prvek musí být odvoditelný z canonical modelu a provenance.

## API-first

Externí producenti a konzumenti používají pouze publikovaná API, OpenAPI a JSON Schema. Interní databáze a event bus nejsou integrační rozhraní.

## Event-driven

Každá změna situačního stavu vstupuje jako validovaná a auditovaná událost. Pipeline podporuje idempotency, ordering metadata, retry/backoff a replay.

## Security-by-design a Zero Trust

Systém implicitně nedůvěřuje síti, uživateli, zařízení ani zdroji dat. Přístup vyžaduje autentizaci, autorizaci, policy evaluation a audit.

## Auditability a explainability

Každý COP objekt musí být dohledatelný ke zdrojovým událostem, transformační verzi a confidence faktorům. AI výstupy musí být auditované a vysvětlitelné.

## Explicit contracts

Integrační smlouvy jsou verzované. Breaking změny vyžadují novou major verzi, ADR a contract tests.

## Independent deployability

COP a SIM jsou samostatné projekty. Komponenty COP mají mít jasné ownership hranice a nasaditelnost bez vazby na simulátor.

## Provider abstraction for AI

AI Gateway abstrahuje OpenAI, Codex, local LLM a mock providera. Externí provideři musí být vypnutelní a local-only režim musí být architektonicky podporovaný.

## NATO renderer only in main COP

SIM produkuje canonical data, nikoli symboliku. Symbol resolver a renderer jsou vlastnictvím hlavního COP systému.

## Synthetic data separated from real data

Syntetická data mají explicitní flag, provenance, handling caveats a UI odlišení. Nesmí být nepozorovaně míchána s reálnými daty.

## No targeting / no weapon workflow

Systém nepodporuje targeting, navádění, řízení zbraní, doporučování použití síly ani autonomní bojové plánování. Výstupem je situační a datový přehled.
