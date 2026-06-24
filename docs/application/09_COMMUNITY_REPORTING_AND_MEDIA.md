# Community Reporting and Media

COP je systém záznamu pro komunitní hlášení. SIM zůstává zdrojový a integrační systém pro externí/simulační data.

## Datové vlastnictví

COP ukládá:

- uživatelský report,
- polohu události,
- vazbu reportu na komunitní skupinu,
- stav reportu,
- vazbu na uživatele z Keycloak/OIDC,
- metadata příloh,
- přístupová pravidla k médiím,
- uživatelské skupiny pro sdílení,
- audit události.

SeaweedFS/S3 ukládá:

- originální fotky,
- budoucí náhledy,
- budoucí video nebo dokumenty.

PostgreSQL neukládá binární fotky. Obsahuje pouze `bucket`, `objectKey`, typ souboru, velikost, stav uploadu a volitelnou polohu pořízení.

## PostGIS spatial model

Produkční COP databáze používá PostGIS pro vlastní prostorová data aplikace:

- `cop_community_reports.location_geom geometry(Point, 4326)` pro polohu události,
- `cop_community_report_attachments.capture_geom geometry(Point, 4326)` pro volitelnou polohu pořízení přílohy,
- `cop_community_groups.anchor_geom geometry(Point, 4326)` pro volitelnou hlavní polohu skupiny/události,
- GiST indexy nad prostorovými sloupci.

Sloupce `lat/lon` zůstávají zachované kvůli API kompatibilitě a čitelnosti. Při startu PostgreSQL store provede idempotentní migraci, doplní geometrii pro existující řádky a následné bbox dotazy `GET /api/v1/community/reports?bbox=...` používají PostGIS envelope nad `location_geom`.

## API

Nové endpointy:

- `GET /api/v1/community/reports`
- `POST /api/v1/community/reports`
- `GET /api/v1/community/reports/{reportId}`
- `PATCH /api/v1/community/reports/{reportId}`
- `DELETE /api/v1/community/reports/{reportId}`
- `POST /api/v1/community/reports/{reportId}/submit`
- `POST /api/v1/community/reports/{reportId}/attachments`
- `POST /api/v1/community/reports/{reportId}/attachments/{attachmentId}/complete`
- `POST /api/v1/community/reports/{reportId}/attachments/{attachmentId}/upload`
- `GET /api/v1/community/reports/{reportId}/attachments/{attachmentId}/content`
- `GET /api/v1/community/groups`
- `POST /api/v1/community/groups`
- `GET /api/v1/community/groups/{groupId}`
- `PATCH /api/v1/community/groups/{groupId}/metadata`
- `DELETE /api/v1/community/groups/{groupId}`
- `POST /api/v1/community/groups/{groupId}/join-request`
- `POST /api/v1/community/groups/{groupId}/members`

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
  "hazardSeverity": "warning",
  "validUntil": "2026-05-20T15:00:00Z",
  "visibility": "community",
  "groupId": "b7d7e35b-9bb3-4d25-b4a7-8b56abbb9999",
  "groupName": "Požár u Vrbna"
}
```

`hazardSeverity` je uživatelský odhad závažnosti: `advisory`, `warning`, `critical`.
`validUntil` je odhadovaná platnost rizika; po vypršení se mapový prvek označí jako stale, ale nezmizí bez moderace/retence.
`groupId` propojuje hlášení se skupinou/konverzací. Webový klient při uložení hlášení skupinu vyžaduje: uživatel vybere existující skupinu, nebo se automaticky vytvoří nová skupina z názvu hlášení. Pokud skupina vznikla přes hlášení, její `anchorLocation` je nastavena na první polohu hlášení a skupina se může v budoucnu zobrazovat i jako samostatný bod události na mapě.

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

Primární upload přílohy neprobíhá přes API proces. COP API vytvoří presigned `PUT` URL a klient nahraje soubor přímo do SeaweedFS/S3.
Protože veřejný web běží přes HTTPS a pilotní SeaweedFS je zatím interní HTTP endpoint, COP umí i serverový fallback `POST /attachments/{attachmentId}/upload`, který přijme binární tělo požadavku (`image/*`, `video/*`, `application/pdf`, `application/octet-stream`) a uloží objekt do SeaweedFS server-side. Starší base64 JSON fallback zůstává podporovaný jen kvůli kompatibilitě a malým přílohám; pro video se nepoužívá. Tento fallback je limitovaný `COP_MEDIA_MAX_ATTACHMENT_BYTES` a `COP_API_BODY_LIMIT_BYTES`.

Podporované přílohy v první verzi:

- fotky: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`,
- video: `video/mp4`, `video/quicktime`,
- dokument: `application/pdf`.

Video přílohy mohou nést metadata `metadata.spatialVideo`:

- `mode: "none"`: běžné 2D video, přehrání přes HTML5 `video`,
- `mode: "side_by_side"`: stereoskopické video uložené jako jeden soubor se dvěma obrazy vedle sebe; XR režim jej v brýlích rozdělí na levé/pravé oko,
- `mode: "over_under"`: stereoskopické video uložené jako jeden soubor s obrazy nad sebou; XR režim jej v brýlích rozdělí na levé/pravé oko,
- `mode: "apple_mv_hevc"`: iPhone Spatial Video v MOV/MV-HEVC se ukládá jako originální soubor. Po dokončení uploadu COP zařadí úlohu konverze, zachová originál a vytvoří odvozené `video/mp4` side-by-side (`derivativeId: "xr-sbs"`) pro WebXR/Oculus přehrávač.

Konverze Apple Spatial MOV běží asynchronně v API kontejneru přes `ffmpeg`. Metadata přílohy obsahují `metadata.spatialVideo.xrDerivative.status`:

- `queued`: úloha čeká ve frontě;
- `processing`: ffmpeg připravuje side-by-side derivát;
- `ready`: `derivatives[].contentUrl` je dostupné oprávněným uživatelům a XR režim jej použije automaticky;
- `failed`: originál zůstává uložený a web jej přehraje jako 2D, detail zobrazí chybu konverze.

Konverzní objekt se ukládá do stejného SeaweedFS/S3 bucketu pod klíč `community-reports/{reportId}/{attachmentId}/derivatives/xr-sbs.mp4`. Přístup k derivátu se řídí stejným `metadata.access` jako originální soubor; API vrací derivátové `contentUrl` pouze oprávněnému uživateli.

Po úspěšném uploadu klient zavolá `complete`. Do budoucna je vhodné doplnit serverovou kontrolu objektu přes `HEAD`, AV/obsahovou kontrolu a generování náhledů.
Po dokončení má příloha `contentUrl`; detail komunitního prvku může zobrazit obrázek, přehrát video přes HTML5 `video` a otevřít PDF. Webový klient zobrazuje média v galerii na celou obrazovku. Galerie sdružuje média reportů ve stejné skupině, aby se uživatel dostal k informacím přes mapu i přes konverzaci. Pokud médium není pro aktuálního uživatele dostupné, detail zůstane viditelný, ale galerie zobrazí chráněný stav bez URL objektu.

## Přístup k médiím

Text reportu, poloha, kategorie, stupeň rizika a platnost jsou mapová informace. Po publikování se proto mohou zobrazit i uživateli bez účtu, pokud je zapnuté veřejné čtení.
Samotné médium má oddělené přístupové pravidlo uložené v `attachment.metadata.access`.

Podporované režimy:

- `public`: výchozí režim, médium je dostupné všem, kteří smějí číst report;
- `private`: médium vidí pouze autor reportu;
- `users`: médium vidí autor a uvedení uživatelé podle Keycloak `subjectId`;
- `groups`: médium vidí autor a aktivní členové vybraných COP komunitních skupin.

Příklad omezení na skupinu:

```json
{
  "metadata": {
    "access": {
      "audience": "groups",
      "groupIds": ["b7d7e35b-9bb3-4d25-b4a7-8b56abbb9999"]
    }
  }
}
```

Pokud uživatel nemá právo na médium, API stále vrátí mapový report a v příloze uvede `accessDenied: true`, ale nevrátí `contentUrl`.
Endpoint `GET /attachments/{attachmentId}/content` u stejného média vrací záměrně `404`, aby se neprozrazovala existence nebo identita chráněného objektu.

Pro chráněná média API vrací `contentUrl` jako krátkodobý podepsaný odkaz s query parametrem `mediaToken`. Token se vydá pouze při autorizovaném API čtení reportu nebo feature kolekce a obsahuje vazbu na `reportId`, `attachmentId`, volitelný `derivativeId` a expiraci. Je to nutné proto, že HTML prvky `img`, `video`, `audio`, `iframe` a otevření PDF v novém okně neposílají aplikační `Authorization: Bearer ...` hlavičku.

Podepsaný media token:

- neobsahuje service token, SeaweedFS credential ani Matrix/Keycloak token;
- je platný jen pro konkrétní přílohu nebo derivát;
- má krátkou platnost, výchozí 10 minut;
- po expiraci klient znovu načte metadata reportu a dostane nový `contentUrl`, pokud má stále oprávnění;
- nemění pravidlo, že neautorizovaný uživatel nedostane `contentUrl` vůbec.

Konfigurace:

```env
COP_MEDIA_ACCESS_TOKEN_SECRET=<nahodne-dlouhe-tajne-heslo>
COP_MEDIA_ACCESS_TOKEN_TTL_SECONDS=600
```

V produkci musí být `COP_MEDIA_ACCESS_TOKEN_SECRET` stabilní napříč restarty API, jinak dříve vydané odkazy přestanou platit okamžitě po restartu. To je bezpečné, ale může to přerušit právě otevřenou galerii.

## Komunitní skupiny

Skupiny jsou aplikační sharing model COP, nikoli náhrada Matrix roomů. Do budoucna mají být navázané na konverzace v CSM Messaging, ale správa přístupu k médiím zůstává v COP, protože COP je systém záznamu pro uživatelská hlášení.

Vlastnosti skupiny:

- `visibility: "public"`: uživatel může vstoupit bez schválení;
- `visibility: "private"`: žádost o vstup je `pending` a správce ji musí potvrdit;
- `anchorLocation`: volitelná hlavní poloha skupiny/události;
- `metadata`: minimální aplikační metadata, například `createdFrom`, `initialCategory`, `initialSeverity` nebo vazba na konverzaci;
- role členů: `owner`, `admin`, `member`;
- stav členství: `active`, `pending`.

Autor skupiny je automaticky `owner`. Pouze `owner` nebo `admin` mohou přidávat členy, potvrzovat žádosti a mazat skupinu. Mazání skupiny je COP metadata operace: zneaktivní sdílení médií a skupinu v seznamu, ale nemaže Matrix room, dokud CSM Messaging neposkytne samostatný bezpečný kontrakt pro archivaci konverzace.
V pilotním webu lze skupinu založit přímo při nahrávání hlášení nebo v panelu Konverzace. Pro produkci je potřeba doplnit uživatelský adresář, aby běžný uživatel nepracoval se syrovým `subjectId`.

Pravidlo pro provázání mapy a chatu:

- každé nové hlášení v UI patří do COP skupiny;
- pokud uživatel vybere existující skupinu, report a média se uloží do ní;
- pokud skupina vznikne z hlášení, získá `anchorLocation` z polohy prvního reportu;
- pokud skupina vznikne z chatu, poloha je prázdná, dokud ji uživatel nebo první mapové hlášení nenastaví;
- CSM Messaging může mít pro stejnou věc Matrix room/konverzaci, ale media ACL se vyhodnocuje podle COP skupiny, ne podle samotné Matrix místnosti.

## Chat-first hlášení

Webový klient umožňuje založit komunitní hlášení přímo z chatovacího kontextu.
Používá se ve chvíli, kdy informace sdílená v konverzaci přestává být jen
koordinační zprávou a má se stát mapovým objektem s auditovatelným stavem,
platností, závažností a pravidly přístupu k médiím.

V připnutém chatovacím panelu je tato akce dostupná přímo v hlavičce aktivního
chatu a také v panelu Kontext. Uživatel tedy nemusí opustit mapu: chat zůstává
vpravo jako inspektor, mapový výřez zůstává uprostřed a formulář hlášení se
otevře s předvyplněným bezpečným kontextem.

Předvyplnění hlášení z chatu dodává pouze bezpečná metadata:

- aktivní COP skupinu nebo skupinu navázanou na konverzaci,
- název skupiny jako zdrojový kontext,
- polohu z posledního sdílení polohy, polohu uživatele nebo aktuální střed mapy,
- výchozí titulek `Hlášení z chatu`.

COP záměrně nekopíruje plaintext zprávy z Matrix timeline do reportu. Uživatel
musí text hlášení potvrdit nebo upravit v reportovacím formuláři. Chatové
přílohy zůstávají Matrix/E2EE médii; pokud mají být součástí reportu, musí být
nahrané přes COP media flow, kde se uplatní ACL, audit, podepsané media tokeny
a budoucí obsahová kontrola.

UI proto záměrně rozlišuje dva typy média:

- **chatové médium**: E2EE příloha v Matrix místnosti pro rychlou koordinaci;
- **reportové médium**: příloha COP hlášení uložená přes media flow s ACL,
  auditní vazbou, mapovou životností a budoucí kontrolou obsahu.

Přechod z chatového média do reportového média musí být vědomá akce uživatele
nebo moderátora. COP nesmí automaticky přebírat šifrované chatové přílohy do
mapového záznamu bez výslovného potvrzení.

## Notifikace

Po odeslání reportu přes `POST /api/v1/community/reports/{reportId}/submit`
COP vytvoří rozhodnutí pro `community.report` notifikaci. Dispatch do CSM
Messaging proběhne jen tehdy, když report:

- je `submitted` nebo `published`,
- nemá prošlou `validUntil`,
- má závažnost `advisory`, `warning` nebo `critical`,
- má konkrétní cílovou skupinu, uživatele nebo oblast.

Výchozí audience vzniká z `groupId`, protože report i média patří do COP
skupiny. Push payload je záměrně minimální: obsahuje kategorii, bezpečný
nadpis, deep link `csm://map/report/<reportId>` a zdrojová metadata. Neobsahuje
fotky, videa, PDF, podepsané media URL ani plaintext chat zprávy.

Přístup k médiím zůstává vždy řízený COP media ACL a podepsanými media tokeny.
CSM Messaging řeší jen doručení notifikace a případnou konverzaci.

## Poloha fotky

Poloha je pro tento use-case podstatná. Ukládají se dvě různé hodnoty:

- `report.location`: poloha události, povinná;
- `attachment.captureLocation`: volitelná poloha pořízení fotky.

Klient může vyplnit `report.location` z GPS zařízení, z mapového výběru, z EXIF fotky nebo z metadat videa. Webový klient umí best-effort načíst JPEG EXIF GPS a u MOV/MP4 hledá běžný ISO 6709 zápis polohy. Nativní iOS aplikace má polohu pořízení číst přes Photos/AVFoundation, protože u iPhone Spatial Video může být přesnější než webový parser.

Pokud médium polohu obsahuje, UI nabídne její použití jako polohy hlášení. Pokud ji neobsahuje, uživatel musí polohu určit ze zařízení nebo výběrem v mapě.
Ve sdílených náhledech se EXIF nemá publikovat automaticky. Originální soubor může zůstat v chráněném objektovém úložišti, ale veřejné deriváty mají být bez EXIF.

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
COP_MEDIA_MAX_ATTACHMENT_BYTES=536870912
COP_API_BODY_LIMIT_BYTES=536870912
COP_MEDIA_SPATIAL_CONVERSION_ENABLED=true
COP_MEDIA_SPATIAL_FFMPEG_PATH=ffmpeg
COP_MEDIA_SPATIAL_CONVERSION_MAX_CONCURRENT=1
COP_MEDIA_SPATIAL_CONVERSION_TIMEOUT_MS=600000
```

Pro produkci doporučuji samostatný bucket `cop-community-media` a samostatné S3 credentials jen pro COP.
API při startu ověří dostupnost bucketu a při HTTP 404 se ho pokusí založit. Stav je vidět v `/health/dependencies` jako `media-storage`.

Aktuální pilot na `docker.home.cz` používá SeaweedFS S3 gateway `http://docker.home.cz:8334`. Port `8333` běží v SeaweedFS `mini` režimu s externí URL jiné aplikace a pro COP S3 podpisy nepoužívat.

Poznámka k veřejnému provozu: `COP_MEDIA_S3_PUBLIC_ENDPOINT` musí být dosažitelný z klienta, který přílohu nahrává. Pro web na `https://cop.zeleznalady.cz` má být cílový endpoint také HTTPS, typicky samostatný reverse proxy vhost `https://media.zeleznalady.cz` na SeaweedFS S3 gateway `http://docker.home.cz:8334`. Do doby zřízení veřejného media vhostu je `http://docker.home.cz:8334` použitelné hlavně z interní sítě a pro backendové ověření.

## iOS tok

1. Uživatel se přihlásí přes Keycloak/OIDC.
2. Aplikace získá polohu zařízení a přesnost.
3. Uživatel pořídí fotku/video nebo vybere PDF a určí kategorii, riziko a platnost.
4. Aplikace přečte polohu z média, pokud je dostupná, a nabídne její použití.
5. Aplikace vybere existující skupinu nebo vytvoří novou `POST /api/v1/community/groups`.
6. Aplikace vytvoří `POST /api/v1/community/reports` s `groupId`.
7. Aplikace zvolí přístup k médiím: všem, jen autorovi, konkrétním uživatelům nebo skupině.
8. Aplikace požádá o upload slot přes `POST /attachments` a předá `metadata.access`.
9. Aplikace nahraje přílohu na `upload.uploadUrl`; pokud to není možné, použije fallback `POST /upload`.
10. Aplikace zavolá `POST /complete`.
11. Aplikace zavolá `POST /submit`.
12. Report se zobrazí v komunitní mapové vrstvě. Přílohy jsou přehratelné nebo otevřitelné jen podle ACL a v rámci skupiny se zobrazují v multimediální galerii.

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

UI nyní zobrazuje panel režimu účtu a zamyká ukládání vlastních profilů pohledu, potvrzování serverových výstrah, AI akce a tvorbu komunitních hlášení za přihlášení přes Keycloak. Lokální mapové čtení zůstává dostupné bez účtu.

Webové tlačítko `Nahlásit` otevře formulář pro kategorii, popis, uživatelský stupeň rizika, odhad platnosti, polohu a přílohy. Poloha se bere z GPS, ze středu mapy nebo interaktivním kliknutím do mapy. Každá příloha dostane stejnou polohu pořízení, pokud soubor sám neposkytne ověřená geodata.

## AI

AI nesmí být nutná pro základní provoz. Doporučený model:

- výchozí režim bez AI,
- on-device AI v iOS pro kvalitu fotky, návrh kategorie a rozmazání citlivých detailů,
- BYOK pro uživatele nebo organizaci,
- centrální klíč jen pro omezené administrativní nebo pilotní scénáře.
