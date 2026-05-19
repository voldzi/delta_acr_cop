# 04 Streaming Contract

Streaming kontrakt distribuuje policy-filtered COP data přes subscription.

## Endpoint

`GET /api/v1/stream/cop/{subscriptionId}`

Pilotní implementace zatím vrací snapshot. Skutečný stream s delta zprávami je plánovaný další krok. Do té doby web používá polling pro aktuální stav a samostatný temporal endpoint pro historii tras.

## Temporal history endpoint

`GET /api/v1/cop/track-history`

Endpoint vrací policy-filtered body historie stop pro route history, časové okno v sekundách a budoucí replay. Podporované query parametry:

- `objectIds`: čárkou oddělené identifikátory objektů,
- `seconds`: relativní časové okno od serverového času,
- `from` a `to`: absolutní časové hranice,
- `limit`: maximální počet bodů na objekt.

Temporal endpoint je analytická čtecí vrstva. Neslouží k zadávání úkolů ani k akčnímu workflow.

## Message types

- `snapshot`: počáteční stav subscription.
- `delta`: změny od poslední sekvence.
- `heartbeat`: udržení spojení a server time.
- `policy_update`: změna policy ovlivnila viditelnost dat.
- `backpressure`: server omezuje frekvenci.
- `reconnect_required`: klient má obnovit spojení.
- `error`: standardizovaná chyba streamu.

Každá zpráva obsahuje `subscriptionId`, `serverTimestamp` a monotónní `sequence`, pokud je to pro typ zprávy relevantní.
