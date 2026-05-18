# 03 Environment Configuration

Environment configuration musí oddělit vývoj, test, demo a produkční režim.

## Kategorie proměnných

- API porty a base URLs,
- database/cache/event bus connection strings,
- OIDC issuer/client configuration,
- Source Registry bootstrap,
- AI provider enable/disable flags,
- classification policy,
- audit retention,
- metrics/exporter nastavení,
- feature flags pro degraded/offline režim.

Citlivé hodnoty nesmí být commitované do repozitáře.
