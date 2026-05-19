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

## Serverová evidence konfliktů

API odvozuje `attributes.conflictEvidence` jako čitelný datový produkt nad aktuálním objektem, historií stop a stavem zdroje. Stejná evidence je dostupná také přes `GET /api/v1/cop/conflicts`.

Evidence může obsahovat:

- změnu afiliace v poslední historii objektu,
- výrazný rozptyl posledních pozic mezi zdroji,
- časté změny lifecycle stavu,
- nízkou confidence,
- degradovaný zdroj,
- objektový stav `CONFLICTED`.

Tato evidence je pouze informační. Nesmí být použita jako doporučení zásahu, výběr cíle ani součást weapon workflow.
