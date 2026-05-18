# 04 Confidence and Provenance

Confidence je vysvětlitelné skóre důvěry v pozorování nebo objekt. Provenance je auditovatelná historie původu a transformací dat.

## Confidence faktory

- spolehlivost zdroje,
- kredibilita informace,
- stáří dat,
- přesnost polohy,
- konzistence s jinými zdroji,
- konflikt pozorování,
- syntetický původ dat.

## Provenance record

Provenance záznam má odkazovat na původní `eventId`, `sourceSystemId`, `adapterVersion`, transformační krok, timestamp a důvod změny confidence.

Confidence nesmí být interpretována jako doporučení akce. Slouží pro datovou kvalitu a situační orientaci.
