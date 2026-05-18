# 02 Provider Abstraction

AI Gateway vystavuje jednotné rozhraní pro `openai`, `codex`, `local` a `mock` providery.

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
