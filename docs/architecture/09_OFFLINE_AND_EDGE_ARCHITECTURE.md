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

Navigace do mapy i chatu používá network-first shell strategii s krátkým
timeoutem. Pokud je zařízení online, připnutá PWA načte aktuální HTML shell a
uloží ho do cache; pokud je síť pomalá nebo nedostupná, vrátí poslední uložený
shell. Content-hashované `/assets/*` a `/chat/assets/*` jsou cache-first,
protože změna buildu mění jejich název. To drží offline start rychlý, ale
zároveň brání tomu, aby po produkčním nasazení PWA dlouho běžela na starém
shellu.

Při instalaci service worker zahřívá runtime cache ze same-origin assetů
odkazovaných z HTML i z Vite build manifestů mapy a chatu. Instalační krok je
úspěšný jen tehdy, když je dostupný aktuální shell i všechny content-hashované
lazy chunky. Předchozí release cache zůstává po jednu verzi zachovaná, aby již
otevřená záložka mohla dokončit lazy import během nasazení nové verze.

Pokud starší service worker přesto zanechá online klienta s chybějícím lazy
chunkem, root error boundary rozpozná browser chybu dynamického importu,
jednorázově odstraní neúplné COP PWA cache, odregistruje starý worker a načte
aktuální release. Offline klient cache nemaže a ponechá poslední funkční shell.

Po registraci service workeru a při návratu aplikace do popředí web shell posílá
zprávu `cop:pwa:warm-cache`. Service worker zopakuje bezpečné dohřátí shell
assetů a vrátí `cop:pwa:cache-warmed` s počty položek v shell/runtime/tile
cache. Nastavení aplikace tak rozlišuje samotnou registraci service workeru od
praktické připravenosti PWA cache.

Manifest `site.webmanifest` je společný pro mapu i chat pod stejným veřejným
originem. Aplikace běží v `standalone` režimu, nefixuje orientaci zařízení,
startuje v `/chat/` a nabízí samostatnou zkratku do situační mapy `/`. Pokud
prohlížeč podporuje Badging API, COP shell i
samostatná chat stránka synchronizují počet nepřečtených zpráv na ikonu
instalované aplikace. Tato badge synchronizace je best effort a nesmí nahrazovat
serverový audit doručení notifikací.

Po každém úspěšném načtení nebo live stream update se pro daný operátorský
scope ukládá poslední povolený COP snapshot: health, zdroje, source health,
aktuální objekty, alerty a oříznutá historie stop. Primární úložiště je
IndexedDB; `localStorage` zůstává kompatibilní fallback a rychlá synchronní
indikace při startu. Web shell zároveň požádá prohlížeč přes Storage Manager API
o persistent storage. Pokud prohlížeč žádost odmítne nebo API nepodporuje, PWA
funguje dál v best-effort režimu a stav se zobrazí v nastavení.

OIDC relace se ukládá odděleně od datového snapshotu. Pokud při startu,
návratu z pozadí nebo plánované obnově access token expiroval a refresh selže
kvůli offline stavu, timeoutu, rate limitu nebo 5xx odpovědi identity provideru,
PWA zachová lokální identitu, uživatelský scope a offline snapshot. Expirovaný
access token se v tomto režimu neposílá do API; online operace počkají na další
úspěšný refresh. Lokální relace se automaticky smaže jen při ručním odhlášení
nebo při potvrzeně neplatném refresh tokenu.

Stejnou persistent storage žádost spouští i samostatný chat shell po vytvoření
Matrix session. E2EE recovery key se v moderním prohlížeči neukládá jako
plaintext `localStorage`; `@cop/messaging` jej zapíše do IndexedDB jako sealed
secret šifrovaný lokálním WebCrypto AES-GCM wrapping key. Wrapping key je
non-extractable a vázaný na origin prohlížeče. Pokud prohlížeč IndexedDB nebo
structured-clone CryptoKey odmítne, klient použije legacy `localStorage`
fallback, aby uživatel neztratil možnost obnovit Matrix key backup.

COP Chat navíc per uživatel a Matrix místnost ukládá poslední známou čitelnou
podobu timeline do lokálního browser storage. Primární úložiště je IndexedDB,
`localStorage` je fallback pro omezené prohlížeče. Do této cache se nezapisují
události, které Matrix SDK v daném okamžiku hlásí jako nešifrovatelné
placeholdery; čitelná zpráva, která už v tomto prohlížeči jednou byla
zobrazena, se proto při krátkodobém E2EE/key refresh problému nemá degradovat
zpět na text o chybějícím klíči. Cache zůstává pouze na zařízení a neposílá se
do COP API.

Při startu PWA nejdřív asynchronně načte nejnovější lokální snapshot z
IndexedDB/`localStorage`, okamžitě ho zobrazí jako `DEGRADED` nebo `OFFLINE`
náhled a paralelně obnovuje živá data přes COP API a SSE stream. Po úspěšné
online obnově se lokální snapshot přepíše novým serverovým stavem a UI se vrátí
do live režimu. Pokud API nebo síť selže, UI zůstane v read-only fallbacku,
zobrazí stáří snapshotu a ponechá mapu, seznam objektů, detail a replay nad
posledními lokálními daty.

Tento režim je pouze informační. Nepovoluje manuální hlášení, změnu zdroje pravdy ani akční workflow. Po obnovení spojení se snapshot přepíše novým serverovým stavem.
