# Společná akceptace odstranění COP/Jízdy

Aktuální postup připravuje nový izolovaný případ `full-server-20261016`.
Zdroj a místní testy nejsou akceptací poskytovatelů ani nasazením do produkce.
Dva dřívější negativní případy zůstávají beze změny. Jejich původní 503, operace,
časy, kopie dat a důkazy se nepřeznačují na pozitivní výsledek. Starší postup je
v [archivu](../archive/2026-10-16_WHOLE_FIXTURE_PRE_SERVER_LOCAL.md).

## Hranice nového případu

Celý koordinátor běží jako `voldzi` na Linuxovém `docker.home.cz` z veřejného
source packu pod `/srv/x5-production/staging/cop/`. Mac obdrží pouze sanitizované
fáze, reference kontejnerů, otisky a výsledky. Nepřenáší syntetická hesla, tokeny
ani privátní manifest. Kontejnery nesmějí mít veřejné porty, produkční mounty
ani Docker socket. Používají jen předem ověřené cached image a přesné nové ownery:

- holder `cop-messaging-joint-c8237f4e9a61-pg`, owner `cop-messaging-joint-c8237f4e9a61`;
- COP owner `cop-erasure-whole-92f0a7d635c8`, carrier s příponou `-node`;
- privátní host adresář `/dev/shm/cop-whole-server-20261016`, skutečný tmpfs,
  vlastník `voldzi`, oprávnění 0700;
- host manifest `cop-account-erasure-whole-full-server-20261016.json` v tomto
  adresáři, 0600, jediný odkaz, bez symlinků;
- identity COP/SIM a Keycloak secrets pouze v serverové RAM a vlastním tmpfs,
  soubory 0600. KC admin heslo prochází stdin do souboru a pak do RAM child
  procesu; není v Docker Config.Env, argv, logu, source packu ani Gitu;
- dosavadní S3/LiveKit provider fixture uchovávají své pouze syntetické konfigurace
  0600 ve vlastních označených private volumes na Docker serveru. Tento odlišný
  provider kontrakt se nemění na tvrzení, že jde o tmpfs. Log driver je `none`.

`--server-local` je výslovná volba. Mění pouze transport koordinátoru ze SSH na
místní Docker příkazy. Nevytváří náhradní adaptéry ani endpointy. Historické Mac
větve se pro tento nový případ nepoužijí.

## Zdroj a kapacita před vytvořením

Před první tvorbou je povinný veřejný JSON `cop-whole-public-source-proof-v1`
uvnitř source packu a jeho explicitní CLI SHA-256. `build_source_proof(ROOT)` v
`whole_server_local.py` změří skutečný Git HEAD, čistotu relevantních zdrojů,
compiled API closure, čtyři runtime resources, skutečnou transitivní workspace
closure a přesné fixture soubory. Nepřipisuje neexistující Git revizi. Root jej
připraví až po finálním sestavení a publikaci; dirty source se odmítá.

Do proofu se doplní `messagingSource` s přesnými `profilePath`, `profileSha256`,
`archivePath`, `archiveSha256` a novým `ownerLabel`. Profile i archiv musí ležet
pod `public-fixture/` tohoto source packu a jejich skutečné bytes musí sedět.
Chybějící finální Messaging scope/provider/source piny znamenají nepřipravenost,
nikoli možnost použít dřívější negativní profil.

Kontrola požaduje skutečný samostatný X5 filesystem, nejméně 4 GiB volného místa,
5 GiB `MemAvailable`, 2 CPU a 256 MiB volného host tmpfs. Neprovádí prune,
restart jiných aplikací, změny sdíleného builderu ani úklid negativních případů.
Nedostatek kapacity se řeší samostatným konkrétním návrhem.

Každá akce používá stejné argumenty `--server-local`, `--source-proof` a
`--source-proof-sha256`. Manifest nikdy neleží na Macu. `--prepare-holder`
vytvoří pouze přesný nový prázdný PG18 holder. `--prepare-keycloak` vytvoří dvě
nové skutečné identity; `--export-sim-bootstrap` odvodí oba bootstrapy přímo v
carrieru z aktuálních COP helperů a devíti skutečných UTC dnů. Main SIM/Messaging
čte pouze tyto schválené serverové reference:

- `/dev/shm/cop-whole/bootstrap/messaging.json`;
- `/dev/shm/cop-whole/bootstrap/sim.json`.

Další akce zůstávají `--prepare-cop-database`, `--prepare-cop-postgis`,
`--prepare-code-login`, `--attach-media-edge`, `--prepare-edge-auth`,
`--bind-readbacks`, `--run`. Pomocné provider skripty přijímají tentýž server-local
source proof. Skutečné čtecí mosty 4321–4323 nepředstírají odstranění a nevydávají
pozitivní mazací účtenku. Bind musí ověřit neprázdné A/B readbacky a skutečné
provider image, owner, namespace, logování a runtime bytes.

## Skutečný výpadek, pád a opakování

Po reálném seedingu a owner preflightu se pozastaví čtyři přesní zapisující
vlastníci SIM Driver/Router a Messaging/Synapse. Skutečný `pg_dump` uloží pět
business databází `cop_erasure_test`, `sim_driver_measurements`, `sim_ai_router`,
`messaging_joint_test`, `csm_synapse`; katalog a SHA-256 se ověří a procesy se
uvolní. Nezávislý `cop_account_safety_guard` se nikdy nedumpuje ani neobnovuje.
Tyto kopie vznikají **před prvním potvrzením**. Provider prepare/capture probíhá
až v owner erase; jeho nová svědectví nesmějí být zpětně připsána starému dumpu.
Tento krok netvrdí snapshot souborů S3, Edge ani Synapse media.

Nový případ vyžaduje skutečný výpadek Messaging. Fixture hook pozoruje pouze
první skutečný POST `/api/v1/communication/account-erasure/owner-v2`. Coordinator
nejdřív skutečně ověří nezávislý guard a existující lokální sealed job se stejnou
operací/datem; potom pozastaví přesný vlastní Messaging kontejner. Původní fetch
se stále provede a skutečně selže. Hook nevyrábí HTTP odpověď ani readiness.
Pozastavení před admission by neprokazovalo stejný durable job a nepoužívá se.

Po skutečném 503 se uchová `initialHttpStatus:503` a
`initialNormal202Verified:false`. Coordinator uvolní pouze jím ověřený vlastní
kontejner, skutečně načte capabilities a provede nové PKCE přihlášení a skutečný
HTTP POST se stejným operationId. Až skutečný 202 založí oddělený
`recoveryAccepted202Verified`. Potom se přesně ověří Node PID/start/source,
nezměněný journal a sealed job, pošle se SIGTERM pouze tomuto procesu a znovu
ověří nulová runtime DB spojení. Carrier/guard/providers zůstávají běžet.

Continuation před workerem znovu ověří originální journal, datum i existující
sealedPrincipal. Nevytváří identitu z pseudonymního journalu. Další skutečný
PKCE/HTTP202 je oddělený post-crash retry; první recovery202 se za něj nepovažuje.
Neznámé nebo neúplné důkazy končí nepřipraveností, nikoli pozitivním stavem.

LiveKit používá skutečné hodinové granty A/B. Ochranná lhůta trvá nejméně 3690 s
od původního požadavku; žádné posouvání hodin, zkrácení TTL ani nové join tokeny.
Provider musí skutečně vrátit 401 pro původní token. Vlastnictví B a přístup SIM
musí zůstat zachovány. Žádní falešní WebRTC účastníci se nezakládají.

## Online výsledek a obnova

`actual_online_whole_deletion_verified` znamená skutečný průchod všemi jedenácti
vlastníky a readbacky. Pořád má `wholeAccountAccepted:false`. Teprve potom se COP
zastaví, ověří nulová spojení, obnoví jeho vlastní skutečný dump a provede skutečná
správcovská změna inkarnace/generace do karantény. Ostatní vlastníci obnovují své
business DB podle vlastních přesných postupů. Nezávislý guard se nemění ani
nevrací zpět. Originální identity/MAC, operationId a requestedAt zůstávají platné.

Nový dataset je nedostupný do aktuálního replay a owner readbacků. Žádný
statický catalog JSON nebo ruční pozitivní ack nenahrazuje obnovu. Závěrečný
`wholeAccountAccepted:true` vyžaduje současně skutečné online mazání, izolaci B,
pravdivé HTTP503/recovery202/crash/retry důkazy, obnovení všech vlastníků a nový
replay/readback. Zálohy poskytovatele zůstávají do řízené expirace; netvrdí se
fyzické smazání Proxmox/PBS kopií. Obnova je v karanténě a důvěřuje správci dle
ADR0055. Produkční zapnutí má navíc vlastní Root, source/image a health gate.
