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
