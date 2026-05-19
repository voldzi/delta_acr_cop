# 04 Streaming Contract

Streaming kontrakt distribuuje policy-filtered COP data přes subscription.

## Endpoint

`GET /api/v1/stream/cop/live`

Produkční pilot používá Server-Sent Events (SSE). Server po připojení pošle policy-filtered `snapshot`, následně `delta` při přijatých ingest eventech a periodický `heartbeat`. Web klient stream používá jako primární kanál a refresh interval ponechává jako fallback synchronizaci pro degraded režim.

Web klient stream čte přes `fetch` nad `text/event-stream`, aby i v Keycloak režimu mohl posílat standardní `Authorization: Bearer ...` hlavičku. Token se proto neposílá v URL.

Objekty ve `snapshot` i `delta` mohou nést `attributes.conflictEvidence`. Jde o serverově odvozenou informační evidenci pro confidence/provenance panel, ne o akční pokyn.

Klient sleduje provozní telemetrii streamu: stav `LIVE` / `DEGRADED` / `OFFLINE`, odhad latence ze serverového času, poslední přijatý heartbeat, počet reconnectů a poslední chybu. Tato data jsou zobrazena v panelu Data readiness a slouží k operátorskému přehledu, ne k řízení objektů.

Legacy snapshot endpoint zůstává k dispozici pro kompatibilitu:

`GET /api/v1/stream/cop/{subscriptionId}`

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
