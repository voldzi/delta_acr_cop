# 07 Versioning Policy

API MVP používá prefix `/api/v1`. Event envelope používá `contractVersion`, například `cop-ingest-v1`.

## Non-breaking změny

- nový volitelný property,
- nový endpoint,
- rozšíření response o volitelná metadata,
- nové enum hodnoty pouze po koordinačním review se SIM týmem.

## Breaking změny

- odstranění pole,
- změna významu pole,
- změna povinnosti pole,
- změna typu,
- změna idempotency nebo error semantics,
- zpřísnění pravidel, které může rozbít existující validní payloady.

Breaking změna vyžaduje novou major verzi, ADR, migrační plán a contract tests pro obě verze.
