# 01 AI Architecture

AI vrstva je asistivní a nesmí být rozhodovacím jádrem COP systému. Pomáhá s vysvětlením situačního obrazu, shrnutím dat, konflikty zdrojů, návrhem dotazů, kontrolou kvality dat, dokumentací a orientací operátora v datech.

AI nesmí vybírat cíle, prioritizovat cíle pro zásah, doporučovat použití síly, plánovat útok, navádět prostředky ani poskytovat taktické bojové doporučení.

```mermaid
flowchart LR
    USER["User / COP Client"]
    GW["AI Gateway"]
    CLASS["Prompt classification"]
    REDACT["Redaction / anonymization"]
    POLICY["Guardrails & policy"]
    ROUTER["Provider router"]
    OPENAI["OpenAI provider"]
    CODEX["Codex provider"]
    LOCAL["Local LLM provider"]
    MOCK["Mock provider"]
    VALID["Structured output validation"]
    HUMAN["Human review when required"]
    AUDIT["AI audit log"]

    USER --> GW --> CLASS --> REDACT --> POLICY --> ROUTER
    ROUTER --> OPENAI
    ROUTER --> CODEX
    ROUTER --> LOCAL
    ROUTER --> MOCK
    OPENAI --> VALID
    CODEX --> VALID
    LOCAL --> VALID
    MOCK --> VALID
    VALID --> HUMAN
    VALID --> AUDIT
    HUMAN --> AUDIT
```

Externí AI provider musí být vypnutelný. Local-only režim musí být podporovaný pro prostředí, kde data nesmí opustit kontrolovanou infrastrukturu.
