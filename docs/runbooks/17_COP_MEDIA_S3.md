# COP Media S3

## Produkční stav

Od 4. srpna 2026 ukládá COP média do centrálního S3-compatible úložiště.

| Položka | Produkční hodnota |
| --- | --- |
| Interní S3 endpoint | `http://storage.home.cz:8333` |
| Bucket | `cop-community-media` |
| Globální prefix | žádný |
| Klíče objektů | `community-reports/...` |
| S3 identita | `cop-production` |
| Oprávnění | `Read`, `List`, `Tagging`, `Write` pouze pro `cop-community-media` |

Přístupové klíče nejsou součástí repozitáře ani dokumentace. Jsou uložené
pouze v produkční konfiguraci `/srv/cop/.env` na `docker.home.cz`.

Migrace byla ověřena porovnáním zdroje a cíle:

- zdroj: 25 objektů, 617 670 038 B;
- cíl: 25 objektů, 617 670 038 B;
- COP API po přepnutí prošlo kontrolou zdraví;
- stávající web `https://cop.zeleznalady.cz` po přepnutí odpovídal.

## Veřejná cesta médií

Migrací nevznikl nový veřejný endpoint médií. HTTPS klienti používají stávající
same-origin upload fallback COP. `COP_MEDIA_S3_PUBLIC_ENDPOINT` proto zatím
zůstává na historické HTTP hodnotě. HTTPS klient ji nesmí použít jako přímý
mixed-content upload a přejde na bezpečný aplikační fallback.

Toto nastavení je záměrné, dokud nebude samostatný veřejný HTTPS media endpoint
navržen, publikován a ověřen. Starý SeaweedFS a jeho data se do té doby nesmí
mazat.

## Produkční konfigurace

COP je nasazený přes Docker Compose z `/srv/cop` na `docker.home.cz`. Pro média
jsou rozhodující následující proměnné:

```env
COP_MEDIA_STORE=s3
COP_MEDIA_S3_ENDPOINT=http://storage.home.cz:8333
COP_MEDIA_S3_PUBLIC_ENDPOINT=http://docker.home.cz:8334
COP_MEDIA_S3_REGION=us-east-1
COP_MEDIA_S3_BUCKET=cop-community-media
COP_MEDIA_S3_ACCESS_KEY_ID=<uloženo pouze v /srv/cop/.env>
COP_MEDIA_S3_SECRET_ACCESS_KEY=<uloženo pouze v /srv/cop/.env>
```

Po změně konfigurace se znovu vytváří pouze služba `cop-api`:

```bash
cd /srv/cop
docker compose up -d --force-recreate cop-api
```

Následně se kontrolují `/health/ready` a `/health/dependencies`.

## Rollback

Před migrací byla vytvořena záloha produkční konfigurace. Pro návrat:

1. V `/srv/cop/.env` vraťte ze zálohy proměnné
   `COP_MEDIA_S3_ENDPOINT`, `COP_MEDIA_S3_BUCKET`,
   `COP_MEDIA_S3_ACCESS_KEY_ID` a `COP_MEDIA_S3_SECRET_ACCESS_KEY`.
2. Neměňte ostatní proměnné ani databázová metadata příloh.
3. Znovu vytvořte `cop-api`:

   ```bash
   cd /srv/cop
   docker compose up -d --force-recreate cop-api
   ```

4. Ověřte `/health/ready`, `/health/dependencies`, upload a načtení přílohy.

Rollback nemaže žádné objekty na novém ani starém úložišti.

## Podmínky pro vyřazení starého SeaweedFS

Staré SeaweedFS je pouze označené jako nepoužívané pro COP. Před jeho
vyřazením musí správce doložit:

1. úspěšný upload nové přílohy v COP;
2. otevření nové přílohy;
3. otevření alespoň jedné přílohy existující před migrací;
4. několik dní běžného provozu bez S3 chyb v logu `cop-api`;
5. aktuální zálohu nového centrálního úložiště.

Do splnění všech bodů se starý SeaweedFS ani původní data nemažou.

## Hranice mazání účtu — ověřeno16října2026

Čtecí kontrola potvrdila SeaweedFS4.45, revizi
`79b87202136cebdaaa7db4d94eaa5915ad381276` a výše uvedený bucket.
Nečetla objekty ani obsah secrets konfigurace. Současná produkční továrna
neváže požadovaný `MediaUploadSettlementVerifier`; úplné mazání proto pro média
není připravené. Backendové PUT mají trvalé záznamy rozpracovaných zápisů,
ale historické přímé předpodepsané PUT je obcházejí.

Konkrétní [upstream zápis metadat](https://github.com/seaweedfs/seaweedfs/blob/79b87202136cebdaaa7db4d94eaa5915ad381276/weed/s3api/s3api_object_handlers_put.go)
navíc záměrně používá `context.Background` i po zrušení HTTP požadavku.
Zrušení spojení, vypršení podpisu ani okamžitá404 proto nejsou důkazem ukončení
všech zápisů. Oprava musí zavést skutečnou překážku zápisu a vyčkat dokončení
přijatých operací na poskytovateli, potom odstranit objekt a znovu ověřit stav.
Žádný přepínač ani stáří záznamu tento důkaz nenahradí.

Na malém produkčním storage serveru nebyl spuštěn další testovací provider;
v okamžiku kontroly měl přibližně229MiB dostupné RAM. Reprodukční test patří
do odděleného prostředí s přesnou verzí. Sdílená služba, její konfigurace,
credentials i síť zůstaly beze změny. Konkrétní nasazovací plán musí zachovat
ostatní buckety a jejich klienty. Viz
[přesná čtecí evidence a zbývající práce](../testing/account-erasure-media-provider-boundary-20261016.json).

## Volitelný upload pouze přes COP API — zdrojová příprava16října

`COP_MEDIA_UPLOAD_TRANSPORT` má výchozí hodnotu `presigned`. Explicitní
`cop_api` vrací pro původní objekt i opakovaný požadavek `method=POST`,
`transport=cop_api` a URL stávající přihlášené uploadové cesty COP. Vyžaduje
pevný HTTPS origin `COP_PUBLIC_URL` bez credentials, query, fragmentu nebo
základní cesty. Chybná hodnota se nevrátí k externímu PUT.

Tento režim nevytváří a neposílá klientovi nový S3 uploadový podpis. Webový
klient pro POST odvozuje cestu z vlastní konfigurace API a ID přílohy a použije
své běžné přihlášení; nepředává uživatelský token na `uploadUrl`. Server
používá existující ověření účtu, vlastníka, těla a trvalých uploadových záznamů.
Dřívější pole zůstávají; OpenAPI rozšiřuje enum metody o POST a přidává volitelné
pole `transport`. Nejde o nový endpoint nebo alternativní autentizaci.

Cílené testy úložiště, XHR klienta a původních komunitních cest prošly70/70;
API/core build a lint prošly. OpenAPI validace prošla se24 staršími warnings;
YAML export je regenerovaný. Ve stávajícím nativním zdroji byl pouze čtecí
kontrolou nalezen fallback z PUT na přihlášený POST; skutečný upload na iPhonu
ani distribuovaný mobilní build tato kontrola neověřuje.

**Produkce zůstává na původní hodnotě.** Tento režim neruší staré podpisy
a nedokazuje ukončení starých uploadů. Samotný přepínač nemění
`verifiedErasureReady`: bez skutečného poskytovatele ověření doběhnutí zůstává
false. Před aktivací mazání je nutné ověřené uzavření staré cesty, skutečné
dokončení zápisů a samostatná zkouška obnovených dat. Viz
[evidence](../testing/account-erasure-media-api-transport-20261016.json).

## Ověření ukončení uploadů pro mazání účtu — implementace16října

Zjednodušený `database_v2` režim používá
`PostgresMediaUploadSettlement` z `media-upload-settlement.ts`.
Produkční factory `createMediaUploadSettlementFromEnv()` vrací verifier pouze
při explicitním `COP_MEDIA_UPLOAD_TRANSPORT=cop_api`. Připojuje se stávající
ověřenou session cestou s `verify-full` a stávající CA; nevytváří nový socket,
privilegovaný broker ani veřejný port. `close()` zavře jeho dva malé pooly.

Migrace `scripts/account-safety/011_media_upload_closure.sql` přidává jedinou
neměnitelnou tabulku v nezávislé databázi ochrany. COP runtime má pouze SELECT.
Ověření vyžaduje skutečný administrátorský záznam jednorázového uzavření staré
cesty; kontroluje bucket, endpoint, otisk aktuálního serverového credential,
identitu úložiště COP a aktuální incarnation/generaci obnovy. Změna credential
nebo obnova generace starý záznam zneplatní. Záznam neobsahuje klíč ani obsah.

Pro každý konkrétní objekt navíc proběhne kontrola skutečného manifestu,
původního vlastníka a odpovídajícího mazacího fence/operation ID pod stejným
transakčním zámkem, který přijímá API zápisy. Přítomný trvalý write lease
znamená čekající operaci. Neznámý výsledek se nemaže podle věku, restartu,
vypršení podpisu ani krátkodobé404. Po kontrole se znovu ověří nezávislá vazba.
Teprve potom stávající S3 adaptér provede DELETE a opakované absence readback.

### Jednorázový koordinovaný provozní krok

Produkční provider je jeden sdílený monolit: S3, filer, master i volume proces
běží ve stejném kontejneru. Samotné odebrání credential nezastaví již přijatý
background commit. Nejmenší ověřená cesta proto vyžaduje krátkou koordinovanou
odstávku tohoto úložiště. Bez odsouhlasení vlastníkem a kontroly ostatních
klientů se sdílená služba nezastavuje.

1. Ponechat příjem nových mazání vypnutý. Pozastavit všechny instance COP API
   a konverzní writery; zaznamenat přesné existující trvalé leases a aktuální
   dataset binding. Připravit `cop_api` pro následující start.
2. Ověřit přesný image, příkaz, původní mounty a zvlášť všechny S3 identity.
   Vstupní secrets se nesmějí vypisovat ani kopírovat do pracovního archivu.
   Nový náhodný credential se přenese pouze mezi produkčními secrets soubory.
3. Zastavit původní monolit a ověřit skutečný konec procesu (`Running=false`,
   `Pid=0`). Teprve potom nahradit credential pouze identity `cop-production`,
   se zachováním všech ostatních identit, oprávnění, image, argumentů a dat.
   Nový credential patří výhradně serverovému API; nikdy do klientského descriptoru.
4. Spustit původní provider. Ověřit novým credential skutečný syntetický
   upload/readback, původním dosud nevypršelým podpisem odmítnutí403 a zachování
   druhého účtu i jiného klienta/bucketu. Do evidence zaznamenat image,
   konec/start procesu, čas odmítnutí původního credential, původní/nový otisk,
   aktuální binding a otisk přesného provozního protokolu.
5. Správce vloží tento konkrétní záznam do `media_upload_closures` pro aktuální
   generaci; runtime jej nemůže vytvořit. Pouze leases zachycené před prokázaným
   zastavením všech COP writerů a provideru lze při této koordinované operaci
   odstranit jako ukončené. Každý pozdější nebo neznámý lease zůstává čekající.
   Spustit COP v `cop_api`, ověřit readiness a celý společný syntetický test.

Vrácení původního credential nebo přímých presigned uploadů zneplatňuje tuto
cestu. Při rollbacku se nejdříve zastaví příjem nových mazání a zachová evidence
rozpracovaných operací. Nesmažou se fence, leases ani nezávislé záznamy.

Izolovaný PostgreSQL18.6 test ověřil7 nových skutečných databázových scénářů;
spolu se stávajícím storage testem30/30. Samostatná skutečná SeaweedFS4.45
zkouška ověřila přerušený částečný upload, konec procesu, scoped výměnu klíče,
restart stejného image a odmítnutí starého podpisu i zachování druhého klienta.
Neprovedla řízené zastavení přímo uvnitř finálního metadata commitu. Nejde o
společnou akceptaci celého účtu ani o již provedenou produkční odstávku.
Přesná evidence: [výsledky](../testing/account-erasure-media-upload-settlement-20261016.json).

### Ověřený přechod se zachováním starého procesu

Izolovaný skutečný test 2026-10-16 použil starý produkční COP image
`sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f`
a připnutý SeaweedFS4.45/79b872021. API skutečně inicializovalo media storage,
provedlo úspěšný PUT a bylo pozastaveno přes Docker pause. Po zastavení
provideru (PID0), výměně pouze COP klíče a restartu stejného provider CID/image
se obnovil přesně stejný API CID, PID a StartedAt. Všechny tři health endpointy
vracely200 před i po přechodu; stará instance S3 v RAM vracela pro skutečný
PUT403, nová identita úspěšně zapisovala i četla. B i jiná identita zůstaly
zachované. Cached health starého procesu tedy nepotvrzuje funkčnost jeho
starého klíče; funkční nový přístup musí potvrdit navazující kandidát.

Stejný test zavolal přesné exporty produkčního instalačního podkladu:
ListObjectVersions200 s jednou `null` verzí, DELETE konkrétní `versionId=null`
vrátil204, nový seznam verzí byl prázdný a HEAD404. První actual zkouška
odhalila standardní číselné XML entity v odpovědi; parser byl opraven a celý
rozšířený test poté prošel. Plošný úklid ani obecný privileged broker nevznikly.

Zdroj: `scripts/account-safety/run-old-api-media-pause-probe.py`.
Přesný výsledek: `docs/testing/account-erasure-old-api-media-pause-20261016.json`.
Nové vlastní syntetické kontejnery a volumes byly uklizeny; produkce a sdílené
whole fixtures se tímto testem neměnily. Produkční Docker imageID se musí vždy
načíst na skutečném storage hostu; samotná reference nebo imageID z jiného
Docker hostu jej nenahrazují.
