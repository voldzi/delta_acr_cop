# 01 Next Codex Prompt COP Skeleton

Použij dokumentační baseline v `docs/` a vytvoř implementační monorepo skeleton hlavního COP systému. Neimplementuj produkční logiku nad rámec skeletonu, ale připrav strukturu pro `apps/cop-api`, `apps/cop-web`, `apps/cop-edge-node` a packages `canonical-model`, `ingest-contracts`, `source-adapters`, `policy-engine`, `nato-symbol-renderer`, `ai-gateway`, `ai-guardrails` a `openapi`.

Vygeneruj typy a validaci z `docs/api/openapi-main-cop.yaml` a `docs/api/schemas/*.schema.json`. Připrav endpoint skeletony pro ingest, COP tracks, subscriptions, stream, symbology, Source Registry, audit, AI, health a metrics. SIM projekt považuj za externí systém a komunikuj s ním pouze přes Shared Integration Contract v1.

AI vrstvu navrhni přes provider abstraction pro OpenAI, Codex, local LLM a mock providera. AI smí být pouze asistivní pro COP/data/reporting/developer use-cases. Nepřidávej targeting, navádění, weapon workflow, reálné bojové plánování ani autonomní operační rozhodování.
