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
Celkové obsazení a volná kapacita X5 po dokončení: **pending final inventory**.

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
Konkrétní restore point a úspěšná izolovaná obnova tohoto bodu zde nejsou
doloženy. Před odstraněním další původní kopie doložte identitu/čas restore
pointu, skutečné zahrnutí X5 a ověřenou obnovu potřebných dat. X5 sama není
nezávislá záloha.

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
`1000 / 10000 / 10000 MB`; ověření 14denní časové politiky je **pending**.
GC se týká pouze tohoto COP builderu. BuildKit data nejsou
obyčejný dokončený job a `cop-storage.py cleanup` je nemaže. Docker image
layers zůstávají v dosavadním daemon storage; tento krok nemění `data-root`.

`scripts/cop-storage-daily.sh` provádí snapshot, bezpečný cleanup dokončených
jobs a retenční preview. Zapojení do pravidelného host scheduleru:
**pending activation evidence**. Při chybě X5 musí běh selhat bez fallbacku.

## Retence a ochrana proti souběhu

| Kategorie | Politika a skutečné vynucení |
| --- | --- |
| Deployment snapshoty | Preview sjednocení 7 různých dnů, 4 ISO týdnů a 3 měsíců; poslední ověřený snapshot vždy chráněn. Automatické mazání vypnuto. |
| Releasy a Docker obrazy | Aktuální a dvě předchozí ověřené obnovitelné verze; chránit všechny používané obrazy i probíhající release. Výběr konkrétních image IDs a automatické mazání zatím vypnuty. |
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
| Nový produkční snapshot a jeho `verify` | **Pending production acceptance record.** |
| Dedicated COP builder | Provisionován/spuštěn, přesné bind volume options a X5 device uvnitř ověřeny; restart `no`, vlastní kapacitní GC. Časová GC politika pending. |
| Denní scheduler | **Pending activation evidence.** |
| Nový API image a produkční konverze | **Pending: API-only overlay nebyl při napsání této evidence nasazen.** |
| Off-server úplná obnova | Uživatelem potvrzené Proxmox zálohování; konkrétní restore point a restore test nedoloženy. |

Plánovaný API overlay vychází z přesně ověřeného produkčního image
`sha256:71c67b2da529450f6c3581799805e352e96167e6c1e79a83743f191fd4699161`
a mění pouze kompilované `media-conversion.js`, `.js.map` a `.d.ts`.
Výchozí server checkout byl `6583cb5ab659044cc681294ee291f9b08135a4bc`;
checkout SHA není důkazem totožnosti běžícího image. Před aktivací doložte
image/layer identitu, syntetický normální start a guard ve skutečném image.

Po aktivaci doplňte: publikovanou revizi, skutečný image ID, zachované mounts
a ostatní služby, HTTP health před/po, ověřenou syntetickou konverzi na X5 a
negativní runtime zkoušku bez očekávaného úložiště. Samotný build tyto body
nepotvrzuje. Výsledek nesmí zlepšovat nebo skrývat již existující upstream
degradaci v `/health/dependencies`.

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
