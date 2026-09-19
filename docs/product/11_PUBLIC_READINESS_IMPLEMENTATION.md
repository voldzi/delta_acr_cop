# 11 Public Readiness Implementation

Aktualizováno: 2026-09-19. Tento dokument eviduje realizaci auditu COP a COP
Mobile z pohledu veřejnosti, přístupnosti, výkonu a celých uživatelských cest.
Dokončená první sada oprav není potvrzením připravenosti pro celou ČR.

## Implementovaný základ

| Oblast                  | Změna                                                                                                                                                                                                     | Meze dokončení                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Důvěryhodnost výstrah   | Nezávislé načítání místních veřejných výstrah; rozlišení chybějící polohy, načítání, omezených dat a prázdného aktuálního výsledku. Sledované místo lze vybrat geocoderem bez GPS a posun mapy je nemění. | Rozsah dostupných zdrojů není úplné pokrytí ČR; autority musí schválit zdroje a texty doporučení.                                   |
| Výstraha → detail       | Horní lišta otevírá místní výstrahy. Seznam a lišta používají stejné neexpirované výstrahy do 30 km; detail funguje i s vypnutými mapovými vrstvami.                                                      | Ověření doporučených kroků vydávající autoritou a měření úspěšnosti u lidí zůstávají před vydáním.                                  |
| Telefon a čitelnost     | Celý text stavu pod 600 px; pod 860 px společné posouvání panelů výstrah, čitelné chyby a pojmenovaná akce detailu.                                                                                       | Vizuální kontrola v prohlížeči nenahrazuje VoiceOver/TalkBack a fyzické zařízení.                                                   |
| Navigace                | Obecný detail nenabízí vrchol polygonu, konec čáry nebo výstražný bod jako implicitní cíl. Podporované bodové cíle jsou explicitně omezené.                                                               | Nejde o ověřenou evakuační trasu ani o garantovaně bezpečný průchod.                                                                |
| Hlášení                 | Potvrzení polohy a veřejnosti; GPS čeká na výsledek; EXIF pouze nabídka; formulář se během publikace uzamkne a draft se soubory přežije restart.                                                          | Uživatelský výzkum musí potvrdit srozumitelnost polohy, času a soukromí.                                                            |
| Obnova publikace        | IndexedDB outbox drží stabilní ID reportu a příloh; serverová idempotence kryje ztracenou odpověď, dvojí klepnutí a opakovaný upload bez duplicity.                                                       | Celý edge sync a dlouhodobé konflikty více zařízení mají vlastní rozsah.                                                            |
| Soukromí příloh         | Vlastník vidí a mění skutečné ACL existujících příloh; server ověřuje členství, audituje změnu, skrývá identifikátory ostatním a revokaci uplatní na přímý URL přístup okamžitě.                          | Produkční pilot musí ověřit porozumění volbám na různých účtech a zařízeních.                                                       |
| COP Mobile              | Z načítání a fallbacku po chybě mapy lze otevřít nativní komunikaci; zůstává známá očekávaná identita a respektuje se Omezit pohyb. Celý release check prochází na finálním Xcode 27.0.                 | Reálný offline chat, OIDC, APNs/PushKit/CallKit a audio hovory stále vyžadují fyzické testy.                                        |
| Veřejný vstup           | Anonymní `/` nabízí situaci kolem mě, hlášení nebo celou mapu běžným jazykem; hluboké odkazy úvod nepřekrývá.                                                                                             | Měřená akceptace cílovými skupinami je stále release gate.                                                                          |
| 3D přehled              | Samostatný `/globe` používá Cesium až po explicitním otevření, COP API, omezené objekty/historii, capability fallback, verzované sdílení a viditelné observed/estimated/stale stavy.                      | Velký volitelný engine; fotorealistické komerční zdroje nejsou součástí.                                                            |
| Výkon a kontrola vydání | Místní dotazy mají timeout/rušení; shell a těžké moduly mají bundle budgets; měří se LCP/INP/CLS; reconnect používá jitter a fronty i SSE backpressure jsou omezené. Lokálně prošlo 2 000 SSE na jedné instanci. | Národní RUM baseline a víceinstanční test v řízeném prostředí zůstávají release branou.                                             |

## Ověření a vydání

- Web: cílené regresní testy pro aktuálnost, výpadky, změnu polohy, timeout,
  obnovení karty, nezávislost na vrstvách, výběr detailu, zákaz rizikových
  navigačních cílů a potvrzení publikace.
- Celková validace: skeleton, JSON Schema, OpenAPI, typová kontrola, ESLint,
  Vitest, build, bundle budgets a smoke test produkčního statického runtime.
  Přesný výsledek posledního běhu je uveden níže.
- Vizuálně: lokální veřejný vstup na desktopu a při šířce 320 CSS px, vstupní
  obrazovka 3D a srozumitelný fallback při nedostupném WebGL. Tato kontrola
  nenahrazuje test produkčních dat, přihlášení ani skutečného publikování.
- Mobile: skeleton, 19 fixture kontrol Device API, validace konfigurace,
  sestavení, 37 jednotkových testů a 4 kritické UI testy prošly na finálním
  Xcode **27.0 / 27A266a** a iOS 27.0 simulátoru. Deployment minimum zůstává
  iOS 26.0. Fyzická akceptace nemá výsledek Pass.

## Navazující práce v pořadí závislostí

| Priorita      | Další výstup                          | Hotovo teprve když                                                                                                                                       |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0            | Fyzická akceptace mobilní první sady  | Automatický build a UI testy jsou zelené; na iPhonu/iPadu je ověřena cesta pomalá síť → chat → návrat do mapy, rozdílné účty, čtečka a velký text.       |
| Hotovo v kódu | Trvalý outbox a idempotence           | Regrese pokrývají opakování, konfliktní obsah, stabilní přílohy a submit.                                                                                |
| Hotovo v kódu | Správa media ACL                      | Regrese pokrývají skrytí identifikátorů a okamžitou revokaci.                                                                                            |
| Hotovo v kódu | Obec bez GPS a veřejný vstup          | Sledované místo je nezávislé na mapě; úvod nabízí tři hlavní veřejné cesty.                                                                              |
| P1            | Měření reálné rychlosti               | Standardní LCP/INP/CLS jsou oddělené od interních ukazatelů; existuje anonymizovaný baseline podle zařízení a sítě, s popsaným vzorkem a soukromím.      |
| P1            | Přenosy a špičky provozu              | Lokální 40/40 smoke a 2 000/2 000 SSE na jedné instanci prošly; konzistence nejméně dvou produkčních instancí projde v řízeném prostředí.                 |
| P1            | Inkluzivní uživatelské ověření        | Protokol v dokumentu 12 proběhne se 48 lidmi a každá skupina splní vlastní cíle.                                                                         |
| P2            | Dostupnost mimo nejnovější iOS        | Přijaté rozhodnutí v dokumentu 13 se ověří produkčními daty; PWA se otestuje na levných Android zařízeních.                                              |
| P2            | Veřejný pilot a provozní připravenost | Ověřeny kapacitní scénáře, důvěryhodnost zdrojů, dostupnost, návrat po výpadku, moderace, podpora, odpovědnosti a měřené akceptační cíle.                |

Položky závislé na uživatelském výzkumu, autoritách, reálných zařízeních a
produkčních měřeních nelze uzavřít samotnou úpravou zdrojového kódu.
Architektonické změny outboxu, ACL, streamu a nativních oprávnění musí
navázat na ADR a příslušný kontrakt; tento dokument je nenahrazuje.

## Poslední lokální ověření

- Plný Vitest běh: **131 souborů, 1 045 testů, vše prošlo**.
- `pnpm lint`: typová kontrola a celorepozitářový ESLint bez chyb.
- `pnpm build`: všechny workspace aplikace a balíčky prošly.
- `check:bundles`: všechny limity prošly. Web shell má **165,8 KiB gzip z
  250**, vlastní kód 3D workspace **6 KiB z 10**, izolovaný Cesium chunk
  **1,05 MiB z 1,12** a izolovaný Matrix E2EE WASM **2,02 MiB z 2,10**.
- `check:static-runtime`: finální web a chat prošly kontrolou komprese,
  cache hlaviček, HTML/PWA assetů a chybějících souborů.
- Lokální SSE smoke: **40/40** spojení otevřeno, **0** selhání, za čtyři
  sekundy doručeno **56** událostí o celkové velikosti **11 846 B**.
- Lokální SSE kapacita jedné instance s pětisekundovým reconnect jitterem:
  **2 000/2 000** současně otevřených spojení, **0** selhání, p95 otevření
  **2 ms**. Záměrný okamžitý burst bez jitteru otevřel jen **1 443/2 000**;
  produkční klient jej omezuje exponenciálním reconnect jitterem. Tento důkaz
  nenahrazuje požadovaný běh přes nejméně dvě instance.
- Skeleton, 8 JSON Schema a OpenAPI validace prošly. OpenAPI hlásí
  6 existujících upozornění u přesměrovacích auth endpointů a demonstračního
  `oneOf`; tato sada jejich kontrakt nemění.
- Formátování změněných webových souborů prošlo; `git diff --check` prošel
  v COP i COP Mobile.
- Mobilní plný release check prošel na finálním Xcode 27.0: 19 fixture kontrol,
  37 jednotkových testů a 4 UI testy, včetně dostupnosti komunikace při chybě
  mapy. Matrix Rust Components jsou **26.9.7** a LiveKit **2.16.0**.
