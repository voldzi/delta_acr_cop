# 21 COP crisis notifications and ČT24 context

Stav k 10. říjnu 2026: implementovaný kandidát vydání. Nasazené revize,
aktivace workeru a doručení při zavřené aplikaci zatím nejsou doložené v tomto
runbooku. Rozhodnutí: [ADR 0040](../adr/0040_VERIFIED_CRISIS_NOTIFICATIONS_AND_MEDIA_CONTEXT.md).
Kontrakt: [integrace 12](../integration/12_COP_NOTIFICATION_DECISION_AND_PUSH.md).

## Rozsah a předpoklady

- COP API rozhoduje nad ověřenými SIM kandidáty; CSM Messaging doručuje.
- Veřejné mapové vrstvy, zprávy ČT24 a technická varování nejsou záložní zdroj
  pro poplach. Žádné přímé APNs/Web Push volání z COP.
- Zachovat stávající síť, službové tokeny, soukromé zprávy, routing, measurement
  flags, hlasové hovory a jiné aplikace. Release se týká pouze dotčených COP
  služeb a aditivního schématu v dosavadní PostgreSQL.
- Produkce vyžaduje PostgreSQL profilů (`COP_USER_PROFILE_STORE=postgres`,
  případně `auto` s ověřeným runtime `user-profile-store=postgres`),
  `COP_SAFETY_NOTIFICATION_STORE=postgres`, funkční `COP_DATABASE_URL`/TLS,
  primární registry zařízení a dosavadní CSM Messaging konfiguraci. Žádný RAM
  fallback pro souhlas, výběr příjemce nebo deduplikaci.

## Konfigurace workeru

Všechny hodnoty se předávají přes dosavadní chráněnou konfiguraci a Compose;
nepotřebují nový port či secret. Výchozí worker je vypnutý.

| Proměnná | Výchozí | Povolený rozsah / význam |
| --- | ---: | --- |
| `COP_SAFETY_NOTIFICATION_WORKER_ENABLED` | `false` | `true` zapne automatický poller; nepovolí souhlas za uživatele. |
| `COP_SAFETY_NOTIFICATION_STORE` | `postgres` | Produkce musí používat trvalou evidenci. `memory` je pouze izolovaný test. |
| `COP_SAFETY_NOTIFICATION_INTERVAL_MS` | 60000 | 15000–300000 ms, další běh po dokončení předchozího. |
| `COP_SAFETY_NOTIFICATION_PAGE_SIZE` | 50 | 1–100 profilů na stránku. |
| `COP_SAFETY_NOTIFICATION_MAX_PROFILES` | 200 | 1–1000 profilů na běh. |
| `COP_SAFETY_NOTIFICATION_MAX_DISPATCHES` | 50 | 1–200 pokusů o odeslání na běh. |
| `COP_SAFETY_NOTIFICATION_CONCURRENCY` | 2 | 1–4 souběžně zpracovávané profily. |
| `COP_SAFETY_NOTIFICATION_CACHE_MS` | 30000 | 0–60000 ms, pouze připravené úplné kandidáty stejné oblasti. |
| `COP_SAFETY_NOTIFICATION_MAX_RUN_MS` | 30000 | 1000–120000 ms, rozpočet běhu. |
| `COP_SAFETY_NOTIFICATION_RETRY_MS` | 60000 | 15000–300000 ms mezi neúspěšnými intake pokusy. |
| `COP_SAFETY_NOTIFICATION_HYDRO_COOLDOWN_MS` | 3600000 | 60000–86400000 ms pro stejný hydro jev a závažnost. |

Worker drží PostgreSQL advisory lease, používá stránkování podle uloženého
subjektu a při chybách prodlužuje interval nejvýše na pět minut. U každého
profilu zpracuje nejvýše deset zapnutých oblastí a pro každou vyžádá nejvýše
500 podkladových prvků. Limit SIM query signalizuje možnou neúplnost; bez
zdokumentovaného SIM cursoru se žádné další stránky nevymýšlejí. Rozpočet není
garancí pevné latence při vysokém počtu účtů.

SIM spojení používá dosavadní `COP_SAFETY_DATA_ENABLED`,
`COP_SAFETY_DATA_BASE_URL`, `COP_SAFETY_DATA_MAX_LIMIT` a
`COP_SAFETY_DATA_TIMEOUT_MS`. Pro kandidáty neplatí mapový stale-if-error cache.
COP přijímá nejvýše 8 MiB JSON, zakazuje redirect a drží timeout i při čtení
těla. Požaduje nejvýše pět minut starý snapshot a přesnou SIM policy/readiness.
Návrat `ready` se týká konkrétního snapshotu; nepotvrzuje pokrytí celé ČR.

## Účet, zařízení a odvolání

1. Přihlášený uživatel uloží sledovanou oblast a minimální závažnost v profilu.
2. Zaregistruje skutečné zařízení. Browserová permission bez úspěšného
   serverového zápisu do Messaging nestačí. Native musí mít vlastní spárované
   zařízení s registrovaným push tokenem.
3. Explicitně zapne souhlas pomocí
   `PUT /api/v1/me/notifications/safety` s `{"enabled":true}`. Chybějící
   souhlas zůstává vypnutý; obyčejný zápis preferences jej nemůže zapnout.
4. Odvolání používá `{"enabled":false}` a primární úložiště. Výpadek SIM či
   Messaging mu nebrání, výpadek primárního úložiště vrací `503` a vyžaduje retry.

Před odesláním se pod zámkem načítá aktuální souhlas, oblast a zařízení.
Dokončené odvolání předchází každému dalšímu odeslání. Pokud už probíhá příjem
v Messaging, odvolání se s tímto rozhodnutím serializuje; push již přijatý do
Messaging nelze odvoláním stáhnout ze zařízení. Změna účtu nepřenáší souhlas
nebo sledovanou oblast jinému subjektu.

## Evidence, retry a retence

Nové tabulky v dosavadní COP databázi:

- `cop_safety_notification_web_devices`: subjekt, neprůhledné device ID,
  způsobilost a čas změny; žádné subscription klíče či APNs tokeny;
- `cop_safety_notification_deliveries`: pouze per-user incident hash, lease,
  pokusy, platnost, přijetí a odkaz na Messaging notification;
- `cop_safety_notification_cooldowns`: neprůhledný hydro klíč a čas posledního
  přijatého upozornění.

Uložené hash klíče jsou interní pseudonymní provozní evidence, nikoli důkaz
anonymizace. Přístup k databázi zůstává omezený. Nová evidence neukládá text
kandidáta, jeho geometrii, soukromé zprávy ani GPS; uložené sledované oblasti
zůstávají součástí dosavadního uživatelského profilu. Diagnostika workeru
obsahuje stav a souhrnné počty, nikoli těla nebo souřadnice.

Intake lease je tři minuty, neúspěšné pokusy jsou nejvýše pětkrát a jen do
explicitního `validUntil`. Kandidát bez platné konečné expirace se automaticky
neodešle. Worker neukládá celý payload do fronty; po restartu může opakovat
nepřijatý požadavek pouze pokud SIM stále poskytuje příslušný ověřený kandidát.
Přijaté klíče zůstávají chráněné před opakováním.

`acceptedCount` znamená odpověď Messaging `online` s `notificationId` a nejméně
jedním cílovým zařízením. Neznamená úspěch APNs/Web Push, viditelný banner ani
potvrzení uživatele. Po přijetí COP stejný klíč neopakuje; další doručení a
zneplatněné tokeny řeší Messaging. Je nutné ověřit jeho redelivery a dobu
idempotence samostatně. Neprezentovat distribuovanou cestu jako přesně jednou
doručený push bez tohoto důkazu.

Pro nové delivery/cooldown záznamy není v této změně automatické mazání.
Neprovádět úklid auditních či historických záznamů ani smazání tabulek při
rollbacku. Samostatná retenční politika musí chránit deduplikaci a povinnou
evidenci; host storage retention není oprávnění mazat databázový audit.

## ČT24

`GET /api/v1/safety/context/news` vrací pouze informační
`sim-crisis-media-context-v1`. COP čte SIM serverově bez uživatelských tokenů,
omezuje tělo na 1 MiB, nejvýše 20 položek a povoluje pouze dohodnuté ČT24
feedy/HTTPS odkazy. Úspěšný informační snapshot se drží pět minut; po chybě je
60sekundový backoff. Zprávy starší než 24 hodin se ve výpisu neponechávají.

Panel je oddělený od oficiálních výstrah a ukazuje titulek, odkaz, čas
publikace a atribuci „Česká televize / ČT24“. Bez plných článků a videa.
`regionCode` je region feedu, nikoli události. Povinné hodnoty
`informationalOnly=true`, `notificationEligible=false`, `location=null`,
`locationStatus=unresolved` a `eventAt=null` brání odvození mapového bodu či
lokálního poplachu. Výpadek vrací omezený/nedostupný informační stav, nikoli
krizový push.

## Nasazení a rollback

1. Zaznamenejte dosavadní `/srv/cop` Git SHA, skutečná image ID dotčených
   služeb, chráněnou konfiguraci a SIM revizi. Ověřte dohodnutý candidate
   kontrakt/readiness a přístup PostgreSQL; nevypisujte tokeny či `.env`.
2. Proveďte standardní COP release gates. Izolované databázové testy musejí mít
   vyhrazenou testovací databázi; nepoužívat produkční uživatelská data.
3. Dodržte `scripts/deploy-production.sh` a
   [X5 deployment pravidla](19_COP_X5_STORAGE.md). Nasaďte pouze dotčené
   `cop-api` a `cop-web` se zachováním schválených Compose overrides.
   Aditivní tabulky nesmějí přepisovat dosavadní profily.
4. Bez aktivace ověřte health, neprůhlednou identitu, consent endpoint, dry run,
   kandidáty/ČT24 a chování při chybě zdroje. Pokud je záměr aktivovat worker,
   změňte pouze jeho schválený flag a ověřte runtime flag/image, ne jen `.env`.
   Nikomu nezapínejte individuální souhlas serverovým hromadným příkazem.
   Health gate dovoluje pouze výslovně uvedené přidání zdravé/vypnuté dependency
   `safety-notification-worker`; původní dependencies nesmějí zmizet ani se
   zhoršit. `scripts/test-cop-health-gate.py` ověřuje tuto hranici.
5. Zapište do evidence skutečně nasazené revize a důkazy. Živý syntetický push
   smí jít pouze na vyhrazeného, výslovně přihlášeného opt-in testera.

Rollback: nejdříve nastavte `COP_SAFETY_NOTIFICATION_WORKER_ENABLED=false`
a nasaďte dotčené API přes standardní wrapper. Ověřte worker dependency
`disabled`, zachovejte souhlasy a ledger. Poté případně vraťte přesné předchozí
API/web obrazy. Aditivní tabulky ponechte; nedropovat audit, souhlasy ani keys.
Pro opětovné zapnutí proveďte znovu ready/device/consent checks a využijte
stávající deduplikaci. Žádný návrat na mapový fallback, RAM nebo veřejný port.

## Akceptační matice

| Gate | Požadovaný důkaz | Stav tohoto runbooku |
| --- | --- | --- |
| Kontrakt, čas, policy, geometrie | Media/informational/centroid/invalid-time/stale/expiry se neposílají; Polygon holes a MultiPolygon nesmějí použít centroid/bbox jako důkaz. | Lokální automatické ověření; konečný release přehled doplní integrátor. |
| Dva účty, oblasti a zařízení | Nezávislé keys, odlišná relevance, žádný souhlas navíc, více zařízení jen aktuálního příjemce. | Finální integrované a produkční ověření čeká. |
| Odvolání versus odeslání | Dokončené odvolání blokuje další dispatch; již přijatý push je nezvratný. | Test zámků a skutečné DB doplnit; fyzická zkouška čeká. |
| Restart a hydro | Přijaté klíče přežijí restart; stejný hydro stav má cooldown, eskalace nový klíč. | Produkční ověření čeká. |
| SIM/Messaging/primary store outage | `503`/degraded, žádný poplach z chyby nebo tichý RAM fallback; obnova a retry před expirací. | Produkční ověření čeká. |
| ČT24 | Atribuce/odkaz a oddělený panel, nulová lokalizace a push eligibility. | Integrované zobrazení a produkce čeká. |
| Zavřená/zamčená aplikace | Tester doloží banner, čas doručení a otevření správného deep linku na reálném telefonu. | Neověřeno; samotný Messaging intake ani build nestačí. |

Živou zkoušku dohodněte s vyhrazeným testerem a Messaging. Běžné uživatele
nepoužívejte jako testovací publikum a nepodvrhujte oficiální SIM zdroj
produkčním mapovým ingestem. Syntetická zpráva musí být zřetelně označená jako
zkouška, aby nevyvolala dojem skutečné krizové výstrahy.

Konečné předání musí uvést zvlášť implementované a publikované revize,
nasazení/flag, automatické testy, skutečný Messaging intake a fyzické doručení.
Bez tohoto posledního kroku nelze slíbit doručení při zavřené aplikaci.

## Automatické ověření kandidáta 10. října 2026

- Integrovaný cílený výběr: 102 testů v deseti souborech prošlo. Zahrnuje dvě
  identity, recipient keys, oblasti/geometrii, čas/policy/stale/expiry, chyby
  zdroje a dispatch, explicitní souhlas a jeho stale přepsání, zařízení,
  hydro cooldown, samostatné ČT24 a přerušení ukládání profilu při změně účtu.
- Skutečný PostgreSQL 17: izolovaný test souhlasu, souběžných claimů, globální
  lease, odvolání za dispatch lockem, přetrvání accepted keys a cooldownu
  prošel. Použit pouze dočasný vlastní kontejner bez veřejného portu a bez
  přístupu k produkční databázi. Testovací kód a log byly ve spravovaném X5
  staging jobu `job-5cdf15b424094511840468b2ce599ab2`, označeném jako dokončený.
- Čtyři testy deployment health gate prošly. TypeScript, ESLint, sestavení
  API/web, bundle budgets, static runtime, analytická hranice a skeleton
  prošly. OpenAPI: nula chyb a 26 již existujících varování; 11 JSON schémat
  prošlo, YAML byl regenerován ze závazného JSON.
- SIM předal nasazení `d894f0d8804414600a23f8dfa9a4bbf86fda559d` a živé čtení
  po dosavadní interní cestě. COP používá hlavní ČT24 feed přesně `/rss`.

Toto je automatická evidence kandidáta, nikoli fyzická akceptace telefonu.
Produkční COP revision/image, aktivace a živé readback doplní samostatná
sekce po nasazení. Žádný syntetický krizový push nebyl poslán běžným uživatelům.

## Production preservation gate (2026-10-10)

The first candidate was not accepted: the exact health comparison detected the
missing `private-dispatch` dependency. API and web were returned to protected
immutable previous images. No consent was granted and the safety worker remained
disabled. The successful candidate endpoint probe before that rollback is
contract evidence only, not evidence of a completed release.

The integrated release restores the already deployed Dispatch lease, invitation
outbox, self-profile/avatar, vehicle record/odometer/mileage/audit and verified
Matrix identity commits through `d87a51c`. The public web restores approved
analytics v2, public discovery and TikTok source classification through `c7beee2`.
These are preservation changes, not new permissions or expanded collection.

The security/performance candidate is integrated separately from the previous
measurements in runbook 20; the combined release needs its own tests. Its web
runtime contains only the built `dist` and built-in Node static server, runs as
`node`, and directly starts `server.mjs`, preserving the existing production
packaging without shipping build tools or development dependencies. The binding
JSON contract is retained and its YAML compatibility export is regenerated.

Dedicated builder `cop-x5` had lost its container while retaining its own X5
bind cache. It was bootstrapped only after verifying the filesystem UUID, volume
path and builder identity; no shared builder or global Docker storage changed.
Remaining X5 capacity must be rechecked before another build.

## Final integrated local gates (2026-10-10)

Local verification started from `54aa40e2b3a58202595bde65e3e989eb6ff8d047`
with Node 24.20.0 / pnpm 10.34.6. Commands ran sequentially with low process
priority; test runs used at most two workers. Evidence logs use the prefix
`/private/tmp/cop-crisis-integrated-`.

- Frozen offline install, 11 schemas, TypeScript/ESLint and binding OpenAPI
  passed. OpenAPI retains 24 warnings and has zero errors.
- The single full test run recorded **1,580 passed / 8 skipped / 1 failed**.
  The seven skipped files need dedicated PostgreSQL test connections. The sole
  failure was an obsolete static-web fixture expecting generic `/conversation`
  fallback. The restored public-site contract deliberately returns 404 there.
  The fixture now tests supported `/globe` fallback and explicit unknown-path
  404; chat `/chat/conversation` is preserved. A targeted recheck of the whole
  static-server file passed **15/15**. The full suite was not repeated after
  this fixture repair; do not relabel its first recorded result as a full pass.
- All 16 workspace build scripts passed. The web was then rebuilt with
  `VITE_COP_PUBLIC_ANALYTICS_ENABLED=true` and synthetic website ID
  `00000000-0000-4000-8000-000000000001`; that ID is present in the compiled
  public-demo artifact. No browser page or actual collector POST was used.
- Bundle budgets and actual static-runtime smoke passed. Web/chat initial
  static graphs measured **188.0 / 104.9 KiB gzip**, within 250 / 135 KiB;
  initial CSS measured 34.3 / 15.1 KiB, within 35 / 16 KiB. Optional engines
  remain outside the initial graphs. Vite's generic large-chunk warning was
  not hidden and no budget threshold was raised.
- The analytics source/SRI release guard passed under both flag values, and
  again after formatting. This is the **same static guard**: it does not read
  those environment flags and does not prove runtime collection or delivery.
- Full formatting initially identified six restored files. Four owned files
  were reformatted. `.prettierignore` adds only the exact shared-vendor runtime
  and provider-issued Google verification paths; their original bytes remain
  unchanged. This preserves the independently checked SRI and verification
  response rather than reformatting external artifacts. The final full format
  and whitespace checks pass. The existing PWA/public-analytics release tests
  passed **67/67** after formatting; no dedicated discovery test file exists.
- The process fetch guard recorded **zero unexpected external fetch attempts**.
  Local static servers were stopped by their smoke check. Dedicated-database,
  production runtime and physical-phone acceptance remain separate gates.

The four formatted public/style files must be included in the final web build;
the candidate's production images and exact runtime flags are recorded only
after the standard deployment and preservation health gate.

Before replacing COP API, the standard deployment also performs an actual
1-pixel PNG conversion using the native Sharp binary inside the exact Linux
image, with no network, writable root, capabilities or production data. A
failed native conversion stops the release before container replacement.
