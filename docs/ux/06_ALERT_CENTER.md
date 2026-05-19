# 06 Alert Center

Alert Center je informační vrstva nad COP daty. Slouží k rychlé orientaci operátora v datové kvalitě, degradaci zdrojů a lokálních proximity výstrahách. Nesmí být interpretován jako doporučení zásahu, výběr cíle ani weapon workflow.

## Serverové alerty

API poskytuje `GET /api/v1/cop/alerts`. Alerty jsou odvozené z aktuálních tracků, serverové `conflictEvidence` a `Source Health`.

Podporované typy ve v1:

- `TRACK_CONFLICT`: konflikt evidence objektu,
- `LOW_CONFIDENCE`: nízká confidence objektu,
- `TRACK_STALE`: zastaralý track v lifecycle okně,
- `TRACK_LOST`: ztracený objekt,
- `SOURCE_DEGRADED`: degradovaný zdroj dat.

Každý alert má deterministické `alertId`, severity, status, detail, čas pozorování a volitelnou mapovou oblast. Operátor jej může potvrdit přes `POST /api/v1/cop/alerts/{alertId}/acknowledge`; potvrzení je auditované a v pilotu držené v runtime stavu API.

## Mapová vrstva

Serverové objektové alerty s polohou se zobrazují jako velmi průsvitné kruhy nad mapou. Kritické alerty jsou červené, warning alerty žluté. Lokální výstraha k poloze operátora zůstává oddělená jako osobní perimetr.

## UI

Workspace `Výstrahy` zobrazuje:

- počet serverových alertů a critical/warning souhrn,
- seznam alertů s důvodem, objektem nebo zdrojem,
- potvrzení alertu,
- lokální proximity výstrahy pro vlastní polohu.
