# 44 — Předání hranic účtu a instalace Jízdě, v2

Stav k 2026-10-11: **zdroje publikované, produkční aktivace neprovedena**.
Veřejný kontakt a politika retence jsou schválené. Tento záznam nedokládá
úplné odpojení Jízdy ani odstranění celého COP účtu.

## Publikované revize

Všechny kandidáty jsou na větvi `codex/account-safety-completion-20261011`:

| Komponenta | Přesná revize |
| --- | --- |
| [COP](https://github.com/voldzi/delta_acr_cop/commit/6b6d80ce8b7975375d12e2b90ec0e3575d114644) | `6b6d80ce8b7975375d12e2b90ec0e3575d114644` |
| [Messaging](https://github.com/voldzi/csm_messaging/commit/ed045c442f540c279d5ab6a54bf26a5dd121a759) | `ed045c442f540c279d5ab6a54bf26a5dd121a759` |
| [CSMCommunicationKit](https://github.com/voldzi/COP-Mobile/commit/73dcb1dfd1bc42775057ce5ddd17edb85ad574db) | `73dcb1dfd1bc42775057ce5ddd17edb85ad574db` |

COP revize výše identifikuje ověřený kód; následný dokumentační commit přidává
pouze tento záznam a manifest. [Manifest](44_ACCOUNT_SAFETY_V2_MANIFEST.json)
obsahuje úplné revize, 24 souborů SDK, SHA-256 a oddělené výsledky ověření.

## Neměnný balíček

- Adresář: `/private/tmp/cop-account-safety-handoff-v2-20261011`
- Archiv: `/private/tmp/cop-account-safety-handoff-v2-20261011.tar.gz`
- SHA-256 archivu: `89890a17de6aa740c6da7df993cea454cb5b6f30bdeb30bea3178953558bc68e`
- Patch: `cop-mobile-sdk-09493a0.patch`
- SHA-256 patche: `0e063f4a11c7931359f904b76b5a4c0d4a68ebac493bbb597d9eab2ec7d41c58`
- Základ SDK: `09493a0cc4aa2bcd45dae75c72f83db0ab37735f`

Patch byl aplikován na čistý základ a výsledný obsah všech 24 souborů ověřen
proti publikované revizi. Původní balíček první etapy zůstává zachovaný.
Archiv obsahuje zdrojové snímky, přesný manifest SDK a souhrn PostgreSQL;
neobsahuje produkční tajemství ani skutečné uživatelské údaje.

## Pokyn pro integraci Jízdy

1. Použít nový zmrazený kandidát. Provést úzké sloučení změn do novějšího
   vendoru, zachovat `expectedNotificationScope` a `onAccountProfileRequested`.
   Nepřepisovat celé modely, callbacky ani pravidla hostitelského repozitáře.
2. Před vytvořením hostitelského hlasu, Dispatch, GPS a měření spustit
   `copStartJizdaLifecycle()`. Obnova autentizace, živá HTTPS kontrola instalace
   a skutečná rekonstrukce Matrix transportu musí předcházet povolení producentů.
3. Po každém await a před úklidem profilu, zastavením Dispatch nebo měření
   ověřit zachycený snapshot přes `copJizdaLifecycleSnapshotIsCurrent(snapshot)`.
   Kontrolovat účet, neprůhledný scope, generaci i připravenost. Opožděná událost
   účtu A nesmí změnit stav účtu B. Oznámení neobsahují obsah ani oprávnění.
4. Dedikovaný opt-in `jizda-mobile` / `jizda_app_link` / `jizda-cop://oauth/callback`
   povolit teprve po koordinovaném provisioningu a ověření nového přihlášení.
   Nemigrovat token kopírováním; dosavadní `csm-mobile` se zachovává.
5. Při migraci měření povolit oba klienty pro autentizaci a explicitní cleanup.
   Příjem dávek zůstává na přesném klientovi, stejném pilotním účtu a `shadow_only`.
   Starý klient musí mít vlastní čtení a odvolání souhlasu. Neobnovovat automaticky
   souhlas, sběr, sdílení ani starou RAM frontu.
6. Zobrazit obyčejný kontakt `mailto:podpora@zeleznalady.cz`. Text hlášení má
   maximum 90 dní a 30 dní od prvního uzavření; platí dřívější termín. Audit bez
   textu má maximum 180 dní. Blokování trvá do odblokování nebo odstranění účtu.
7. Jízda provede sériově nativní ověření s Xcode 27.1 (`27A9275`) a fyzickou
   akceptaci této přesné revize. Dřívější sestavení jejího kandidáta tuto změnu
   neověřuje. Skutečné účty se tímto předáním nemažou ani neresetují.

## Provedené ověření

| Oblast | Výsledek |
| --- | --- |
| COP regrese | 1 696 prošlo / 12 přeskočeno; 198 souborů prošlo / 8 přeskočeno |
| Skutečný izolovaný PostgreSQL | 4 závody, restart a změna owner secret prošly; instance zastavena, data odstraněna |
| COP build, lint, skeleton, schémata | Prošlo; 11 JSON schémat |
| OpenAPI | 0 chyb / 24 varování; export synchronizován |
| Rozpočty balíčku, statický runtime a vypnutá veřejná analytika | Prošlo |
| Messaging | 105 testů prošlo; kompilace s warnings-as-errors a diff kontrola prošly |
| Finální SDK Foundation harness | 431 izolovaných kontrol prošlo |
| SDK zdrojové hranice / syntaxe | 52 kontrol / 14 Swift souborů prošlo |
| SDK device contract | 19 fixtures prošlo |
| Čistá aplikace patche / integrita | Všech 24 souborů souhlasí |
| Nativní XCTest tohoto delta | 33 připraveno; 0 spuštěno |

Harness SDK používá syntetické HTTPS/Matrix klienty a vložený Keychain adaptér.
Nedokládá skutečné MatrixRustSDK, APNs, LiveKit ani fyzický telefon. Finální
nezávislá kontrola zdrojového delta nezjistila blokující připomínku k publikaci.
Reindex dočasného COP checkoutu odmítlo Chroma CLI, protože checkout není
vybraným projektem; po začlenění do vybraného projektu se má zopakovat.

## Zbývající akceptační body

Studený start, návrat do popředí s platným cache bootstrapem a obnoveným Matrix
transportem, A→B během každého await, fence při registraci/hlasu/GPS/obnově,
změna připravenosti při stejné generaci, blokování během vložení čekající zprávy
nového účtu do stejné místnosti, retry/odblokování při vypnutém příjmu, starý
klient a odvolání měření, 503, restart, rollback, dva telefony a skuteční poskytovatelé.

Aktivaci stále brání app/installation grant revokace a readback LiveKitu,
doložená migrace neznámých starších Matrix/push instalací, moderátorská
role/proces a životní cyklus produkčního klíče pro důkazy. Celkové odstranění
účtu potřebuje všech 11 skutečných owner důkazů; implementovaná orchestrace
a místní COP adaptér je nenahrazují. SIM dosud nedodal přijatou cleanup hranici
pro všechny uchované dny měření, BYOK a související evidenci.

HTTP 202 vždy znamená čekající stav. `livePermissionsRevoked=false` nesmí být
prezentováno jako dokončené odpojení. Produkční bezpečnostní příznaky ani chat/BYOK
nebyly tímto kandidátem změněny. Kontakt je publikovaný ve zdrojích, jeho živé
nasazení se netvrdí.

Rollback zachová trvalé guards, jejich konfiguraci a secrets, markers, fences,
checkpointy, retenci i vynucování blokací. Před zpřístupněním obnovy ze zálohy
se musí znovu uplatnit odstranění. [Podrobnosti kandidáta](43_ACCOUNT_SAFETY_COMPLETION.md).

## Navazující serverová kontrola — 2026-10-11 17:40 CEST

Jízda potvrdila přijetí v2. Sestavení 1.2 (33) ponechává beze změny; novou
integraci a sériové nativní testy připraví v kandidátu 34. Toto potvrzení
nedokládá, že nové testy nebo instalace již proběhly.

Pouze čtením na `docker.home.cz` ověřeno:

| Oblast | Skutečný produkční stav |
| --- | --- |
| COP checkout | `e99401213efbf9d6a7685443adc318eeeb422c15` |
| COP API image | `sha256:8c61839a458ca82cfc79725b4763759c90d66ffcd31e1e24e2ff5defe9724741`; OCI revize není uvedena |
| Messaging běžící image/revize | `sha256:ff80ec9a89155aae5081b118c6e9900dfccfce6187b90f4a90432c45b04d2079` / `d311b2c` |
| Messaging serverový checkout | `224629034141a1a56f90c94021379a5d52d761fc`; není totožný s deklarovanou revizí běžícího obrazu |
| Zdraví | Oba kontejnery healthy; COP `/health/live` a `/health/ready` HTTP 200 |
| COP bezpečnostní přepínače | `COP_COMMUNICATION_SAFETY_ENABLED`, `COP_JIZDA_DISCONNECT_ENABLED`, `COP_ACCOUNT_ERASURE_ENABLED` nejsou nastavené |
| Messaging bezpečnostní přepínače | `CSM_COMMUNICATION_SAFETY_ENABLED`, `CSM_JIZDA_DISCONNECT_ENABLED`, `CSM_APP_DEVICE_LEDGER_ENABLED`, `CSM_ACCOUNT_ERASURE_ENABLED` nejsou nastavené |
| COP produkční podmínky | Evidence secret, erasure secret a moderator role nejsou nakonfigurované; ověřena pouze přítomnost, žádná hodnota se nevypisovala |

V2 není nasazený. Zdraví dosavadního provozu nedokládá nové autorizované
odpojení ani account-erasure flow. Produkce ani tajné hodnoty nebyly změněny.

Znovu zkontrolované zdrojové podmínky: attested Matrix ledger a selektivní
delete/readback jsou implementované a ověřené syntetickým Synapse HTTP fixture.
Migrace starších zařízení bez ledgeru není dokončená. LiveKit stále vydává
token se společným subject identity a nemá app/installation revoke/readback;
`livePermissionsRevoked` proto zůstává false. SIM nepředal nový přijatý cleanup
kontrakt; jeho poslední stav se nezměnil. Žádný z těchto bodů není nahrazen
105 zdrojovými testy Messaging nebo přípravou klientského kandidáta 34.
