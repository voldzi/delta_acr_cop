# 16 PoC Functional Walkthrough Requirements

Tento runbook opravuje rozsah PoC: PoC není ukázka chatu. Chat je pouze
komunikační podpůrná funkce. Hlavním cílem PoC je prokázat, že COP/CSM umí v
omezeném, ale reálném scénáři naplnit funkční řetězec požadavku z podkladu
`RYŠAVÝ_Jan_ZP_44_KGS.md`.

PoC má ukázat COP jako schopnost: lidé, procesy, data, technologie, audit a
rozhodovací podpora. Nejde o izolovanou mapu ani izolovaný messenger.

## Požadavek Z Podkladu

Požadavkový podklad definuje AI-COP/NIPS jako vícevrstvou federovanou
architekturu, která:

- sbírá vícezdrojová data,
- normalizuje a označuje data metadaty,
- provádí fúzi, deduplikaci, korelaci a řízení kvality,
- poskytuje společný operační obraz různým rolím,
- zachovává zdroj, čas, přesnost, spolehlivost a oprávnění informace,
- podporuje rozhodování a OODA cyklus,
- používá AI/MCP jen jako kontrolovanou, auditovanou a vysvětlitelnou asistenci,
- počítá s federovanými uzly, edge/offline režimem a synchronizací,
- respektuje need-to-know, audit, klasifikaci a human-in-the-loop.

## Funkční Scope PoC

Aktuální civilní PoC neprokazuje plný vojenský AI-COP včetně utajovaných dat,
MIP/MIM produkční federace a certifikovaného cross-domain provozu. Prokazuje
řízený civilně-krizový řez schopností, na kterém je možné ověřit architektonický
princip:

| Oblast požadavku | Co PoC prokazuje |
| --- | --- |
| Vícezdrojová data | safety/počasí/povodně, mapový katalog, komunitní hlášení, média, zákresy, profily |
| Datová vrstva | server-side provider integrace, normalizované API, metadata zdrojů, čas a stav závislostí |
| Analytická vrstva | katalog vrstev, agregace, health/dependencies, AI/MCP read-only dotazy, základ pro fúzi |
| Rozhodovací vrstva | mapový workspace, role-based přístup, detail objektu, vrstvy, zákresy, média |
| Federace/edge | edge runtime, heartbeat, outbox/replay koncept, provozní runbook |
| Bezpečnost | OIDC, role, ACL médií, audit, oddělení plaintext chatu od COP API |
| Komunikace | `cop-chat` jako podpůrná E2EE koordinace, nikoli hlavní PoC cíl |
| Validace | opakovatelný seed, reset, produkční health, test uživatelského průchodu |

## PoC Akceptační Kritéria

Předvedení je úspěšné, pokud lze na produkčním pilotu ukázat:

1. **Jednotný situační obraz**: po otevření COP je vidět civilní krizový scénář
   `Povodeň - Středočeský kraj` s mapovým kontextem.
2. **Vrstvy a zdroje**: uživatel umí zapnout/skrýt vrstvy bezpečnostních dat,
   povodní, hlášení a zákresů; detail ukazuje zdroj a čas.
3. **Datová standardizace**: data jsou dostupná přes COP API a katalog vrstev,
   ne přes ruční kopírování nebo přímé databázové zásahy.
4. **Hlášení z terénu**: uživatel vytvoří nebo otevře hlášení s polohou,
   platností, rizikem, textem a médii.
5. **ACL médií**: oprávněný uživatel média zobrazí, neoprávněný nemá dostat
   chráněný obsah.
6. **Zákresy**: operátor vytvoří nebo otevře zákres, uloží jej a po refreshi
   zůstane dostupný.
7. **Fúze a kvalita obrazu**: demo vysvětlí, jak se vrstvy skládají do jednoho
   obrazu, jak se nese metadata zdroje/času a kde je prostor pro další fúzní AI.
8. **AI/MCP jako asistent**: ukáže se read-only MCP registry/tool volání nebo
   provozní endpoint, včetně auditní stopy; AI nic sama nerozhoduje.
9. **Edge/degraded princip**: ukáže se edge stav nebo runbook outbox/replay
   princip; pokud runtime není plně demonstrovatelný, označí se jako řízená
   simulace, ne hotová schopnost.
10. **Komunikace**: chat ukáže jen koordinaci skupiny; nesmí zastínit mapu,
    data, fúzi, audit a rozhodovací podporu.
11. **Provozní důvěra**: health/dependencies jsou zelené nebo srozumitelně
    vysvětlené jako degraded bez dopadu na hlavní scénář.
12. **Lessons learned**: po průchodu je jasné, co je prokázané, co je pouze
    simulované a co zůstává další etapou.

## Doporučený Průchod

### 1. Kontext A Cíl

Začít sdělením:

> PoC ověřuje, že CSM/COP dokáže vytvořit společný situační obraz z více zdrojů
> a podpořit rozhodování. Chat je pouze podpůrná koordinace.

Krátce vysvětlit, že požadavek vychází z AI-COP/NIPS: data, fúze, rozhodovací
vrstva, federace, bezpečnost, audit a human-in-the-loop.

### 2. Datová Vrstva

Ukázat:

- mapový katalog a dostupné vrstvy,
- provider/safety data,
- komunitní hlášení,
- média a jejich ACL,
- stav providerů přes `health/dependencies`.

Říct explicitně: PoC ukazuje standardizovanou datovou cestu přes API a katalog,
ne ruční kopírování dat.

### 3. Normalizace A Metadata

U detailu objektu nebo hlášení ukázat:

- polohu,
- typ/riziko,
- čas vzniku nebo aktualizace,
- zdroj,
- stav/platnost,
- metadata pro oprávnění.

Vysvětlit, že v plném AI-COP by stejný princip nesl i klasifikaci, přesnost,
spolehlivost, releasability a vazby na datový slovník.

### 4. Analytická Vrstva

Ukázat nebo vysvětlit na připravených datech:

- agregaci více vrstev do jednoho operačního obrazu,
- deduplikaci/nekřížení odpovědností mezi hlášením a chatem,
- základ pro fúzi a kvalitu obrazu,
- možnost AI sumarizace pouze s vazbou na zdroje.

Neprezentovat AI jako rozhodovací autoritu. AI je nástroj pro sensemaking,
prioritizaci a asistovanou interpretaci.

### 5. Rozhodovací Vrstva

V mapě ukázat:

- rychlé přepnutí vrstev,
- detail objektu,
- zákres a měření,
- uložený stav po refreshi,
- mobilní použitelnost v Safari.

Tady je hlavní uživatelská hodnota: velitel/operátor dostává přehled,
nepřeskakuje mezi tabulkami a izolovanými aplikacemi.

### 6. Federace A Edge

Ukázat:

- edge/runtime status nebo provozní runbook,
- princip lokálního outboxu,
- replay/synchronizaci po obnovení spojení,
- že federace znamená propojení uzlů přes rozhraní, ne centralizaci všech dat.

Pokud je část pouze konceptuálně připravená, říct to přesně.

### 7. MCP A Agentní Rozhraní

Ukázat bezpečné read-only rozhraní:

- registry nástrojů,
- jedno auditované volání,
- policy-filtered výstup,
- auditní záznam.

Zásada: MCP/AI může číst a pomáhat interpretovat, ale nesmí bez člověka měnit
stav systému ani vydávat rozhodnutí.

### 8. Komunikace

Teprve potom otevřít `cop-chat`:

- ukázat podpůrnou skupinu,
- poslat nebo ukázat krátkou koordinační zprávu,
- ukázat, že chat není zdroj mapové pravdy.

Pokud má informace z chatu přejít do COP, musí se stát hlášením, úkolem nebo
jiným strukturovaným záznamem.

### 9. Bezpečnost A Audit

Ukázat:

- přihlášení přes OIDC,
- role/oprávnění,
- ACL médií,
- auditovatelné operace,
- oddělení E2EE chat obsahu od COP API.

Vysvětlit rozdíl mezi civilním PoC a budoucím provozem na více klasifikačních
doménách, kde je nutné řešit CDS, STANAG metadata a formalizované releasability
pravidlo.

### 10. Závěr A Lessons Learned

Závěr nesmí znít „chat funguje“. Správný závěr:

> PoC ověřil řízený civilně-krizový řez AI-COP: vícezdrojová data, jednotný
> situační obraz, strukturovaná hlášení, média s ACL, zákresy, provozní audit,
> podpůrnou komunikaci a připravenou architekturu pro AI/MCP a edge rozšíření.

## Matice Požadavek → Demo

| Požadavek z podkladu | Demo krok | Stav |
| --- | --- | --- |
| COP jako schopnost, ne aplikace | Kontext, mapový workspace, role, workflow | prokazováno |
| Datová vrstva | mapový katalog, safety data, hlášení, média | prokazováno v civilním řezu |
| ETL/normalizace | API kontrakty, metadata, jednotné vrstvy | částečně prokazováno |
| Fúze a kvalita | vrstvy + vysvětlení metadata/source/quality | částečně prokazováno |
| Rozhodovací vrstva | mapa, detail, zákres, dashboard/health | prokazováno |
| AI/MCP | read-only nástroje, audit | částečně prokazováno |
| Edge/offline | edge runtime/runbook, outbox/replay | částečně prokazováno |
| Interoperabilita | API-first, provider model, OGC/standard mapping docs | prokazováno dokumentačně a API |
| Bezpečnost | OIDC, ACL, audit, E2EE chat odděleně | prokazováno v civilním režimu |
| Validace PoC | seed/reset, health, průchod, lessons learned | prokazováno |

## Co Nepřeceňovat

- Neříkat, že PoC je plný vojenský AI-COP.
- Neříkat, že současný civilní pilot nahrazuje MIP/MIM/NCOP.
- Neříkat, že AI predikce jsou hotová rozhodovací schopnost.
- Neříkat, že chat je hlavní výsledek PoC.
- Neříkat, že edge/offline je finální akreditovaný provoz, pokud je ukázán jen
  jako pilotní schopnost.

## Výstup PoC

Výstupem má být krátký záznam:

- co bylo funkčně prokázáno,
- jaký požadavek tím byl pokryt,
- co bylo pouze simulované nebo dokumentačně připravené,
- jaké riziko nebo mezera zůstává,
- jaký je doporučený další krok pro pilot/implementaci.
