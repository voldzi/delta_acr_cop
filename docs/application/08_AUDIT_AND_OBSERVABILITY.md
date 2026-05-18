# 08 Audit and Observability

Audit je append-only evidence významných akcí a rozhodnutí. Observabilita sleduje zdraví pipeline, latenci, chybovost a policy dopady.

## Auditovat

- ingest request a výsledek validace,
- Source Registry změny,
- idempotency konflikty,
- fusion konflikty a confidence vysvětlení,
- subscription vytvoření a policy filtering,
- AI dotazy, provider, guardrails a výsledek policy checku,
- administrátorské změny.

## Metriky

`ingest_latency`, `fusion_latency`, `distribution_latency`, `ai_latency`, `active_subscriptions`, `cop_object_count`, `source_outage_count`, `data_conflict_count`, `policy_denied_count`, `ai_rejected_requests`.
