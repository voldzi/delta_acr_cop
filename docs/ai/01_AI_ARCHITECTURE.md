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
    OLLAMA_PROVIDER["COP Ollama provider"]
    LOCAL["Compatibility Local LLM Gateway provider"]
    AKB["AI KnowledgeBase LLM Gateway"]
    OLLAMA["Ollama"]
    MOCK["Mock provider"]
    VALID["Structured output validation"]
    HUMAN["Human review when required"]
    AUDIT["AI audit log"]

    USER --> GW --> CLASS --> REDACT --> POLICY --> ROUTER
    ROUTER --> OPENAI
    ROUTER --> CODEX
    ROUTER --> OLLAMA_PROVIDER --> OLLAMA
    ROUTER --> LOCAL --> AKB --> OLLAMA
    ROUTER --> MOCK
    OPENAI --> VALID
    CODEX --> VALID
    OLLAMA_PROVIDER --> VALID
    LOCAL --> VALID
    MOCK --> VALID
    VALID --> HUMAN
    VALID --> AUDIT
    HUMAN --> AUDIT
```

Externí AI provider musí být vypnutelný. Local-only režim musí být podporovaný pro prostředí, kde data nesmí opustit kontrolovanou infrastrukturu.

Produkční lokální režim COP používá primárně `ollama` provider, který běží
server-side v COP API a volá Ollama runtime přímo. Provider `local` přes AI
KnowledgeBase LLM Gateway zůstává kompatibilní fallback, ne primární cesta.
