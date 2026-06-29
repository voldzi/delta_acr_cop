# Civilní situační mapa

Implementační skeleton civilní situační mapy pro zobrazení rizik v okolí, výstrah, zdrojových vrstev a budoucích komunitních hlášení uživatelů.

## Stack

- pnpm workspace,
- TypeScript,
- Fastify API,
- React/Vite web klient,
- Vitest contract/unit testy,
- Docker Compose pilot profile.

## Lokální spuštění

```bash
pnpm install
pnpm check
pnpm dev
```

Výchozí porty:

- API: `http://localhost:4310`
- Web: `http://localhost:4311`
- Chat: `http://localhost:4314/chat/`

## Pilot na docker.home.cz

Pilotní compose soubor používá porty `4310`, `4311` a `4314`. Před nasazením na serveru ověř obsazené porty podle runbooku v `docs/runbooks/04_RUNNING_MAIN_COP.md`.

## Dokumentace

Standardní rozcestník dokumentace je v `docs/README.md`. Nové vstupní dokumenty mapují existující detailní dokumentaci:

- architektura: `docs/architecture.md`,
- API: `docs/api.md`,
- bezpečnost: `docs/security.md`,
- provoz: `docs/operations.md`,
- observability: `docs/observability.md`,
- runbook: `docs/runbook.md`.

Autoritativní OpenAPI kontrakt je `openapi/openapi.json`. Soubor `docs/api/openapi-main-cop.yaml` je jen generovaný YAML export pro čitelnost a kompatibilitu nástrojů.

## Validace

```bash
bash scripts/validate-skeleton.sh
pnpm validate:schemas
pnpm validate:openapi
pnpm lint
pnpm test
pnpm build
pnpm check:bundles
```

## Bezpečnostní hranice

Systém je situační datová platforma pro civilní informování a ochranu osob. Nepřidává targeting, navádění, řízení zbraní, doporučování použití síly ani autonomní operační rozhodování.
