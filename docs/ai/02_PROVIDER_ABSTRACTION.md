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
Nad `ollama` providerem běží samostatný model router `deterministic-v1`, který
volí konkrétní lokální modelový profil:

- `fast`: výchozí rychlý model pro běžné dotazy, krátké shrnutí a UI dialogy,
- `reasoning`: větší model pro konfliktní analýzu, širší situační souhrny,
  vícezdrojové porovnání, predikční otázky a delší chatový kontext,
- `embedding`: embedding model pro retrieval/RAG nad policy-filtered COP entitami
  a consentovanou chat pamětí; klienti ho nikdy nevolají přímo.

Router používá deterministické scoring pravidlo nad účelem dotazu, délkou
promptu, velikostí kontextu, počtem objektů/výstrah/incidentů/zpráv a výrazy
typu konflikt, predikce, dopad, riziko nebo situational awareness. Rozhodnutí
se vrací jako volitelné `routing` metadata v AI odpovědi a zapisuje se do
auditu bez promptu a bez kontextu.

Semantic context vrstva běží až po policy filtraci v aplikačních AI endpointech.
Neindexuje globálně všechna surová data do LLM dotazu; z aktuálně oprávněného
kontextu vytvoří malé dokumenty, použije `bge-m3` pro podobnost k dotazu a do
LLM vloží jen top-N výsledků s metadaty zdroje.

Před voláním provideru se nad stejnými výsledky použije evidence-first prompt
compression. LLM dostane `contextCompression`, citované/top-N semantic a indexed
položky bez raw payloadů a jen omezené podpůrné záznamy, které jsou citované
nebo krizově relevantní. Plné počty a evidence metadata se vracejí klientovi
odděleně, takže komprese neznamená změnu oprávnění ani ztrátu auditovatelnosti.

Výchozí produkční pořadí pro `auto` je:

1. explicitně nakonfigurovaný dostupný provider,
2. `ollama`,
3. `local`,
4. `mock`.
