# 47 Terminální hlasová oprávnění a návrh compaction

Stav k 11. 10. 2026: **navazující source kandidát terminal admission a návrh
politiky, bez schválení mazání, automatického úklidu nebo produkční aktivace**.
Výchozím zdrojem je neměnné předání v3,
COP `a8c3684`, [integrace 45](45_JIZDA_VOICE_GRANTS_AND_LEGACY_MIGRATION.md)
a [předání 46](46_JIZDA_VOICE_V3_HANDOFF.md). Tento dokument je nová navazující
etapa; nepřepisuje předání v2/v3 ani jejich manifesty. Nezavádí endpoint,
retenční konfiguraci nebo hotový provider quiescence kontrakt.

## 1. Doporučené rozhodnutí

Oddělit dva kroky:

1. **Quiescence**: trvalý zákaz vydání/refresh/join/rejoin, vyřešené handshaky
   a skutečný owner/provider doklad, že konkrétní scoped účastník je odpojen
   a žádný již odeslaný pokus se nemůže dodatečně připojit.
2. **Compaction po samostatném schválení**: atomicky nahradit prokazatelně
   uzavřený grant minimálním deny/receipt záznamem a jednou uvolnit grant slot.
   Původní blokace, idempotence a doklad pokrytí všech grantů přežijí změnu.

Pouhé ukončení hovoru, `validUntil`, JWT expirace, zavřený WebSocket, timeout,
věk řádku, remove404 nebo právě prázdný seznam účastníků nejsou quiescence.
`providerVerified=false`, neznámý původ či pending handshake nejsou kandidáti
na odstranění. Vyčerpání kapacity vede k 503 pro nové vydávání, nikoli k mazání
nejstarší evidence. Volání již v `connected` se neukončuje podle původního
vyzváněcího `expiresAt`; samotné compaction nesmí ukončovat aktivní hovory.

Navržené označení politiky je `cop-scoped-voice-compaction-v1`. Jde o návrh
pro budoucí schválení, nikoli o nastavenou produkční hodnotu. Retence moderace
90/30/180 dní se na hlasový ledger nepřenáší.

## 2. Terminální admission a provider dokončení jsou různé důkazy

Nová terminal admission etapa má ověřovat autoritativní `VoiceCallStore`
podle serverového `callId`: chybějící/terminální hovor se nesmí znovu připojit;
nedostupný store je 503. Kontrola musí proběhnout před validací/dispatch,
po čekání a při obnoveném signalizačním přístupu. Její přesný zdrojový hook
a testové výsledky doplní owner implementace této nové etapy.

Tato kontrola sama neodpojí dříve přijatou RTC session. Pokud hovor skončí
během odeslaného joinu nebo zpracování ACK, skutečná durable handshake evidence
se zachová. Hovor lze mít lokálně terminální a současně mít provider cleanup
pending. Receipt tuto nejistotu nesmí změnit na úspěch.

Pro quiescence musí owner doložit současně:

- Přesnou canonical vazbu grant → hovor/místnost → issuer/client/instalace,
  z trvalého ledgeru. Žádné prefix či klientské UUID guessing, žádné převzetí
  provenance z control těla.
- Terminal fence a zákaz nového issuance/refresh/join/rejoin ve všech
  signalizačních cestách, včetně serverem obnovených JWT stejné identity.
- Aktuální výlučné gateway vlastnictví a přijatou jedinou signalizační cestu,
  skutečný jeden backend connect pokus a absenci skrytých proxy/provider retries.
- Uzavřenou inventuru všech dispatchů a potvrzení, že nedoběhne pozdní join.
  Neuzavřený `dispatched` řádek, ztráta owner kontinuity nebo nejistá backend
  session zůstává pending. Ani dlouhé čekání tuto inventuru nedoplní.
- Přijatý provider remove/readback, případně samostatný provider quiescence
  doklad s jednoznačnou session/generací. Remove404 po historickém ACK není
  úspěch; žádný neexistující reconciliation endpoint se nepředpokládá.
- Shodu immutable `admissionEpoch` s příslušnou přijatou topologií a trvalou
  ochranu proti obnovení zrušené session po restartu/obnově.

Zvláštní již navržený důkaz „nikdy nepřipojeno“ smí použít pouze nový canonical
grant vydaný v aktuální aktivní accepted epoch, žádný dispatch, výlučného ownera
a autoritativní provider absenci. Neplatí pro starý/no-epoch grant, ztracené
historické řádky ani řádek odstraněný úklidem. V3 provider kontrakt pro nejasné
historické ACK/remove404 zatím tento důkaz nemá.

## 3. Neměnné bezpečnostní podmínky compaction

| Podmínka | Co se musí zachovat |
| --- | --- |
| Vlastnictví | Přesný ověřený issuer/subject/dedicated klient; pouze neprůhledné owner klíče v uloženém dokladu. |
| Deny | Kompaktní záznam nesmí vrátit grant do aktivního stavu; neznámá reserved identity se odmítá. |
| Historická identita | Nikdy znovu nepoužít participant identity, grant ID ani původní call/installation reuse klíč pro nový hovor. |
| Pending | Unknown legacy, nevyřešený dispatch a neakceptovaná topologie zůstávají chráněné, obsazují kapacitu a nekompaktují se. |
| Receipt | Idempotentní retry nesmí po odstranění plného grantu ztratit důkaz či vytvořit prázdný scope s falešným completion. |
| Scope | Odvolání instalace/app musí zahrnout i kompaktované granty a doklady; cizí instalace, COP Mobile a jiné účty zůstávají mimo rozsah. |
| Epoch | Žádný backfill starého grantu, žádné vydávání historického proofu za nový accepted epoch. |
| Obnova | Starý snapshot nesmí znovu povolit kompaktovaný grant nebo převinout counter či terminal fence. |
| Minimalizace | Žádné JWT/jti/token hash, jméno, raw subject/UUID, E2EE klíč či hlasový obsah v kompaktním záznamu/auditu. |

App/installation/global account fences se tímto úklidem **neodstraňují**.
Stejně se neresetuje přijatá epoch, fingerprint konfigurace nebo evidence
nejasného provider handoffu. Ani úspěšný app unlink není dokončené smazání účtu.

## 4. Konkrétní návrh kapacit a retenčních rozhodnutí

Následující hodnoty jsou návrh pro kontrolovaný pilot a vyžadují schválení;
nejsou nové runtime defaulty ani ověřená velikost produkční databáze.

| Oblast | Navržená hranice a chování |
| --- | --- |
| Granty jedné instalace | Zachovat max128 aktivních/pending/nekompaktovaných grantů. Slot se uvolní až po celé atomické compaction s dokladem. |
| Instalační scope jednoho účtu/klienta | Zachovat max128, včetně předběžných revokací. Tato etapa neuvolňuje rezervaci revokované instalace. Accepted retry funguje i při cap. |
| Nevyřešené dispatch evidence | Navrhnout max8 na identitu a max4096 globálně. Další nový dispatch je 503; existující evidence se nemaže a aktivní hovor se kvůli cap neukončí. |
| Hot handshake evidence | Navrhnout max128 na identitu, včetně ACK historie dosud nepokryté přijatým quiescence dokladem. Při cap zákaz nového dispatchu, nikoli time-only úklid. |
| Kompaktní terminal receipts | Navrhnout max256 na instalaci. Při cap zastavit další nové issuance, dokud není přijaté generační vyřazení nebo oprávněná archivace; nepřepisovat nejstarší receipt. |
| Worker | Jedna běžící instance; nejvýše32 grantů nebo1 MiB kanonických JSON podkladů na transakční dávku, max5 sekund práce před pokračovacím checkpointem. |

Cap se kontroluje pod stejnou transakční autoritou jako zápis a nové issuance.
Checkpoint/retry už přijaté operace nepotřebuje nový slot. Počty předběžných
fences a grantů různých účtů se nesmějí sloučit. Global disk/row budget se
stanoví až podle změřené relační a indexové velikosti v izolovaném pilotu;
při nedostatku kapacity se nové přijímání vypne, evidence se nezahodí.

V3 revokace nyní používá globální `tx.scan(VOICE_GATEWAY_PENDING_PREFIX)`.
Limit128 grantů tuto práci ani celkovou historickou handshake evidenci neomezuje.
Navržený worker budget proto není tvrzením, že současná revokace je bounded.
Před zapnutím compaction je nutný nový per-identity/epoch index a skutečné
keyset stránkování s durable cursor; nestačí načíst celý scan a pak použít
`slice(0,32)`. Stejná změna musí omezit i inventuru pro provider cleanup.
Cursor váže scope, generaci, zapečetěný dispatch watermark a poslední klíč;
souběžný nový dispatch se před vytvořením quiescence dokladu zablokuje fence.
Ztráta ownera nebo mezera v inventuře přeruší dávku do pending. Existující
`MobilityTransaction.scan` toto stránkování neposkytuje; potřebná store/index
migrace je budoucí samostatná implementace, nikoli součást tohoto dokumentu.

Retenční návrh pro schválení: plný terminal grant/proof detail držet nejméně
30 dní od skutečného provider dokončení, potom jej lze nahradit minimálním
receipt/deny záznamem **jen při splnění všech podmínek výše**. Toto čekání je
okno pro reklamaci/diagnostiku, nikoli důkaz revokace; nikdy nezkrátí pending.
Dobu uchování minimálních receipts, auditů a případné soukromé archivace musí
vlastník dat schválit zvlášť podle konkrétního účelu. Do té doby se nemažou.
Rozsah historie hovorů v `VoiceCallStore` a obsah Matrix není automaticky
součástí této politiky.

Bez přijaté generační/restore politiky není poctivé současně slíbit neomezený
počet hovorů, konečný prostor a trvalou per-identity historii. Tento návrh
volí konečné cap a bezpečné 503 před tichým zahozením důkazů.

## 5. Budoucí datový a atomický migrační model

Příklad minimálního interního dokladu, **nikoli současný OpenAPI kontrakt**:

```text
policyVersion, compactionId, opaqueOwnerKey, installationKey,
opaqueCallKey, retiredIdentityKey, terminalRevision,
denialGeneration, admissionEpoch, coveredDispatchGeneration,
providerProofId/digest, providerCompletedAt, compactedAt,
idempotencyBinding, capacityReleased=true
```

Doklad je serverový a prokazatelně svázaný s přesnou canonical identitou/místností.
Pokud pro provider retry/readback nadále musí zůstat úplná neprůhledná participant
identity nebo room, uchová se pouze v přístupově omezeném provider receipt,
ne v běžných logách. Hash samotný neumožní provést provider cleanup.

Budoucí compaction proběhne takto:

1. Read-only výběr kandidáta podle terminal stavu a dokladu; připravit seznam
   přesných klíčů a revizí. Žádný age-based výběr s automatickým mazáním.
2. Pod trvalým singleton ownerem a transakčním zámkem znovu ověřit policy,
   terminal revision, epoch/generaci, grant fence, provider proof a úplnou
   inventuru dispatchů. Změna kterékoli autority zruší pouze kandidaturu.
3. V jedné transakci uložit immutable compaction receipt, přenést reuse klíč
   do typu `retired` a zachovat app/installation enumeraci s odkazem na doklad.
   Nezměnit chybějící full row na možnost založení nové identity pro stejný call.
4. Ve stejné transakci nahradit jen přesně pokrytá metadata/ACK/proof řádky
   minimálním dokladem a jednou snížit nový resident grant counter.
   Pending/nepokryté řádky se nepřevedou ani neodstraní.
5. Crash před commitem nezmění nic; crash po commitu umožní stejné compaction
   ID pouze přečíst. Opakovaný worker nikdy nesníží counter podruhé.

Současný `grant-count` znamená počet uchovaných vydání. Nový „resident“ counter
proto vyžaduje řízenou verzovanou migraci, ne prosté decrement ve v3. Backfill
musí ověřit plné indexy, již kompaktované doklady a count consistency, pod
pozastaveným novým issuance/dispatch. Počítá pending jako resident; neodhadne
jej z timestamps. Chybějící ownership/proof nebo nesoulad vede k 503 a opravě
ownerem, nikoli k přepočtu „nula“. Původní cumulative počet může zůstat jako
neidentifikující provozní součet, nikdy jako důkaz vyčištění jednotlivého grantu.

Pro budoucí bounded gateway historii lze zavést transakčně monotonní dispatch
generaci na identitu. Souhrnný doklad smí pokrýt rozsah jen bez děr a bez
nevyřešených pokusů, po terminal fence. Existující v3 náhodná handshake UUID
nedokládají pořadí či úplnost; nesmějí se dodatečně převést na souvislý rozsah
bez přesné uzavřené inventury. Detaily již pokrytého rozsahu se odstraní teprve
po samostatně přijaté politice a restore ochraně.

## 6. Finální generační vyřazení a instalační migrace

Pouhé minimalizování identity řádků stále může růst bez hranice. Finální
vyřazení receipts/deny historie je druhá, samostatně schvalovaná etapa:

- Všechny granty a dispatchy vyřazované generace musí být terminální a mít
  přijatý quiescence/proof; unknown/no-epoch a pending blokují tuto generaci.
- API i všechny gateway join/rejoin/refresh cesty musí respektovat aktuální
  retirement generaci. Chybějící grant/identity je vždy deny; žádný fallback
  ani rekonstruování starého grantu z klientského JWT.
- Generační autorita se musí uchovat mimo obnovovaný snapshot a nikdy se
  nepřevinout. Jeden aktuální přijatý generation checkpoint může nahradit
  podrobnou retired historii jen po ověření uzavřené inventury.
- Participant identity, grant ID a call reuse klíč se v nové generaci
  nerecyklují. Staré active granty se do ní nedotagují a nepromění na nové.
- Střídání generací za účelem úklidu nesmí bez schváleného servisního postupu
  přerušit aktivní hovory. Nelze automaticky měnit accepted epoch k obejití cap.

Revokované instalační/app scope zůstávají ve v3 trvalé a započtené. Jejich
uvolnění vyžaduje oddělený serverem vlastněný registration-generation kontrakt
pro COP, Messaging/push a budoucí klienty, prokazatelné provider odvolání staré
instalace a ochranu proti starému bootstrap/ticket replay. Nový klientský UUID
ani prefix není důkaz nové generace. Zamrazené v2 SDK/Messaging/host tuto
migraci nedostávají skrytou změnou kontraktu.

## 7. Obnova a rollback

Záloha a obnovovací replay nejsou quiescence doklad. Uživatelovo potvrzené
Proxmox zálohování se nezpochybňuje; pro tento účel je třeba konkrétní aplikací
ověřený postup, aby snapshot neobnovil revoked grant/counter/pending join.

Před zpřístupněním obnovené instance:

1. Nové issuance/dispatch zůstane vypnuté. Ověřit současnou externí generační
   autoritu, konfiguraci/secret fingerprints a provider topologii.
2. Přehrát app/installation/account/terminal fences, compaction receipts a
   capacity-release checkpoints. Odmítnout starou active epoch ve všech
   admission cestách; nespoléhat na stáří snapshotu nebo expiraci tokenu.
3. Znovu reconcile nevyřešené dispatchy/provider session. Neexistence row v
   novém snapshotu sama není důkaz „nikdy nepřipojeno“.
4. Ověřit starý token i serverem refresovaný token, dva účty/instalace, nové
   issuance a správný counter. Až potom samostatně obnovit přijímání.

Rollback po skutečné compaction smí použít jen čtečku rozumějící novému
retired/receipt formátu a counter verzi. Návrat ke v3 kódu nesmí tento stav
ignorovat ani zavést náhradní prázdný ledger. Bez kompatibilní maintenance
čtečky je bezpečný rollback intake-off se zachovaným guardem, nikoli obnova
staré databáze bez replay. Samotné vypnutí workeru ponechá všechny fences.

## 8. Oprávnění a rozhodnutí před implementací mazání

| Owner | Potřebné přijetí a úzké oprávnění |
| --- | --- |
| Vlastník hlasových dat/COP | Schválit policy ID, účel, návrh30 dní pro plné dokončené podklady, dobu minimálních receipts/auditu, cap a skutečné resource dopady. Nepřenést moderátorskou retenci či celé account deletion oprávnění. |
| COP ledger/store | Serverový transakční zápis jen vlastních voice namespaces/indexů/counterů a dokumentovaný migration/restore postup. Žádný libovolný namespace/owner z požadavku. |
| Gateway owner | Přijaté výlučné vlastnictví a dispatch generation/inventory; původní owner lease loss nesmí skončit tichým převzetím RAM spojení. |
| LiveKit/provider | Přesný remove/list/readback a případný nový skutečný quiescence doklad pro známou místnost/identitu/session. Běžný moderator ani klient nedostane room-admin credential. |
| Identity/Messaging/push | Pouze případná samostatná instalační generační migrace; vlastnictví starých záznamů se nedoplní guessed UUID. |
| Backup/restore owner | Nevratná generační autorita, replay před obnovením admission, ověřený test obnovy a přístup k minimálním receipts. |
| Provozní správce | Oddělené schválení případné archivační cesty/retence/šifrování a size budgetu; archiv není obnovitelná cache. |

Není třeba vytvářet nové tajemství jen kvůli tomuto návrhu. Případné podpisové
oprávnění pro externí generační/quiescence doklad má samostatného ownera,
klíčový kontrakt a schválení. Nedoporučuje se rozšířit LiveKit credentials
nebo moderátorskou roli na plošné mazání ostatních aplikací.

## 9. Akceptace před zapnutím compaction

- Read-only dry-run: přesné počty eligible/pending/unknown/cap, bez tokenů,
  raw identit a změny evidence. Sám nedokládá provider cleanup.
- Dva účty/dvě instalace; repeated operation a compaction ID, count-at-cap,
  concurrent issue/revoke/compact a nové issuance pouze po atomickém uvolnění.
- Terminal během dispatch/ACK, zavřený klient před ACK, owner loss/restart,
  remove404, 429/503, starý/no-epoch grant, přímá/alternativní signaling cesta.
- Crash před/po každém checkpointu; žádný dvojí decrement, ztracený reuse deny,
  prázdný scope s falešným completion nebo zahozený unresolved handshake.
- Dlouhý skutečně aktivní hovor přes původní ringing deadline bez compaction
  zásahu; terminal hovor nesmí přijmout starý ani refresovaný token.
- Izolovaná obnova starého snapshotu, replay/generation guard a kompatibilní
  rollback; tento test je oddělený od zdravého aktuálního API.
- Provider/topology i fyzická akceptace nového klienta zvlášť. Žádný syntetický
  upstream, úspěšný build nebo HTTP202 se nepřejmenuje na přijatou produkci.

V této dokumentační práci nebyla provedena compaction, migrace, odstranění
záznamů, změna runtime/konfigurace/secrets, produkční či nativní kontrola ani
nový test/build samotného návrhu compaction. Ověření terminal source delta
je samostatně uvedeno níže. Nevyřešené provider důkazy a všech11 account-erasure owner
domén zůstávají samostatné.

## 10. Implementovaná terminal admission delta

Samostatný [ADR0048](../adr/0048_TERMINAL_VOICE_CALL_ADMISSION.md) popisuje
read-only `createVoiceCallAdmission` nad `VoiceCallStore.get`.
Přesný `grant.callId` a SFU room `cop-call-<callId>` se musí shodovat se
záznamem store. Matrix `roomId` není SFU room a nepoužívá se jako jeho náhrada.

- `created`, chybějící hovor, nesoulad a terminal fáze: 403
  `VOICE_CALL_ADMISSION_DENIED`.
- `ringing`, `accepted`, `connecting_media`: přijatelné pouze před existujícím
  `expiresAt`; accepted/connecting respektují dosavadní media timeout.
- `connected`: původní ringing deadline jej neukončí.
- Výpadek čtení nebo neplatná autoritativní data: 503
  `VOICE_CALL_STATE_UNAVAILABLE`; žádný legacy fallback.

COP API kontroluje scoped hovor před i po vydání media credentials a po
posledním await profilu/notification před úspěšnou odpovědí. Nový/čerstvě
přijatý neúspěšný claim se pokusí kompenzovat dosavadním media_failed; již
terminální stav se nepřepíše. Čtení i denial compensation mají samostatný
5sekundový request deadline. API PostgreSQL CallStore má také query a serverový
statement timeout 5 sekund. Výpadek či timeout kompenzace zůstává 503 a není
tvrzením o dokončeném ukončení; media se nevrátí ani po pozdním dokončení await.

Gateway má povinný `assertCall` hook. Produkční entry používá explicitní
PostgreSQL CallStore a omezené dotazy; auto/memory/disabled nepovolí.
Kontrola obklopuje validate/dispatch/positive ACK, signalizační události a
omezenou single-flight kontrolu nečinných scoped spojení. Před vzdáleným
dispatch se obnoví také výlučné vlastnictví gateway.

Pokud end nastane během již odeslaného Join, klient nedostane známé zastaralé
ACK a přesný transport se uzavře. Operational odstranění přesné opaque
identity/místnosti je oddělené od app/installation proofu. Nikdy nemaže
durable pending a nevytváří completion receipt. Remove404/výpadek zůstává
nejisté odstranění. Mezi posledním čtením a vzdálenou operací existuje závod;
tato implementace netvrdí atomické end/dispatch ani plnou provider quiescence.

Legacy COP Mobile a dosavadní Jízda cesta nemění identitu, JSON ani řízení
médií. Zmrazené candidate33/v2 a předání v3 jsou nedotčené. Žádný nový
produkční account/infrastructure/secret/delete/revoke/activation nebyl proveden.

## 11. Samostatný navržený mobilní delta

Tato část je pokyn k budoucí koordinované integraci, **není změnou publikovaného
SDK ani hosta**. Nejprve dokončit zmrazenou v2 candidate34 podle jejího manifestu.

1. V následném kandidátu převzít v3 optional `participantIdentity` a stejný
   per-account `x-cop-installation-id` z online-attested bootstrapu. Staré JSON
   a initializers nadále dekódují nil; serverovou identity klient nevybírá.
2. Při 403 `VOICE_CALL_ADMISSION_DENIED` zastavit právě tento join/rejoin,
   zobrazit ukončený/nedostupný hovor a načíst autoritativní call state, pokud
   je aktuální account generation stále platná. Nesmí se přepnout na legacy
   token, jiný účet či přímý SFU.
3. Při 503 `VOICE_CALL_STATE_UNAVAILABLE` rozlišit výpadek služby od odmítnutí
   uživatele. Retry musí být omezené a patřit stejné generaci účtu/instalace;
   při end/account change/revoke jej zrušit. UI neoznačí 503 za přijatý hovor.
4. Remote Leave/disconnect může souviset s terminal stavem; po bezpečném
   readback se nelze automaticky připojit k ended/missed/cancelled hovoru.
   Změna jen lokální navigace v hostovi nesmí sama provádět remote revocation.
5. Zachovat 202 `revoking` versus 200 doložený `revoked`; terminal closure
   není dokončené app unlink ani smazání účtu.

Přijetí vyžaduje fyzický iPhone, dva účty/instalace, end během media connect,
pozadí/zámek/reconnect, delší connected hovor přes ringing deadline a souběžný
legacy COP Mobile hovor. Tyto nativní/produkční zkoušky nejsou zde provedené.

## 12. Ověření zdrojového kandidáta

- Finální úplná COP regrese: **1801 passed, 16 skipped**; 203 test files
  passed a 9 podmíněně skipped. Jediný worker, bez selhání (91,12 s).
- V této regresi: gateway **43**, admission helper **18**, COP scoped HTTP
  **26**, ledger **14**, receipt kontrakt **4**. Samostatné focused API/helper/
  stávající CallStore ověření po poslední opravě: **52/52**.
- Skutečná izolovaná PostgreSQL: **4/4**. Cross-pool canonical end, skutečný
  factory SQL timeout čtení/kompenzace pod drženým table lockem, issuance/revoke
  serialization/restart a skutečná primární singleton lease/loss.
  Tyto čtyři conditional testy jsou součástí 16 skipů standardní regrese;
  zbývajících 12 podmíněných zkoušek nebylo touto etapou zpřístupněno.
- Build, TypeScript, ESLint, skeleton, 11 JSON Schema, veřejná analytika a
  diffcheck prošly. Závazný OpenAPI je platný s26warnings beze změny jejich
  počtu; dvě pocházejí z již předaných WebSocket101 operací. Generovaný YAML
  odpovídá JSON. Závislosti/lockfile se touto deltou nemění.

Sandboxový pokus bez povolených loopback serverů byl zastaven. V2-worker
regresi selhal jeden existující media-conversion wait s1sekundovou hranicí;
stejný nezměněný test v úplné finální1-worker regresi prošel. Converter kód
ani jeho timeouty se neupravovaly. První databázový table-lock test uvolnil
lock nečinností `Pool.query` session; opravený test drží vlastní klientskou
transakci a zkouška nyní prokazatelně čeká na skutečné SQL timeouty.

Testy používají syntetické účty, lokální fake SFU a krátkodobou loopback
databázi. Neprokazují real LiveKit quiescence, jediný produkční ingress,
provider retries, nativní/fyzickou regresi či App Store přijetí. Produkce,
secrets, reálné účty a smazání dat zůstaly beze změny. V2/v3 archive SHA byly
znovu ověřeny; jejich soubory a frozen SDK/host se neměnily.
