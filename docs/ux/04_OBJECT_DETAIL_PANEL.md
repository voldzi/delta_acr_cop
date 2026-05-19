# 04 Object Detail Panel

Detail objektu vysvětluje, proč se objekt v COP nachází a jakou má důvěryhodnost.

## Obsah

- object identity a typ,
- affiliation/domain/status,
- aktuální poloha a stáří dat,
- confidence score a faktory,
- provenance a source history,
- conflict flags,
- SIM/real indikace,
- symbol resolution detail,
- audit link.

Panel nesmí nabízet akce spojené s použitím síly.

## Implementace k 2026-05-19

Object detail v2 je rozdělený na sekce `Identita`, `Poloha`, `Symbologie`, `Zdroj`, `Confidence`, `Data lineage`, `Konflikty` a `Source history`.

- `Confidence` ukazuje faktory: score, spolehlivost zdroje, kredibilitu informace, stáří dat, source health a původ dat.
- `Data lineage` vysvětluje cestu: source event -> adapter transform -> canonical COP object -> APP-6 rendering.
- `Konflikty` jsou informační datové flagy: změna affiliation/statusu, rozdílné pozice z více zdrojů, degradovaný zdroj nebo `CONFLICTED` stav.
- `Source history` používá temporal history body vybraného objektu z aktuálního replay/live okna.

Konflikty ani confidence nejsou akční doporučení. Slouží pouze k hodnocení kvality dat a situační orientaci.
