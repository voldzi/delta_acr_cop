# 02 Contract Testing

Contract tests jsou klíčové pro paralelní vývoj SIM projektu.

## Testovat

- validní single event,
- validní batch,
- chybějící povinné pole,
- neznámý `sourceSystemId`,
- nepovolený `eventType`,
- idempotency retry,
- idempotency conflict,
- synthetic flag u SIM dat,
- standardní error response.

SIM tým má používat stejné JSON Schema a OpenAPI artefakty jako COP tým.
