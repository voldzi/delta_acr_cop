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

Web klient v pilotu registruje service worker `cop-service-worker.js`, který
ukládá aplikační shell, manifest, ikony, lokální build assety, chat shell pod
`/chat/` a průběžně použité mapové dlaždice. API endpointy se service workerem
necachují, aby se neobcházela autentizace ani aktuální server-side policy.

Navigace do mapy i chatu používá stale-while-revalidate shell strategii: pokud
už je shell v cache, PWA ho vrátí okamžitě a síťovou aktualizaci provede na
pozadí. Content-hashované `/assets/*` a `/chat/assets/*` jsou cache-first,
protože změna buildu mění jejich název. To je základ pro chování podobné
nativní aplikaci při opakovaném otevření nebo nestabilní síti.

Při instalaci service worker navíc zahřívá runtime cache ze same-origin assetů
odkazovaných přímo z HTML shellu mapy a chatu. Díky tomu další spuštění PWA
nečeká na základní JS/CSS chunky mapy ani integrovaného chatu. Volitelné těžké
části, například Matrix/E2EE nebo PDF zpracování, se předem nestahují; ukládají
se cache-first až při prvním skutečném použití.

Po registraci service workeru a při návratu aplikace do popředí web shell posílá
zprávu `cop:pwa:warm-cache`. Service worker zopakuje bezpečné dohřátí shell
assetů a vrátí `cop:pwa:cache-warmed` s počty položek v shell/runtime/tile
cache. Nastavení aplikace tak rozlišuje samotnou registraci service workeru od
praktické připravenosti PWA cache.

Manifest `site.webmanifest` je společný pro mapu i chat pod stejným veřejným
originem. Aplikace běží v `standalone` režimu, nefixuje orientaci zařízení a
nabízí zkratku do `/chat/`, aby připnutý COP působil jako jedna aplikace s
integrovanou komunikací. Pokud prohlížeč podporuje Badging API, COP shell i
samostatná chat stránka synchronizují počet nepřečtených zpráv na ikonu
instalované aplikace. Tato badge synchronizace je best effort a nesmí nahrazovat
serverový audit doručení notifikací.

Po každém úspěšném načtení nebo live stream update se do `localStorage` pro daný operátorský scope ukládá poslední povolený COP snapshot: health, zdroje, source health, aktuální objekty, alerty a oříznutá historie stop. Pokud API nebo síť selže, UI přepne do read-only fallbacku, označí režim `OFFLINE` nebo `DEGRADED`, zobrazí stáří snapshotu a ponechá mapu, seznam objektů, detail a replay nad posledními lokálními daty.

Tento režim je pouze informační. Nepovoluje manuální hlášení, změnu zdroje pravdy ani akční workflow. Po obnovení spojení se snapshot přepíše novým serverovým stavem.
