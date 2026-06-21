# 05 Local LLM Provider

Local LLM provider je určen pro prostředí s omezenou konektivitou, vyšší citlivostí dat nebo požadavkem na local-only režim.

## Požadavky

- běh v kontrolované infrastruktuře,
- jasný model registry a version pinning,
- omezení kontextu podle classification policy,
- audit stejného rozsahu jako u externích providerů,
- degraded odpovědi při nedostupnosti modelu,
- nezávislá evaluace guardrails.

Local provider může mít nižší kvalitu výstupu. UI musí odlišit provider a případné limity odpovědi.

## Produkční Integrace Přes AI KnowledgeBase LLM Gateway

COP nevolá Ollama přímo z webového klienta. Produkční lokální AI je zapojená
server-side přes AI KnowledgeBase LLM Gateway:

```text
COP web -> COP API -> @cop/ai-gateway -> AI KnowledgeBase LLM Gateway -> Ollama
```

Tím zůstává zachovaná bezpečnostní hranice:

- interní URL Ollamy a LLM Gateway nejsou dostupné v browseru,
- service token LLM Gateway se nikdy neposílá do webového klienta,
- COP před voláním modelu vždy provede vlastní AI guardrails,
- COP neposílá do lokálního LLM admin tokeny, media access tokeny ani provider
  service tokeny,
- AI odpověď je asistivní; není rozhodovacím nebo notifikačním jádrem.

Podporovaný provider v COP je `local`. Používá endpoint:

```http
POST /api/v1/chat/completions
```

LLM Gateway request obsahuje:

- `model`, výchozí `gemma4:12b`,
- `messages` se systémovým promptem COP a uživatelským dotazem,
- `max_tokens`, výchozí `512`,
- `think=false`, aby thinking-capable Ollama model nevracel prázdný
  thinking-only výstup,
- `metadata.requestId`, `metadata.purpose`, `metadata.safetyScope` a
  `metadata.caller=cop-api`.

## Runtime Konfigurace

Lokální AI je defaultně vypnutá. Pro zapnutí v produkci:

```env
COP_EXTERNAL_AI_ENABLED=true
COP_AI_DEFAULT_PROVIDER=local
COP_AI_LOCAL_GATEWAY_URL=http://docker.home.cz:3220/llm-gateway
COP_AI_LOCAL_GATEWAY_TOKEN=<service-token-pokud-je-vyžadován>
COP_AI_LOCAL_MODEL=gemma4:12b
COP_AI_LOCAL_MAX_TOKENS=512
COP_AI_LOCAL_TIMEOUT_MS=30000
COP_AI_LOCAL_RETRY_ATTEMPTS=2
COP_AI_LOCAL_THINK=false
```

`COP_AI_DEFAULT_PROVIDER=mock` ponechává bezpečný vývojový režim bez externího
volání. `providerPreference=auto` v klientovi znamená: použij konfigurovaný
produkční provider, jinak `local`, a teprve potom `mock` fallback.

## Degraded Režim

`/health/dependencies` vrací stav `ai-gateway`:

- `ok`, pokud je LLM Gateway dostupná,
- `degraded`, pokud je dostupný jen mock nebo lokální provider neodpovídá,
- `disabled`, pokud je provider vypnutý.

Pokud lokální LLM během dotazu selže, COP API nevrací chybu 500. Odpověď má
stav `NEEDS_HUMAN_REVIEW` a uživateli sdělí, že AI provider je dočasně
nedostupný. To je záměrné fail-open chování pro mapu a fail-closed chování pro
AI výstup.
