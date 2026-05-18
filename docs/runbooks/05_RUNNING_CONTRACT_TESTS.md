# 05 Running Contract Tests

Contract tests ověřují kompatibilitu COP a SIM. Spustitelný skeleton je v `tests/contract`.

## Minimální scénáře

1. Validovat JSON Schema soubory.
2. Validovat OpenAPI YAML.
3. Poslat validní SIM event.
4. Poslat validní batch.
5. Ověřit `400` pro schema chybu.
6. Ověřit `409` pro idempotency conflict.
7. Ověřit `403` pro revokovaný zdroj.

## Příkazy

```bash
pnpm test:contracts
pnpm check
```

Fixture pro SIM source je v [sim-event.json](../../tests/contract/fixtures/sim-event.json).
