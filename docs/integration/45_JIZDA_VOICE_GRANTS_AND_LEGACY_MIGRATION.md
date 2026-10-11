# 45 Hlasové přístupy Jízdy a doložená migrace starších instalací

Stav k 11. 10. 2026: **zdrojová implementace nových scoped hlasových přístupů,
bez nasazení a produkční aktivace**. Migrace historických registrací zůstává návrhem.
Dokument navazuje na dokončené předání v2; jeho soubory a doklady nemění.
Přijetí v2 Jízdou nedokládá nasazení serveru, přijetí grantů poskytovatelem,
odvolání starých přístupů ani fyzickou akceptaci hlasových hovorů.

Závazné současné hranice jsou v [integraci 41](41_JIZDA_SCOPED_DISCONNECT.md),
[plánu odstranění účtu 42](42_COP_ACCOUNT_REMOVAL_PLAN.md),
[dokončení hranic 43](43_ACCOUNT_SAFETY_COMPLETION.md) a
[`openapi/openapi.json`](../../openapi/openapi.json). Zde uvedené nové hlasové
kontrakty popisují kandidátní zdroje; nejsou dokladem změny běžící produkce.
Historická Matrix/push migrace nemá hotový migrační endpoint ani přijatý důkaz původu.

## 1. Co je doloženo a co zbývá

| Oblast | Doložený současný stav | Chybějící důkaz |
| --- | --- | --- |
| Rozsah Jízdy | Dedicated klient musí být odvozen ze signed `azp` a stejného ověřeného issueru. Sdílený `csm-mobile` není důkazem konkrétní aplikace. | Přijatá registrace klienta, koordinovaná migrace hosta a skutečné provozní ověření. |
| Nová Matrix instalace | COP bootstrap předává ověřený účet, issuer, klienta a instalační UUID serverově; bez redirectu a bez náhradního legacy bootstrapu při selhání atestované cesty. | Aktivovaný a přijatý Messaging ledger, více zařízení a ověření absence odvolaných zařízení v Synapse. |
| Push | COP vytváří podpisový registrační ticket. Jen ověřený dedicated klient může získat `verifiedAppScope`/`appClientId`; klientem vyplněný bundle není samostatná autorita. | Úplná vazba na ověřený issuer a doložené vlastnictví starších registrací. |
| Hlas | Kandidát má trvalý app/installation ledger, neprůhlednou identitu konkrétního hovoru, scoped revokaci a signalizační admission gateway. Legacy klient používá původní subject identity. | Nasazení jediné signalizační cesty, akceptace konkrétního LiveKitu, starý join/rejoin, aktuální participant removal/readback a nativní integrace. |
| Odpojení Jízdy | Durable fence vzniká před cleanupem; ostatní aplikace mají vlastní autoritu. | `live_permissions` a všechny nevyřešené legacy instalace zůstávají pending. |
| Celý účet | Durable orchestrátor požaduje 11 domén. Existuje skutečný lokální adaptér relací/profilů. | Přijaté skutečné adaptéry a owner proofs všech 11 domén, nikoli jen jejich syntetická náhrada v testu. |

Současný push ticket v `server.ts` obsahuje `sub`, `appInstanceId`, bundle,
účel, audience, čas, `jti` a případný serverový app scope/client; v tomto
pozorovaném payloadu není samostatný issuer. Přesnou budoucí vazbu issueru
musí potvrdit změna podpisového kontraktu nebo již doložená, pevná serverová
vazba signer → issuer. Žádný historický issuer se nedoplní odhadem z e-mailu,
subjectu či klientského požadavku. Chybějící vazba je brána migrace.

Zdrojové opory:
[`voice-call-media.ts`](../../apps/cop-api/src/voice-call-media.ts),
[`jizda-app-link.ts`](../../apps/cop-api/src/jizda-app-link.ts),
[`messaging-provider.ts`](../../apps/cop-api/src/messaging-provider.ts),
[`server.ts`](../../apps/cop-api/src/server.ts).

## 2. Migrační pravidlo pro starší Matrix a push registrace

Migrace nesmí změnit neznámý záznam na doloženou instalaci pouhým přiřazením
UUID. Prefix device ID, název zařízení, bundle z těla, jazyk, čas vytvoření,
poslední aktivita ani shodný účet nejsou důkazem konkrétní aplikace.
Samotné prokázání držení starého přístupu neodlišuje Jízdu od COP Mobile.

### Přijatelný řetězec vlastnictví

Pro každý převzatý záznam musí server doložit celý řetězec:

1. Aktuální relace má platný podpis, přesný issuer, subject a přijatý dedicated
   klient Jízdy. Klient nevybírá vlastníka záznamu.
2. Historický serverový doklad nezávisle dokládá původní účet **a aplikaci**
   konkrétní Matrix/push registrace. Pokud dokládá pouze společný účet,
   převod do rozsahu Jízdy není povolen.
3. Kde je nutné potvrdit živé zařízení, poskytovatel ověří držení konkrétní
   registrace pomocí přijatého jednorázového challenge. Tajný token, privátní
   E2EE klíč ani surový APNs token se nevypisuje a netvoří obsah auditu.
4. Nový serverový ledger sváže přesný issuer/účet/klienta/instalaci s původním
   provider record ID. Převzetí má jednorázový operation ID, kontrolu generace
   a konfliktů; nelze převést záznam jiného účtu nebo jiné aplikace.
5. Zápis a revokační fence používají stejnou transakční ochranu. Pozdní
   bootstrap, registrační retry nebo queue handoff nesmí obnovit odvolaný záznam.
6. Provider readback potvrdí skutečný výsledek. Příjem žádosti či lokální zápis
   ledgeru není potvrzení odstranění u poskytovatele.

Konkrétní challenge, serverová atestace původu aplikace a migrační endpoint
nejsou tímto návrhem implementované. Návrh musí projít owner akceptací před
jejich zavedením; nelze jednoduše důvěřovat prohlášení starého klienta.

### Rozlišení výsledků

| Starší záznam | Postup |
| --- | --- |
| Účet i aplikace mají důvěryhodný historický doklad | Lze navrhnout řízené převzetí a ověřit provider readback. |
| Doložen jen účet nebo držení společného přístupu | Zůstává neznámá aplikace; nepřevzít do Jízdy a neodvolat při app unlinku. |
| Neznámý vlastník nebo konfliktní vazby | Pending, bez změny vlastnictví. Vyžaduje samostatnou owner analýzu. |
| Doloženě odvolaný záznam | Zachovat fence; nepřeregistrovat při restartu ani po obnově ze zálohy. |

Novou dedicated instalaci lze založit vedle nevyřešeného historického záznamu,
ale tím se historie nestává vyřešenou. `legacyInstallationsResolved=true`
vyžaduje uzavřenou inventuru v rozsahu účtu a důkazy pro všechny relevantní
záznamy, včetně neaktivních zařízení a čekajících front. Čas nebo TTL samo
nestačí, pokud poskytovatel umožňuje obnovu přístupu.

Při odpojení Jízdy se nevolá globální unregister, odhlášení sdíleného Matrix
uživatele ani odstranění COP Mobile. Hromadné odhlášení je případně samostatná
uživatelská operace s vlastním dopadem a schválením; nesmí být skrytým krokem
migrace. Nevyřešený stav zůstává v `remaining`, HTTP 202 znamená pending.

## 3. Implementovaný zdrojový kontrakt hlasového ledgeru a admission

### Rozsah a identita

Každý nový hlasový grant je navázán na ověřený issuer/účet, dedicated
klienta, instalaci, hovor/místnost a jednu serverovou identitu účastníka.
Klient nesmí zvolit subject vlastníka, app scope, libovolnou participant
identity nebo poskytovatele. Instalační UUID je referenční hodnota pod ověřeným
účtem a klientem, nikoli doklad autority.

`VoiceGrantLedger.owns` vyžaduje přesné `actor.issuer`, signed `actor.authorizedParty`
a OIDC relaci. Sdílený `csm-mobile` ani `cop-web` nelze nastavit jako dedicated
klienta ledgeru. COP atestuje instalaci až po úspěšném serverovém Matrix bootstrapu
se stavem `online`, `chatAvailable=true` a `tokenAvailable=true`. Samotný prefix
device ID, hlavička aplikace ani zaslané UUID tuto atestaci nevytvoří.

Participant identity má tvar `cop-jizda-voice-v1-<serverové náhodné UUID>`.
Owner klíče `appKey` a `installationKey` jsou oddělené HMAC domény odvozené
existujícím serverovým `COP_LIVEKIT_API_SECRET`; nezavádí se nový hlasový secret.
Různé účty/instalace mají různé identity i při stejném klientském UUID.
Stejný hovor a instalace znovu použijí uloženou identitu při obnově JWT,
aniž by prodloužily původní `validUntil`. Lookup používá tuto identitu,
nikoli `jti`, původní token nebo jeho hash. Dosavadní identity = subject se nesmí
dodatečně prohlásit za scoped Jízdu ani plošně odvolat při jejím odpojení.

Uložený grant obsahuje `identity`, `grantId`, `callId`, `room`, `appKey`,
`installationKey`, UTC `createdAt`/`validUntil` a případné `revokedAt`/
`revocationOperationId`/`admissionEpoch`; privátně nese referenci existujícího Jízda fence.
Neukládá raw subject, username, instalační UUID, mediální obsah, E2EE klíč,
úplný JWT ani OAuth token. Maximální věk je výchozích 86 400 sekund,
konfigurovatelně 60–86 400 sekund. Jedna instalace může mít nejvýše 128
uchovaných grantů, účet v tomto klientovi nejvýše 128 instalačních rozsahů
(atestace i předběžné revokační fences dohromady, každý započten jen jednou).
Při dosažení kapacity je výsledek 503; nejde o automatické mazání ani TTL retenci.
Opakování již přijatého odvolání i odvolání již atestované instalace funguje
také při dosažené kapacitě; existující fence se kvůli kapacitě neodstraní.

Marker `voice-grant-ledger:v1:configuration` trvale váže secret, issuer,
klienta a maximální věk. Tichá změna nebo chybějící marker s existujícími
záznamy selže. Vypnutí příjmu ponechá admission, fences a revokaci aktivní;
odstranění konfigurace při existujícím ledgeru zabrání startu API.

Gateway marker `voice-signaling-gateway:v1:configuration` obsahuje fingerprint,
`active` a případné UUID `acceptedEpoch`. Při prvním vydání uloží grant
`admissionEpoch` jen z aktuálního `active=true` markeru s platnou epoch.
Staré nebo znovu použité granty se nikdy dodatečně neoznačí za vydané v nové
akceptované topologii. Vypnutí libovolné acceptance brány nastaví `active=false`;
návrat false→true vytvoří novou epoch. Doklady staré epoch nesmějí potvrdit
úplné odvolání v nové topologii bez samostatného důkazu.
Produkční env factory vždy nastaví `requireAdmissionEpoch=true`: chybějící/
neaktivní marker ani dříve vydaná identita bez aktuální epoch nemohou vytvořit
scoped JWT. Nové i reused vydání v tomto případě vrací 503
`VOICE_GRANT_ADMISSION_UNAVAILABLE`; grant se dodatečně nepřeznačí a revokační
maintenance tím nezanikne. Volitelné defaultfalse slouží pouze explicitním
programmatickým syntetickým ledgerům, nikoli konfiguraci produkčního API.
Stejná aktuální active/epoch kontrola proběhne v jedné transakci i při
`assertAdmission` po podpisu JWT; přepnutí konfigurace během podpisu tak
zastaví handoff. Canonical read/revoke zůstane při změně epoch dostupný.

### Kontrakt hosta Jízdy

1. Použít přijatý dedicated OIDC klient. Pole klienta z aplikace nemůže nahradit signed `azp`.
2. Poslat POST `/api/v1/messaging/bootstrap` s `deviceId` a stabilním UUID
   `installationId`. Teprve úspěšný atestovaný bootstrap umožní hlasový grant.
3. Posílat `x-cop-installation-id` u vytvoření hovoru, detailu vracejícího media
   a akcí `accept`, `heartbeat`, `media_connected`. Chybějící hlavička je 400,
   neznámá instalace 403, vypnutý příjem/chybějící služba 503. Žádný scoped
   požadavek nepřejde na legacy subject identity při chybě.
4. `media.participantIdentity` je nové volitelné pole pouze scoped odpovědi.
   Použít je místo vlastního COP subjectu při porovnávání identity účastníka;
   samotné JWT i E2EE klíč zůstávají serverem vydané pro daný hovor.
5. `decline`, `cancel`, `end` nad již existujícím hovorem zůstávají dostupné
   bez nové hlavičky. Výpis hovorů zůstává kompatibilní. Legacy COP klient
   používá původní identity/odpovědi a nemusí zavádět tento scoped kontrakt.

### Kontrakt odvolání konkrétní instalace

POST `/api/v1/me/voice-installations/revoke` přijímá pouze
`{"installationId":"<UUID>"}` a UUID v `Idempotency-Key`. Vlastník, issuer
a klient vycházejí z ověřené relace; žádný `userId`, app scope ani seznam grantů
nelze přidat do těla. Fence se trvale zapíše před provider handoffem, opakování
stejného operation ID pokračuje, odlišný operation ID nad stejnou odvolanou
instalací vrací 409. Stejné UUID jiného účtu se tím neodvolá.

| Výsledek | HTTP a přesná sémantika |
| --- | --- |
| Přijaté odvolání, provider proof čeká | 202, `status=revoking`, `joinDenied=true`, `providerVerified=false`. |
| Skutečný přijatý provider proof | 200, `status=revoked`, `joinDenied=true`, `providerVerified=true`. |
| Provider výpadek, 429, 503 nebo neplatný doklad | 503 `VOICE_GRANT_PROVIDER_UNAVAILABLE`; již zapsaný fence se neruší a stejné operation ID lze zkusit znovu. |

Každý úspěšný/pending receipt má `contractVersion=cop-voice-installation-revocation-v1`,
`scope=installation`, `operationId`, `accountDeleted=false` a `Cache-Control: no-store`.
Lokální `confirmsRevoked(identity, room)` potvrzuje pouze trvalý COP zákaz
vstupu pro přesně uloženou místnost, nikoli odpojení u poskytovatele.
`readRevokedGrant(identity, room)` navíc vrátí canonical uložený grant s původní
epoch, pouze pokud tento přesný grant skutečně kryje trvalá revokace/fence.
Nepřebírá žádné pole ani provenance z těla control požadavku.

### Vydání a odvolání

1. COP ověří relaci, účast v hovoru, app link, stav instalace, existující globální
   account guard a canonical block policy. Installation preflight proběhne před
   vytvořením hovoru/oznámením a před uvedenými mediálními přechody. Issuer
   po podpisu tokenu znovu ověří trvalé admission fences.
2. Ledger zaznamená idempotentní vydání před handoffem. Současné odpojení
   vytvoří fence ve stejné autoritě; pozdní vydání nesmí odevzdat platný přístup.
3. Token grant zůstává omezen na správnou místnost a potřebné mediální operace.
   Zabezpečení a E2EE se touto etapou nemění.
   Selhání vydání po vytvoření nebo přijetí hovoru ukončí vlastní novou media
   claim jako `failed` a pošle `ended`; nevytvoří nepravdivé `answered_elsewhere`.
4. Odpojení zneplatní nové vydávání/refresh, odvolá všechny doložené granty
   daného rozsahu a zastaví právě připojené vlastní participanty. Nesmí ukončit
   cizí účastníky ani místnost COP Mobile.
5. Provider readback a test starého tokenu musí při akceptaci doložit join i
   rejoin. Neúplný doklad zůstane pending; výpadek je 503.

App unlink předá vlastní stejné operation ID ledgeru a revokeru. Výsledek
hlasového provideru naplní jen `livePermissionsRevoked`; ostatní Messaging/push/
Matrix/legacy důkazy jsou samostatné. Nevyřešené `remaining` nemůže odvolání
jedné nové hlasové instalace vynulovat.

### Admission gateway a interní serverový handoff

Nový samostatný runtime v `voice-admission-main.ts` se nespouští v běžném COP API.
Gateway obsluhuje `/rtc`, `/rtc/validate`, `/rtc/v1`, `/rtc/v1/validate`;
nenahrazuje RTC mediální porty. Ověřuje podpis/expiraci LiveKit JWT, přesnou
ledger identity a místnost před forwardováním; celý rezervovaný prefix je
managed i při vadném suffixu. Přijaté původní legacy identity zůstávají původní
cestou, bez dodatečného hádání vlastníka aplikace.

Handoff POST `/internal/voice-grants/revoke` je pouze serverový. Tělo obsahuje
operation ID a páry `{identity,room}`; revoker posílá dávky nejvýše 128 grantů.
HS256 JWT vydaný existujícím LiveKit klíčem má platnost 30 sekund,
`roomAdmin=true` pro `cop-voice-grants-control-v1` a metadata SHA-256 přesného
těla. Běžný room-join token tento control endpoint neopravňuje. Příjem dokladu
je omezen na 4 096 bajtů; doklad má pouze `contractVersion`, stejné
`operationId` a boolean `providerVerified`. Přesměrování je zakázané.

Před každým skutečným signalizačním handshake vznikne trvalý stav
`voice-signaling-gateway:v1:handshake:*`. Neukládá token. `dispatched` přejde
na `acknowledged` pouze po dekódovaném kladném protobuf/JSON potvrzení správné
identity/místnosti (nebo příslušného reconnectu) a přijatém důkazu jednoho
backend connect pokusu. Neznámý handshake po timeoutu/restartu se automaticky
nemaže ani nezmění na potvrzený. Revokace čeká na pending handshake, zavře
vlastní signaling spojení, odstraní přesné participanty a provede provider
readback. Neúspěšný remove, včetně 404, není důkaz; samotný prázdný seznam
účastníků nemusí vyloučit pozdější join. Dokončení ukládá samostatný opaque
operation/body checkpoint a jednotlivé grant proof checkpoints v aktuální
active epoch. Každý kladný proof vyžaduje canonical `admissionEpoch` shodnou
s aktuální aktivní epoch; historické/neoznačené granty zůstávají pending i při
aktuálně prázdném seznamu. Výjimka bez provider remove je doložený nikdy
nepřipojený grant: stejná canonical active epoch, žádný dispatch řádek,
stále výlučný gateway owner a autoritativní provider absence. Žádný prefix,
samotné control tělo ani chybějící řádek pro starý grant tuto výjimku nezaloží.
Částečně potvrzený grant se při retry znovu nevydává za nejasný remove404;
jeho přesný checkpoint platí pouze v této active epoch. Cizí identity ani
room se cleanupem neodstraňují.

Samostatný primární PostgreSQL advisory lock `731031,2` má právě jeden živý
gateway owner; není to existující Dispatch singleton. Ztráta vlastnictví je
pro proces trvalá a ukončí signaling, bez tichého převzetí původních WS spojení.
Restart musí respektovat zachované nevyřešené handshaky. Jde o zdrojové chování;
izolovaný test skutečného PostgreSQL ověřil jednu lease, její ztrátu a nové vlastnictví. Reálný failover a provider topologie ještě nejsou akceptované.

### Konfigurace bez aktivace

| Nastavení | Význam |
| --- | --- |
| `COP_VOICE_SCOPED_GRANTS_ENABLED=false` | Nové atestace a vydání jsou vypnuté; při zachované konfiguraci revokace/admission pokračují. |
| `COP_VOICE_SCOPED_GRANT_MAX_AGE_SECONDS=86400` | Trvalý věk grantů; 60–86400, změna vyžaduje řízenou migraci fingerprintu. |
| `COP_VOICE_SIGNAL_GATEWAY_ENABLED=false` | Samostatný gateway runtime se sám nespustí. |
| `COP_VOICE_SIGNAL_GATEWAY_ACCEPTED=false` | Žádný provider completion proof z nepřijaté topologie; API revoker ani nevolá provider. |
| `COP_VOICE_SIGNAL_SINGLE_ATTEMPT_VERIFIED=false` | Bez živého důkazu `signal_relay.connect_attempts=1` a absence retry v proxy nelze potvrdit handshake/cleanup. |
| `COP_VOICE_SIGNAL_GATEWAY_CONTROL_URL` | Interní origin control listeneru, bez credentials/query/hash. Jeho zachování vytváří maintenance službu i při vypnutém novém příjmu. |
| `COP_VOICE_SIGNAL_GATEWAY_BACKEND_URL` | Interní LiveKit origin; žádná klientská náhrada ani veřejný přímý fallback. |
| `COP_VOICE_SIGNAL_GATEWAY_HOST`, `COP_VOICE_SIGNAL_GATEWAY_PORT` | Samostatný listener, výchozí loopback a 7884. Nasazení musí explicitně určit interní dosažitelnost. |

Existující `COP_DATABASE_URL`, OIDC issuer/dedicated client a LiveKit credentials
musí být pro API i gateway shodné a serverově dostupné. Změna veřejné signalizační
topologie, proxy retry pravidel nebo přístupu k provideru je samostatné nasazení
a akceptace; tento zdrojový kandidát je neprovedl.
API env factory odmítne `COP_VOICE_SCOPED_GRANTS_ENABLED=true`, pokud nejsou
současně true obě acceptance brány. Konfigurace control URL při intake=false
zachová maintenance. Proxy a ingress nesmějí logovat bearer token nebo
`access_token` query; gateway neposílá token v upstream URL a má vypnutý request logger.

Zastavení aktuálního participantu, ověřený webhook po připojení nebo zákaz
nového vydání v COP samy nedokládají zákaz vstupu se starým bearer tokenem.
Webhook s následným odpojením je detekce a ukončení po vstupu, nikoli automaticky
admission před přístupem k médiím. Pokud provoz LiveKitu nepodporuje přijatou
kontrolu revokace při join/rejoin, ledger nesmí tvrdit
`livePermissionsRevoked=true`. Krátké TTL ani deklarované `expiresAt`
nenahrazují důkaz chování konkrétního serveru a obnovy tokenů; viz brána v
[integraci 43](43_ACCOUNT_SAFETY_COMPLETION.md#co-brání-úplné-akceptaci).

Legacy granty bez doložené aplikace/instalace zůstávají zvláštní nevyřešenou
kategorií. Před aktivací nového rozsahu je nutné určit, jak skončí jejich
skutečné join/rejoin oprávnění. Neodvozovat jeho konec pouze z původního TTL.
Provider topologie, přímé/alternativní signaling cesty, callbacky/provider retries,
aktuální LiveKit build a produkční oprávnění **čekají na společnou akceptaci**.
Samotný gateway kód neprokazuje, že žádná další veřejná cesta nepřijme starý token.

Zdrojové opory: [`voice-grant-ledger.ts`](../../apps/cop-api/src/voice-grant-ledger.ts),
[`voice-grant-runtime.ts`](../../apps/cop-api/src/voice-grant-runtime.ts),
[`voice-grant-routes.ts`](../../apps/cop-api/src/voice-grant-routes.ts),
[`voice-grant-revocation.ts`](../../apps/cop-api/src/voice-grant-revocation.ts),
[`voice-admission-gate.ts`](../../apps/cop-api/src/voice-admission-gate.ts),
[`voice-admission-main.ts`](../../apps/cop-api/src/voice-admission-main.ts).

## 4. Přesné brány moderace a oprávnění klíčů

Veřejný kontakt **podpora@zeleznalady.cz** byl člověkem potvrzený. Zdrojová policy
`cop-communication-retention-90d-30d-180d-v1` a dřívější samostatná retenční
autorizace jsou popsány v předání 43; novější odpověď obsahující kontakt není
novým rozhodnutím o retenci, právních výjimkách ani produkční aktivaci.
Žádné z těchto potvrzení nezaložilo moderátora, roli, produkční tajemství ani
nové provider oprávnění.

### Role a práce moderátora

`COP_COMMUNICATION_MODERATOR_ROLE` musí obsahovat **přesný schválený název role**
od vlastníka identity. Název dosud není v produkci nastaven; testové názvy nejsou
schválené produkční role. Server kontroluje roli pouze v `actor.roles` po
ověření OIDC podpisu/issueru. Hlavička, tělo, e-mail ani role nativní aplikace
nemohou přidat moderátorské oprávnění.

| Operace | Potřebné oprávnění a omezení |
| --- | --- |
| GET `/api/v1/moderation/communication/reports` | Ověřená OIDC relace a přesná moderátorská role; pouze pracovní fronta. |
| GET `/api/v1/moderation/communication/reports/{reportId}` | Stejná role; vybraný podklad před retenčním termínem. Po odstranění detailu 410. |
| PATCH stejného detailu | Stejná role, `expectedRevision`, platný přechod a resolution při uzavření; při konfliktu 409. |
| Vlastní hlášení / blokace | Vlastní ověřený účet; moderátorská role neslouží k výběru cizího oznamovatele. |
| Klíče, provider cleanup, celé odstranění účtu | Tato moderátorská role je neopravňuje. Patří samostatným owner adapterům. |

Před aktivací vlastník služby schválí konkrétní lidi/skupinu, proces převzetí
a vyřízení fronty, klasifikaci hlášení, eskalaci bez kopírování výňatků do logů,
záznam rozhodnutí a předání směny. Čas odpovědi ani dostupnost 24/7 dosud
nejsou slíbené. Soukromý text se neexportuje do AI Routeru ani do podpůrného
e-mailu automaticky. Odvolání moderátorské role musí zablokovat další přístup
i u dříve načteného rozhraní; konkrétní token/relace politika čeká na akceptaci.

### Tajemství a správa

| Tajemství / oprávnění | Povolený účel | Potřebné samostatné schválení |
| --- | --- | --- |
| `COP_COMMUNICATION_EVIDENCE_SECRET` | Dedikovaný náhodný klíč nejméně 32 znaků pro serverové šifrování vybraných podkladů a idempotency HMAC. | Vytvoření a bezpečný zápis do schváleného produkčního secrets souboru; ne do Gitu, chatu, prohlížeče či logu. |
| `COP_COMMUNICATION_MODERATOR_ROLE` | Přesná role ověřeného aktéra pro uvedené moderátorské endpointy. | Název, přiřazení konkrétním subjektům a schválený provozní proces. Nevytvořeno tímto návrhem. |
| `COP_ACCOUNT_ERASURE_SECRET` | HMAC vlastníka/fence a AES-GCM minimálního restart intentu, nikoli obsah účtu. | Samostatné vytvoření, dostupnost při obnově a přijatá migrace/retence fence. |
| Existující `COP_LIVEKIT_API_KEY`/`COP_LIVEKIT_API_SECRET` | Podpis scoped room JWT, oddělené HMAC ledger domény, serverový room-admin cleanup/readback. | Schválené minimální serverové předání gateway procesu a skutečná provider/topology akceptace. Nevznikl nový secret ani klientské admin oprávnění. |

Klíč důkazů se nesdílí s web session klíčem ani provider credential. Přístup
k němu má jen potřebný serverový proces a schválená správa secrets; moderátor
jej nepotřebuje vidět. Změna evidence klíče/politiky není tichá konfigurace:
durable fingerprint ji odmítne, staré hlášení se nepřevezme chybným klíčem.
Vypnutí příjmu zachová read/retry/unblock/moderaci, retenci a již platné blokace.
Při existujícím markeru/hlášení chybějící config zabrání startu.

## 5. Všech 11 owner cleanupů: kroky a oprávnění

Následující IDs jsou přesný seznam z
[`account-erasure.ts`](../../apps/cop-api/src/account-erasure.ts). Každý owner
musí přijmout reálný adaptér, minimální oprávnění a ověřit svůj cleanup; žádná
syntetická odpověď, RAM TTL nebo HTTP 202 nenahrazuje dokončený důkaz.

| Adapter ID | Další práce a doklad dokončení | Oprávnění / rozhodnutí k samostatnému přijetí |
| --- | --- | --- |
| `keycloak` | Odvolat relace/refresh přístupy a odstranit identitu; ověřit staré tokeny/bootstrap a zákaz obnovy účtu. | Vlastník identity schválí účelově omezený serverový přístup pro cílový účet a pořadí vůči ostatním checkpointům. Ne obecný admin token klienta. |
| `cop_sessions_profiles` | Skutečný lokální adaptér existuje; ověřit všechny primary/fallback stores a historické rows bez issueru. Neznámé vlastnictví zůstává pending. | Přístup jen potřebného serveru k tabulkám relací/profilů/ack a fences; schválená migrace legacy vlastnictví. Produkční akceptace zatím chybí. |
| `cop_devices` | Doložit všechny instalace/push/pushery/tickets/fronty účtu; late retry ani starý ticket nesmí vytvořit novou registraci. | COP/Messaging owner poskytne account-wide enumerate/revoke/readback; app unlink scope se nesmí zaměnit za celý účet. |
| `messaging_matrix` | Enumerovat současné i opuštěné místnosti a vlastní obsah přes všechny stránky, redakce/owned media/metadata, revokace credentials a provider readback. Popsat vzdálené/federované kopie. | Přijaté Synapse/Matrix/media operace podle prokázaného vlastníka; žádné prefix mazání, žádné odstranění obsahu jiných lidí. Deaktivace sama není úplný doklad. |
| `voice_livekit` | Revoke ledger/admission/grants a vlastní call metadata; starý join/rejoin musí být odmítnut a cizí hovor zachován. | Přijaté provider admission/remove/readback, vlastnictví historie a legacy grant policy. Nový ledger sám nestačí. |
| `cop_content_media` | Odstranit/redigovat vlastní komunitní obsah, kresby, přílohy, osobní track vazby a owned objects; ověřit neexistenci osiřelých uploadů. | Omezené DB/object-store/media oprávnění, přesný ownership katalog a schválené pravidlo pro sdílený obsah. |
| `mobility_dispatch` | Vyřešit převod/smazání vlastněných zdrojů, sdílení, pozvánky a outbox; zastavit producers/grants a odstranit identifikační i location vazby. | Uživatelovy resource impact choices a owner policy pro vozidla/společné historie; schválená minimální finanční evidence, bez vymyšlené výjimky. |
| `sim_measurements` | Odvolat a potvrdit všechny stále uchované contributor days, vyřešit submit/revoke race i restore replay. 202 zůstává pending. | SIM musí přijmout account-wide hranici a enumerate/delete/readback doklady; pouze serverový token, bez přenosu raw GPS nebo dalších identifikátorů do auditu. |
| `ai_router` | Odstranit uložený BYOK klíč, profil/limity/cache a osobní vazby auditu; žádný fallback na společný klíč. Test nepotřebuje placené OpenAI volání. | Router owner schválí identitu cíle a cleanup/readback, účel a přesnou retenci potřebné nákladové evidence. COP klíč nečte/neukládá. |
| `moderation_audit` | Odstranit osobní reporter/target vazby napříč hlášeními a auditem; schválená 90/30/180 politika je horní hranice, nikoli hotový account-erasure adaptér. | Vlastník moderace/logů přijme account-wide cleanup a přesné případné výjimky; bez nové blanket právní či neomezené retence. |
| `backup_restore` | Přijmout expiry/restricted access a durable replay odstranění před zpřístupněním obnovy; doložit izolovanou obnovu bez navrácení zrušeného účtu. | Vlastník záloh potvrdí rozsah každého store/provideru, replay mechanismus a přístup. Potvrzené Proxmox zálohování se nezpochybňuje, samo ale není erasure proof. |

Do dokončení všech skutečných domén zůstává account deletion capability false.
Chybějící/nepřijatý adaptér vrací 503 před přijetím nového fence. Již přijaté
fences a checkpointy přetrvají výpadek, restart i rollback; dokončení vyžaduje
všech 11 skutečných proofů a atomický terminal checkpoint. App unlink nikdy
nenastavuje `accountDeleted=true`.

## 6. Výsledky zdrojových testů a zbývající akceptace

Nejmenší cílený běh `voice-grant-ledger.test.ts` a
`voice-scoped-integration.test.ts` prošel **35/35**. API TypeScript kontrola
prošla. Syntetické RS256 OIDC relace pro dva účty ověřily skutečné COP handlery:
online bootstrap → instalace → začátek hovoru/detail, chybějící/neznámou instalaci
před call/push side effects, mediální přechody, zachovaný terminal decline,
izolovanou revokaci a idempotentní retry 202/503/200. Podepsané LiveKit JWT
ověřil `TokenVerifier`, včetně absence profilu v scoped tokenu a zachované legacy identity.
Mockovaný control provider ověřil admin JWT/body vazbu, dvě dávky 128+1, zákaz
fetch při nepřijaté topologii a chyby 429/503/neplatný či nadměrný receipt.
Ledger testy pokryly restart, souběh issue/revoke, konfiguraci/fences, kapacitu
a zákaz raw identity/tokens v uložených řádcích, původní epoch bez backfillu
a preemptive revocation scopes. Reprodukce start revoke race i selhání media
po accept ověřily ukončení nového hovoru a pravdivé lifecycle oznámení.

Tyto testy nevolaly skutečný LiveKit ani produkci a nenahrazují gateway/provider
či fyzickou akceptaci. Doklady bez tajných hodnot:
`/private/tmp/cop-voice-scoped-integration-20261011.log`,
`/private/tmp/cop-voice-scoped-typecheck-20261011.log`.

Před tvrzením o přijatém provozu musí předání obsahovat:

1. Přesné immutable revize COP/Messaging/SDK/Jízdy, změněná OpenAPI pole,
   migrations, konfiguraci a provider admission hranici. Nativní host musí
   ověřovat scope/generaci/fence po každém čekání.
2. Dva účty, dvě aplikace a více instalací: izolace účtů, nové i historické
   registrace, neznámé vlastnictví, konfliktní ledger a staré credential.
3. Join/rejoin se starým grantem po unlinku/account fence, souběžné vydávání
   a odvolání, restart, výpadek provideru, opožděné webhooky i queue handoff.
   Doklad musí ověřit chování skutečného provideru, ne jen falešného issueru.
4. Důkaz, že odpojení Jízdy zachovalo COP Mobile a cizí účastníky. Legacy
   neprokázané granty/registrace jsou výslovně pending; žádné guessing.
5. Přijatý moderator role mapping/proces, schválené vytvoření secrets a test
   retence/cleanup/obnovy. Záznamy testů bez tokenů, excerptů či raw GPS.
6. Fyzickou nativní akceptaci na iPhonu: studený start, více účtů/zařízení,
   app background, přijatý/odmítnutý/zmeškaný hovor, probíhající hovor,
   výpadky a návrat; každá brána vykázaná odděleně.

V této zdrojové etapě nebyly vytvořeny role ani tajné hodnoty, změněna produkce,
odstraněn účet, nasazen gateway nebo ověřen skutečný iPhone/LiveKit.
Příznaky zůstávají vypnuté. Dosavadní výsledky v2 se nepřepisují a nejsou
vydávány za provider či migrační akceptaci nové etapy.


## 7. Výslovně neuzavřené hranice

- `joinDenied=true` při `providerVerified=false` označuje přijatý trvalý COP
  fence. Není to doklad, že neakceptovaná produkční SFU cesta již odmítá starý
  JWT. Tento důkaz vyžaduje skutečnou jedinou signalizační cestu a provider test.
- Gateway kontroluje app/installation/grant fence a maximální stáří grantu.
  Dosud nekontroluje aktuální fázi z `VoiceCallStore`. Ukončení hovoru tedy
  samo ještě neodvolá zkopírovaný platný scoped JWT; připojení do stejné
  místnosti může být možné do expiry nebo scoped revokace. Samostatné rozšíření
  musí připojit autoritativní call-state kontrolu před validaci/dispatch,
  zamítnout terminal/chybějící/vypršelý ringing call, ponechat dlouhé aktivní
  hovory a vracet503 při výpadku store. Ověřit také end-vs-pending-join race.
- Staré/no-epoch granty, přerušená kontinuita topology i historické acknowledged
  hovory s provider remove404 zůstávají pending/unavailable. Prázdný inventory
  je nepovýší na completion. Potřebují samostatně přijatý quiescence/reconciliation
  doklad; tento kandidát jej neimplementuje. Běžný unlink proto není prohlášen
  za dokončený v produkci.
- Limit128 uchovaných grantů/instalací je bezpečná kapacitní hranice. Před
  běžným provozem je potřeba přijmout compaction/retention politiku pro
  prokazatelně dokončené granty a historii. Kandidát automaticky nemaže evidence
  ani fences a neprohlašuje TTL za provider proof.

Zdrojová etapa nevytváří App Store completeness. Moderátorský proces, legacy
vlastnictví, skutečné owner proofs všech11 domén, provider/topology akceptace
a fyzické testy zůstávají samostatně vykázané v předání.


## 8. Závěrečné ověření kandidáta, 11. 10. 2026

| Brána | Výsledek | Rozsah důkazu |
| --- | --- | --- |
| Úplná COP regrese | **1761 prošlo, 14 přeskočeno**, 202 testových souborů prošlo, 9 podmíněných přeskočeno | Finální zdroje; běh se dvěma workers. |
| Ledger a COP HTTP integrace | **35/35** | Dva podepsané syntetické OIDC účty, instalace, lifecycle a post-sign epoch. Zahrnuto v úplné regresi. |
| Signalizační gateway | **26/26** | Skutečné lokální WebSocket spojení se syntetickým upstreamem, nikoli skutečný LiveKit. Zahrnuto v regresi. |
| JSON receipt kontrakty | **4/4** | 200/202, konzistence provider proof, zákaz client identity a účetního smazání. Zahrnuto v regresi. |
| Izolovaný skutečný PostgreSQL | **2/2** | Dva store instances, issue/revoke race, restart, izolace, jediný owner a terminal lease loss. Dva z podmíněně přeskočených testů výše ověřeny samostatně. |
| Sestavení a lint | Prošlo | Všechny workspace buildy, TypeScript a ESLint. Nejde o nativní/iPhone build. |
| Schémata a skeleton | Prošlo | 11 JSON Schema, závazný JSON OpenAPI a generovaný YAML. |
| OpenAPI | Platné, 26 warnings | Dvě nové varovné poznámky čekají2xx u WebSocket101; ostatní existující kontrakty nebyly přepracovány. |
| Lockfile | Prošlo | Frozen offline kontrola, přímý protocol1.51.0 odpovídá již existující zamčené transitive revizi. |
| Veřejná analytika | Prošlo | Povolené veřejné cesty a default-off guard zůstaly zachované. |

První plný běh se čtyřmi workers skončil1757passed a třemi timeouty
nezměněných media-conversion testů. Jejich samostatný běh prošel20/20;
následná úplná regrese se dvěma workers prošla bez selhání. Produkční konverze
ani její testové timeouty nebyly kvůli tomu upravené. Web build dále uvádí
existující upozornění na velké chunks; webový kód nebyl změněný.

Původní publikované v2 předání zůstalo neměnné. Tato etapa neupravila
produkční konfiguraci, síť, tokeny/secrets, SIM, Messaging ani mobilní SDK.
Host Jízdy musí změny integrovat do nového kandidáta a fyzicky ověřit;
nepřepisovat již předaný candidate33.
