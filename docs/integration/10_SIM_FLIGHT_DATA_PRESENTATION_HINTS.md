# SIM Flight Data Presentation Hints

Tento pokyn je určen pro SIM `flight-data` a další budoucí poskytovatele veřejných letových dat. COP zůstává prezentační aplikace: rozhoduje, jak bude let vykreslen, ale potřebuje od zdroje dostatek normalizovaných údajů pro civilní zobrazení, historii a detail letu.

## Cíl

Veřejné lety mají být v COP oddělené od simulované letecké situace. COP je může zobrazit buď standardní situační symbolikou, nebo civilním symbolem letadla podle typu. SIM nemá posílat hotový COP symbol, ale má dodat stabilní data a volitelné prezentační hinty.

## Katalog

SIM má v provider katalogu držet samostatnou finální vrstvu:

- `recommendedCatalogLayerId`: `flight.public.tracks`
- `providerLayerId`: `flight.tracks`
- `providerId`: `sim.flight-data`
- `sourceRole`: `final`
- `kind`: `track_stream`
- label v češtině: `Veřejné lety`

Simulovaná letecká situace nepatří do `flight-data`. Má zůstat samostatným SIM zdrojem / COP track streamem, aby si uživatel mohl zapnout veřejné lety a simulovaná data nezávisle.

## Track Payload

Každý veřejný let musí mít stabilní identifikaci:

- `trackId`
- `icao24`, pokud je známé
- `callsign`, pokud je známý
- `registration`, pokud je známá
- `lastSeenAt`
- `position.lat`, `position.lon`
- `headingDeg`, pokud je známý
- `speedMps`, pokud je známá
- `altitudeM`, pokud je známá
- `verticalRateMps`, pokud je známá

COP používá `callsign`, potom `registration`, potom `icao24`. Pokud zdroj nemá callsign, nesmí ho nahrazovat technickým stringem typu `flight:icao24:*`.

## Aircraft Metadata

SIM má předávat co nejvíce z těchto údajů:

```json
{
  "aircraft": {
    "typeDesignator": "A320",
    "manufacturer": "Airbus",
    "model": "A320-214",
    "category": "passenger_jet",
    "engineType": "jet",
    "wakeTurbulenceCategory": "medium",
    "iconHint": "jet"
  }
}
```

`iconHint` je volitelné, ale doporučené. Povolené hodnoty:

- `jet`
- `turboprop`
- `small_aircraft`
- `helicopter`
- `glider`
- `uav`
- `unknown`

Pokud `iconHint` chybí, COP si typ odvodí z `typeDesignator`, `category`, `engineType` a `objectType`.

## Provenance A Kvalita

SIM má zachovat:

- `sources[]` s `sourceId`, `sourceRecordId`, `seenAt`, `fetchedAt`
- `providers[]` s licencí a režimem
- `quality.confidence`
- `quality.positionAgeSeconds`
- `quality.stale`
- `deduplication`

Tyto údaje COP zobrazuje v detailu a používá pro confidence, stale stav a audit datového původu.

## Omezení

SIM nesmí posílat targeting, doporučení zásahu, weapon workflow ani prioritizaci cílů. Veřejné lety jsou civilní situační informace. COP je zobrazuje pro informování uživatele, nikoli pro navádění akce.

