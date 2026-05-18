# 06 AI Guardrails

Guardrails omezují AI na povolené asistivní COP/data/reporting/developer use-cases.

## Povolené use-cases

- vysvětlení objektu a provenance,
- shrnutí vrstvy nebo časového intervalu,
- návrh filtrů a dotazů,
- kontrola kvality dat,
- vysvětlení konfliktu zdrojů,
- návrh reportu,
- dokumentace a runbooky,
- vývojářská pomoc.

## Zakázané use-cases

- výběr nebo prioritizace cílů pro zásah,
- doporučení použití síly,
- plánování útoku,
- navádění prostředků,
- taktické bojové doporučení,
- obcházení detekce nebo bezpečnostních kontrol,
- autonomní operační rozhodnutí.

Zakázaný požadavek se odmítá, auditně zaznamená a neodesílá se externímu providerovi, pokud policy neurčí bezpečný klasifikační krok bez citlivých dat.
