# 05 Audit

Audit slouží k dohledatelnosti dat, policy rozhodnutí, administrátorských změn a AI použití.

## Audit events

- `SOURCE_REGISTERED`,
- `SOURCE_REVOKED`,
- `INGEST_ACCEPTED`,
- `INGEST_REJECTED`,
- `IDEMPOTENCY_CONFLICT`,
- `POLICY_DENIED`,
- `COP_SUBSCRIPTION_CREATED`,
- `AI_REQUEST_COMPLETED`,
- `AI_REQUEST_REJECTED`,
- `FUSION_CONFLICT_DETECTED`.

Auditní záznamy musí obsahovat timestamp, actor/source, correlation ID, výsledek a relevantní policy metadata.
