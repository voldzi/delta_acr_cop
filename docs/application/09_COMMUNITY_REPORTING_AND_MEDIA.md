# Community Reporting and Media

COP je systém záznamu pro komunitní hlášení. SIM zůstává zdrojový a integrační systém pro externí/simulační data.

## Datové vlastnictví

COP ukládá:

- uživatelský report,
- polohu události,
- stav reportu,
- vazbu na uživatele z Keycloak/OIDC,
- metadata příloh,
- přístupová pravidla k médiím,
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

Endpointy `/api/v1/community/groups...` jsou součástí aktuální vazby mezi
mapovým hlášením a chatem. Aktivní COP web při vytvoření nového komunitního
hlášení založí veřejnou komunitní skupinu ukotvenou v poloze hlášení a uloží
její `groupId/groupName` do metadat reportu. Samotná E2EE konverzace a Matrix
místnost se vytváří až při otevření této skupiny v samostatné aplikaci
`cop-chat`.

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
  "visibility": "community"
}
```

`hazardSeverity` je uživatelský odhad závažnosti: `advisory`, `warning`, `critical`.
`validUntil` je odhadovaná platnost rizika; po vypršení se mapový prvek označí jako stale, ale nezmizí bez moderace/retence.
Nové hlášení je mapový objekt navázaný na komunitní skupinu. Detail hlášení v
mapě nabízí akci `Chat`, která otevře vložený `cop-chat` a předá mu `groupId`.
Pokud daná skupina ještě nemá Matrix místnost, `cop-chat` ji připraví bezpečnou
E2EE cestou při prvním otevření.

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

Mobilní formulář používá jeden zřetelný picker pro fotoaparát, knihovnu fotografií a aplikaci Soubory, zobrazuje vybrané položky ještě před uložením a umožňuje je jednotlivě odebrat. Režim přístupu `users` spojuje vyhledávání v COP adresáři s kontakty z konverzací dostupných právě přihlášenému uživateli. Díky tomu lze zvolit i existující chatový kontakt, jehož profil ještě není v lokálním výsledku adresáře. Do ACL klient vždy ukládá kanonické `subjectId`/messaging `userId` podle integračního kontraktu, nikoli ručně opisovaný technický identifikátor; samotný Matrix identifikátor ve tvaru `@user:server` se do ACL nenabízí. Adresář vrací až 25 shod a česká jména vyhledává bez ohledu na diakritiku, například `Jiri` najde `Jiří`.

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
Po dokončení má příloha `contentUrl`; detail komunitního prvku může zobrazit
obrázek, přehrát video přes HTML5 `video` a otevřít PDF. Webový klient zobrazuje
média daného reportu v galerii na celou obrazovku. Pokud médium není pro
aktuálního uživatele dostupné, detail zůstane viditelný, ale galerie zobrazí
chráněný stav bez URL objektu.

## Přístup k médiím

Text reportu, poloha, kategorie, stupeň rizika a platnost jsou mapová informace. Po publikování se proto mohou zobrazit i uživateli bez účtu, pokud je zapnuté veřejné čtení.
Samotné médium má oddělené přístupové pravidlo uložené v `attachment.metadata.access`.

Podporované režimy:

- `public`: výchozí režim, médium je dostupné všem, kteří smějí číst report;
- `private`: médium vidí pouze autor reportu;
- `users`: médium vidí autor a uvedení uživatelé podle Keycloak `subjectId`.

Historický režim `groups` může existovat u starších příloh kvůli kompatibilitě
serverového vyhodnocení ACL, ale nové COP web UI jej nenabízí.

Příklad omezení na konkrétní uživatele:

```json
{
  "metadata": {
    "access": {
      "audience": "users",
      "userSubjectIds": ["f4b6a4e2-1234-4f2a-8f83-9c7a6d0d1111"]
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

## Komunikace a skupiny

COP web už neobsahuje vlastní správu chatových skupin pro hlášení. Občanská
komunikace, přímé zprávy, skupiny, připnutí chatů, reakce a sdílení souborů
patří do samostatné aplikace `cop-chat`, která je do COP vložená jako
komunikační panel.

Pravidlo pro mapu a chat:

- hlášení v COP je mapový záznam s polohou, platností, závažností, přílohami a
  auditem;
- konverzace v `cop-chat` je lidská komunikace a může si vytvářet vlastní
  soukromé nebo veřejné skupiny;
- COP web při uložení hlášení nezakládá chat ani chatovou skupinu;
- pokud má informace z chatu přejít do mapy, uživatel vytvoří nové hlášení a
  vědomě nahraje přílohy přes COP media flow.

## Chat-first hlášení

Aktuální integrace je krátkodobě iframe panel `cop-chat` uvnitř COP. Chat tedy
zůstává dostupný vedle mapy, ale COP web z něj automaticky nevytváří reporty a
nekopíruje plaintext zprávy ani E2EE přílohy. Uživatel musí text hlášení a
přílohy potvrdit ve formuláři `Nahlásit`, kde se uplatní COP media flow, ACL,
audit, podepsané media tokeny a budoucí obsahová kontrola.

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
- má konkrétní cílové publikum přes veřejnou viditelnost, vybrané uživatele
  nebo oblast sledovanou uživatelem.

Push payload je záměrně minimální: obsahuje kategorii, bezpečný
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
COP_MEDIA_S3_ENDPOINT=http://host.docker.internal:8334
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

Aktuální pilot na `docker.home.cz` používá SeaweedFS S3 gateway publikovanou na hostitelském portu `8334`. Kontejner `cop-api` se k ní připojuje přes `http://host.docker.internal:8334`; adresa `http://docker.home.cz:8334` uvnitř kontejneru závisí na VPN/DNS routě a nesmí se používat jako interní endpoint. Port `8333` běží v SeaweedFS `mini` režimu s externí URL jiné aplikace a pro COP S3 podpisy nepoužívat.

Poznámka k veřejnému provozu: `COP_MEDIA_S3_PUBLIC_ENDPOINT` musí být dosažitelný z klienta, který přílohu nahrává. Pro web na `https://cop.zeleznalady.cz` má být cílový endpoint také HTTPS, typicky samostatný reverse proxy vhost `https://media.zeleznalady.cz` na SeaweedFS S3 gateway `http://docker.home.cz:8334`. Dokud veřejný media vhost není dostupný, HTTPS PWA přímý HTTP upload přeskočí a použije zabezpečený same-origin fallback `POST /attachments/{attachmentId}/upload`; vlastní API přistupuje k SeaweedFS přes `host.docker.internal`.

## iOS tok

1. Uživatel se přihlásí přes Keycloak/OIDC.
2. Aplikace získá polohu zařízení a přesnost.
3. Uživatel pořídí fotku/video nebo vybere PDF a určí kategorii, riziko a platnost.
4. Aplikace přečte polohu z média, pokud je dostupná, a nabídne její použití.
5. Aplikace vytvoří samostatný report přes `POST /api/v1/community/reports`.
6. Aplikace zvolí přístup k médiím: všem, jen autorovi nebo konkrétním uživatelům.
7. Aplikace požádá o upload slot přes `POST /attachments` a předá `metadata.access`.
8. Aplikace nahraje přílohu na `upload.uploadUrl`; pokud to není možné, použije fallback `POST /upload`.
9. Aplikace zavolá `POST /complete`.
10. Aplikace zavolá `POST /submit`.
11. Report se zobrazí v komunitní mapové vrstvě. Přílohy jsou přehratelné nebo otevřitelné jen podle ACL a zobrazují se v galerii reportu.

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

Na úzkém mobilním viewportu se obsah formuláře posouvá samostatně mezi pevnou
hlavičkou a pevnou spodní lištou akcí. `Zrušit` a `Uložit hlášení` tak zůstávají
dosažitelné bez ohledu na délku formuláře, klávesnici a spodní iOS safe area.
Textové ovladače formuláře mají na iOS nejméně 16px písmo, takže fokus
vyhledávání kontaktu nezpůsobí automatické přiblížení a horizontální oříznutí
dialogu. Každý vnitřní grid zároveň dovoluje smrštění na 320px viewport.
Po úspěšném odeslání klient explicitně obnoví komunitní mapovou vrstvu a zapne
její katalogové vrstvy, takže nové hlášení není závislé na následném posunu mapy
nebo ručním přepnutí vrstvy. Mapa se současně zaměří na polohu uloženého
hlášení, i když byla převzata z GPS nebo médií mimo předchozí výřez.

## AI

AI nesmí být nutná pro základní provoz. Doporučený model:

- výchozí režim bez AI,
- on-device AI v iOS pro kvalitu fotky, návrh kategorie a rozmazání citlivých detailů,
- BYOK pro uživatele nebo organizaci,
- centrální klíč jen pro omezené administrativní nebo pilotní scénáře.
