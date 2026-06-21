# 02 Provider Abstraction

AI Gateway vystavuje jednotné rozhraní pro `openai`, `codex`, `ollama`, `local` a `mock` providery.

`ollama` je primární server-side local-only provider vlastněný COP API. Volá
Ollama runtime přímo ze serveru a žádný modelový endpoint ani servisní token
nevystavuje webovému ani nativnímu klientovi.

`local` je kompatibilní fallback přes AI KnowledgeBase LLM Gateway. Používá se
jen v prostředích, kde je výhodné sdílet jeden gateway s dalšími aplikacemi,
nebo jako dočasná migrační cesta.

## Společný contract

- `providerId`,
- dostupnost a health,
- podporované use-cases,
- podporované output formáty,
- maximální datová klasifikace,
- požadavky na redaction,
- audit metadata,
- schopnost structured outputs,
- schopnost tool calling jen pro approved tools.

Provider router vybírá provider podle policy, konfigurace, klasifikace dat, dostupnosti a uživatelského oprávnění.

Výchozí produkční pořadí pro `auto` je:

1. explicitně nakonfigurovaný dostupný provider,
2. `ollama`,
3. `local`,
4. `mock`.
