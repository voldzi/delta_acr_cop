# 05 Local LLM Provider

Local LLM provider je určen pro prostředí s omezenou konektivitou, vyšší citlivostí dat nebo požadavkem na local-only režim.

## Požadavky

- běh v kontrolované infrastruktuře,
- jasný model registry a version pinning,
- omezení kontextu podle classification policy,
- audit stejného rozsahu jako u externích providerů,
- degraded odpovědi při nedostupnosti modelu,
- nezávislá evaluace guardrails.

Local provider může mít nižší kvalitu výstupu. UI musí odlišit provider a případné limity odpovědi.
