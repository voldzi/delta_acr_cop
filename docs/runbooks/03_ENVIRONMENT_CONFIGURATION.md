# 03 Environment Configuration

Environment configuration musí oddělit vývoj, test, demo a produkční režim.

## Kategorie proměnných

- API porty a base URLs,
- database/cache/event bus connection strings,
- OIDC issuer/client configuration,
- Source Registry bootstrap,
- AI provider enable/disable flags,
- track lifecycle thresholds (`COP_TRACK_STALE_AFTER_MS`, `COP_TRACK_EXPIRE_AFTER_MS`),
- temporal history persistence (`COP_TRACK_HISTORY_STORE`, `COP_DATABASE_URL`, `COP_DATABASE_SSL`),
- user profile persistence (`COP_USER_PROFILE_STORE`, volitelně stejný `COP_DATABASE_URL` jako temporal store),
- stream distribution limits (`COP_STREAM_BACKPRESSURE_CLIENTS`, `COP_STREAM_RETRY_MS`),
- classification policy,
- audit retention,
- metrics/exporter nastavení,
- feature flags pro degraded/offline režim.

Citlivé hodnoty nesmí být commitované do repozitáře.
