# 02 Next Codex Prompt Contract Tests

Vytvoř contract test suite pro hlavní COP systém a nezávislý SIM projekt podle `docs/integration/01_SHARED_INTEGRATION_CONTRACT.md`, `docs/api/openapi-main-cop.yaml` a JSON Schema v `docs/api/schemas/`.

Testy musí pokrýt validní single event, validní batch, schema chybu, chybějící povinná pole, neznámý `sourceSystemId`, nepovolený `eventType`, revokovaný zdroj, idempotentní retry, idempotency conflict, syntetický flag a standardní error model. Připrav fixture payloady pro SIM source `sim-air-situation-001`.

Výstupem má být spustitelný testovací skeleton, který mohou používat COP i SIM týmy bez přístupu k interní implementaci druhého projektu.
