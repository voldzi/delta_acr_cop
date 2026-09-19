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

## SSE release gate

`pnpm test:load:stream -- <base-url> <clients> <duration-ms>` opens the requested
počet souběžných COP streamů, ověří úspěšné otevření všech spojení a vypíše
p50, p95 a p99 latence otevření. Výchozí release limit je p95 ≤ 5 sekund;
změnit ho lze pouze explicitně přes `COP_LOAD_MAX_OPEN_P95_MS` a důvod se musí
uložit spolu s výsledkem.

Pilotní smoke cíl je 40 klientů. Škálovací brána je 2 000 klientů proti nejméně
dvěma API instancím se sdílenou PostgreSQL stream sběrnicí. Úspěšný běh proti
jediné instanci je užitečný kapacitní důkaz, ale nesplňuje multi-instance bránu.
Škálovací běh používá `COP_LOAD_RAMP_MS=5000`, což odpovídá produkčnímu
reconnect jitteru a po otevření posledního klienta drží všechna spojení ještě po
celou zadanou dobu. Samostatný běh bez rampy měří úmyslný okamžitý burst.
API standardně používá listen backlog 4 096, nastavitelný přes
`COP_API_LISTEN_BACKLOG`, aby nárazové otevírání streamů nekončilo v omezené
frontě operačního systému. Test seskupuje shodné chyby, takže i neúspěšný
kapacitní běh zůstává čitelný a archivovatelný.
