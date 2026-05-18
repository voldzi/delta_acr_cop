# 09 Offline and Edge Architecture

Offline a edge režim je určen pro omezenou konektivitu a lokální čtení posledního povoleného COP snapshotu.

## Principy

- lokální cache posledního snapshotu,
- explicitní stale a degraded indikace,
- lokální outbox pro manuální hlášení,
- sync po obnovení spojení,
- policy enforcement i bez plné konektivity,
- audit lokálních akcí a replay po reconnectu,
- redukovaná granularita při omezené šířce pásma.

Edge node nesmí vytvářet nový zdroj pravdy. Po obnovení spojení synchronizuje změny přes kontraktované endpointy a řeší konflikty podle server-side pravidel.
