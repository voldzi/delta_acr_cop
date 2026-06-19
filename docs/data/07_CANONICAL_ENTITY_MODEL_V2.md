# 07 Canonical Entity Model v2

Tento dokument rozšiřuje původní track/object model na plný civilní COP model.
Navazuje na principy vícezdrojového COP/NIPS: jednotný datový jazyk, provenance,
confidence, vysvětlitelnost, audit a bezpečné sdílení.

## Cíl

Všechny významné objekty v COP musí být použitelné stejně ve webu, iOS/iPadOS,
notifikacích, AI asistenci, auditu a budoucích provider uzlech. Proto nesmí mít
každý modul vlastní nekompatibilní metadata.

## Společná metadata entity

Každá doménová entita má nést:

- `id`: stabilní identitu entity.
- `entityType`: typ entity.
- `title` a `summary`: lidský název a krátké vysvětlení pro UI.
- `source`: zdrojový systém, adaptér a verze adaptéru.
- `classification`: bezpečnostní úroveň, releasability a caveats.
- `releasePolicy`: komu lze entitu a její média ukázat.
- `confidence`: důvěryhodnost, dataQuality, stale a vysvětlení.
- `provenance`: původ, transformační kroky, sourceRevision a basis.
- `createdAt`, `updatedAt`, `validFrom`, `validUntil`.
- `ownerSubjectId`, `groupId` nebo `eventId`, pokud existuje vlastník.
- `correlationId` pro dohledání requestů, eventů a auditních záznamů.

JSON Schema baseline je v
[canonical-entity.schema.json](../api/schemas/canonical-entity.schema.json).

## Autoritativní entity

| Entity | Účel | Příklady |
| --- | --- | --- |
| `mapFeature` | Obecný mapový prvek z katalogu | hranice, POI, letiště |
| `observedObject` | Pohyblivý nebo sledovaný objekt | let, partner, vozidlo |
| `sensorObservation` | Měřená nebo modelovaná hodnota | počasí, kvalita ovzduší, mobilní síť |
| `incident` | Událost/pracovní prostor | povodeň, požár, havárie |
| `alert` | Výstraha nebo upozornění | CHMI výstraha, AOI vstup, stale data |
| `communityReport` | Uživatelské hlášení | fotka mostu, požár, zaplavená komunikace |
| `evidence` | Médium nebo dokument k události | fotka, video, PDF, spatial video |
| `task` | Pracovní úkol bez weapon workflow | ověřit místo, doplnit fotografii |
| `userZone` | Uživatelská nebo skupinová oblast | sledovaná oblast, varovná zóna |
| `sketchDrawing` | Ruční zákres nad mapou | polygon, šipka, text, měření |
| `sourceSystem` | Provider nebo uzel federace | SIM, Messaging, Mission Arena |

## Release Policy

`releasePolicy` je povinné governance pole. Nevyjadřuje jen viditelnost v UI,
ale i to, jestli lze otevřít média, zahrnout entitu do AI dotazu nebo poslat
notifikaci.

Povolené hodnoty `visibility`:

- `public`: viditelné veřejně.
- `authenticated`: používá se jen v `allowedScopes`; pro viditelnost použít
  konkrétní scope níže.
- `group`: viditelné členům skupiny.
- `event`: viditelné v rámci události/workspace.
- `private`: viditelné vlastníkovi.
- `restricted`: viditelné jen rolím/operatorům podle ABAC.

Média mohou mít přísnější `mediaAccess` než text hlášení. Například popis
rizika může být veřejný, ale fotky jen pro skupinu.

## Confidence a Data Quality

`confidence` není doporučení akce. Slouží pouze pro datovou kvalitu a pro
vysvětlení uživateli nebo operátorovi.

`dataQuality`:

- `observed`: měřená/pozorovaná hodnota.
- `modelled`: modelový výpočet.
- `mixed`: kombinace měření a modelu.
- `inferred`: odvozeno pravidlem nebo AI.
- `synthetic`: simulace/test.
- `unknown`: neznámé.

UI pro běžného občana má zobrazit lidské shrnutí, například “měřené počasí,
aktualizováno před 8 minutami”. Technické faktory patří do detailu/provenance.

## Provenance

Provenance odpovídá na otázky:

- odkud data přišla,
- kdy byla převzata,
- jakým adaptérem prošla,
- jestli byla odvozena, sloučena nebo zjednodušena,
- podle jaké verze modelu nebo read-modelu vznikla.

Provider kódy a `sourceRevision` se nemají zobrazovat běžnému uživateli jako
hlavní text. Slouží pro diagnostiku, audit a operátorský detail.

## Dopad Na Existující API

Tento model zatím neruší existující endpointy. Je to sjednocující vrstva:

- `CommunityReport` mapuje na `communityReport`.
- `CommunityReportAttachment` mapuje na `evidence`.
- `SketchDrawing` mapuje na `sketchDrawing`.
- `CopAlert` mapuje na `alert`.
- provider `features` mapují na `mapFeature`, `sensorObservation` nebo
  `observedObject` podle katalogu.

Budoucí rozšíření endpointů má doplňovat tato pole zpětně kompatibilně jako
volitelné metadata, dokud nebude vyhlášena nová major verze kontraktu.

## iOS/iPadOS Pravidla

Nativní klient musí:

- respektovat `releasePolicy` a nikdy nezobrazit chráněná média bez oprávnění,
- zachovat neznámá metadata při ukládání preferencí,
- nepoužívat SIM jako přímý zdroj,
- ukládat offline snapshot vázaný na `subjectId`,
- při konfliktu revize zákresu nebo hlášení neprovádět tichý overwrite.

## AI Pravidla

AI dotaz může pracovat jen s policy-filtered entitami. Do AI se nesmí posílat:

- média bez oprávnění,
- syrové tokeny, service credentials nebo interní URL,
- data mimo allowedScopes uživatele,
- neveřejné provider diagnostiky, pokud uživatel nemá odpovídající roli.

AI výstup musí být auditovatelný a označený jako asistivní shrnutí, ne jako
autonomní rozhodnutí.
