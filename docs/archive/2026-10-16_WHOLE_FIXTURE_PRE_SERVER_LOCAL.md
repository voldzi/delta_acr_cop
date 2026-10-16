# Společná akceptace odstranění COP/Jízdy

Tento postup používá výhradně označené syntetické kontejnery v jedné izolované
síťové jmenné oblasti. Není to produkční instalátor ani oprávnění k odstranění
skutečného účtu. Úspěch sestavení nebo komponentního testu nenahrazuje závěrečný
výsledek celého postupu.

## Skuteční vlastníci

Test spouští skutečnou produkční kompozici `buildServer`, PostgreSQL a PostGIS,
nezávislý PostgreSQL guard, skutečný Keycloak, SIM, Messaging/Synapse, LiveKit,
S3 a Edge. Nepředává náhradní seznam mazacích adaptérů. Používá dva skutečně
vydané syntetické subjekty Keycloaku ve všech službách. Neotevírá veřejné porty.
Čtecí testovací mosty 4321–4323 pouze volají skutečnou kontrolu vlastních databází
či poskytovatelů; nemohou provést smazání ani vydat pozitivní mazací účtenku.

Privátní manifest `/private/tmp/cop-account-erasure-whole-full-20261016.json`
obsahuje syntetické přihlašovací údaje a má oprávnění 0600. Jeho obsah se
nezobrazuje ani neukládá do Gitu. Metadata produkce se tímto postupem nemění.

## Oddělení opakovaných případů

Negativní případ s původními účty se nepřeznačuje na úspěch a jeho nezávislá
operace, datum, archivní kontrolní součty ani privátní důkazy se nepřepisují.
Nový plný případ má vlastní holder, dvě nově vydané identity Keycloaku a
manifest `cop-account-erasure-whole-full-20261016.json`. Soukromé bootstrapy
se odvozují z názvu případu; jejich předání jinému správci vyžaduje přesný
schválený zdroj a cíl, ověřený hash a oprávnění 0600.

`prepare-whole-aux-providers.py --manifest <privátní-manifest> --component
media|edge` používá stávající přesně připnuté veřejné fixture zdroje a cached
image v tomto holderu. Ukládá pouze skutečné reference do `providerFixtures`.
LiveKit se připravuje explicitními argumenty `--manifest`, `--holder` (ID),
`--owner`, `--name` a `--carrier` v `prepare-livekit-whole-fixture.py`.
`--attach-media-edge` a `--prepare-edge-auth` propojí skutečné nové reference;
`configure-whole-edge-oidc.py --manifest <privátní-manifest>` přepne pouze
přesně ověřený prázdný child Edge na skutečný omezený OIDC service účet.
Samotné capabilities Edge nepotvrzují synchronizaci; tu provede skutečný COP
listener a autorizovaný `/edge/sync` při naplnění společného testu.

Čerstvé potvrzení používá skutečný authorization-code tok s PKCE, `prompt=login`
a `max_age=0`. `auth_time` pochází z podepsaného tokenu skutečného Keycloaku,
nikoli z hodin testovacího klienta. Heslový grant bez `auth_time` jej nenahrazuje.

## Oddělený profil Messaging full-v2

Plný případ používá výhradně nový `run_messaging_approved_joint_full_v2.py`,
modul `cop_account_erasure_full_v2.AccountErasure`, nový manifest rozsahu a
výslovný OTP profil `:full_v2` vázaný na přesný owner nové fixture. Obsahuje
SQL005 a nativní helper proudů; starý v7/CF24 případ se nepovyšuje ani nemění.
Aktuální balení je samostatný `messaging_approved_joint_full_v2.freeze-v3.json`
a privátní archiv `cop-messaging-joint-source-full-v2-v3.tar.gz`.

Po selhání pouze ve známém prázdném bootstrapu může jeho vlastník výslovně
použít `--resume-pristine-bootstrap`. Vyžaduje původní privátní konfiguraci,
přesné svědectví neúspěšného zdroje a holderu, nezměněné omezené role/vlastníky,
prázdné katalogy obou business DB a nepřítomnou evidenci Messaging v guardu.
Nesplnění kterékoli podmínky zastaví postup; tento přepínač nic nemaže ani
neresetuje a nepřijímá neprázdný nebo cizí dataset. Selhané nové kontejnery
uchovají omezené privátní logy 0600 do výslovného koordinovaného úklidu.

COP wrapper před testem a po něm skutečně porovná zdrojové soubory obou
Messaging runtime, importovaný provider, SQL a živý čtecí most s připnutým
profilem. Ověří vlastníka, namespace, image a vypnuté Docker logování. Závěrečný
výsledek `messagingSource` má přesně sedm SHA-256 polí: `scopeSha256`,
`profileSha256`, `sourceArchiveSha256`, `providerSha256`, `clientSha256`,
`helperSha256`, `sql005Sha256`. Tyto otisky nevyjadřují dokončení mazání;
to musí samostatně prokázat skutečný průchod všemi vlastníky a obnovou.

## Spuštění

Po připravení skutečných fixture všemi vlastníky:

```sh
python3 scripts/test-account-erasure-whole-joint.py --bind-readbacks --manifest /private/tmp/cop-account-erasure-whole-full-20261016.json
python3 scripts/test-account-erasure-whole-joint.py --run --manifest /private/tmp/cop-account-erasure-whole-full-20261016.json
```

Bind požaduje skutečně dostupné a neprázdné čtecí výsledky A/B. Samotný bind
nepotvrzuje připravenost mazání; tu znovu prověří skutečný COP controller.
Při chybějící službě test končí jako nepřipravený, nikdy jako úspěšný.

Po skutečném naplnění dat a preflightu coordinator pozastaví přesně čtyři
vlastněné zapisující fixture (SIM Driver/Router a Messaging/Synapse). Vytvoří
skutečné PostgreSQL archivy pěti business databází: `cop_erasure_test`,
`sim_driver_measurements`, `sim_ai_router`, `messaging_joint_test`,
`csm_synapse`. Ověří jejich katalog a SHA-256 a procesy opět uvolní.
`cop_account_safety_guard` se nikdy nezálohuje ani neobnovuje tímto testem.
Tento krok netvrdí snapshot souborů S3, Edge ani Synapse media.

Teprve potom odešle skutečné potvrzení mazání. Ověří zákaz starého přístupu A,
zachování B a původní operaci. LiveKit dostane skutečné hodinové tokeny A/B
vydané současným COP issuerem; jejich granty jsou skutečně evidované. Nejsou
vytvářeni falešní WebRTC účastníci. Test čeká skutečný čas ochranné lhůty a
kontroluje skutečné odmítnutí dříve vydaných tokenů poskytovatelem.

Fáze `actual_online_whole_deletion_verified` znamená dokončení ověřeného online
mazání všech jedenácti vlastníků. `wholeAccountAccepted` je stále `false`.
Závěrečná akceptace vyžaduje skutečnou obnovu a nový průchod všemi kontrolami.

## Skutečný pád a pokračování ve stejné generaci

Nový plný případ vyžaduje `integration.requireControlledCrashRetry=true`.
Před assertem se uloží skutečný HTTP stav prvního potvrzení; neúspěšný pokus se
nikdy zpětně neoznačuje jako 202. Během skutečného čekání na expiraci hlasových
tokenů lze provést `--crash-pending`: pouze po skutečném 202 ověří přesný vlastní
Node PID, čas startu a zdroj, původní nezávislý journal, datum a sealed job.
Zapíše privátní checkpoint, ukončí pouze tento proces signálem SIGTERM a znovu
ověří nulová runtime spojení a nezměněnou evidenci. Jde o skutečný crash test,
nikoli tvrzení o graceful shutdown. Poskytovatelé, guard a carrier zůstanou běžet.

`--continue-confirmed` smí odstranit starý testovací run-lease pouze po ověření
zániku přesného procesu a skutečného crash checkpointu. Před startem workerů
znovu ověří původní journal i existující sealedPrincipal; nevytváří novou operaci
ani identitu. `--retry-confirmed` provede nové skutečné PKCE přihlášení a HTTP
POST se stejnou operací. Samostatně zaznamená jeho skutečný 202 a shodu data.
Ochranná lhůta původních tokenů se neposouvá a nové join tokeny se nevydávají.
Závěrečný pozitivní výsledek musí mít všechny tři důkazy: původní 202, skutečný
pád s původním jobem a skutečný 202 retry; stále navíc vyžaduje mazání všech
vlastníků, zachování B a ověřenou obnovu/replay.

## Obnova v karanténě

Po online ověření COP ukončí listener a uloží soukromý checkpoint. Pevný krok:

```sh
python3 scripts/test-account-erasure-whole-joint.py --restore-cop-database --manifest /private/tmp/cop-account-erasure-whole-full-20261016.json
```

ověří původní archiv a zastavení COP, obnoví pouze jeho vlastněnou business
DB a zavolá skutečnou správcovskou `transitionAccountErasureDataset`. Nová
inkarnace a generace vyžadují replay; tento krok sám nevytváří společné
pozitivní potvrzení obnovy. Ostatní databáze obnovují jejich vlastníci podle
svých přesných postupů, s nezměněnou nezávislou evidencí mazání. Neověřený nový
dataset musí zůstat nedostupný; dokončení nesmí být dovozováno ze staré účtenky.

Společný operátorský podklad se smí vytvořit až po skutečných obnoveních a
ověřeních jejich vazeb. Není dovoleno ručně vyrobit pozitivní soubor namísto
obnovy. Původní identita/MAC, operationId a requestedAt zůstávají zachovány.
Chybějící sealedPrincipal se automaticky nedoplňuje z pseudonymního journalu;
použije se existující cesta s čerstvě ověřeným skutečným aktérem.

Závěrečný výsledek obsahuje hash skutečné zkompilované API closure, revizi,
pravdivý příznak změněného pracovního stromu a identitu základního Node image.
Tento image není automaticky produkční kandidát. Produkční nasazení musí
samostatně prokázat shodu svého runtime a projít produkčním postupem.

## Rozsah důkazu a úklid

Tato fixture neprokazuje TLS produkce, fyzický výmaz Proxmox/PBS archivů ani
úspěšnou obnovu celého virtuálního stroje. Zálohy zůstávají do řízené expirace;
obnovená data chrání karanténa a skutečný replay nezávislé evidence v rámci
schválené důvěry ve správce podle ADR 0055.

Při úklidu kontrolujte přesný owner label a odstraňujte pouze konkrétní
vlastněné kontejnery, named volumes a privátní syntetické podklady. Sdílený
holder se odstraňuje až po souhlasu všech vlastníků fixture. Žádný plošný
Docker prune, produkční volume, změna `data-root` ani přímá manipulace s
`/var/lib/docker` sem nepatří.
