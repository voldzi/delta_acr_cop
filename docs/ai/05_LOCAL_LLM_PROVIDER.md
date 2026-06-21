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

## Produkční Integrace Přes COP Ollama Provider

COP nevolá Ollama přímo z webového klienta. Produkční lokální AI je zapojená
server-side v `cop-api` přes COP-owned Ollama provider:

```text
COP web / iOS -> COP API -> @cop/ai-gateway -> Ollama
```

Tím zůstává zachovaná bezpečnostní hranice:

- interní URL Ollamy nejsou dostupné v browseru ani iOS klientovi,
- případný Ollama service token se nikdy neposílá do webového klienta,
- COP před voláním modelu vždy provede vlastní AI guardrails,
- COP neposílá do lokálního LLM admin tokeny, media access tokeny ani provider
  service tokeny,
- AI odpověď je asistivní; není rozhodovacím nebo notifikačním jádrem.

Primární podporovaný provider v COP je `ollama`. Používá Ollama endpoint:

```http
POST /api/chat
```

Ollama request obsahuje:

- `model`, výchozí `gemma4:12b`,
- `messages` se systémovým promptem COP a uživatelským dotazem,
- `options.num_predict`, výchozí `512`,
- `think=false`, aby thinking-capable Ollama model nevracel prázdný
  thinking-only výstup.

AI KnowledgeBase LLM Gateway zůstává podporovaná jako volitelný kompatibilní
fallback provider `local`, zejména pokud prostředí chce sdílet jeden gateway pro
více aplikací.

## Runtime Konfigurace

Lokální AI je defaultně vypnutá. Pro zapnutí v produkci:

```env
COP_EXTERNAL_AI_ENABLED=true
COP_AI_DEFAULT_PROVIDER=ollama
COP_AI_OLLAMA_BASE_URLS=http://192.168.200.2:11434,http://host.docker.internal:11434,http://192.168.1.176:11434
COP_AI_OLLAMA_TOKEN=<service-token-pokud-je-vyžadován>
COP_AI_OLLAMA_MODEL=gemma4:12b
COP_AI_OLLAMA_MAX_TOKENS=512
COP_AI_OLLAMA_TIMEOUT_MS=30000
COP_AI_OLLAMA_RETRY_ATTEMPTS=2
COP_AI_OLLAMA_THINK=false
```

`COP_AI_DEFAULT_PROVIDER=mock` ponechává bezpečný vývojový režim bez externího
volání. `providerPreference=auto` v klientovi znamená: použij konfigurovaný
produkční provider, jinak `ollama`, potom kompatibilní `local` gateway, a teprve
potom `mock` fallback.

Volitelný compatibility fallback přes AI KnowledgeBase LLM Gateway:

```env
COP_AI_LOCAL_GATEWAY_URL=http://docker.home.cz:3220/llm-gateway
COP_AI_LOCAL_GATEWAY_TOKEN=<service-token-pokud-ho-AKB-vyžaduje>
COP_AI_LOCAL_MODEL=gemma4:12b
COP_AI_LOCAL_MAX_TOKENS=512
COP_AI_LOCAL_TIMEOUT_MS=30000
COP_AI_LOCAL_RETRY_ATTEMPTS=2
COP_AI_LOCAL_THINK=false
```

## Aplikační AI Endpointy

Web a iOS klienti nepoužívají low-level LLM API. Volají pouze aplikační COP
endpointy:

- `POST /api/v1/ai/cop-assistant/query` pro obecný povolený dotaz,
- `POST /api/v1/ai/situation-summary` pro situační souhrn z aktuálně čitelných objektů, výstrah a zdrojů,
- `POST /api/v1/ai/source-health-summary` pro srozumitelné vysvětlení stavu providerů,
- `POST /api/v1/ai/community-report/draft` pro pomoc s textem občanského hlášení.

Tyto endpointy vytváří kontext server-side, aplikují policy a auditují dotaz.
Nepředávají LLM media obsah, tokeny ani surové interní diagnostické struktury.

## Degraded Režim

`/health/dependencies` vrací stav `ai-gateway`:

- `ok`, pokud je COP Ollama provider nebo fallback LLM Gateway dostupná,
- `degraded`, pokud je dostupný jen mock nebo lokální provider neodpovídá,
- `disabled`, pokud je provider vypnutý.

Pokud lokální LLM během dotazu selže, COP API nevrací chybu 500. Odpověď má
stav `NEEDS_HUMAN_REVIEW` a uživateli sdělí, že AI provider je dočasně
nedostupný. To je záměrné fail-open chování pro mapu a fail-closed chování pro
AI výstup.
