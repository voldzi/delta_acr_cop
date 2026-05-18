# CODEX PROMPT — Projekt 01 COP: Dokumentační a architektonický baseline hlavního COP systému

Jsi CODEX spuštěný samostatně nad projektem:

`/Users/voldzi/Documents/Development/18 2026/DELTA_ACR/01 COP`

Toto je samostatný projekt pro hlavní COP systém. Projekt SIM je samostatný projekt a bude se vyvíjet paralelně v jiné složce. Tvým cílem v tomto kroku není implementovat produkční aplikaci, ale vytvořit profesionální dokumentační, architektonický a integrační baseline pro hlavní COP systém.

Autoritativní vstupní zadání je zde:

`/Users/voldzi/Documents/Development/18 2026/DELTA_ACR/01 COP/docs/zadani_codex_hlavni_cop_system_ai_delta_v1.md`

Nejprve tento soubor načti, analyzuj a použij jako hlavní zdroj požadavků. Pokud soubor není dostupný, práci nezastavuj; vytvoř baseline podle níže uvedených požadavků a do `docs/06_OPEN_QUESTIONS.md` zapiš, že vstupní zadání nebylo nalezeno.

---

## 1. Cíl tohoto úkolu

Vytvoř jednotnou a profesionální dokumentační strukturu pro hlavní COP systém.

Hlavní COP systém má být samostatná aplikace / platforma pro:

- příjem situačních dat přes API,
- canonical data model,
- korelaci a fúzi dat,
- tvorbu COP state,
- distribuci COP,
- NATO symbol renderer,
- webový COP klient,
- offline/degraded režim,
- Source Registry,
- audit,
- RBAC/ABAC,
- AI podporu přes OpenAI, Codex a lokální LLM,
- DELTA-inspired UX design.

Projekt SIM se v tomto repozitáři neimplementuje. COP projekt ale musí obsahovat přesně popsané integrační kontrakty, aby se mohl později napojit na samostatně vyvíjený SIM projekt.

---

## 2. Zásadní pravidla

Neimplementuj nyní produkční backend, frontend ani databázové migrace.

V tomto kroku vytvoř pouze:

- dokumentaci,
- architektonické návrhy,
- ADR záznamy,
- OpenAPI skeleton,
- JSON Schema skeletony,
- datový model jako návrh,
- integrační kontrakty jako návrh,
- bezpečnostní koncept,
- AI governance koncept,
- UX/design koncept,
- runbooky,
- quality gates,
- prompt pro další CODEX krok.

Vytvářej pouze placeholdery tam, kde to pomáhá budoucímu vývoji.

Vše piš profesionálně česky. Technické termíny používej běžně anglicky, pokud je to v oboru přirozené.

Všechny nejasnosti zapiš do `docs/06_OPEN_QUESTIONS.md`.

Nepřidávej žádné targetingové, zbraňové, naváděcí nebo bojové workflow. COP systém je datová a situační platforma.

---

## 3. Požadovaná struktura dokumentace

Vytvoř nebo sjednoť tuto strukturu:

```text
docs/
  00_INDEX.md
  01_PROJECT_OVERVIEW.md
  02_DOCUMENTATION_STANDARD.md
  03_DEVELOPMENT_WORKFLOW.md
  04_QUALITY_GATES.md
  05_GLOSSARY.md
  06_OPEN_QUESTIONS.md

  product/
    00_INDEX.md
    01_VISION_AND_SCOPE.md
    02_STAKEHOLDERS.md
    03_SYSTEM_BOUNDARIES.md
    04_MVP_SCOPE.md
    05_OUT_OF_SCOPE.md

  architecture/
    00_INDEX.md
    01_ARCHITECTURE_PRINCIPLES.md
    02_SYSTEM_CONTEXT.md
    03_CONTAINER_VIEW.md
    04_COMPONENT_VIEW.md
    05_DEPLOYMENT_VIEW.md
    06_INTEGRATION_ARCHITECTURE.md
    07_DATA_ARCHITECTURE.md
    08_EVENT_DRIVEN_ARCHITECTURE.md
    09_OFFLINE_AND_EDGE_ARCHITECTURE.md
    10_DELTA_INSPIRED_UX_ARCHITECTURE.md

  application/
    00_INDEX.md
    01_APPLICATION_OVERVIEW.md
    02_MODULES.md
    03_BACKEND_ARCHITECTURE.md
    04_FRONTEND_ARCHITECTURE.md
    05_NATO_RENDERER.md
    06_COP_DISTRIBUTION.md
    07_SOURCE_REGISTRY.md
    08_AUDIT_AND_OBSERVABILITY.md

  integration/
    00_INDEX.md
    01_SHARED_INTEGRATION_CONTRACT.md
    02_SIMULATOR_TO_COP_CONTRACT.md
    03_INGEST_API_CONTRACT.md
    04_STREAMING_CONTRACT.md
    05_SOURCE_REGISTRY_CONTRACT.md
    06_ERROR_MODEL.md
    07_VERSIONING_POLICY.md

  api/
    openapi-main-cop.yaml
    schemas/
      canonical-event-envelope.schema.json
      observed-object.schema.json
      source-system.schema.json
      cop-subscription.schema.json
      symbol-resolve-request.schema.json
      symbol-resolve-response.schema.json
      ai-cop-query.schema.json

  data/
    00_INDEX.md
    01_CANONICAL_MODEL.md
    02_EVENT_ENVELOPE.md
    03_COP_STATE_MODEL.md
    04_CONFIDENCE_AND_PROVENANCE.md
    05_CLASSIFICATION_AND_POLICY_TAGS.md
    06_SYNTHETIC_DATA_HANDLING.md

  interoperability/
    00_INDEX.md
    01_NATO_STANDARD_MAPPING.md
    02_APP6_STANAG2019_SYMBOL_RENDERING.md
    03_JC3IEDM_STANAG5525_MAPPING.md
    04_ADATP3_APP11_MESSAGES.md
    05_STANAG4609_METADATA.md
    06_STANAG4586_UAV_TELEMETRY_LIMITS.md

  ai/
    00_INDEX.md
    01_AI_ARCHITECTURE.md
    02_PROVIDER_ABSTRACTION.md
    03_OPENAI_PROVIDER.md
    04_CODEX_USAGE.md
    05_LOCAL_LLM_PROVIDER.md
    06_AI_GUARDRAILS.md
    07_AI_AUDIT_AND_LOGGING.md
    08_PROMPT_TEMPLATES.md

  security/
    00_INDEX.md
    01_SECURITY_ARCHITECTURE.md
    02_RBAC_ABAC.md
    03_IDENTITY_AND_ACCESS.md
    04_SOURCE_AND_DEVICE_IDENTITY.md
    05_AUDIT.md
    06_MDM_MAM_ENDPOINT_TRUST.md
    07_CONTINUOUS_ATO.md
    08_THREAT_MODEL.md
    09_INTEGRATION_RISK_REGISTER.md

  ux/
    00_INDEX.md
    01_DELTA_INSPIRED_DESIGN_PRINCIPLES.md
    02_MAIN_COP_UI.md
    03_MAP_AND_LAYER_MODEL.md
    04_OBJECT_DETAIL_PANEL.md
    05_TIMELINE_AND_REPLAY.md
    06_ACCESSIBILITY_AND_FIELD_USABILITY.md

  testing/
    00_INDEX.md
    01_TEST_STRATEGY.md
    02_CONTRACT_TESTING.md
    03_LOAD_TESTING.md
    04_SECURITY_TESTING.md
    05_ACCEPTANCE_CRITERIA.md

  runbooks/
    00_INDEX.md
    01_LOCAL_DEVELOPMENT.md
    02_DOCKER_COMPOSE.md
    03_ENVIRONMENT_CONFIGURATION.md
    04_RUNNING_MAIN_COP.md
    05_RUNNING_CONTRACT_TESTS.md
    06_DEMO_RUNBOOK.md

  adr/
    0000_ADR_TEMPLATE.md
    0001_DOCUMENTATION_FIRST_APPROACH.md
    0002_SEPARATE_COP_AND_SIM_PROJECTS.md
    0003_SHARED_INTEGRATION_CONTRACT.md
    0004_DATA_FIRST_COP_ARCHITECTURE.md
    0005_EVENT_DRIVEN_ARCHITECTURE.md
    0006_NATO_RENDERER_IN_MAIN_COP.md
    0007_AI_PROVIDER_ABSTRACTION.md
    0008_DELTA_INSPIRED_UX_WITHOUT_WEAPON_WORKFLOW.md

  prompts/
    00_INDEX.md
    01_NEXT_CODEX_PROMPT_COP_SKELETON.md
    02_NEXT_CODEX_PROMPT_CONTRACT_TESTS.md
    03_NEXT_CODEX_PROMPT_NATO_RENDERER.md
```

---

## 4. Klíčový obsah

### 4.1 `docs/architecture/01_ARCHITECTURE_PRINCIPLES.md`

Definuj principy:

- documentation-first,
- data-first,
- API-first,
- event-driven,
- security-by-design,
- zero trust,
- auditability,
- explainability,
- explicit contracts,
- independent deployability,
- provider abstraction for AI,
- NATO renderer only in main COP,
- synthetic data separated from real data,
- no targeting / no weapon workflow.

### 4.2 `docs/integration/01_SHARED_INTEGRATION_CONTRACT.md`

Tento dokument je kritický. Musí umožnit paralelní vývoj SIM projektu.

Popiš:

- odpovědnosti COP systému,
- odpovědnosti SIM systému,
- hranici mezi projekty,
- pravidla verzování kontraktu,
- autentizaci,
- sourceSystemId,
- adapterVersion,
- eventId,
- correlationId,
- idempotency,
- producerTimestamp,
- ingestTimestamp,
- klasifikaci,
- označení syntetických dat,
- error model,
- retry/backoff,
- schema validation,
- breaking changes policy.

Vytvoř verzi kontraktu jako `Shared Integration Contract v1`.

### 4.3 `docs/api/openapi-main-cop.yaml`

Vytvoř validní OpenAPI 3.1 skeleton s endpointy:

- `POST /api/v1/ingest/events`
- `POST /api/v1/ingest/batches`
- `GET /api/v1/cop/tracks`
- `POST /api/v1/cop/subscriptions`
- `GET /api/v1/stream/cop/{subscriptionId}`
- `POST /api/v1/symbology/resolve`
- `GET /api/v1/sources`
- `POST /api/v1/sources`
- `GET /api/v1/sources/{sourceSystemId}`
- `PATCH /api/v1/sources/{sourceSystemId}`
- `POST /api/v1/sources/{sourceSystemId}/revoke`
- `GET /api/v1/audit/events`
- `POST /api/v1/ai/cop-assistant/query`
- `GET /health/live`
- `GET /health/ready`
- `GET /health/dependencies`
- `GET /metrics`

Použij odkazy na JSON Schema soubory v `docs/api/schemas`.

### 4.4 JSON Schema skeletony

Vytvoř validní JSON Schema skeletony pro:

- `canonical-event-envelope.schema.json`
- `observed-object.schema.json`
- `source-system.schema.json`
- `cop-subscription.schema.json`
- `symbol-resolve-request.schema.json`
- `symbol-resolve-response.schema.json`
- `ai-cop-query.schema.json`

### 4.5 `docs/interoperability/02_APP6_STANAG2019_SYMBOL_RENDERING.md`

Popiš NATO renderer jako součást hlavního COP systému.

Musí obsahovat:

- účel rendereru,
- vstupní canonical object,
- symbol resolver,
- mapování `objectType + affiliation + domain + status + modifiers`,
- výstupní symbol code,
- pravidla fallbacku,
- lokální rozšíření symboliky,
- testovací přístup,
- oddělení datového významu od prezentace.

Uveď, že cílem první fáze není certifikovaná NATO shoda, ale architektonická připravenost, katalog, mapping matrix a testovatelnost.

### 4.6 `docs/ai/01_AI_ARCHITECTURE.md`

Navrhni AI vrstvu pro hlavní COP systém.

Podporovaní provideři:

- OpenAI,
- Codex,
- lokální LLM,
- mock provider.

AI v COP smí pomáhat s:

- vysvětlením situačního obrazu,
- shrnutím dat,
- vysvětlením konfliktu zdrojů,
- návrhem dotazů,
- kontrolou kvality dat,
- dokumentací,
- podporou operátora při orientaci v datech.

AI v COP nesmí:

- vybírat cíle,
- prioritizovat cíle pro zásah,
- doporučovat použití síly,
- plánovat útok,
- navádět prostředky,
- poskytovat taktické bojové doporučení.

Popiš:

- provider abstraction,
- AI Gateway,
- prompt templates,
- structured outputs,
- audit,
- guardrails,
- redaction/anonymization,
- human-in-the-loop,
- možnost vypnout externí AI,
- local-only režim.

### 4.7 `docs/ux/01_DELTA_INSPIRED_DESIGN_PRINCIPLES.md`

Popiš DELTA-inspired design pouze na úrovni obecných principů:

- web-first map UI,
- rychlá orientace,
- vrstvy,
- realtime update,
- detail objektu,
- confidence,
- provenance,
- stáří dat,
- konflikt zdrojů,
- degraded/offline režim,
- timeline/replay,
- vysoký kontrast,
- velký situační displej,
- tablet/notebook použitelnost,
- žádné weapon workflow.

### 4.8 ADR

Vytvoř všechny ADR podle struktury.

Každý ADR musí mít:

```md
# ADR-XXXX: Název

## Status
Proposed / Accepted / Deprecated

## Context

## Decision

## Consequences

## Alternatives Considered

## Follow-up Actions
```

---

## 5. Diagramy

Použij Mermaid.

Vytvoř minimálně:

- system context diagram,
- container diagram hlavního COP systému,
- ingest pipeline diagram,
- event-driven architecture diagram,
- simulator-to-COP sequence diagram,
- NATO symbol rendering flow,
- AI provider abstraction diagram,
- COP distribution flow,
- source registry lifecycle diagram.

---

## 6. Quality gates

V `docs/04_QUALITY_GATES.md` definuj:

- všechny dokumenty musí být nalinkované z indexů,
- každý adresář musí mít `00_INDEX.md`,
- OpenAPI musí být validní YAML,
- JSON Schema musí být validní JSON,
- Mermaid diagramy musí být syntakticky validní,
- ADR musí být číslované,
- každá změna integračního kontraktu musí mít verzi a ADR,
- každá AI změna musí popsat bezpečnostní dopad,
- každá bezpečnostní změna musí aktualizovat threat model nebo risk register,
- žádné zásadní TBD bez zápisu do `docs/06_OPEN_QUESTIONS.md`.

---

## 7. Po dokončení vypiš

Na konci práce vypiš:

1. seznam vytvořených souborů,
2. stručné shrnutí architektury,
3. klíčová rozhodnutí,
4. otevřené otázky,
5. doporučený další prompt pro implementaci skeletonu COP aplikace,
6. doporučený další prompt pro vytvoření contract testů proti SIM projektu.

---

## 8. Pracovní postup

1. Zkontroluj aktuální složku projektu.
2. Načti `docs/zadani_codex_hlavni_cop_system_ai_delta_v1.md`.
3. Vytvoř dokumentační strom.
4. Vytvoř indexy.
5. Vytvoř architekturu.
6. Vytvoř integration contract v1.
7. Vytvoř OpenAPI skeleton.
8. Vytvoř JSON Schema skeletony.
9. Vytvoř AI dokumentaci.
10. Vytvoř UX dokumentaci.
11. Vytvoř security dokumentaci.
12. Vytvoř ADR.
13. Zkontroluj konzistenci a cross-linky.
14. Vypiš závěrečné shrnutí.

Začni tímto dokumentačním a architektonickým baseline úkolem pro projekt 01 COP.
