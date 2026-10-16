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
