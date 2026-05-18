# 03 Load Testing

Load testing baseline vychází z laboratorních MVP kritérií.

## Cíle

- minimálně 1 000 současných stream klientů,
- minimálně 1 000 ingest zpráv/s v laboratorním režimu,
- kritické polohové aktualizace do 1 s end-to-end,
- reconnect klienta do 5 s po krátkém výpadku.

Měřit se má ingest latency, fusion latency, distribution latency, backpressure, reconnect rate a policy denied count.
