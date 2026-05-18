# 04 Streaming Contract

Streaming kontrakt distribuuje policy-filtered COP data přes subscription.

## Endpoint

`GET /api/v1/stream/cop/{subscriptionId}`

## Message types

- `snapshot`: počáteční stav subscription.
- `delta`: změny od poslední sekvence.
- `heartbeat`: udržení spojení a server time.
- `policy_update`: změna policy ovlivnila viditelnost dat.
- `backpressure`: server omezuje frekvenci.
- `reconnect_required`: klient má obnovit spojení.
- `error`: standardizovaná chyba streamu.

Každá zpráva obsahuje `subscriptionId`, `serverTimestamp` a monotónní `sequence`, pokud je to pro typ zprávy relevantní.
