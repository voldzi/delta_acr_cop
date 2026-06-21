# 09 PoC Readiness and Completion Plan

Tento dokument popisuje, co chybí k dokončení přesvědčivého pilotu CSM/COP
pro klientskou ukázku. Technický pilot na `docker.home.cz` běží, ale cílem PoC
není jen dostupná aplikace. Cílem je ukázat profesionální krizovou pracovní
plochu, opakovatelný scénář, auditovatelná data, mobilní návaznost a jasnou
hodnotu pro občana i operátora.

## Aktuální Stav

Stav k 2026-06-21:

- produkční pilot běží na `docker.home.cz` a veřejně přes `cop.zeleznalady.cz`,
- web, API a edge kontejner jsou nasazené v Docker Compose,
- Postgres/Patroni store je používán pro profily, historii, hlášení, zákresy a
  federation runtime,
- SeaweedFS/S3 kompatibilní úložiště je zapojené pro média,
- SIM je server-to-server provider pro safety, situation, flight a další data,
- Messaging provider je online a je napojený pro konverzace/skupiny,
- mapový katalog, community reports, zákresy, profily, počasí, radarové vrstvy,
  mobilní síť, flight data a XR workspace jsou implementované v pilotní úrovni,
- výkon webového klienta byl optimalizován odložením chat panelu, tabulek,
  XR workspace a NATO rendereru mimo prvotní bundle.

Tento stav je vhodný pro interní pilot a řízené demo. Není to ještě stav, který
by měl být prezentován jako plně dokončená produkční služba pro veřejnost.

## Verdikt

Pro řízenou klientskou PoC ukázku: ano, aplikace je použitelná, pokud se demo
předem připraví a seedne.

Pro neřízené veřejné produkční nasazení: zatím ne. Chybí dokončit především
bezpečnostní balíček, stabilní demo data, mobilní QA, iOS vazby, notifikace,
observability dashboard a formální akceptační protokol.

## Co Chybí Do Silného PoC

| Oblast | Stav | Co doplnit před klientským PoC |
| --- | --- | --- |
| Demo scénář | existují data a runbooky | vytvořit opakovatelný seed Povodeň + role + talking points |
| Uživatelský manuál | základ existuje | doplnit krátký pilotní průchod pro občana a operátora |
| Mobilní použití | web má mobilní režim, iOS kontrakt existuje | před demo projít iPhone/iPad checklist a opravit blokery dotyku/panelů |
| Počasí a rizika | radar/grid/výstrahy existují | sladit názvy vrstev, defaultní sady a legendy pro ne-technického uživatele |
| Community reports | média a ACL existují | připravit ukázkové hlášení s fotkou, PDF, videem a mapovou vazbou |
| Zákresy | modul existuje | připravit ukázkovou uzávěru, evakuační bod a měření |
| Chat/skupiny | messaging bridge existuje | připravit 2-3 demo skupiny, lidské názvy, avatar a ne-technické texty |
| AI/MCP | roadmap a guardrails existují | pro PoC ukázat minimálně auditované situační shrnutí, ne autonomní rozhodnutí |
| Edge/offline | edge kontejner běží | připravit offline outbox demo nebo jasně označit jako další fázi |
| Observability | health/dependencies existují | připravit dashboard/stránku: zdroje, cache, latence, stale data, poslední import |
| Security package | bezpečnostní dokumenty existují | doplnit scan/SBOM/audit coverage report před formálním předáním |

## Priorita Před Ukázkou

1. Demo seed Povodeň ve středních Čechách.
2. Přednastavené uživatelské profily a skupiny.
3. Předpřipravená sada vrstev: výstrahy, radar, povodně, hlášení, komunikace,
   mobilní síť, prostředky.
4. Jedno ukázkové komunitní hlášení s médiem a ACL.
5. Jeden zákres evakuační trasy nebo uzávěry.
6. Jeden chat se zprávou, připnutým kontextem a mediální přílohou.
7. Krátké AI situační shrnutí s citací datových zdrojů a nejistotou.
8. Health/observability obrazovka pro důvěryhodnost technického zázemí.
9. Mobilní průchod na iPhone/iPad.
10. Export nebo sdílení odkazu na situaci.

## Demo Seed Je Nutný

Ano. Bez seed dat bude demo působit jako nástroj, ve kterém se čeká, co se
zrovna stane. Seed musí vytvořit ucelený příběh:

- aktivní událost `Povodeň - Středočeský kraj`,
- AOI polygon okolo toku a zasažených obcí,
- meteorologickou výstrahu,
- povodňový stav nebo hydrologický trend,
- radarovou srážkovou vrstvu,
- 3 komunitní hlášení s různou závažností,
- 1 fotku, 1 PDF, 1 video,
- 2 zákresy: uzávěra a evakuační bod,
- 2 skupiny: krizový štáb a dobrovolníci,
- 1 chat s připnutým kontextem mapy,
- 1 AI shrnutí pro operátora.

Seed musí být resetovatelný a označený jako demonstrační data. Produkční systém
nesmí míchat demo data s reálnými incidenty bez jasného štítku.

## Akceptace Pro Klientskou PoC Ukázku

Před prezentací musí být splněno:

- aplikace se otevře na `cop.zeleznalady.cz` bez chyb v mapovém podkladu,
- přihlášený operátor vidí uložený profil, skupiny a layout,
- demo událost je vidět do 10 sekund od otevření,
- mapové vrstvy lze přepínat na desktopu i mobilu,
- radar/počasí se vykreslí bez falešných obdélníků nebo technických labelů,
- klik na objekt ukáže jeden jasný detail, ne duplicitní panely,
- hlášení otevře galerii médií podle ACL,
- chat má lidské názvy účastníků a nezobrazuje technické Matrix chyby běžnému
  uživateli,
- zákres lze vytvořit, upravit a po reloadu zůstane uložený,
- health/dependencies ukáže stav providerů a store bez kritické chyby,
- demo lze po ukázce obnovit do výchozího stavu.

## Rozhodnutí Pro Pilot

Pro PoC se doporučuje prezentovat systém jako:

- civilní situační mapu pro krizové události,
- společný workspace pro mapu, hlášení, chat, média a zákresy,
- server-to-server integrační platformu nad SIM a dalšími poskytovateli,
- bezpečně auditovanou aplikaci s přihlášením, ACL a oddělením datových vrstev,
- připravený základ pro iOS/iPadOS a edge režim.

Nedoporučuje se tvrdit, že jde o finální veřejnou produkci, plně certifikovaný
krizový systém, garantované mobilní pokrytí operátorů nebo plně autonomní AI.

