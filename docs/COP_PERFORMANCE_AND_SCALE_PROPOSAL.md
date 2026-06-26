# COP — Engineering Playbook: profesionální výkonná aplikace pro tisíce uživatelů

> **Účel.** Tohle není esej. Je to **prováděcí příručka**: vývojář ji vezme a podle
> ní krok po kroku dovede COP (cop-web, cop-chat, cop-api) k produkčně robustní,
> maximálně výkonné aplikaci pro **tisíce souběžných uživatelů**. Každý úkol má
> *proč, kde, jak, hotovo-když (DoD) a jak ověřit*.
>
> **Status:** návrh/roadmap. Po schválení se klíčová rozhodnutí překlopí do
> `docs/adr/`. Změny API → vždy aktualizovat `openapi/openapi.json` + dokumentaci
> ve stejné změně (viz `CLAUDE.md`).

---

## 0. Jak pracovat (závazný režim)

1. **Větev → malý commit → ověření → merge.** Jeden logický krok = jeden
   revertovatelný commit. Nikdy přímo na `main` bez větve.
2. **Záchytná síť napřed.** Před každou strukturní změnou napiš charakterizační
   nebo E2E test, který zafixuje *současné* chování. (Poučení: regrese
   `content-visibility` na mobilu prošla 310 unit testy — protože layout/mobil
   nikdo netestoval.)
3. **Brány po každém kroku:** `pnpm lint` → `pnpm test` → `pnpm build`. Pro kontrakt
   `pnpm test:contracts`, pro strukturu `bash scripts/validate-skeleton.sh`,
   pro API `pnpm validate:openapi` + `pnpm validate:schemas`.
4. **Nasazení po krocích.** Feature větev → ff-merge `main` → push → na hostu
   `git pull` + `docker compose up -d --build <služba>` → health check. Žádný
   velký „big bang".
5. **Měř, neodhaduj.** Před a po každém výkonovém zásahu zaznamenej číslo (React
   Profiler commits, bundle size, p95, počet SSE/instance).

---

## 1. Principy a konvence (závazné pro veškerou práci)

- **Žádný soubor > ~800 ř., žádná komponenta > ~300 ř.** (dnes: `main.tsx`
  15 008 ř., `server.ts` 10 768 ř., `ChatApp.tsx` ~6 000 ř., `CopMap.tsx` 8 437 ř.).
- **Stav patří co nejníž.** Často-měnící stav (text, hover, kreslení, výběr) drž
  lokálně v listové komponentě, ne v kořeni.
- **Stabilní reference.** Handlery předávané memoizovaným komponentám přes
  `useEventCallback`/`useCallback`. Žádné inline arrow funkce do těžkých dětí.
- **Data přes jednu vrstvu** (TanStack Query): cache + dedup + `AbortController`.
  Žádný ruční `fetch` v komponentě bez zrušení.
- **API stateless.** Žádný stav, který musí přežít mezi requesty, v paměti procesu.
- **Degraduj, nepadej.** Každý upstream má timeout + fallback; přetížení → 503
  s `Retry-After`, ne pád.
- **Bezpečnost defaultně.** Allow-list CORS, rate-limit, bezpečnostní hlavičky,
  tokeny nikdy do logu.
- **Vše s testem a metrikou.** Co nemá test, považuj za rozbité; co nemá metriku,
  považuj za neviditelné.

---

## 2. Cílové SLO a jak je měřit

| Oblast | Cíl | Jak měřit (brána) |
|---|---|---|
| Souběžní uživatelé | 5 000 session / 2 000 SSE | k6 load test |
| TTI (mobil, 4G) | < 3,5 s | Lighthouse CI, RUM (web-vitals) |
| Kritický JS bundle | < 250 kB gzip | bundle budget v CI |
| Interakce | 60 fps, mapa 0 re-renderů při nesouvisející změně | React Profiler, INP (RUM) |
| API latence | p95 < 200 ms / p99 < 800 ms | Prometheus histogram per route |
| SSE | < 1 s doručení, reconnect < 5 s, ≥ 1 000 streamů/instance | k6 + `cop_stream_clients_total` |
| Cache hit-rate | ≥ 90 %, nezávislé na počtu instancí | `cop_*_cache_requests_total` |
| Render chyby | 100 % → fallback (žádná bílá obrazovka) | error boundary + Sentry-like |
| Pod zátěží | 0 OOM/pádů při 2k SSE | k6 + `under-pressure` metriky |

---

## 3. Současný stav (podloženo)

### Frontend
- `apps/cop-web/src/main.tsx` — **15 008 ř.**, `App()` ~4 600 ř.,
  **167 `useState`, 52 `useEffect`, 46 `useMemo`, 31 `useCallback`**.
- `CopMap` ([main.tsx:4341](apps/cop-web/src/main.tsx:4341)) — **58 propsů včetně
  inline arrow handlerů** (`onSelectObject={(o) => {…}}`, `onClearSelection={() => {…}}`),
  **bez `React.memo`** → překresluje 8 437ř. mapu na každou změnu kteréhokoli
  ze 167 stavů.
- **Chybí error boundary** ([main.tsx:14997](apps/cop-web/src/main.tsx:14997) je jen
  `StrictMode` + `Suspense`).
- i18n napůl: `language` stav existuje, stringy hardcoded česky.
- `cop-chat/ChatApp.tsx` ~6 000 ř. — perf jádro už zlepšeno (viz §6 „Hotovo").

### Backend
- `apps/cop-api/src/server.ts` — **10 768 ř.**
- SSE ([server.ts:5023](apps/cop-api/src/server.ts:5023)) je **dobře navržené per-spojení**:
  `streamBroadcaster.subscribe()`, heartbeat 15 s, `createBackpressure`, `retry: 5000`,
  `id:` (Last-Event-ID), `x-accel-buffering: no`, per-subject `filterStreamMessage`.
  **Jediná škálovací mezera: `streamBroadcaster` je in-process** — události
  vyprodukované na instanci A se nedostanou ke klientům na instanci B.
- Cache s **in-flight coalescingem** + Prometheus statistikami (situation/safety/tak) — dobře.
- Perzistence: Postgres store pro community reports; ale i **in-memory `Map`** stav
  v `server.ts` → blokuje horizontální škálování.
- `register(cors, { origin: true })` — odráží libovolný Origin.
- **Chybí:** rate-limit, helmet, komprese, under-pressure.
- `/metrics` (Prometheus) existuje.

### Doručování
- Single host `docker.home.cz`, `docker compose up -d --build` (staví na hostu,
  recreatuje i závislosti). Žádný LB, multi-instance, CDN → **SPOF**.

### Co je dobře (nerozbít)
Odolný `load()` + offline snapshot + operating-mode (ONLINE/DEGRADED/OFFLINE);
polling vázaný na stream a viditelnost; SSE backpressure/heartbeat/reconnect;
backend cache coalescing; `@cop/messaging` + bridge s testy; lazy-load
`TrackTable`/`XrWorkspace`.

---

## 4. Znovupoužitelné vzory (kopíruj a aplikuj)

### 4.1 Error boundary (React)
```tsx
class AppErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: unknown) { reportError(e); } // → telemetry
  render() {
    return this.state.hasError
      ? <RecoverableFallback onReload={() => location.reload()} />
      : this.props.children;
  }
}
```
Mountuj kolem `App()` i `ChatApp()` (cop-chat hotovo).

### 4.2 Stabilní handler (proti re-renderům dětí)
```tsx
function useEventCallback<A extends unknown[], R>(fn: (...a: A) => R) {
  const ref = React.useRef(fn);
  React.useLayoutEffect(() => { ref.current = fn; });
  return React.useCallback((...a: A) => ref.current(...a), []);
}
```
*(Už existuje v `cop-chat/ChatApp.tsx` — povýšit do `@cop/ui` a sdílet.)*

### 4.3 Memoizace těžkého podstromu
```tsx
const CopMapMemo = React.memo(CopMap);
// volání: všechny handlery přes useEventCallback, hodnoty seskupené do
// memoizovaných objektů (useMemo), žádná inline arrow/objekt v JSX.
```

### 4.4 Doménový hook (rozbití kořenového stavu)
```tsx
function useMapView(initial) {
  const [view, setView] = React.useState(initial);
  const [bounds, setBounds] = React.useState(null);
  // … jen mapový stav + odvozeniny; vrací stabilní API
  return React.useMemo(() => ({ view, bounds, setView, setBounds }), [view, bounds]);
}
```

### 4.5 Datová vrstva (TanStack Query)
```tsx
const { data, isLoading } = useQuery({
  queryKey: ["situationDetail", featureId],
  queryFn: ({ signal }) => fetchSituationDetail(apiBase, token, featureId, signal),
  staleTime: 30_000,
});
```
Nahradí ruční `fetch` v kartách (dnes bez cache/abortu → race + zbytečné requesty).

### 4.6 SSE fan-out adaptér (klíč k horizontálnímu škálování)
`streamBroadcaster` nech beze změny per-spojení; jen mu **zdroj událostí** napoj
na sdílenou sběrnici:
```ts
interface StreamBus {
  publish(message: CopStreamMessage): Promise<void>;   // producent (1×)
  subscribe(onMessage: (m: CopStreamMessage) => void): () => void; // každá instance
}
// Redis: publish → PUBLISH cop:stream …; subscribe → SUBSCRIBE cop:stream
// (nebo NATS — už je v kandidátních službách). Lokálně InProcessBus pro dev.
```
Každá instance se přihlásí k busu a přeposílá svým SSE klientům přes stávající
`streamBroadcaster.subscribe(writeMessage)`.

Aktuální implementovaný první krok: `COP_STREAM_BUS=memory` zachovává lokální
doručení a `COP_STREAM_BUS=postgres` používá existující `COP_DATABASE_URL`,
tabulku `cop_stream_bus_events` a `LISTEN/NOTIFY`. Díky tomu není potřeba zavádět
Redis/NATS dřív, než bude skutečně nutný samostatný message broker.

---

## 5. Workstreamy (konkrétní úkoly)

### WS1 — Výkon frontendu

| # | Úkol | Kde | Jak | DoD / ověření |
|---|---|---|---|---|
| 1.1 | Memoizovat `CopMap` | [main.tsx:4341](apps/cop-web/src/main.tsx:4341), `CopMap.tsx` | `React.memo(CopMap)`; všech ~58 propsů stabilizovat: handlery → `useEventCallback`, hodnoty → seskupit do `useMemo` objektů | React Profiler: změna nesouvisejícího stavu (např. `mobileSheet`) → **0 commitů** `CopMap` |
| 1.2 | Memoizace karet/boardů | `SelectedSituationDataCard`, `*Board`, `*Summary` | `React.memo` + stabilní propsy | Profiler: výběr prvku nepřekresluje ostatní karty |
| 1.3 | Datová vrstva karet | situation karty | TanStack Query (4.5) | žádný request při unmountnuté kartě; abort při přepnutí prvku |
| 1.4 | Code-split per workspace/feature | `App()` render | `React.lazy` + `Suspense` na map/data/alerts/replay/settings | kritický bundle < 250 kB gzip (CI budget) |
| 1.5 | Izolovat sketch/draw stav | sketch feature | lokální stav v sketch komponentě, ne v `App()` | tah štětcem nepřekresluje `App()` |

### WS2 — Architektura frontendu

| # | Úkol | Jak | DoD |
|---|---|---|---|
| 2.1 | Rozbít stav do domén | viz §9 mapa domén → `useAuthSession`, `useLiveSituation`, `useMapView`, `useMapCatalog`, `useSituationLayers`, `useSafetyLayers`, `useWeatherRadar`, `useReplay`, `useWorkspaceUI` | změna v jedné doméně nepřekresluje ostatní (Profiler) |
| 2.2 | Feature-moduly | `features/{map,situation,community-report,incidents,alerts,sketch,messaging-host,replay,settings}` | žádný soubor > 800 ř.; `App()` = orchestrátor + router |
| 2.3 | `@cop/core` | **Hotovo pro `auth.ts` + `cop-data.ts`:** cop-chat importuje `@cop/core`, cop-web má kompatibilní re-exporty. Navazující krok: postupně přesunout další sdílené browser/API kontrakty, pokud se objeví mimo cop-web. | žádné `../../cop-web/src` v cop-chat; `pnpm lint/test/build` zelené |
| 2.4 | `@cop/ui` | sdílené primitivy: `Dialog` (focus-trap, `aria-modal`), `StatusBanner`, `Avatar`, `useEventCallback` | jeden zdroj UI; a11y v jednom místě |
| 2.5 | Dokončit rozbití `ChatApp.tsx` | `components/` + `hooks/` (`useMatrixSession`, `useChatRouting`, `useChatPreferences`) | žádná komponenta > 300 ř. |

### WS3 — Škálovatelnost backendu

| # | Úkol | Kde | Jak | DoD |
|---|---|---|---|---|
| 3.1 | SSE fan-out přes sběrnici | [server.ts:5023](apps/cop-api/src/server.ts:5023), `streamBroadcaster` | `StreamBus` adaptér (4.6) — Redis/NATS; producent publikuje 1×, instance přeposílají | událost z instance A dorazí klientovi na instanci B; k6: 2 instance × 1 000 SSE |
| 3.2 | Bezestavovost API | in-memory `Map` v `server.ts` | přesunout sdílený stav do Postgres/Redis | restart/rolling instance neztratí stav; lze spustit N instancí |
| 3.3 | Sdílená cache | situation/safety/tak cache | Redis backend, zachovat in-flight coalescing | hit-rate ≥ 90 % nezávisle na počtu instancí |
| 3.4 | Hardening pluginy | bootstrap (`register`) | `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/compress`, `@fastify/under-pressure` | rate-limit na auth/search/upload/stream; 503 s `Retry-After` pod tlakem; gzip na GeoJSON |
| 3.5 | CORS allow-list | [server.ts:573](apps/cop-api/src/server.ts:573) `origin:true` | allow-list z env (`COP_*_ALLOWED_HOSTS`) | žádný odraz cizího Originu |
| 3.6 | Upstream timeouts + breaker | SIM/safety/weather adaptéry | timeout + circuit-breaker → degradovat | upstream výpadek = DEGRADED, ne zaseknutí |
| 3.7 | DB škálování | community-report-store, pool | ověřit `instances × pool ≤ max_connections`; indexy na horké dotazy; read-replica pro čtení | load test bez vyčerpání spojení |

### WS4 — Odolnost a provoz

| # | Úkol | DoD |
|---|---|---|
| 4.1 | Error boundary v cop-web (4.1) | render chyba → fallback, ne bílá stránka |
| 4.2 | Operating-mode jako explicitní FSM s testy | přechody ONLINE↔DEGRADED↔OFFLINE pokryté testy |
| 4.3 | Graceful shutdown | drain SSE + dokončit in-flight při SIGTERM → bezvýpadkový rolling deploy |
| 4.4 | Readiness rozšířit o Redis/bus | `/health/ready` selže, když chybí sběrnice |

### WS5 — Doručování a infrastruktura

| # | Úkol | DoD |
|---|---|---|
| 5.1 | Multi-instance API za LB (HAProxy/Traefik) | odstraněn SPOF; rolling deploy bez výpadku |
| 5.2 | CI staví image → registry; host jen `pull` | žádný build na produkčním hostu |
| 5.3 | CDN před statické assety (immutable cache) | TTI měřitelně níž; origin odlehčen |
| 5.4 | Autoscaling dle metrik (SSE klienti, event-loop lag) | škálování nahoru/dolů automaticky |

### WS6 — Observabilita, kvalita, bezpečnost

| # | Úkol | DoD |
|---|---|---|
| 6.1 | **Playwright E2E s mobilním viewportem** | toky: login→mapa→vrstvy; nahlásit+upload; embedded chat→composer→odeslat; sdílení polohy→centrování mapy. Zelené před každým mergem |
| 6.2 | Load testy (k6): 2 000 SSE + dashboard | p95/p99, event-loop lag, paměť v limitu; 0 pádů |
| 6.3 | RED metriky per route + RUM (web-vitals) | Prometheus histogramy; LCP/INP/CLS z reálných uživatelů |
| 6.4 | Distribuované tracing (OTel) web→api→upstream | jeden trace přes hranice služeb |
| 6.5 | Bundle budget + Lighthouse v CI | regrese velikosti/výkonu blokuje merge |
| 6.6 | Vizuální regrese embedded mobilního chatu | layout regrese zachycena v CI |
| 6.7 | Reálná i18n vrstva (`t()` + katalog) | žádné hardcoded stringy v JSX |
| 6.8 | A11y: focus-trap, `aria-modal`, reduced-motion, klávesnice | audit projde |

---

## 6. Exekuční plán (pořadí a závislosti)

**Hotovo (východisko):** cop-chat perf (coalescing eventů, `React.memo` řádků +
stabilní handlery, izolace composeru, error boundary, oprava stale closure, lehký
seznam chatů); `@cop/messaging` + bridge s testy.

**Fáze 1 — Stabilizace a rychlé výhry** *(nízké riziko, vysoký dopad; lze paralelně)*
- WS1.1 (memo `CopMap`), WS4.1 (error boundary), WS6.1 (mobilní E2E),
  WS3.4 + WS3.5 (hardening + CORS), **hotfix composeru** (§7).
- *Brána fáze:* E2E zelené, mapa 0 re-renderů, API hardening v provozu.

**Fáze 2 — Škálovatelnost backendu** *(nutné dřív než přijdou tisíce uživatelů)*
- WS3.1 (SSE bus), WS3.2 (stateless), WS3.3 (sdílená cache), WS5.1 (multi-instance + LB),
  WS6.2 (load testy jako brána).
- *Brána:* k6 2 000 SSE přes ≥ 2 instance bez pádu, lineární škálování.

**Fáze 3 — Modularizace** *(velká, ale po Fázi 1–2 bezpečná s testy)*
- WS2.1–2.5 (domény, feature-moduly, `@cop/core`, `@cop/ui`, dokončení ChatApp),
  WS1.4 (code-split), WS1.5 (sketch izolace).
- *Brána:* žádný soubor > 800 ř.; změna domény nepřekresluje ostatní.

**Fáze 4 — Globální výkon a profesionalizace**
- WS5.2–5.4 (CI build, CDN, autoscaling), WS6.3–6.8 (tracing, RUM, SLO, i18n, a11y,
  vizuální regrese), WS3.6–3.7 (breakers, DB škálování).
- *Brána:* SLO z §2 splněné a měřené v dashboardu.

---

## 7. Akutní hotfix — composer na mobilu (před Fází 1)

**Problém:** embedded `.conversation-pane { position: fixed; inset: 0; height: 100dvh }`
([cop-chat styles.css:138](apps/cop-chat/src/styles.css:138)) — `100dvh`/`fixed`
uvnitř iframu na iOS přetéká reálnou výšku iframu → composer (spodní flex prvek)
je odříznutý (pod chatem prosvítá mapa).
**Oprava (cop-chat only):**
1. `html, body, #root { height: 100% }` (dnes jen `min-height` → procenta se nepropisují).
2. Embedded panel `position: absolute; inset: 0; height: 100%` uvnitř
   `.wa-shell.embedded { position: relative; height: 100% }` — výška vázaná na reálný
   box iframu, ne na `dvh`. Cílit **jen na `.embedded`** (standalone `/chat/` funguje).
3. `padding-bottom: env(safe-area-inset-bottom)` na composer (iOS home indikátor).
**Ověření:** WS6.1 E2E na iPhone presetu — composer viditelný, odeslání funguje.

---

## 8. Definition of Done (globální)

Úkol je hotový, až: má test (unit/charakterizační nebo E2E) · prošel `lint`+`test`+
`build` · má metriku, pokud mění výkon/chování · je v samostatném revertovatelném
commitu · neporušil `validate-skeleton`/OpenAPI · dokumentace/ADR aktualizovány,
pokud mění API/konfiguraci/kontrakt.

---

## 9. Příloha A — Mapa stavu `App()` → doménové hooky

| Doména (hook) | Stavy (výběr z 167 `useState`) |
|---|---|
| `useAuthSession` | authSession, authRefreshRetry, authDiagnostics |
| `useLiveSituation` | objects, sources, sourceHealth, streamHealth, serverAlerts, health, lastLoadedAt, loadError, isLoading, streamStatus, streamTelemetry, streamReconnectAttempt, browserOnline, offlineSnapshotState |
| `useRefreshConfig` | autoRefresh, refreshSeconds, trackHistoryLimit, trackHistoryWindowSeconds, trackHistory |
| `useMapView` | mapView, mapBounds, focusViewRequest, autoFit |
| `useMapControls` | mapClusterEnabled, mapBasemapMode, showHistory, showPrediction, predictionMinutes, predictionMode, trackHistoryDisplayMode, publicFlightSymbolMode, showAlertAreas |
| `useMapCatalog` | mapCatalog, activeCatalogGroupId, visibleCatalogLayerIds, selectedLayer, visibleTrackLayerIds |
| `useSituationLayers` | situationLayers, situationSources, visibleSituationLayerIds, visibleSituationSourceIds, situationFeatures, situationStatus, situationWarnings, coverageTechnology, situationRasterRefreshTick, weatherWebcamDetailCache |
| `useWeatherRadar` | weatherRadarFrames, weatherRadarFrameIndex, weatherRadarFrameCatalogTick, weatherRadarPlaybackEnabled, weatherRadarPlaybackStatus |
| `useSafetyLayers` | safetyLayers, visibleSafetyLayerIds, safetyFeatures, safetyStatus, safetyWarnings, safetySources |
| `useFilters` | includeSynthetic, minConfidence, affiliationScope, domainScope, searchQuery, selectedObjectId, selectedSituationFeatureId |
| `useZones` | zoneCreationMode, editingZoneId, aoiRules |
| `useReplay` | replayRunning, replayPosition |
| `useWorkspaceUI` | activeWorkspace, mobileSheet, mobileSketchOpen, workspaceResizeActive, workspaceLayout, workspaceSkin, operatorProfile, helpSection, settingsOpen, settingsTab, language |
| `usePlaceSearch` | placeSearchItems, placeSearchLoading, placeSearchError, mapSearchQuery, mapSearchDocked |
| `useDemo` | demoScenario, demoScenarioBusy, demoScenarioError |

## 10. Příloha B — Skupiny propsů `CopMap` (pro memoizaci)

- **Data (memoizované objekty):** objects/visibleObjects, alerts, situationFeatures,
  trackHistory, aoiRules.
- **Výběr (primitiva):** selectedObjectId, selectedSituationFeatureId, editingZoneId.
- **Zobrazení (primitiva):** showHistory/Prediction, predictionMinutes/Mode,
  clusterTracks, mapBasemapMode, alertRadiusKm, autoFit, trackHistoryDisplayMode.
- **Řízení (memoizované požadavky):** focusView, focusViewRequest,
  focusUserLocationRequest, initialView, mapInteractionSuspended, mapResizeSuspended.
- **Handlery (všechny `useEventCallback`):** onBoundsChange, onSelectObject,
  onSelectSituationFeature, onClearSelection, onAutoFitChange, onCreate/UpdateZonePolygon,
  onCancelZoneCreation/Editing, onPickReportLocation, onCreate/DeleteSketchDrawing.

## 11. Příloha C — Rizika → metriky

| Riziko dnes | Metrika | Cíl |
|---|---|---|
| Re-render mapy | Profiler commits / interakce | 0 při nesouvisející změně |
| SSE single-proc | streamy/instance | ≥ 1 000, lineární přes bus |
| Per-instance cache | hit-rate při N instancích | ≥ 90 % |
| Bílá obrazovka | render chyby zachycené | 100 % → fallback |
| Mobile regrese | E2E mobilní toky | zelené před mergem |
| Přetížení | 503 z under-pressure vs. pády | 0 OOM/pádů @ 2k SSE |
| Bundle drift | kB gzip kritická cesta | < 250 kB, hlídáno v CI |
