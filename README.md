# ACR COP Data Fabric / SITDATA-COP

Implementační skeleton hlavního COP systému. Projekt navazuje na dokumentační baseline v `docs/` a připravuje samostatný COP monorepo skeleton pro lokální pilot.

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

Systém je situační datová platforma. Nepřidává targeting, navádění, řízení zbraní, doporučování použití síly ani autonomní operační rozhodování.
