# 10 AI Response Playbook And Evals

CSM/COP AI odpovědi se nespravují jako tisíce ručně napsaných textů. Produkční
model je katalog záměrů, datových zdrojů a akčních pravidel, který se ověřuje
velkou eval sadou českých i anglických parafrází.

## Cíl

- uživatel se nemusí trefit do jedné přesné formulace dotazu,
- AI vybere správný COP/SIM zdroj před voláním obecného modelu,
- UI nezobrazuje nesmyslné akce, například navigaci na meteorologickou vrstvu,
- odpověď vždy rozlišuje ověřená data, nejistotu a chybějící informace,
- nové regresní chyby se zachytí testem před nasazením.

## Implementace

Aktivní katalog je v:

- `apps/cop-api/src/ai-response-playbook.ts`
- `apps/cop-api/src/ai-grounded-response.ts`

Katalog obsahuje pravidla `AiResponsePlaybookRule`:

- `intentId` - stabilní identifikátor záměru, například
  `weather.summary.forecast`, `weather.rain.now` nebo `map.nearest.police`,
- `domain` - produktová doména,
- `patterns` - normalizované regexy pro rychlé rozpoznání dotazu,
- `requiredSources` - očekávané zdroje jako `sim-search-data`, `map-search`,
  `routing`, `chat-context`,
- `allowedActions` a `forbiddenActions` - kontrakt pro UI akce,
- `answerContract` - co musí odpověď zmínit a co nesmí domýšlet,
- `evalTemplates` - šablony pro generování eval dotazů.

Chat-agent pipeline v `apps/cop-api/src/server.ts` vkládá playbook do:

- prompt instrukce,
- `context.responsePlaybook`,
- `result.structured.evidence.responsePlaybook`.

Za providerem běží ještě výstupní quality gate. Odmítá chybové odpovědi,
prázdné souhrny a technické řetězce určené jen pro diagnostiku (například
interní názvy vrstev, provider identifikátory, stack trace nebo Matrix error
kódy). Místo nich vytvoří `grounded-playbook-v1` odpověď z autorizovaného COP
kontextu. Stejná ochrana se používá v chatu, situačním souhrnu a vysvětlení
stavu datových zdrojů.

Deterministická odpověď se používá také tam, kde LLM nepřináší hodnotu nebo by
mohl zhoršit bezpečnost: tísňové kontakty, vysvětlení schopností COP AI,
příprava hlášení, stav odesílání zpráv a E2EE obnova. Meteorologické, mapové a
operační dotazy se při dostupných strukturovaných datech odpovídají přímo z
COP/SIM výsledku; model nesmí přepsat naměřené hodnoty ani do UI propustit
technické metadata.

API zároveň filtruje `result.structured.mapActions` podle playbooku. Například
počasí může nabídnout nejvýše jeden mapový odkaz a nikdy trasu, pokud ji
playbook explicitně nepovolí.

COP Chat ukládá zkrácený `responsePlaybook` i do Matrix metadata `cz.cop.ai`.
Renderer jej používá před starší heuristikou: route tlačítko se zobrazí jen
tehdy, když je `route` v `allowedActions` a není ve `forbiddenActions`. Tím je
možné zpětně auditovat, proč odpověď použila konkrétní zdroje a proč byly
některé UI akce povolené nebo zakázané.

## Eval sada

Funkce `buildAiResponsePlaybookEvalCases(10000)` generuje deterministickou
sadu 10 000 dotazů. Nejde o statické odpovědi; jde o pokrytí parafrází, které
musí router zařadit do správného záměru.

Kromě routerové sady mají rizikové záměry samostatné výstupní regresní testy.
Pro obecnou předpověď ověřují výběr strukturované předpovědi před radarovou
odrazivostí, přirozený souhrn a zákaz technických identifikátorů vrstev,
zdrojů a surových souřadnic. Bez určeného místa se neprovádí celorepublikový
radarový fallback; agent si místo vyžádá běžnou otázkou.

Test:

- `apps/cop-api/src/ai-response-playbook.test.ts`
- `apps/cop-api/src/ai-grounded-response.test.ts`
- `apps/cop-api/src/ai-map-search.test.ts`

Ověřuje:

- základní problematické scénáře,
- obecnou předpověď s polohou i bez ní a uživatelsky čitelný fallback,
- map-only akce pro počasí,
- route-capable akce pro navigovatelné objekty,
- 10 000 generovaných dotazů se vrací na očekávaný intent,
- sada má vysokou unikátnost formulací.

## Pravidla rozšiřování

1. Nepřidávat ručně odpověď pro jeden screenshot.
2. Přidat nebo upravit intent pravidlo.
3. Přidat eval šablony a očekávané akce.
4. Spustit playbook test a relevantní integrační test.
5. Pokud záměr mění API/UI kontrakt, aktualizovat dokumentaci a případně
   OpenAPI.

## Aktuální domény

- počasí: souhrnná předpověď, déšť, bouřka, radar, teplota, vítr,
- voda a povodně: hladina, průtok, riziko záplavy,
- mapa: policie, zdravotní pomoc, kryt,
- mapa: hasičská stanice a veřejně dostupný AED,
- doprava,
- aktivní požár a požární riziko,
- infrastruktura,
- navigace,
- aktivní výstrahy, situační souhrn a komunitní hlášení,
- zdraví a čerstvost datových zdrojů,
- chat, notifikace, čekající/duplicitní odeslání a E2EE obnova,
- PWA/offline stav,
- poloha zařízení,
- hlášení.

## Bezpečnostní hranice

Playbook neurčuje pravdu o situaci. Určuje, jaké zdroje se mají použít a jaké
akce smí UI nabídnout. AI stále musí citovat data a nesmí obejít RBAC/ABAC,
klasifikaci, audit ani pravidla human review pro state-changing návrhy.
