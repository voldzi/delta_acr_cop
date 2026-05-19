# 03 Backend Architecture

Backend MVP má poskytovat API-first rozhraní, event-driven pipeline a auditovatelné zpracování dat.

## Služby

- API Gateway: autentizace, autorizace, rate limit a routing.
- Ingest service: validace event envelope, idempotency a publikace.
- Source Registry service: evidence zdrojů a jejich lifecycle.
- Canonical model service: normalizace payloadů.
- Fusion service: korelace, konflikty, confidence.
- COP query service: čtení aktuálního a historického stavu.
- Distribution service: subscription, snapshot, delta a reconnect.
- AI Gateway: provider abstraction, guardrails, audit.
- Audit service: append-only evidence důležitých operací.

Backend nesmí generovat doporučení použití síly ani podporovat weapon workflow.

## Pilotní implementace

Pilot běží jako Fastify API s in-memory stavem. Aktuální objektový stav je uložený v `objects`, eventy v `events` a časová historie stop v `trackHistory`. Endpoint `/api/v1/cop/tracks` vrací aktuální situační obraz po lifecycle filtraci, endpoint `/api/v1/cop/track-history` vrací retenované body historie pro analytické vrstvy mapy.

Produkční rozšíření musí nahradit in-memory temporal historii perzistentním storem, přidat stránkování a napojit realtime distribuci přes SSE nebo WebSocket.
