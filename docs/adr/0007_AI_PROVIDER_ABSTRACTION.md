# ADR-0007: AI Provider Abstraction

## Status

Accepted

## Context

COP má používat OpenAI, Codex, vlastní server-side Ollama provider, kompatibilní lokální LLM gateway a mock providera, ale policy může externí AI omezit nebo vypnout.

## Decision

AI bude přístupná pouze přes AI Gateway s provider abstraction, guardrails, redaction, structured output validation a auditem.

## Consequences

Systém může měnit providery a podporovat local-only režim. Primární local-only cesta je COP-owned `ollama`; `local` přes AI KnowledgeBase LLM Gateway je kompatibilní fallback. Implementace vyžaduje jasné provider capability metadata.

## Alternatives Considered

Přímé volání konkrétního AI providera z UI nebo služeb. Odmítnuto kvůli bezpečnosti a auditovatelnosti.

## Follow-up Actions

Navrhnout provider interface a guardrail test suite.
