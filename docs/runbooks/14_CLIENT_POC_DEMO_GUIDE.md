# 14 Client PoC Demo Guide

Tento runbook je praktický scénář pro řízenou klientskou ukázku. Cíl není
ukázat všechny funkce, ale ukázat jasný krizový příběh, ve kterém CSM/COP
pomáhá občanům, operátorům a krizovému štábu sdílet stejný situační obraz.

## Cíl Ukázky

Klient má po 20-30 minutách pochopit:

- kde vzniká událost,
- jaké riziko se týká občanů,
- odkud pochází data,
- jak uživatel přidá hlášení,
- jak se hlášení dostane do mapy a chatu,
- jak operátor pracuje se skupinou, zákresem a médii,
- jak systém zachovává audit, oprávnění a oddělení providerů.

## Role

| Role | Účet | Co ukazuje |
| --- | --- | --- |
| Operátor | `cop.operator1` | mapový workspace, vrstvy, detail, chat, zákresy |
| Občan | iOS/web klient | hlášení s polohou a médiem |
| Technik | admin/provoz | health, dependencies, provider observability |
| Pozorovatel | bez účtu | veřejná mapa a veřejné vrstvy bez ukládání profilu |

Konkrétní účty a hesla nepatří do dokumentace. Ukládají se jen v provozním
secret managementu nebo se před ukázkou vytvoří ručně v Keycloaku.

## Před Demo Checklist

1. Ověřit produkci:
   ```sh
   curl -fsS https://cop.zeleznalady.cz/health/ready
   ```
2. Ověřit interní závislosti na `docker.home.cz`:
   ```sh
   cd /srv/cop
   set -a; . ./.env; set +a
   curl -fsS -H "Authorization: Bearer ${COP_PUBLIC_LAB_VALUE:-$COP_LAB_TOKEN}" \
     http://127.0.0.1:4310/health/dependencies
   ```
3. Otevřít aplikaci v desktop Chrome/Safari a v mobilním Safari.
4. Přihlásit demo operátora.
5. Ověřit, že profil má jméno, roli, organizaci a avatar.
6. Ověřit, že jsou dostupné vrstvy:
   - meteorologické výstrahy,
   - radar/srážky,
   - povodně a voda,
   - komunitní hlášení,
   - mobilní síť,
   - komunikace/doprava,
   - uživatelské zákresy.
7. Ověřit, že chat ukazuje lidská jména a ne technické Matrix identifikátory.
8. Ověřit, že galerie médií otevře fotku, PDF a video.
9. Ověřit, že zákres po refreshi zůstane na mapě.

## Doporučený Demo Seed

Demo seed se má připravit jako resetovatelný scénář `flood-central-bohemia`.
Seed data musí být označená jako demonstrační.

### Událost

- název: `Povodeň - Středočeský kraj`,
- stav: `Aktivní`,
- oblast: Praha a okolí Vltavy/Berounky/Labe podle zvoleného scénáře,
- začátek: pevný čas pro demo,
- závažnost: `warning` nebo `critical` podle scénáře,
- veřejný popis: krátký civilní text, bez technických provider detailů.

### Mapové Vrstvy

Zapnout jako výchozí:

- radarová srážková vrstva,
- meteorologické výstrahy,
- povodňové body a oblasti,
- komunitní hlášení,
- uživatelské zákresy,
- komunikace a dopravní omezení,
- mobilní síť pouze jako kontext.

Vypnout jako výchozí:

- diagnostické provider vrstvy,
- surové technické vstupy,
- dlouhé debug/provenance kódy.

### Hlášení

Seed má obsahovat nejméně:

1. `Zatopený podjezd`
   - závažnost: `warning`,
   - platnost: 6 hodin,
   - média: fotografie,
   - viditelnost: krizová skupina.
2. `Poškozená lávka`
   - závažnost: `critical`,
   - platnost: 24 hodin,
   - média: video,
   - viditelnost: vybraná skupina.
3. `Dobrovolnické místo`
   - závažnost: `info`,
   - platnost: 12 hodin,
   - média: PDF instrukce,
   - viditelnost: veřejné.

### Zákresy

Seed má obsahovat:

- polygon zasažené oblasti,
- linii uzávěry nebo neprůjezdné komunikace,
- bod evakuačního místa,
- textový popisek `Dočasné shromaždiště`,
- měření vzdálenosti mezi rizikovým místem a evakuačním bodem.

### Chat A Skupiny

Seed má připravit:

- skupinu `Krizový štáb - Povodeň`,
- skupinu `Dobrovolníci - logistika`,
- připnutý kontext mapy na aktivní událost,
- několik lidských zpráv:
  - potvrzení přijetí hlášení,
  - žádost o doplnění fotografie,
  - rozhodnutí o uzávěře,
  - odkaz na mapový detail.

## Demo Flow

### 1. Přehled

Otevřít mapu a ukázat aktivní událost. Vysvětlit, že mapa není statický GIS,
ale pracovní plocha pro krizovou situaci.

Ukázat:

- aktivní událost v horní liště,
- rizikové vrstvy,
- stav providerů,
- radar a výstrahy.

### 2. Data A Důvěryhodnost

Kliknout na výstrahu nebo povodňový prvek a ukázat:

- zdroj,
- čas aktualizace,
- platnost,
- stale/degraded stav jen pokud je relevantní,
- confidence a dataQuality v detailu, ne jako rušivý text na mapě.

### 3. Komunitní Hlášení

Ukázat hlášení občana:

- text,
- poloha,
- závažnost,
- platnost rizika,
- média,
- ACL médií.

Vysvětlit, že mapa může ukázat veřejný text, ale média se otevřou jen
oprávněným uživatelům.

### 4. Chat

Otevřít chat skupiny a ukázat:

- lidský seznam konverzací,
- připnutý mapový kontext,
- zprávu s odkazem na hlášení,
- přílohy a polohu.

Neukazovat technické Matrix identifikátory, bootstrap ani E2EE debug texty v
běžném režimu.

### 5. Zákres

Zapnout zákresy:

- nakreslit uzávěru,
- přidat evakuační bod,
- změnit barvu/průhlednost,
- uložit do skupiny nebo události,
- refreshnout stránku a ověřit, že zákres zůstane.

### 6. Mobilní Průchod

Na iPhone ukázat:

- otevření mapy,
- přepnutí vrstvy,
- detail hlášení,
- vytvoření nového hlášení,
- otevření chatu jako samostatné mobilní obrazovky.

### 7. Provozní Důvěra

Na závěr ukázat provozní stav:

- API ready,
- dependencies,
- provider health,
- cache/stale informaci,
- auditovatelný tok dat.

## Co Neříkat A Neukazovat

- Netvrdit, že data o stavu BTS jsou potvrzený realtime stav operátora.
- Netvrdit, že radar/grid předpovídá budoucnost bez SIM nowcast metadat.
- Nezobrazovat interní tokeny, sourceId jako hlavní text ani technické chyby.
- Neukazovat AI jako rozhodovací autoritu.
- Nepoužívat vojenský jazyk pro civilní scénář.

## Doporučená Závěrečná Věta

„Toto není jen mapa. Je to společný krizový workspace: data od providerů,
hlášení od lidí, komunikace skupin, média, zákresy, oprávnění, audit a
připravená cesta k mobilnímu a edge použití.“

