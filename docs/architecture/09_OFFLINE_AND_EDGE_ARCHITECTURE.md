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

## Pilot PWA režim

Web klient v pilotu registruje service worker `cop-service-worker.js`, který ukládá aplikační shell, manifest, ikony, lokální build assety a průběžně použité mapové dlaždice. API endpointy se service workerem necachují, aby se neobcházela autentizace ani aktuální server-side policy.

Po každém úspěšném načtení nebo live stream update se do `localStorage` pro daný operátorský scope ukládá poslední povolený COP snapshot: health, zdroje, source health, aktuální objekty, alerty a oříznutá historie stop. Pokud API nebo síť selže, UI přepne do read-only fallbacku, označí režim `OFFLINE` nebo `DEGRADED`, zobrazí stáří snapshotu a ponechá mapu, seznam objektů, detail a replay nad posledními lokálními daty.

Tento režim je pouze informační. Nepovoluje manuální hlášení, změnu zdroje pravdy ani akční workflow. Po obnovení spojení se snapshot přepíše novým serverovým stavem.
