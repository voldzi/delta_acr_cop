# Community Reporting and Media

COP je systém záznamu pro komunitní hlášení. SIM zůstává zdrojový a integrační systém pro externí/simulační data.

## Datové vlastnictví

COP ukládá:

- uživatelský report,
- polohu události,
- stav reportu,
- vazbu na uživatele z Keycloak/OIDC,
- metadata příloh,
- audit události.

SeaweedFS/S3 ukládá:

- originální fotky,
- budoucí náhledy,
- budoucí video nebo dokumenty.

PostgreSQL neukládá binární fotky. Obsahuje pouze `bucket`, `objectKey`, typ souboru, velikost, stav uploadu a volitelnou polohu pořízení.

## API

Nové endpointy:

- `GET /api/v1/community/reports`
- `POST /api/v1/community/reports`
- `GET /api/v1/community/reports/{reportId}`
- `POST /api/v1/community/reports/{reportId}/submit`
- `POST /api/v1/community/reports/{reportId}/attachments`
- `POST /api/v1/community/reports/{reportId}/attachments/{attachmentId}/complete`

Vytvoření reportu:

```json
{
  "category": "fire",
  "title": "Požár u cesty",
  "description": "Kouř u lesa, viditelný plamen.",
  "location": {
    "lat": 50.075,
    "lon": 14.438,
    "accuracyM": 8,
    "source": "device"
  },
  "observedAt": "2026-05-20T11:59:30Z",
  "visibility": "community"
}
```

Kategorie:

- `fire`
- `flood`
- `bridge_damage`
- `road_blockage`
- `infrastructure_damage`
- `medical`
- `utility_outage`
- `hazard`
- `other`

Upload přílohy neprobíhá přes API proces. COP API vytvoří presigned `PUT` URL a klient nahraje soubor přímo do SeaweedFS/S3.

Podporované přílohy v první verzi:

- fotky: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`,
- video: `video/mp4`, `video/quicktime`,
- dokument: `application/pdf`.

Po úspěšném uploadu klient zavolá `complete`. Do budoucna je vhodné doplnit serverovou kontrolu objektu přes `HEAD`, AV/obsahovou kontrolu a generování náhledů.

## Poloha fotky

Poloha je pro tento use-case podstatná. Ukládají se dvě různé hodnoty:

- `report.location`: poloha události, povinná;
- `attachment.captureLocation`: volitelná poloha pořízení fotky.

Klient může vyplnit `report.location` z GPS zařízení, z mapového výběru nebo z EXIF. Ve sdílených náhledech se EXIF nemá publikovat automaticky. Originální soubor může zůstat v chráněném objektovém úložišti, ale veřejné deriváty mají být bez EXIF.

## SeaweedFS konfigurace

COP používá S3-compatible presigned upload.

Proměnné:

```env
COP_MEDIA_STORE=s3
COP_MEDIA_S3_ENDPOINT=http://docker.home.cz:8333
COP_MEDIA_S3_PUBLIC_ENDPOINT=https://media.zeleznalady.cz
COP_MEDIA_S3_REGION=us-east-1
COP_MEDIA_S3_BUCKET=cop-community-media
COP_MEDIA_S3_ACCESS_KEY_ID=...
COP_MEDIA_S3_SECRET_ACCESS_KEY=...
COP_MEDIA_UPLOAD_EXPIRES_SECONDS=900
COP_MEDIA_MAX_ATTACHMENT_BYTES=26214400
```

Pro produkci doporučuji samostatný bucket `cop-community-media` a samostatné S3 credentials jen pro COP.
API při startu ověří dostupnost bucketu a při HTTP 404 se ho pokusí založit. Stav je vidět v `/health/dependencies` jako `media-storage`.

Poznámka k veřejnému provozu: `COP_MEDIA_S3_PUBLIC_ENDPOINT` musí být dosažitelný z klienta, který přílohu nahrává. Pro web na `https://cop.zeleznalady.cz` má být cílový endpoint také HTTPS, typicky samostatný reverse proxy vhost `https://media.zeleznalady.cz` na SeaweedFS S3 endpoint `http://docker.home.cz:8333`. Do doby zřízení veřejného media vhostu je `http://docker.home.cz:8333` použitelné hlavně z interní sítě a pro backendové ověření.

## iOS tok

1. Uživatel se přihlásí přes Keycloak/OIDC.
2. Aplikace získá polohu zařízení a přesnost.
3. Uživatel pořídí fotku a vybere kategorii.
4. Aplikace vytvoří `POST /api/v1/community/reports`.
5. Aplikace požádá o upload slot přes `POST /attachments`.
6. Aplikace nahraje fotku na `upload.uploadUrl`.
7. Aplikace zavolá `POST /complete`.
8. Aplikace zavolá `POST /submit`.
9. Report se zobrazí v komunitní mapové vrstvě.

Offline iOS režim má držet lokální outbox a odeslat kroky až po obnovení spojení.

## Keycloak navázání

Současný API kontrakt už používá `AuthenticatedActor`:

- `subjectId`,
- `username`,
- `displayName`,
- `email`,
- `roles`.

Při přechodu na veřejnou registraci přes `login.zeleznalady.cz` je potřeba:

- v realmu `cop` povolit self-registration,
- vyžadovat ověřený email,
- doplnit theme pro civilní aplikaci,
- nastavit klienty `cop-web` a budoucí `cop-ios`,
- oddělit role pro běžného uživatele a moderátora,
- později doplnit moderaci `submitted -> published/hidden/rejected`.

Navržené role:

- `cop_user`: běžný uživatel, vytváří reporty a spravuje vlastní drafty;
- `cop_moderator`: validuje reporty, skrývá závadný obsah;
- `cop_admin`: správa konfigurace.

## Web režimy

Veřejný web má dva zřetelné režimy:

- anonymní read-only režim: mapa, veřejné zdroje, situační vrstvy, bezpečnostní vrstvy, tracky, historie a publikovaná komunitní hlášení;
- přihlášený režim: serverový profil pohledu, potvrzování výstrah, AI asistent a připravený účet pro navazující tvorbu komunitních hlášení a upload médií.

Anonymní uživatel nesmí dostat lab token ve web bundle. `COP_PUBLIC_LAB_VALUE` proto zůstává pro veřejné nasazení prázdné. Serverový `COP_LAB_TOKEN` může zůstat jen pro interní pilotní zdroje.

UI nyní zobrazuje panel režimu účtu a zamyká ukládání vlastních profilů pohledu, potvrzování serverových výstrah a AI akce za přihlášení přes Keycloak. Lokální mapové čtení zůstává dostupné bez účtu.

## AI

AI nesmí být nutná pro základní provoz. Doporučený model:

- výchozí režim bez AI,
- on-device AI v iOS pro kvalitu fotky, návrh kategorie a rozmazání citlivých detailů,
- BYOK pro uživatele nebo organizaci,
- centrální klíč jen pro omezené administrativní nebo pilotní scénáře.
