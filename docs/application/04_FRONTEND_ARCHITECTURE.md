# 04 Frontend Architecture

Webový klient je operační konzument COP state. Jeho účelem je rychlá orientace, filtrování vrstev, detail objektu, timeline/replay, stav zdrojů a vysvětlení confidence/provenance.

## Doporučený stack

- Next.js + React,
- MapLibre GL nebo ekvivalent,
- WebSocket/SSE klient pro delta updates,
- lokální state management pro UI filtry a subscription,
- komponenta AI assistant drawer napojená pouze na povolené AI endpointy.

## Zásady

UI musí jasně odlišit syntetická data, stale objekty, konflikty zdrojů a degraded režim. UI nesmí obsahovat targeting, navádění ani workflow použití síly.
