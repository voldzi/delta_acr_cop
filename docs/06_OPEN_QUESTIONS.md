# 06 Open Questions

Vstupní zadání bylo nalezeno a použito: [zadani_codex_hlavni_cop_system_ai_delta_v1.md](zadani_codex_hlavni_cop_system_ai_delta_v1.md).

## Architektura

- Bude backend MVP preferovat NestJS, Go, nebo jiný stack?
- Bude event bus pro MVP NATS JetStream, Redpanda, Kafka, nebo dočasná in-process vrstva?
- Jaké jsou cílové provozní režimy: cloud, on-prem, air-gapped, edge node, nebo kombinace?
- Jaké limity latence a propustnosti jsou závazné mimo laboratorní kritéria?

## Data a interoperabilita

- Která konkrétní edice APP-6/STANAG 2019 bude referenční pro mapping katalog?
- Které JC3IEDM entity budou v MVP skutečně mapované a které zůstanou jen připravené?
- Jaké klasifikační úrovně, releasability značky a handling caveats budou v cílovém prostředí povolené?
- Jaké sample payloady poskytne SIM projekt pro contract tests?

## Security a AI

- Který identity provider je cílový pro MVP: Keycloak, Entra ID, nebo jiný OIDC provider?
- Jaká pravidla rozhodují, kdy AI dotaz vyžaduje human review?
- Které datové typy je nutné před externím AI providerem redigovat nebo anonymizovat?
- Bude lokální LLM povinný pro offline režim, nebo pouze volitelný provider?

## UX a operace

- Jaká zařízení a minimální rozlišení jsou primární: notebook, tablet, velký situační displej?
- Má MVP podporovat více současných mapových podkladů, nebo jen jeden základní map provider?
- Jak dlouho se má držet lokální cache pro degraded/offline režim?
