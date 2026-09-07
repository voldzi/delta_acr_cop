# 03 Load Testing

Load testing baseline vychází z laboratorních MVP kritérií.

## Cíle

- minimálně 1 000 současných stream klientů,
- minimálně 1 000 ingest zpráv/s v laboratorním režimu,
- kritické polohové aktualizace do 1 s end-to-end,
- reconnect klienta do 5 s po krátkém výpadku.

Měřit se má ingest latency, fusion latency, distribution latency, backpressure, reconnect rate a policy denied count.

Rychlá regresní kontrola streamu je dostupná jako
`pnpm test:load:stream -- http://127.0.0.1:4310 40 8000`. Otevírá skutečná SSE
spojení, po omezené době je ukončí a vrátí počet otevřených spojení, událostí,
bytů a chyb. Pro chráněné prostředí se token předává jen přes
`COP_LOAD_TOKEN`; nesmí se zapisovat do argumentů, logů ani repozitáře. Tato
kontrola pro desítky klientů je release smoke test. Cíl 1 000 současných
klientů vyžaduje samostatné řízené kapacitní prostředí a sledování API,
PostgreSQL, proxy a distribuční vrstvy.
