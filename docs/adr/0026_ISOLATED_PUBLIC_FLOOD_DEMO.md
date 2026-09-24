# ADR 0026: Izolovaný veřejný průchod v mapě COP

Stav: přijato

## Kontext

COP má chráněný operátorský seed/reset `flood-central-bohemia` a živý datový
tok. Veřejný návštěvník má bez účtu projít syntetickou povodní přímo na mapě
COP, aniž získá možnost zapisovat incidenty, spouštět seed/reset nebo vidět
interní a partnerská data. Samostatný HTML náhled nebyl pro tento účel
dostatečný.

## Rozhodnutí

Web má samostatnou veřejnou trasu `/demo/flood-central-bohemia` v React
aplikaci. Ta používá stejný `CopMap` renderer a mapové zobrazení existujících
`SituationFeature` prvků jako běžný COP. Scénář vytváří jen lokální,
syntetické prvky; žádné COP/SIM/TAK/ARDOS API nevolá. Samostatný kořenový
komponent neaktivuje běžné operátorské efekty, živé vrstvy ani nástroje pro
zápis. Původní veřejný odkaz `/ardos-demo/` přesměrovává na novou trasu.

Vydavatel, oblast, platnost, poslední ověření a neaktuální stav po modelovém
výpadku jsou přímo v průvodci. ARDOS je popsán pouze jako možný kanál
schváleného stručného textu, bez tvrzení o partnerství nebo doručení.

## Důsledky

Veřejná ukázka je skutečný COP mapový klient s interaktivními mapovými prvky,
ale její scénář není napojen na produkční data ani na chráněný seed. API a
OpenAPI se nemění. Mapový podklad stále vyžaduje běžné veřejné mapové zdroje;
simulovaný výpadek je prezentační stav, nikoli důkaz provozu při reálném
odpojení sítě.
