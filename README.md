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

## Pilot na docker.home.cz

Pilotní compose soubor používá porty `4310` a `4311`. Před nasazením na serveru ověř obsazené porty podle runbooku v `docs/runbooks/04_RUNNING_MAIN_COP.md`.

## Bezpečnostní hranice

Systém je situační datová platforma pro civilní informování a ochranu osob. Nepřidává targeting, navádění, řízení zbraní, doporučování použití síly ani autonomní operační rozhodování.
