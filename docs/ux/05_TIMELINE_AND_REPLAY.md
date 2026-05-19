# 05 Timeline and Replay

Timeline/replay umožňuje analyzovat vývoj COP dat v čase.

## Capability

- posun v čase pro vybrané vrstvy,
- replay změn objektů,
- zobrazení změny confidence,
- detekce a vysvětlení konfliktů zdrojů,
- indikace stale/lost/restored stavu,
- export reportu pouze s policy kontrolou.

Replay je analytický nástroj, nikoli plánovací nebo akční workflow.

## Pilotní stav

Aktuální pilot umí zobrazit historii trasy jako mapovou vrstvu a časové okno lze nastavit i v sekundách. Historie se načítá ze serverového endpointu `/api/v1/cop/track-history`; pokud není dostupná, klient může dočasně použít lokální historii získanou z posledních refreshů.

Predikce polohy je v UI oddělená od historie. Smí ukazovat odhad další polohy na základě pohybu a posledních bodů, ale nesmí být prezentovaná jako pokyn k zásahu nebo jako akční doporučení.

## Další rozvoj

- replay controller nad serverovou časovou osou,
- porovnání režimů predikce: jednoduché prodloužení směru, vyhlazený trend z posledních bodů, predikce s manévrem,
- zobrazení nejistoty predikce jako průsvitné oblasti,
- časová filtrace podle zdroje, syntetických dat, confidence a lifecycle stavu,
- export analytického reportu pouze v mezích policy.
