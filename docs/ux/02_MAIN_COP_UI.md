# 02 Main COP UI

Hlavní UI má šest oblastí:

- top status bar: stav systému, latency, aktivní zdroje, počet objektů, online/degraded/offline a AI provider status,
- left layer panel: vrstvy, filtry, AOR, confidence threshold a synthetic toggle,
- central map canvas: MapLibre, symboly, clustering, AOI a timeline overlay,
- right object detail panel: detail, provenance, source history, confidence, audit link a symbol resolution,
- bottom timeline/replay panel: časový posun a změny confidence,
- AI assistant drawer: povolené datové dotazy a vysvětlení.

Komunikace je sedmá průřezová plocha, ne oddělený modul. Plovoucí chat slouží
pro rychlou kontrolu, ale připnutý režim se chová jako pravý inspektor ve stylu
Xcode: mapa si uvolní prostor, na pravém okraji je rail pro přepínání Chat /
Skupiny / Kontext a uživatel může měnit šířku celého docku i vnitřního splitu
mezi seznamem konverzací a timeline.

AppShell v2 směruje hlavní pracovní plochu ke vzhledu operační konzole:
nahoře je stabilní operační kontext s aktuální událostí nebo vybraným objektem,
vlevo je úzké aplikační menu, uprostřed mapa a vpravo připnutý komunikační
panel. Chat v připnutém režimu má seznam konverzací, hlavičku aktivní místnosti,
připnutý mapový kontext, timeline, rychlé vložení médií a composer. Zprávy i
sdílená média zůstávají svázané s COP skupinou a mapovou událostí.

Chatový composer musí podporovat text, fotku, video, soubor a polohu jako
primární akce. Pokud má informace z chatu přejít do mapového světa, uživatel
použije akci `Nahlásit`; tím vzniká COP komunitní hlášení s vlastní platností,
závažností, polohou, ACL a auditem. COP UI nesmí působit jako dvě oddělené
aplikace: map-first a chat-first workflow musí vést ke stejnému reportu,
skupině a související konverzaci.

Pravý horní roh top baru obsahuje operátorský vstup. V pilotu neslouží k autentizaci, ale otevírá centrum nastavení pro uživatelské volby mapy, dat, vlastní polohy a budoucího účtu.

Primární aktualizace COP dat probíhá přes live SSE stream. Nastavení intervalu je proto v centru nastavení jako `Fallback synchronizace`; používá se v degraded režimu, při výpadku streamu, po obnově záložky a pro méně dynamická data.

PWA offline režim automaticky ukládá poslední povolený COP snapshot pro daný operátorský scope. Při výpadku API nebo sítě topbar přepne na `DEGRADED` nebo `OFFLINE`, levý panel ukáže stáří snapshotu a zobrazení je read-only, dokud se neobnoví serverové spojení.

UI nesmí obsahovat targeting, navádění ani ovládání prostředků.
