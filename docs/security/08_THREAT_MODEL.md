# 08 Threat Model

## Aktiva

- COP state,
- canonical event stream,
- Source Registry,
- audit/provenance,
- identity provider integrace,
- AI Gateway a prompt/audit data,
- offline cache.

## Hrozby

- spoofing zdroje,
- replay nebo duplicate ingest,
- schema bypass,
- elevation of privilege,
- leakage klasifikovaných dat,
- neautorizovaná subscription,
- AI prompt injection,
- exfiltrace přes externí AI provider,
- záměna syntetických a reálných dat,
- manipulace confidence/provenance.

## Mitigace

mTLS/OIDC, Source Registry, idempotency, schema validation, RBAC/ABAC, audit, redaction, provider policy, local-only mode, signed events, monitoring a contract tests.
