# 01 Shared Integration Contract

**Název:** Shared Integration Contract v1  
**Platnost:** Proposed baseline pro paralelní vývoj COP a SIM projektu  
**Rozsah:** API, event envelope, chybový model, verzování, autentizace a pravidla syntetických dat.

## Odpovědnosti COP systému

- Publikovat OpenAPI a JSON Schema kontrakty.
- Spravovat Source Registry a oprávnění zdrojů.
- Přijímat eventy pouze přes ingest API.
- Validovat schema, klasifikaci, syntetický flag a povolené event/object types.
- Zajišťovat idempotency, audit, provenance, confidence a policy enforcement.
- Vlastnit canonical model, fusion, COP state, distribuci a NATO renderer.

## Odpovědnosti SIM systému

- Vystupovat jako externí producent dat typu `SIMULATOR`.
- Registrovat se jako `SourceSystem`.
- Posílat pouze validní eventy podle `canonical-event-envelope.schema.json`.
- Uvádět `sourceSystemId`, `adapterVersion`, `eventId`, `correlationId`, `producerTimestamp`, klasifikaci, kvalitu a `simulation.synthetic=true`.
- Neposílat finální NATO symboly, nepoužívat interní databázi COP a nepředpokládat interní pořadí pipeline.

## Hranice projektů

Stabilní hranicí jsou `/api/v1` endpointy, JSON Schema, streaming message typy a standardní error model. Interní implementace COP, včetně event busu, databáze, fusion algoritmů a UI komponent, není sdílené rozhraní.

## Autentizace

Produkční směr: mTLS pro systémové zdroje a OIDC client credentials pro aplikační klienty. Laboratorní MVP může používat API token, pokud je omezený na registrovaný zdroj.

Požadované hlavičky pro ingest:

```http
Authorization: Bearer <token>
X-Source-System-Id: sim-air-situation-001
X-Idempotency-Key: <uuid>
X-Contract-Version: cop-ingest-v1
X-Correlation-Id: <uuid>
```

## Povinná pole události

- `eventId`: globálně unikátní identifikátor události.
- `eventType`: typ změny, např. `track.updated`.
- `contractVersion`: verze kontraktu, např. `cop-ingest-v1`.
- `source.sourceSystemId`: identita zdroje v Source Registry.
- `source.adapterVersion`: verze transformační logiky.
- `correlationId`: korelační identifikátor requestu nebo scénáře.
- `producerTimestamp`: čas vzniku události u producenta.
- `ingestTimestamp`: doplňuje COP při přijetí.
- `classification`: úroveň, releasability a handling caveats.
- `simulation.synthetic`: povinné `true` pro SIM.
- `quality`: confidence, source reliability a information credibility.

## Idempotency

`X-Idempotency-Key` a `eventId` chrání proti duplicitám. Stejný klíč se stejným obsahem může vrátit předchozí výsledek. Stejný klíč s jiným obsahem vrací `409 Conflict`.

## Retry a backoff

Producent může opakovat request po síťové chybě, `429` nebo `503`. Doporučený backoff je exponenciální s jitterem. Producent nesmí měnit `eventId` při retry stejné události.

## Schema validation

Nevalidní JSON nebo porušení JSON Schema vrací `400 Bad Request`. Business-validní JSON, který porušuje pravidla registru, klasifikace nebo povolených typů, vrací `422 Unprocessable Entity` nebo `403 Forbidden`.

## Breaking changes policy

Breaking změna vyžaduje novou major verzi kontraktu, paralelní běh staré a nové verze po dohodnuté období, ADR a aktualizované contract tests. Non-breaking změny mohou přidávat volitelná pole, nové enum hodnoty pouze po domluvě a nové endpointy bez změny existujícího chování.
