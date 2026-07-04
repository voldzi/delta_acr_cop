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

- `model`, výchozí rychlý profil `gemma4:12b-mlx`; komplexní dotazy může
  router přepnout na reasoning profil `gemma4:31b-mlx`,
- `messages` se systémovým promptem COP a uživatelským dotazem,
- `options.num_predict`, výchozí `512` pro fast profil a vyšší limit pro
  reasoning profil,
- `think=false`, aby thinking-capable Ollama model nevracel prázdný
  thinking-only výstup.

Model router `deterministic-v1` běží v `@cop/ai-gateway` server-side. Vyhodnocuje
účel dotazu, velikost kontextu, rozsah situačních dat, chatový výřez a výrazy
typické pro konfliktní analýzu, dopady, rizika, predikci nebo situational
awareness. Rozhodnutí se vrací jako volitelné `routing` metadata a auditují se
jen technické hodnoty (`modelRole`, skóre, strategie), ne prompt ani kontext.
`bge-m3` je podporovaný server-side embedding model pro následné retrieval/RAG
nad policy-filtered COP daty; klienti ho nevolají přímo. `cop-api` používá
embedding provider v semantic context vrstvě pro `situation-summary` a
`chat-agent/query`: z už autorizovaných COP objektů, výstrah, hlášení, incidentů,
source health a consentovaného chatContextu sestaví dokumenty, seřadí je podle
podobnosti k dotazu a do LLM kontextu vloží jen omezený relevantní výběr.
Před semantic řazením se navíc skládá `priorityContext`, který zvýhodňuje
krizově důležité signály: vodu/povodně, požáry, zdravotní rizika,
infrastrukturu, dopravní omezení, bezpečnostní/policejní incidenty, komunitní
hlášení a aktivní výstrahy. Rutinní stale/low-confidence civilní letecké tracky
jsou pro situační přehled nízká priorita, pokud nejsou přímo relevantní.
Kontext obsahuje citační značky a strukturované `mapSnapshot` kandidáty pro
budoucí render mapového náhledu.

AI KnowledgeBase LLM Gateway zůstává podporovaná jako volitelný kompatibilní
fallback provider `local`, zejména pokud prostředí chce sdílet jeden gateway pro
více aplikací.

## Runtime Konfigurace

Lokální AI je defaultně vypnutá. Pro zapnutí v produkci:

```env
COP_EXTERNAL_AI_ENABLED=true
COP_AI_DEFAULT_PROVIDER=ollama
COP_AI_HEALTH_DEPENDENCY_TIMEOUT_MS=10000
COP_AI_MODEL_ROUTER_ENABLED=true
COP_AI_MODEL_ROUTER_COMPLEXITY_THRESHOLD=70
COP_AI_OLLAMA_BASE_URLS=http://192.168.200.2:11434,http://host.docker.internal:11434,http://192.168.1.176:11434
COP_AI_OLLAMA_TOKEN=<service-token-pokud-je-vyžadován>
COP_AI_OLLAMA_FAST_MODEL=gemma4:12b-mlx
COP_AI_OLLAMA_MODEL=gemma4:12b-mlx
COP_AI_OLLAMA_MAX_TOKENS=512
COP_AI_OLLAMA_TIMEOUT_MS=30000
COP_AI_OLLAMA_RETRY_ATTEMPTS=2
COP_AI_OLLAMA_THINK=false
COP_AI_OLLAMA_REASONING_MODEL=gemma4:31b-mlx
COP_AI_OLLAMA_REASONING_MAX_TOKENS=1200
COP_AI_OLLAMA_REASONING_TIMEOUT_MS=90000
COP_AI_OLLAMA_REASONING_RETRY_ATTEMPTS=1
COP_AI_OLLAMA_REASONING_THINK=false
COP_AI_OLLAMA_EMBEDDING_MODEL=bge-m3:latest
COP_AI_OLLAMA_EMBEDDING_TIMEOUT_MS=10000
COP_AI_SEMANTIC_RETRIEVAL_ENABLED=true
COP_AI_SEMANTIC_RETRIEVAL_MAX_DOCUMENTS=12
COP_AI_SEMANTIC_RETRIEVAL_CACHE_ENTRIES=500
```

`COP_AI_DEFAULT_PROVIDER=mock` ponechává bezpečný vývojový režim bez externího
volání. `providerPreference=auto` v klientovi znamená: použij konfigurovaný
produkční provider, jinak `ollama`, potom kompatibilní `local` gateway, a teprve
potom `mock` fallback. `modelPreference=auto` znamená, že konkrétní modelový
profil volí server-side router. COP Chat může u AI-agent dotazů předat
`modelPreference=reasoning` přes volbu v dialogu nebo slash příkaz `/reasoning`;
router pak preferuje `COP_AI_OLLAMA_REASONING_MODEL`, pokud je dostupný.
`COP_AI_HEALTH_DEPENDENCY_TIMEOUT_MS` řídí pouze obalový timeout pro
`/health/dependencies`; samotné AI dotazy používají provider timeouty
`COP_AI_OLLAMA_TIMEOUT_MS`, `COP_AI_OLLAMA_REASONING_TIMEOUT_MS` a
`COP_AI_LOCAL_TIMEOUT_MS`.

Volitelný compatibility fallback přes AI KnowledgeBase LLM Gateway:

```env
COP_AI_LOCAL_GATEWAY_URL=http://docker.home.cz:3220/llm-gateway
COP_AI_LOCAL_GATEWAY_TOKEN=<service-token-pokud-ho-AKB-vyžaduje>
COP_AI_LOCAL_MODEL=gemma4:12b-mlx
COP_AI_LOCAL_MAX_TOKENS=512
COP_AI_LOCAL_TIMEOUT_MS=30000
COP_AI_LOCAL_RETRY_ATTEMPTS=2
COP_AI_LOCAL_THINK=false
```

## Aplikační AI Endpointy

Web a iOS klienti nepoužívají low-level LLM API. Volají pouze aplikační COP
endpointy:

- `POST /api/v1/ai/cop-assistant/query` pro obecný povolený dotaz,
- `POST /api/v1/ai/situation-summary` pro situační souhrn z aktuálně čitelných
  krizově prioritizovaných objektů, výstrah, komunitních hlášení, incidentů a
  zdrojů,
- `POST /api/v1/ai/chat-agent/query` pro otázku viditelnému AI agentovi nad COP
  kontextem a volitelným consentovaným chat výňatkem,
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
