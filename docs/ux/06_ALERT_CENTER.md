# 06 Alert Center

Alert Center je veřejná/mapová vrstva pro reálné safety výstrahy ze SIM. V horním řádku aplikace a ve workspace `Výstrahy` se nesmí zobrazovat technické lifecycle nebo kvalita dat. Tyto informace patří do technického panelu `Stav zdrojů`.

## Veřejné výstrahy

Za veřejné safety výstrahy COP považuje pouze SIM vrstvy:

- `public.safety.weather_alerts`,
- `public.safety.fire`,
- `public.safety.flood`,
- kompatibilně `public.safety.warnings`.

Frontend pracuje s normalizovanými interními layer id `weather_alerts`, `fire`, `flood` a `warnings`, ale pouze pokud feature pochází ze `safety-data` zdroje. Deduplikace a priorita nesmí vycházet z českého nebo anglického textu, ale ze stabilních SIM polí jako `layerId`, `sourceId`, `typeCode`, `severity`, `validFrom`, `validUntil`, `metrics`, `tags` a lokalizovaných textů.

GDACS kontext ze SIM zdroje `gdacs_alerts` je veřejná safety vrstva pro specializované vrstvy: povodňové `FL` události patří do `public.safety.flood` a požární `WF` události do `public.safety.fire`. Technické `response.warnings` z providerů zůstávají pouze provozní diagnostika.

ČHMÚ CAP výstrahy ze zdroje `chmi_alerts` patří do `public.safety.weather_alerts`; obecná vrstva `public.safety.warnings` smí obsahovat pouze krizové zdroje `hzs_incidents` a `municipal_alerts`. Dopravní SRTI a technická hlášení zdrojů se v této veřejné krizové vrstvě nezobrazují. Při současném zobrazení více polygonových výstražných vrstev se meteorologické výstrahy kreslí oddělenou žluto/oranžovou škálou a obecné krizové výstrahy samostatnou krizovou škálou, aby se vizuálně neslévaly.

Detail krizové výstrahy musí ukazovat přesnost polohy ze SIM. `source_point` znamená přesný bod ze zdroje. `municipality_centroid` a `admin_boundary_centroid` jsou pouze přibližné centroidy. `authority_fallback_point` a `region_centroid` nejsou poloha události; u `municipal_alerts` se uživateli zobrazuje text, že jde o bod vydávající autority, ne přesné místo události.

## Technické stavy

API poskytuje `GET /api/v1/cop/alerts`. Tyto alerty jsou odvozené z tracků, evidence a Source Health a nejsou veřejnými safety výstrahami.

Technické typy:

- `TRACK_CONFLICT`: konflikt evidence objektu,
- `LOW_CONFIDENCE`: nízká confidence objektu,
- `TRACK_STALE`: zastaralý track v lifecycle okně,
- `TRACK_LOST`: ztracený objekt,
- `SOURCE_DEGRADED`: degradovaný zdroj dat,
- `AOI_ENTRY`: technická událost osobní zóny.

`TRACK_STALE`, `TRACK_LOST`, `LOW_CONFIDENCE` a `SOURCE_DEGRADED` se zobrazují pouze v panelu `Stav zdrojů` jako kvalita dat, stav zdrojů nebo lifecycle stop. Nezvyšují počet veřejných výstrah, nevstupují do prioritní horní lišty a nekreslí samostatnou výstražnou oblast nad mapou.

## Mapová vrstva

Mapová výstražná vrstva zobrazuje jen safety features ze SIM. Technické serverové alerty se nad mapou nevykreslují jako veřejné výstrahy; jejich detail zůstává v technickém panelu.

## UI

Workspace `Výstrahy` zobrazuje:

- počet aktivních SIM safety výstrah,
- critical/warning souhrn podle severity/SPA/SIM metadat,
- seznam relevantních safety features s výběrem detailu v mapě.

Panel `Stav zdrojů` zobrazuje:

- readiness situačních a výstražných vrstev,
- počet datových zdrojů,
- technické události,
- konflikty evidence,
- lifecycle stop,
- nízkou jistotu,
- degradaci zdrojů.
