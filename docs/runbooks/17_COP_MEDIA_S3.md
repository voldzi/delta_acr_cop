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
