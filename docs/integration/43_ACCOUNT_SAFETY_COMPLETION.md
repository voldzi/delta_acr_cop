# 43 Dokončení hranic účtu a instalace — kandidát, bez aktivace

Stav k 11. 10. 2026: zdrojová příprava navazuje na produkční COP `e994012`.
Nezapíná hlášení, odpojení ani odstranění účtu. Zachovává přesný HTTP 200
doklad smazání měření SIM; HTTP 202 nadále znamená čekající práci.

## Samostatná identita Jízdy

Připravený vypnutý manifest je
`scripts/keycloak/jizda-mobile-client.candidate.json`. Má veřejného klienta
`jizda-mobile`, výhradní callback `jizda-cop://oauth/callback`, autorizační
kód s PKCE S256 a vypnuté implicitní, password a service-account granty.
Manifest má prázdné scopes a žádné role; před použitím musí vlastník identity
schválit přesně potřebné stávající mappers/scopes. Nejde o nasazeného klienta.
[Keycloak popisuje veřejné klienty a PKCE v oficiální dokumentaci](https://www.keycloak.org/docs/26.5.7/server_admin/index.html).

Pro aktivovaný dedicated build jsou společně závazné:

- `CSMAppScope=jizda_app_link`;
- `CSMOIDCClientId=jizda-mobile`;
- `CSMOIDCRedirectScheme=jizda-cop` a odpovídající URL type;
- přesná issuer/base URL a nový login; nekopírovat refresh token ze společného
  `csm-mobile` namespace a nemaže se účet ani SwiftData.

Současná Jízda zůstává na `csm-mobile`. SDK transport měření přijme dedicated
Jízdu pouze s přesným opt-in a stavem lifecycle; grant/batch kontroluje stav i
generaci před a po čekání. Čtení a odvolání souhlasu nezávisí na připraveném
Matrix transportu. Host musí koordinovaně upravit svou kontrolu klienta.

COP routing vyžaduje přijetí nového klienta v existující OIDC allowlist a
stávající role/scopes. Měření má zvláštní intake klient
`COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID`; `COP_DRIVER_MEASUREMENTS_CLEANUP_OIDC_CLIENT_IDS`
je explicitní seznam jen pro GET/DELETE consent, výchozí `csm-mobile`.
Budoucí přechod intake na `jizda-mobile` musí zároveň ponechat cleanup seznam
`csm-mobile,jizda-mobile`, aby stará relace mohla odvolat svůj souhlas. Tento
seznam nerozšiřuje grant/batch ani pilotní subject cohort; bere pouze signed
`azp`, stejný issuer a účet. HMAC přispěvatele je stále subject+UTCden.
Příznaky a produkční konfigurace se nemění; odpovědi zůstávají `shadow_only`.

## Matrix a důkaz instalace

`POST /api/v1/messaging/bootstrap` má zpětně kompatibilní volitelný
`installationId` UUID. Dedicated Jízda vyžaduje UUID i `deviceId`.
COP odmítá další pole, tedy i klientem vybranou identitu aplikace. Z ověřené
OIDC relace posílá pouze serverově:

- `x-csm-user-id`;
- `x-csm-oidc-issuer`;
- `x-csm-app-client-id` ze signed `azp`;
- `x-csm-installation-id`.

Tento přenos nedovoluje redirect. Identity se nepřepisují ztrátovou normalizací.
Messaging musí mít přijatý a aktivní `CSM_APP_DEVICE_LEDGER_ENABLED` se
stejným issuer/client nastavením před odesláním první atestace. Jinak vrací
503; nikdy se nepřepne na neověřený legacy bootstrap.

Ledger váže účet, Matrix identitu, device ID, issuer, client a UUID; samotný UUID
není autoritou a může být stejný v izolovaných jmenných prostorech dvou účtů.
Existující neznámé Matrix zařízení se nepřivlastní podle prefixu. Odpojení
odvolává jen doložená zařízení Jízdy a ověřuje jejich nepřítomnost v Synapse.
Neodpojuje sdíleného Matrix uživatele ani COP Mobile.

## Studený start a host

SDK dedicated opt-in obnoví pouze autentizaci, získá ověřeného COP aktéra
a živě ověří link před registrací push, Matrixem a frontami. GET používá
HTTPS, bearer, žádnou cache/cookies/redirect a pouze HTTP 200.
Neznámý stav nebo výpadek udržuje producenty pozastavené. Fence v Keychain
je vázán na issuer/client/COP/účet/UUID; připravený stav není uložená autorita.
Opožděná odpověď účtu A nesmí obnovit nebo pozastavit nový účet B.

Po úspěšném ověření linku SDK rekonstruuje Matrix transport před zpřístupněním
producentů. Platná stará bootstrap cache sama neznamená obnovené fronty nebo
živý sync. Selhání přípravy zůstává nepřipravené. Obnova úložiště posílá stejné
instalační UUID a kontroluje generaci. Opožděné hlasové odpovědi nesmí po
změně účtu nebo fence předat přístup k médiím.

Host musí před vytvořením hlasové služby, Dispatch a měření zavolat
`copStartJizdaLifecycle()` a ověřit `snapshot.permitsProducers`.
Po obsahově prázdném `csmJizdaLifecycleReadinessChanged` načte
`copJizdaLifecycleSnapshot()` a zastaví vlastní producenty, pokud stav
nepovoluje provoz. Pro novou kontrolu relace je
`copPrepareJizdaLifecycle(expectedScope:)`. Po každém čekání kontroluje
aktuální generaci. Legacy build bez opt-in zachovává dosavadní chování.

Veřejný snapshot obsahuje i neprůhledný hash scope účtu. Host použije
`copJizdaLifecycleSnapshotIsCurrent(snapshot)` po čekání: porovnává scope,
generaci i aktuální readiness, nikoli jen UUID. Stejný účet/generace s nově
přijatým fence proto neprojde. Oznámení zůstává bez payloadu; před zastavením
Dispatch nebo vymazáním vlastní fronty kontrolovat vlastnictví zachycené operace.

Úzký merge musí zachovat novější Jízda `expectedNotificationScope`
a `onAccountProfileRequested`. Celý upravený CommunicationModel nepřepisovat.

## Samostatné odstranění celého COP účtu

Nový `cop-account-erasure-v1` je v závazném JSON OpenAPI:

| Operace | Význam |
| --- | --- |
| GET `/api/v1/me/account-deletion/capabilities` | Skutečná připravenost všech domén; aktuálně false. |
| POST `/api/v1/me/account-deletion` | Samostatné potvrzení `confirmAccountDeletion=true`, UUID Idempotency-Key. |
| GET `/api/v1/me/account-deletion/{operationId}` | Jen vlastní doklad; 200 může obsahovat čekající mazání. |

POST a obnovení dokladu vyžadují signed `auth_time` nejvýše 300 sekund staré.
Čerstvý `iat` po refreshi nestačí. Před prvním přijetím musí být připravené
a přijaté všechny skutečné adaptéry. Chybějící adaptér vrací 503 bez nového
fence. Po přijetí je COP API blokace trvalá i pro staré platné JWT a BFF.
`revocationEnforced=true` znamená tento COP API fence; nedokládá smazání
historie nebo odvolání již vydaných přístupů ostatních poskytovatelů.

Trvalý job ukládá HMAC klíč a AES-GCM chráněný minimální issuer/subject pro
obnovení důvěryhodným workerem po odstranění loginu. Neukládá OAuth token,
profil, heslo ani klíč poskytovatele. Každá doména má vlastní checkpoint
a idempotentní operationId. Poslední důkaz a konec jobu se zapisují atomicky.
Pouze všech 11 skutečných důkazů dovoluje `deleted`/HTTP 200; jinak je
`deleting`/202 s neprázdným seznamem. Výpadek je 503 a fence zůstává.

Implementovaný místní adaptér skutečně odstraňuje vlastněné BFF relace,
profil a potvrzení upozornění. HMAC ownership a databázové fences chrání
pozdní zápis, restart a změnu účtu. Historický profil bez doloženého issuer
a živá neidentifikovatelná BFF relace zůstávají pending; identita se nehádá.
Protokol ostatních domén zůstává bránou podle plánu 42, ne umělým potvrzením.

## Schválený kontakt a retence

Veřejný kontakt správce je **podpora@zeleznalady.cz**; obyčejný odkaz je
`mailto:podpora@zeleznalady.cz`, bez předvyplněného předmětu nebo obsahu.
Zdroj veřejné stránky `/o-aplikaci/` obsahuje tento kontakt. API capability jej
vrací i při vypnutém hlášení, aniž by nabízelo neaktivní operaci.
Závazný policy ID je `cop-communication-retention-90d-30d-180d-v1`.
Text hlášení se odstraní při dřívějším termínu: 90 dní od přijetí nebo 30 dní
po prvním uzavření. Další přezkum termín neprodlužuje. Audit neobsahuje výňatek
a žádný záznam auditu nepřekročí 180 dní. Ve 180 dnech od hlášení se odstraní
také cíl, důvod, identita oznamovatele i audit; zbude vlastní potvrzení bez
obsahu. Moderátorský detail a změna po tomto termínu vrací 410
`REPORT_DETAIL_EXPIRED`; vlastní potvrzení a idempotentní retry zůstávají
dostupné. Blokování trvá do odblokování nebo odstranění účtu.

Retence se vynucuje při čtení i retry; startup provede úklid a následný worker
běží každých 60 sekund bez souběhu. Chyba úložiště neodhalí soukromý obsah
v logu. Toto pravidlo se vztahuje na provozní store; replay odstranění ze záloh
a pravidla ostatních služeb zůstávají jejich samostatným akceptačním bodem.

Vypnutí příjmu hlášení nezastaví retenci ani již platné blokace. Stávající vlastní
potvrzení, stejný idempotentní retry, odblokování a moderace zůstávají dostupné;
nové hlášení a blokování vrací 503 `COMMUNICATION_SAFETY_INTAKE_DISABLED`.
Capabilities pro nové funkce jsou false. Marker `communication-safety:configuration-v1`
chrání fingerprint klíče a politiky. Při existujícím markeru nebo starých hlášeních
chybějící konfigurace zabrání startu; nesprávný klíč nepřevezme staré záznamy.

## Co brání úplné akceptaci

1. Skutečné přiřazení moderátorské role, proces vyřízení a filtrování hlášení
   a schválené vytvoření produkčního klíče pro důkazy. Kontakt a retence jsou
   schválené, příznaky produkce zůstávají vypnuté.
2. Dokončit přijaté cleanup adaptéry všech domén v plánu 42 a jejich oprávnění.
   SIM zatím nedodal account-erasure hranici pro všechny uchované dny měření,
   BYOK a navázanou evidenci. Jeho vlastní chat požádal o souhlas s analýzou.
3. LiveKit dnes používá společnou participant identity = subject a nemá
   app-scoped grant ledger ani revoke/readback rozhraní. Odstranění této identity
   může zasáhnout COP Mobile. U self-hosted LiveKit navíc RemoveParticipant
   samo nezneplatňuje token pro nový vstup; automaticky obnovený token nelze
   považovat za odvolaný jen podle původního TTL.
   [Oficiální popis tokenů a omezení revokace](https://docs.livekit.io/frontends/reference/tokens-grants/).
   Proto `livePermissionsRevoked=false` a odpojení nemůže být completed.
   Nové granty potřebují ověřený app/installation scope, oddělenou neprůhlednou
   participant identity a přijatý důkaz zákazu join/rejoin konkrétního provozu.
4. Vyřešit doloženou migraci neznámých starších Matrix/push instalací; žádné
   odhadování podle názvu, žádné globální odhlášení při odpojení Jízdy.
5. Společně nativně a fyzicky ověřit nový lifecycle, více účtů/zařízení,
   výpadek, studený start a rollback. Starší úspěšná SDK sada tento delta nedokládá.

## Bezpečné nasazení a návrat

Produkční příznaky zůstávají false. Nevytvářely se produkční tajné hodnoty,
role, identity ani síťové propojení; nemaže se skutečný účet.
Připravené změny SQL se spustily pouze v izolované testovací databázi.

Po první přijaté operaci nesmí rollback odstranit guard, jeho config, HMAC
secret, databázové fences ani checkpointy. Vypnutí příjmu nových žádostí
nesmí vypnout jejich vynucování. Startup odmítne chybějící guard u nalezených
trvalých markerů. Změna issuer/client nebo web-session owner secret vyžaduje
schválenou migraci fence, nikoli vymazání markeru. Worker běží bez souběhu,
při zastavení se zruší a nesmí zahájit další provider handoff.
Obnova ze zálohy musí znovu uplatnit odstranění před zpřístupněním služby.
Uživatelem potvrzené Proxmox zálohování se tím nezpochybňuje; account-erasure
replay je samostatné pravidlo proti obnovení zrušeného účtu.

## Ověření tohoto kandidáta

Konkrétní výsledky a publikované revize jsou v závěrečném předávacím manifestu.
COP finální regrese: **1 696 passed / 12 skipped**, 198 souborů prošlo a 8 bylo
přeskočeno. Čtyři skutečné izolované PostgreSQL závody/obnovy byly ověřeny
samostatně; server a databáze byly zastaveny, testovací data odstraněna.
`pnpm build`, `pnpm lint`, skeleton, 11JSONschemat, OpenAPI (0chyb/24varování),
bundle budgets, static runtime smoke a default-off public analytics prošly.
Messaging: **105 passed**, compile warnings-as-errors a diffcheck prošly;
zdrojová revize `ed045c4` je publikovaná, nikoli nasazená.
Původní neúspěšná lokální regrese měla chybějící workspace závislosti a chybný
sentinel nové testovací fixture; obojí opraveno před finálním během výše.
Static smoke po sandbox EPERM a jedné timeout kontrole oprávnění prošel při
povoleném opakování. Není to důkaz produkčního nebo mobilního doručení.
Místní source testy skutečně používají PostgreSQL pro transakční závody,
restart, izolaci účtů a změnu owner-secret; ostatní provider cleanup důkazy
v orchestrátoru jsou syntetické. Nativní sestavení, skutečné externí odstranění
a fyzická akceptace jsou vykazovány odděleně. Žádný účet nebyl vyresetován.
