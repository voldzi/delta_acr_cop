# 19 COP storage on X5

Datum evidence: 7. října 2026. Rozsah: COP na `docker.home.cz`.
Rozhodnutí: [ADR 0038](../adr/0038_COP_X5_OPERATIONAL_STORAGE_BOUNDARY.md).

## Rozdělení dat

| Cesta | Účel | Pravidlo |
| --- | --- | --- |
| `/srv/cop` | Aktivní konfigurace, Git checkout a deployment | Zachovat aktuální provozní soubory; `.env` zůstává chráněná. |
| `/srv/x5-production/backups/cop` | Zálohy aplikační konfigurace a Git | Privátní snapshoty; nejde o zálohu databáze či všech uživatelských dat. |
| `/srv/x5-production/archives/cop` | Dokončené releasy a dlouhodobé artefakty | Neodvozovat nepotřebnost pouze ze stáří/názvu. |
| `/srv/x5-production/cache/cop` | Obnovitelné COP pracovní cache | Úklid jen výslovně označených dokončených jobs; dedikovaný builder samostatně. |
| `/srv/x5-production/staging/cop` | Dočasné COP pracovní soubory | Aktivní jobs a media konverze mají vlastní ochranu. |

Ověřený X5 je samostatný připojený `ext4` filesystem s UUID
`2f93f595-b61b-4eea-9054-7afa9b275b5b`. Při inventuře mělo X5
`st_dev=2065`, interní systémový filesystem `st_dev=64512`. Číslo zařízení
nenahrazuje UUID a může se po rebootu změnit. Při změně je nutné znovu ověřit
skutečný mount a UUID a teprve pak aktualizovat očekávané číslo zařízení.

Nástroje musejí odmítnout chybějící mount, jiné UUID/filesystem, read-only X5,
stejné zařízení jako `/`, symlinkové cíle a nedostatečná oprávnění. Nikdy
nevytvářejí náhradní backup/cache/staging na interním disku.

## Skutečně provedené přesuny

| Zdroj | Cíl a stav |
| --- | --- |
| `/home/voldzi/cop-deployments` | Přesunuto do `/srv/x5-production/archives/cop/deployments`; ověřena integrita a izolovaná obnova. Původní cesta je kompatibilní symlink na tento cíl. |
| Legacy `cop-poc-backups`, `codex`, `deploy` | Ověřené kopie v `/srv/x5-production/backups/cop/legacy`; původní kopie zatím ponechány. Nejsou automaticky způsobilé k mazání. |

Uvolněná alokace interního disku po přesunu deployment archivu:
**2 799 202 304 B** (přibližně 2,80 GB / 2,61 GiB).
Tato hodnota neobsahuje dosud ponechané legacy zdroje.

Závěrečná inventura 7. 10. 2026 po přesunu a cíleném úklidu obrazů:

| Úložiště | Obsazeno | Volno |
| --- | ---: | ---: |
| Interní filesystem `/` | 198 014 734 336 B | 63 274 295 296 B (58,9 GiB) |
| X5, celý filesystem | 87 341 367 296 B (81,3 GiB) | 72 016 814 080 B (67,1 GiB) |

COP adresáře na X5 při samostatné inventuře zabíraly přibližně **7,1 GiB**:
backups 718 946 304 B, archives 6 884 737 024 B, cache 544 768 B a staging
483 328 B, celkem 7 604 711 424 B alokace. Inventury probíhaly vedle práce
jiných aplikací; celkový rozdíl volného místa hostu nelze připsat COP.

Cíleně bylo odstraněno **41 starých COP obrazů / 58 tagů**, až po archivaci
a ověřeném načtení 51 obrazů podle immutable ID a jejich vrstev. Archiv
`/srv/x5-production/archives/cop/images-2026-10-07T124438Z-5eb81f82c23a488db263e9de57c92264/images.tar.gz`
má 4 081 497 507 B. Aktuální tagy se při obnově nezměnily. Zůstalo 10
chráněných COP obrazů; používané obrazy včetně zastavených kontejnerů se
nemažou. Kvůli sdíleným vrstvám a souběžným změnám jiných aplikací není
samostatná fyzicky uvolněná alokace Docker obrazů vyčíslena. Prokazatelně
připsaná úspora COP tak zůstává 2,61 GiB přesunutého souborového archivu.

Privátní evidence kopie, metadat a izolované obnovy je na hostu v
`/srv/x5-production/archives/cop/storage-migration-20261007T115738Z/migration-proof.json`.
Manifesty obsahují pouze provozní evidenci v chráněném COP adresáři;
nepublikujte jejich privátní obsah nebo hash souborů se secrets.

Aktivní PostgreSQL/Patroni databáze, fronty, externí S3 média a
`cop-edge-data` volume nebyly přesunuty. Edge obsahuje stav, cursor a outbox;
není běžná cache. Tile cache mimo tento host není součástí změny. Docker
`data-root`, sdílené buildery a jiné aplikace zůstávají spravované samostatně.

## Snapshot, kontrola a obnova

`scripts/cop-storage.py` používá pevné produkční cesty a UUID. Před každým
zápisem a po získání společného `.storage.lock` znovu ověřuje X5. Privátní
aplikační adresáře mají režim `0700`, snapshoty a jejich soubory `0600`.
Sdílené rodičovské adresáře X5 se tímto nástrojem nepřepisují ani nechmodují.

Snapshot obsahuje pouze:

- chráněnou `.env` a výslovně předané skutečné Compose soubory/overrides;
- Git bundle a patch změněných tracked souborů;
- privátní manifest integrity a potřebných metadat.

Snapshot **nezahrnuje databázi, aktivní fronty, média ani obsah untracked
souborů**. U untracked souborů zaznamená pouze počet. Secrets, obsahy souborů
a jejich hashe se nevypisují do běžného výstupu.

Příklad ověření na hostu:

```bash
cd /srv/cop
python3 scripts/cop-storage.py preflight
python3 scripts/cop-storage.py snapshot \
  --compose-file docker-compose.yml \
  --compose-file docker-compose.driver-measurements.yml \
  --compose-file docker-compose.x5.yml
python3 scripts/cop-storage.py verify /srv/x5-production/backups/cop/<snapshot>
python3 scripts/cop-storage.py retention-plan
```

Pokud je nasazený další override, například `docker-compose.ai-router.yml`,
předejte jej snapshotu také. Neobnovujte konfiguraci bez znalosti skutečné
sady použitých overrides.

Úspěšné `verify` znamená porovnání integrity, izolovanou obnovu konfigurace
včetně vlastníků, režimů, času a podporovaných rozšířených atributů a ověření
samostatného Git bundlu proti prázdnému repozitáři. Ověření neaktivuje
obnovené soubory v `/srv/cop`. `databaseRestoreVerified=false` je záměrné;
není to důkaz obnovitelnosti databáze nebo celé aplikace.

Uživatel potvrdil off-server Proxmox zálohování celého hostu včetně X5.
Správu jeho bodů obnovy řeší Proxmox; konkrétní bod obnovy není podmínkou
dokončení této COP změny. COP samostatně ověřil integritu přesunutých dat,
izolovanou obnovu archivů, konfigurace a Git. Test úplné obnovy hostu se
v této změně neprováděl. X5 sama není nezávislá záloha.

### Chráněná změna produkční konfigurace

Samostatně schválená instalace klíče pomocí
`scripts/install-openai-mcp-env.mjs` nyní používá stejný COP storage zámek a
privátní X5 snapshot. Produkční větev nevytváří další `.env.pre-openai-*`
kopii na interním disku. Python ověří zděděný descriptor i X5; před atomickou
výměnou `.env` se mount kontroluje znovu. Následující postup pouze popisuje
úložiště; sám o sobě neschvaluje aktivaci AI nebo vložení nového klíče.

```bash
cd /srv/cop
umask 077
python3 scripts/cop-storage.py preflight >/dev/null
exec 9>>/srv/cop/.storage.lock
flock -n 9
export COP_STORAGE_LOCK_FD=9
node scripts/install-openai-mcp-env.mjs '<protected-pending-file>' /srv/cop/.env
flock -u 9
exec 9>&-
```

Placeholder nahraďte existujícím chráněným pending souborem; hodnotu klíče
nevkládejte do argumentů, příkazové historie ani dokumentace. Installer
spotřebuje pending soubor až po úspěšné změně. Jeho současná funkce také mění
nastavení OpenAI MCP; proto jej nespouštějte jako pouhý storage test.

## Runtime ochrana media konverzí

Produkční `docker-compose.x5.yml` váže
`/srv/x5-production/staging/cop/media-conversions` na
`/data/cop-media-conversions`, zakazuje `create_host_path` a marker
`.cop-storage.json` váže samostatně read-only. Předem vytvořený chráněný
marker musí obsahovat:

```json
{"uuid":"2f93f595-b61b-4eea-9054-7afa9b275b5b"}
```

Konverze používají tyto tři proměnné:

```env
COP_MEDIA_SPATIAL_CONVERSION_WORKDIR=/data/cop-media-conversions
COP_MEDIA_SPATIAL_CONVERSION_EXPECTED_STORAGE_UUID=2f93f595-b61b-4eea-9054-7afa9b275b5b
COP_MEDIA_SPATIAL_CONVERSION_EXPECTED_DEVICE_ID=2065
```

Před každým skutečným conversion jobem API ověřuje úplnou konfiguraci,
explicitní absolutní existující adresář bez symlinkových předků, shodu
`stat.dev` a pravidelný marker na témže zařízení s přesným UUID. Marker nesmí
být symlink ani group/world writable. Při chybě nevznikne pracovní soubor,
nespustí se `ffmpeg`, nepoužije se `/tmp` a derivát přejde do `failed`.
V guardovaném režimu API adresář samo nevytváří.

Samotná deployment kontrola ani `create_host_path:false` nejsou runtime
ochrana: Docker může existující kontejner automaticky restartovat při rebootu.
Proto musí být nasazený API kód s kontrolou úložiště pro každý job, také při
rollbacku. Původní lokální/dev chování bez guard proměnných zůstává dostupné;
produkce je nesmí vynechat.

Pracovní vstup konverze je vytvářen výhradně jako nový soubor `0600`.
Vstup a výstup se po skončení jobu odstraňují. Zbytky po pádu nejsou
automaticky odstraněny běžným job cleanupem: nejprve potvrďte, že do nich
nepíše žádná konverze. Konverzní adresář není generic dokončený job.

## Deployment a builder

Budoucí běžné nasazení používá `scripts/deploy-production.sh` s explicitními
službami. Wrapper:

1. Ověří X5 a získá společný zámek.
2. Zachová základní Compose, driver-measurements, X5 a přítomný AI Router
   override a před změnou vytvoří jejich privátní snapshot.
3. Vytvoří vlastní staging/cache jobs na X5 a drží jejich `.job.lock` po
   celou dobu zápisů. `TMPDIR` a `XDG_CACHE_HOME` míří na tyto jobs.
4. Vyžaduje pouze dedikovaný builder `cop-x5` a kontroluje jeho bind volume;
   nesmí použít nebo prunovat sdílený builder.
5. Ověří přítomnost runtime guardu v API image, aktivuje pouze explicitně
   zadané služby a porovná HTTP health a veřejné demo s původním stavem.
6. Označí jobs jako dokončené až po skončení zápisů a vypíše retenční návrh.

Příklad po dokončené akceptaci této změny:

```bash
cd /srv/cop
bash scripts/deploy-production.sh cop-api
```

Dedikovaný builder byl provisionován a spuštěn; X5 `st_dev=2065` byl
ověřen také uvnitř `/var/lib/buildkit`. Očekávaný
volume `buildx_buildkit_cop-x50_state` má local bind driver s `device`
`/srv/x5-production/cache/cop/buildkit`, `type=none`, `o=bind`; stejnojmenný
builder container jej musí používat pro `/var/lib/buildkit`.
`scripts/verify-cop-builder.py` tyto vztahy pouze kontroluje.

Builder má `restart=no` a musí být spouštěn až po ověření X5, bez autonomního
startu proti neověřenému mountu. Jeho vlastní kapacitní GC argumenty jsou
`1000 / 10000 / 10000 MB`. Denní údržba používá pouze tento builder s
`--filter until=336h --max-used-space 10gb`; první skutečný běh prošel a
uvolnil 0 B. Syntetický build `FROM scratch` ověřil zápis přes X5 builder.
GC se týká pouze tohoto COP builderu. BuildKit data nejsou
obyčejný dokončený job a `cop-storage.py cleanup` je nemaže. Docker image
layers zůstávají v dosavadním daemon storage; tento krok nemění `data-root`.

`scripts/cop-storage-daily.sh` provádí snapshot, bezpečný cleanup dokončených
jobs, GC dedikovaného builderu a retenční preview. Je zapojen do vlastního
spravovaného COP bloku uživatelského cronu v **03:17 Europe/Prague**; ostatní
záznamy nebyly změněny. Celý skript byl spuštěn také ručně a prošel. Jde o
ověření aktuální konfigurace a jednoho běhu, nikoli o dlouhodobou historii
automatického provozu. Při chybě X5 běh selže bez fallbacku.

## Retence a ochrana proti souběhu

| Kategorie | Politika a skutečné vynucení |
| --- | --- |
| Deployment snapshoty | Preview sjednocení 7 různých dnů, 4 ISO týdnů a 3 měsíců; poslední ověřený snapshot vždy chráněn. Automatické mazání vypnuto. |
| Releasy a Docker obrazy | Pro API a web jsou vybrány a izolovaně ověřeny aktuální a dvě předchozí verze uvedené níže. Chráněny zůstávají také všechny používané obrazy a probíhající release. Automatické mazání vypnuto; případný jednotlivý úklid vyžaduje ověřený archiv a opakovanou kontrolu použití. |
| Dokončené tool-owned cache/staging jobs | Úklid nad 14 dní nebo nad společný limit 10 GiB dokončených spravovaných jobs, od nejstarších. Každý kandidát musí mít platný vlastní manifest, `completed`, `rebuildable` a volný zámek. |
| Aktivní, neznámé nebo `hold` jobs | Vždy chráněné. Pád produceru sám o sobě neznamená dokončení. |
| Audit, původní uživatelská data, legacy archivy | Žádné automatické mazání; samostatně schválená politika. |

10 GiB není filesystem quota ani pevná hranice všech aktivních či neznámých
dat. Monitorujte celkové obsazení X5 a volnou rezervu samostatně. Cleanup
nesmí následovat symlinky, zasáhnout souběžného writera, procházet jinou
aplikaci ani manipulovat s `/var/lib/docker`.

## Akceptace a zatím otevřené body

| Kontrola | Evidence/stav |
| --- | --- |
| Skutečný X5 UUID a samostatný ext4 filesystem | Ověřeno při inventuře 7. 10. 2026. |
| Deployment archiv: kopie, integrita, izolovaná obnova a kompatibilní cesta | Ověřeno; uvolněno 2 799 202 304 B. |
| Legacy kopie | Ověřeny; originály ponechány. |
| Media runtime guard | 20/20 cílených testů; skutečné default-converter I/O s executable syntetickým nástrojem, včetně negativních vstupů bez zápisů/spuštění, symlinků, env wiring, opakovaných jobs a dev regrese. |
| API a jeho dependency build | Exit 0; čerstvý forced TypeScript build, cílený ESLint a diff check exit 0. |
| Storage tools: Linux metadata, souběh a retention | 19/19 testů PASS v Linux prostředí; izolované/syntetické přípravky. |
| Produkční snapshoty a jejich `verify` | Po nasazení ověřeny snapshoty `2026-10-07T122739.950196Z`, `2026-10-07T122936.575359Z` a `2026-10-07T123157.760725Z`: izolovaná obnova konfigurace/metadat a Git bundlu; nikoli DB. |
| Dedicated COP builder | Přesné bind volume options a device `2065` ověřeny také uvnitř builderu; restart `no`; syntetický build prošel; denní GC s 336 hodinami a 10 GB prošlo, uvolnilo 0 B. |
| Denní scheduler | Aktivní COP blok 03:17 Europe/Prague; ručně ověřen celý denní běh. |
| Nasazený API guard | Skutečný image, jeho JS hash, env a X5 bindy včetně read-only markeru ověřeny v produkčním kontejneru. Zdraví ověřeno bez změny ostatních služeb. |
| Skutečný `ffmpeg` ve stejném API image | Dva izolované syntetické jobs dosáhly `ready`; ověřen SBS výstup 128 × 48, X5 device `2065`, read-only marker a žádné pracovní soubory v interním `/tmp`. Bez sítě a produkčních secrets. |
| Nesprávné zařízení / chybějící marker | Izolované runtime jobs ve skutečném image skončily `failed` před vytvořením pracovních souborů; žádný interní fallback. X5 nebyla odpojována z produkce. |
| Ověřené rollback API a web verze | Aktuální API a dvě předchozí API verze prošly izolovaným skutečným startem a HTTP health 200. Tři chráněné web verze prošly HTTP 200 a kontrolou osmi HTML/assets očekávání každé varianty. |
| Cílený úklid starých obrazů | Archiv 51 obrazů ověřen a znovu načten podle immutable ID a vrstev bez změny aktuálních tagů; následně odstraněno 41 obrazů / 58 tagů. 10 chráněných obrazů ponecháno. |
| Off-server zálohování | Uživatelem potvrzené Proxmox zálohování včetně X5; správa bodů obnovy náleží Proxmoxu. Úplná obnova hostu nebyla součástí této změny. |

Nasazený API overlay vychází z přesně ověřeného původního produkčního image
`sha256:71c67b2da529450f6c3581799805e352e96167e6c1e79a83743f191fd4699161`
a mění pouze kompilované `media-conversion.js`, `.js.map` a `.d.ts`. Jeho
skutečný image ID je
`sha256:e76a3323f761662d48fe4126a2fbc477adf6c872307888283db37aafed86c144`.
Ověřený SHA-256 nasazeného JS je
`f7d768583e164f750a707d929fa9d0c085cf4a9663e4de6680cd9e6bd174c145`;
původní image layers jsou přesným prefixem nového image. Publikovaná a
nasazená zdrojová revize této změny je
`9a05cbfe19605f6391b925a70d8ad2644c31ac4c`; závěrečná dokumentace a denní
skript následují v samostatné revizi téže větve `codex/cop-x5-storage`, bez
další změny API image. Výchozí server checkout byl
`6583cb5ab659044cc681294ee291f9b08135a4bc`; checkout SHA sám o sobě
nenahrazuje ověření běžícího image.

API změna zachovala nesouvisející env, sítě a runtime konfiguraci. Ostatní COP
kontejnery ani jejich image nebyly touto aktivací nahrazeny. Produkční health
bylo ověřeno před i po změně; již existující upstream degradace nebyla
přeznačena na úspěch.

Chrání se také tyto dvě skutečně nastartované předchozí API verze:
`sha256:71c67b2da529450f6c3581799805e352e96167e6c1e79a83743f191fd4699161`
a `sha256:a5d442589f67e1495a41787cf104af71b5930f9ba0d33ca4cc3d2e66fa509cec`.
Pro web byly ověřeny a chráněny image
`sha256:227eb3f22c55de97cebe466dbcefc48677fc57a424b3ef838d6ce3d208c99d89`,
`sha256:3cbb3e704c9407d9b23d69353c87ec2221fe6c03da187f6f7742f6e414fd6f10`
a `sha256:27ac815207d0130a2b434aa8142d789bfa39e66c6c847e69e9a93d9d2ead9908`.
Starší API předcházejí runtime guardu: rollback vyžaduje vypnuté konverze
podle postupu níže. Izolovaný start potvrzuje spuštění a dostupnost
testovaných endpointů, nikoli plnou obnovu účtů či dat. Dva první izolované
web pokusy chybně použily UID 1000 a skončily `EACCES`; opravený přípravek
použil skutečného uživatele image a správný pracovní adresář. Produkční web
se kvůli těmto pokusům neměnil.

U chatu jsou zachovány obě dostupné verze; u edge a MCP jediná dostupná
aktuální verze. Dvě starší ověřené verze tam nejsou doloženy. Celý ověřený
archiv obrazů je chráněný, automaticky se neexpiruje. Budoucí cílený úklid
vyžaduje opětovnou inventuru, ověření obnovy a kontrolu všech kontejnerů.

### Další zdroje zápisů

U pěti COP služeb byl zjištěn log driver `json-file` a prázdné kontejnerové
log options (`Config={}`); není zde doložen vlastní kontejnerový limit
velikosti nebo retence. Logy nebyly plošně mazány ani označeny za cache.
Před jejich omezením či přesunem je nutné klasifikovat auditní evidenci,
potvrdit požadovanou retenci a připravit samostatný provozní postup. Tento
krok nemění globální Docker `data-root` ani manipulaci s jeho interními
soubory. Stejně samostatný plán vyžaduje případný přesun databází, front a
ostatního trvalého provozního stavu.

## Rollback

1. Zachovejte databáze, fronty, uživatelská data, X5 kopie a secrets; neobnovujte
   celý stack jen kvůli API storage změně.
2. Ověřte X5 a vyberte přesnou ověřenou předchozí API image podle release
   evidence, nikoli odhadnutého mutable tagu.
3. Pokud předchozí API neumí runtime guard, nejprve vypněte
   `COP_MEDIA_SPATIAL_CONVERSION_ENABLED`. X5 override, UUID/device nastavení
   a vázané cesty ponechte. Starý kód nesmí znovu převádět do `/tmp`.
4. Vraťte pouze `cop-api`; zachovejte všechny ostatní schválené overrides a
   servisní konfiguraci. Ověřte zdraví a funkci, která změnu vyvolala.
5. Při nedostupném X5 ponechte konverze a úložné operace odmítnuté. Archivní
   symlink neobracejte na novou interní cache a neprovádějte hromadné kopírování
   či mazání. Návrat archivu na interní disk vyžaduje zvlášť ověřenou kapacitu,
   konzistentní kopii a integritu; původní X5 kopie se tím nemaže.

Rollback nepoužívá plošný prune, mazání volumes ani ruční operace uvnitř
Docker data-root. Úplná obnova DB/S3/hostu má vlastní provozní postup a není
nahrazena ověřením konfiguračního snapshotu.

Privátní původní konfigurace a připravený API rollback jsou v
`/srv/x5-production/archives/cop/api-storage-20261007`; jeho
`deployment-proof.json` dokládá skutečný image a zachované nastavení.
Při obnově staršího obrazu z uvedeného `images.tar.gz` načtěte archiv přes
Docker, porovnejte ID a vrstvy s privátní `verification.json` a teprve pak
explicitně vyberte požadované ID pro danou službu. Archiv je bez mutable
tagů; nezaměňuje běžící tagy a nepředstavuje pokyn ke spuštění celého stacku.
