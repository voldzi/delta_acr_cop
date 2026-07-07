# 02 Main COP UI

Hlavní UI má šest oblastí:

- top status bar: stav systému, latency, aktivní zdroje, počet objektů, online/degraded/offline a AI provider status,
- left layer panel: vrstvy, filtry, AOR, confidence threshold a synthetic toggle,
- central map canvas: MapLibre, symboly, clustering, AOI a timeline overlay,
- right object detail panel: detail, provenance, source history, confidence, audit link a symbol resolution,
- bottom timeline/replay panel: časový posun a změny confidence,
- AI assistant drawer: povolené datové dotazy a vysvětlení.

Komunikace je sedmá průřezová plocha. Krátkodobě ji zajišťuje samostatná
aplikace `cop-chat` vložená do COP jako iframe panel. Plovoucí chat slouží pro
rychlou kontrolu, ale připnutý režim se chová jako pravý inspektor: mapa si
uvolní prostor, na pravém okraji je chatový panel a uživatel může měnit šířku
celého docku.

AppShell v2 směruje hlavní pracovní plochu ke vzhledu čisté operační konzole:
nahoře je stabilní operační kontext s aktuální událostí nebo vybraným objektem,
vlevo je jediné úzké aplikační menu a uprostřed mapa s volitelnými panely
vrstev/detailu. Připnutý chat se otevírá jako pravý dock a uvnitř používá
embedded režim `cop-chat` bez vlastní aplikační lišty. Funkce konverzací,
skupin, reakcí, příloh a notifikací vlastní `cop-chat`; COP web pouze poskytuje
prostor a navigační vstup.

Chatový composer musí v `cop-chat` podporovat text, fotku, video, soubor a
polohu jako primární akce. Pokud má informace z chatu přejít do mapového světa,
uživatel použije v COP akci `Nahlásit`; tím vzniká COP komunitní hlášení s
vlastní platností, závažností, polohou, ACL a auditem. COP UI nesmí udržovat
druhou správu chatových skupin.

Pravý horní roh top baru obsahuje operátorský vstup. Přihlášený uživatel zde vidí avatar a jméno z `preferences.operatorProfile`; nepřihlášený uživatel vidí pouze akci `Přihlásit`. Profilová karta může obsahovat avatar, zobrazované jméno, roli, organizaci, telefon, e-mail a kontaktní poznámku.

Pracovní plocha je konfigurovatelná. Levý katalogový panel, pravý inspektor a dolní status bar lze skrýt nebo sbalit tak, aby v krizové situaci vynikla mapa. Desktop podporuje změnu šířky levého a pravého panelu tažením za hranu. Stav se ukládá do `preferences.workspaceLayout`; bez přihlášení zůstává dostupný lokálně v prohlížeči.

Vzhled plochy má tři skiny uložené v `preferences.workspaceSkin`: civilní, operační a terénní. Skin mění pouze vizuální systém. Šablony pracovní plochy navíc nastavují rozložení panelů, mapový podklad, symboliku a výstražné vrstvy. Civilní šablona je určená pro občanskou orientaci, operační pro dispečink a terénní pro maximum mapy na menším zařízení.

Manuál je součást aplikace. Hlavní vstup je v topbaru, kontextové malé otazníky jsou v nastavení a u nástrojů, které mohou vyžadovat vysvětlení. Nápověda musí používat civilní jazyk, oddělovat bezpečnostní výstrahy od technických varování a neobsahovat instrukce k použití síly.

Primární aktualizace COP dat probíhá přes live SSE stream. Nastavení intervalu je proto v centru nastavení jako `Fallback synchronizace`; používá se v degraded režimu, při výpadku streamu, po obnově záložky a pro méně dynamická data.

PWA offline režim automaticky ukládá poslední povolený COP snapshot pro daný
operátorský scope do IndexedDB s `localStorage` fallbackem. Při otevření
aplikace se lokální snapshot zobrazí bez čekání na síť, topbar ho označí jako
`DEGRADED` nebo `OFFLINE` náhled a aplikace paralelně obnovuje živé API/SSE
spojení. Po výpadku API nebo sítě levý panel ukáže stáří snapshotu a zobrazení
je read-only, dokud se neobnoví serverové spojení.

Navigace je mapový režim nad existujícím routing overlay. Uživatel ji může
spustit z vybraného objektu/prvku, ze zobrazené trasy nebo z již vypočtené
zásahové trasy. Před startem volí profil `Autem` nebo `Pěšky`; COP potom
požádá SIM přes `/api/v1/routing/route`, zobrazí fullscreen navigační overlay
a uloží lehký route package lokálně pro návrat po restartu PWA. Offline režim
pokračuje po uložené trase a stažených dlaždicích v koridoru trasy; nové
přepočítání trasy vyžaduje dostupné backend spojení, dokud nebude zaveden
lokální routovací graf. Aktivní navigace průběžně počítá postup po segmentech
trasy, odchylku od linie, vzdálenost k dalšímu bodu a při online režimu nabízí
ruční přepočet z aktuální polohy.

UI nesmí obsahovat targeting, navádění ani ovládání prostředků.

Skryté neprovozní prvky mohou existovat pouze jako izolovaný easter egg bez
dopadu na situační mapu, chat, datové zdroje nebo oprávnění. Pilotní integrace
`Rajčatová sklizeň` se spouští z COP shellu nebo lokálním chat příkazem
`/tomato` a zobrazuje externí hru v sandboxovaném iframe z
`games.zeleznalady.cz`; COP nepřebírá její service worker ani herní assety do
operačního bundle.
