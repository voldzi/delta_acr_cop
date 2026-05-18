# 05 Source Registry Contract

Source Registry definuje, které zdroje smí publikovat jaké události a objekty.

## Endpointy

- `GET /api/v1/sources`
- `POST /api/v1/sources`
- `GET /api/v1/sources/{sourceSystemId}`
- `PATCH /api/v1/sources/{sourceSystemId}`
- `POST /api/v1/sources/{sourceSystemId}/revoke`

## Stav

`REGISTERED`, `ACTIVE`, `SUSPENDED`, `REVOKED`.

Revokace je auditovaná a nemá být tichá. Nové ingest requesty revokovaného zdroje vrací `403 Forbidden`.
