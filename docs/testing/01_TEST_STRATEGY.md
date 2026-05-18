# 01 Test Strategy

Testovací strategie sleduje největší rizika: integrační kontrakt, validaci dat, policy enforcement, distribuci, symboliku, AI guardrails a offline/degraded chování.

## Úrovně

- unit testy pro model, policy a symbol resolver,
- contract tests pro OpenAPI/JSON Schema,
- integration tests pro ingest pipeline,
- stream tests pro snapshot/delta,
- UI tests pro základní COP workflow,
- security tests pro auth, RBAC/ABAC a audit,
- AI guardrail tests pro povolené a zakázané prompt typy.
