# User Sketches and Measurements

Zákresy jsou aplikační obsah COP. Nejsou součástí SIM provider dat a nesmí se
ukládat jen do uživatelských preferencí. Používají se pro občanské poznámky,
mapové značky, sdílené zákresy ve skupinách, jednoduché měření a profesionální
operační anotace bez targeting, weapon workflow nebo doporučování použití síly.

## Datový model

Autoritativní vrstva katalogu:

- `user.sketch.drawings`

Backend ukládá zákresy do `cop_user_drawings`. Pokud je dostupný PostGIS,
geometrie se ukládá jako `geometry(Geometry, 4326)`, styl, symbol a doplňková
metadata jako `jsonb`. Každá změna se auditně zapisuje do
`cop_user_drawing_audit`.

Základní pole:

- `geometry`: GeoJSON `Point`, `LineString` nebo `Polygon`.
- `kind`: `marker`, `point`, `line`, `polygon`, `circle`, `text`, `arrow`,
  `measurement`.
- `visibility`: `private`, `group`, `event`, `public`.
- `style`: barva tahu, výplň, průhlednost a šířka čáry.
- `symbol`: civilní `iconId` nebo profesionální APP-6/NATO `sidc`.
- `properties.fillPattern`: volitelný vizuální vzor výplně `solid`, `outline`,
  `hatch` nebo `dash`.
- `properties.shape`: volitelná informace o obecném tvaru symbolu, například
  `star`, `circle`, `square`, `rectangle`, `triangle`, `wave`, `diamond`.
- `ownerSubjectId`, `groupId`, `eventId`, `revision`, `locked`.

Veřejné a soukromé zákresy se vrací stejným GeoJSON kontraktem. Přístupová
pravidla se vyhodnocují server-side podle identity uživatele, skupiny a
viditelnosti.

## API

Klienti používají:

- `GET /api/v1/sketch/palettes?mode=civil|professional`
- `GET /api/v1/sketch/drawings?bbox=west,south,east,north&groupId=...&eventId=...`
- `POST /api/v1/sketch/drawings`
- `GET /api/v1/sketch/drawings/{drawingId}`
- `PATCH /api/v1/sketch/drawings/{drawingId}`
- `DELETE /api/v1/sketch/drawings/{drawingId}`

`GET` je použitelný i bez přihlášení pro veřejné prvky. Zápis, editace a mazání
vyžadují přihlášeného uživatele. Skupinový zákres vyžaduje členství ve skupině.
Event zákres vyžaduje `eventId`.

Minimální payload pro vytvoření:

```json
{
  "kind": "polygon",
  "visibility": "group",
  "groupId": "4ed1b9d3-1ff7-4db0-b8c5-3b2638f7c7f8",
  "label": "Uzavřená oblast",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[14.4, 50.08], [14.42, 50.08], [14.42, 50.09], [14.4, 50.08]]]
  },
  "style": {
    "stroke": "#2f80ed",
    "fill": "#2f80ed",
    "opacity": 0.25,
    "lineWidth": 2
  },
  "symbol": {
    "palette": "civil",
    "iconId": "warning"
  }
}
```

## UI

Web používá explicitní režimy mapy:

- `Pohyb`: běžné posouvání mapy.
- `Výběr`: výběr a editace existujícího zákresu.
- `Značka`: vložení bodové civilní značky.
- `Linie`: kreslení linie.
- `Polygon`: kreslení oblasti.
- `Šipka`: vyplněná 2D šipka vytvořená začátkem a koncem směru.
- `Text`: vložení textové poznámky.
- `Měření`: dočasné měření vzdálenosti, které lze uložit jako zákres.

Při kreslení se vypne běžné posouvání mapy, aby touch eventy na mobilu
nepropadávaly do MapLibre. Vybraný zákres lze upravit přímo v mapě: posunem
vrcholů, vložením bodu přes midpoint a smazáním vybraného vrcholu.

Webový klient má profesionální kreslicí inspektor:

- nástroje lze sbalit na jedinou aktivní ikonu,
- každému novému nebo vybranému objektu lze nastavit barvu tahu, barvu výplně,
  průhlednost, šířku čáry a vzor výplně,
- značka má výběr ze symbolů včetně obecných tvarů a základních profesionálních
  APP-6/NATO symbolů,
- styl se aplikuje okamžitě na vybraný zákres a současně slouží jako výchozí
  nastavení pro další objekt.

## Palety

Civilní paleta obsahuje obecné krizové symboly:

- upozornění,
- uzávěra,
- pomoc,
- místo setkání,
- zdroj vody,
- evakuační bod,
- riziko,
- poznámka.

Dále obsahuje obecné vektorové tvary pro rychlý zákres: hvězda, kruh, čtverec,
obdélník, trojúhelník, kosočtverec a vlnka. Tyto tvary jsou uložené jako běžné
`iconId` a klienti je mohou vykreslovat nativně.

Profesionální paleta může používat APP-6/NATO symboly přes existující renderer.
Použití je omezené na situační anotaci a nesmí přidávat targeting, navádění ani
weapon workflow.

## iOS/iPadOS

Nativní klient používá stejný API kontrakt a stejnou vrstvu
`user.sketch.drawings`. V terénu má mít offline outbox pro nově vytvořené nebo
upravené zákresy. Konflikty se řeší přes `revision`: pokud server mezitím objekt
změnil, klient zobrazí konflikt a nechá uživatele rozhodnout, zda lokální změnu
zachovat jako novou revizi.

Na iPhone musí být režim kreslení explicitní a oddělený od pohybu mapy. Na iPadu
se editace vlastností může zobrazit v pravém inspektoru.

## Budoucí rozvoj

- undo/redo nad lokální editací,
- snapping na referenční prvky z katalogu,
- duplikování a zamykání objektů,
- sdílení zákresů přímo do konverzace,
- export/import GeoJSON,
- iOS offline merge a auditní diff.
