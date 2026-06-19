# 02 Modules

## Doporučené moduly monorepa

- `apps/cop-api`: API Gateway, ingest, query, Source Registry, audit a AI endpointy.
- `apps/cop-web`: webový COP klient.
- `apps/cop-edge-node`: edge/degraded runtime, lokální file-backed outbox,
  heartbeat, policy-filtered replay pull a status endpointy pro publikaci pod
  `/edge`.
- `packages/canonical-model`: sdílené typy a validace canonical modelu.
- `packages/ingest-contracts`: OpenAPI/JSON Schema kontrakty.
- `packages/source-adapters`: adapter framework.
- `packages/policy-engine`: RBAC/ABAC evaluation.
- `packages/nato-symbol-renderer`: symbol resolver a rendering metadata.
- `packages/ai-gateway`: provider abstraction a guardrails.
- `packages/openapi`: generované klienty a contract test helpers.

Moduly nesmí sdílet interní databázové struktury se SIM projektem.
