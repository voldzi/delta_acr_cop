# Jízda → COP → SIM: dobrovolná měření provozu

Stav: adaptér připraven v COP, **výchozí vypnutý**. Mobilní sběr v Jízdě zůstává
vypnutý. SIM používá pouze `shadow_only`; toto rozhraní neaktualizuje navigační
rychlosti ani TPEG2. Aktivace vyžaduje oddělený provozní souhlas, připravenou
databázi, interní spojení, tajemství a společnou akceptaci.

Závazný mobilní kontrakt je `openapi/openapi.json`. Interní kontrakt SIM je
`sim-driver-measurements-v1` v SIM `openapi/openapi.json` a
`docs/integration/20_JIZDA_DRIVER_MEASUREMENTS_CONTRACT.md`. COP záměrně
odděluje mobilní verzi `cop-driver-measurements-v1`, protože mobil nesmí
posílat `contributorIdDay` ani `consent` atestaci.

## Přesný předávací pokyn pro Jízdu

Používejte přihlášený bearer token uživatele z klienta `csm-mobile` proti COP
API. Nevolejte SIM ani Valhallu přímo. Nikdy nedávejte službový SIM token do
aplikace. Konfigurace COP musí klienta `csm-mobile` přijímat a příslušná
OIDC role nesmí vyloučit běžného přihlášeného uživatele.

1. `GET /api/v1/driver-measurements/v1/consent` vrací
   `{contractVersion,granted,grantedAt,pendingDeletion,canGrant}`.
2. Po samostatném výslovném souhlasu odešlete
   `POST /api/v1/driver-measurements/v1/consent` s přesným JSON
   `{ "contractVersion":"cop-driver-measurements-v1", "version":"traffic-quality-v1", "granted":true }`.
   Odpověď vrací `grantedAt`; žádný sběr nezačne před tímto okamžikem.
3. `POST /api/v1/driver-measurements/v1/batches` přijímá stávající
   `DriverMeasurementDraft`, ale změňte jeho `contractVersion` z interní
   `sim-driver-measurements-v1` na **`cop-driver-measurements-v1`**. Ostatní
   pole: `batchId`, `contributorDay`, `vehicleClass`, `points`, volitelné `eta`
   zůstávají. `contributorIdDay`, uživatelské ID, token, `consent`, adresy,
   texty, trasa a volný kontext jsou zakázané. V odpovědi zůstává původní
   mobilní `batchId`, verze COP a bezpečný SIM shadow receipt.
4. `DELETE /api/v1/driver-measurements/v1/consent` nemá tělo. Ihned vypněte
   sběr a vymažte místní volatilní outbox. COP hned zruší lokální souhlas;
   `200` znamená dokončené mazání SIM, `202` znamená trvale evidované čekající
   mazání. Stav sledujte přes GET. Nový souhlas je možný nejdříve další UTC
   den a pouze po dokončení mazání. Opětovné zapnutí stejný den vrací `409`.

Všechny odpovědi používají `Cache-Control: no-store`. Při 400/403/409 neopakujte
stejný chybný požadavek; 429 respektuje `Retry-After`, 503 vyžaduje omezený
retry se stejným `batchId`. Žádný přímý fallback do SIM. Bez zapnutého
`COP_DRIVER_MEASUREMENTS_ENABLED` vrací adaptér 503 a Jízda zůstává vypnutá.

## Serverová hranice a minimalizace

COP přijme pouze ověřený OIDC subjekt; laboratorní token a browserový `Origin`
odmítne. Navíc vyžaduje podepsané OIDC `azp=csm-mobile` (nebo explicitně
nastavený `COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID`). To je vazba na klienta,
nikoli kryptografický důkaz fyzického zařízení či pravosti GPS. Den uživatele
je UTC a pseudonym je HMAC nad ověřeným subjektem a
dnem. Také mobilní UUID dávky, vzorků a ETA COP stabilně oddělí podle subjektu
a dne, takže dva uživatelé nemohou kolidovat shodným mobilním UUID. Server
doplní `consent` atestaci z vlastního trvalého stavu a pošle SIM jen přes
vyhrazený interní token. COP neukládá GPS ani těla odpovědí a neloguje body.

Neznámá pole se odmítají. COP připouští jen osobní auto a skutečné GPS body:
3–120 bodů ve stejný UTC den, chronologicky po 1–10 s, v rámci 600 s,
maximálně 24 h staré, alespoň 60 s zpožděné při uploadu, po souhlasu,
bez reduced accuracy, s přesností polohy nejvýše 15 m, rychlosti 2 m/s a
směru 20°. `estimated`, `simulated`, `personal_stop`, `paused` a `unknown`
odmítne. Tělo je omezeno na 1 MiB. COP **nedokáže nezávisle prokázat**,
že Jízda skutečně vynechala začátek/konec jízdy či osobní zóny; její
`DriverMeasurementCollector` musí zachovat odstup nejméně 60 s a 300 m a
to musí být ověřeno na telefonu před zapnutím.

## Trvalý souhlas, mazání a tajemství

Zapnutý COP adaptér vyžaduje PostgreSQL v `COP_DATABASE_URL`. Vzniká tabulka
`cop_driver_measurement_consents` pro čas souhlasu, odvolání a seznam UTC dnů,
které čekají na smazání. Neobsahuje GPS. Odeslání dávky drží transakční zámek
řádku uživatele po dobu interního volání, takže souběžné odvolání nemůže
předběhnout právě odesílanou dávku. SIM volání má timeout 10 s, databázový
statement 15 s a lock 12 s. Při výpadku SIM zůstává mazání v databázi a
COP jej opakuje po startu a každou minutu. Regrant čeká na úplné smazání;
ve stejný UTC den je blokován i po dokončení, protože SIM drží 7denní
tombstone denního pseudonymu.

`COP_DRIVER_MEASUREMENTS_HASH_SECRET` má nejméně 32 náhodných znaků a nesmí se
měnit bez řízené migrace: COP ukládá jen jeho fingerprint a při nečekané
změně odmítne start, aby neztratil možnost odvodit pseudonymy pro mazání.
`COP_DRIVER_MEASUREMENTS_SIM_URL` je celý interní prefix končící na
`/situation-data/api/v1/internal/driver-measurements/v1`.
`COP_DRIVER_MEASUREMENTS_SIM_TOKEN` je vyhrazený službový token, pouze v
produkčních secrets. Žádná hodnota se neukládá do Gitu. Runtime DDL v COP
vyžaduje `CREATE` oprávnění při prvním startu; pro nejmenší dlouhodobá práva
lze vytvořit obě tabulky předem řízenou migrací a runtime uživateli ponechat
jen SELECT/INSERT/UPDATE a sekvenční práva dle konkrétního schématu.

Při rollbacku vypněte pouze `COP_DRIVER_MEASUREMENTS_ENABLED`. Ponechte
`COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED=true`, databázi, HMAC tajemství a
SIM přístup, aby již udělené souhlasy bylo možné odvolat a čekající smazání
doběhlo. V tomto režimu jsou nové souhlasy a dávky zakázány, GET/DELETE
souhlasu funguje dál. Na SIM musí zůstat zapnutý samostatný
`DRIVER_MEASUREMENTS_REVOCATION_ENABLED`; příjem nových dávek může zůstat
vypnutý. Pokud SIM DELETE odmítá, COP ponechá `pendingDeletion=true`
a blokuje opětovný souhlas. Automatický cleanup zpracuje nejvýše čtyři denní
pseudonymy na běh a má jediného pracovníka; po restartu se obnoví z databáze.

## Akceptace před aktivací

Lokální syntetické testy pokrývají dva uživatele, transformaci UUID, odmítnutí
kontextu, odvolání, čekající smazání a chybové odpovědi SIM. Zatím nejsou
důkazem běhu na telefonu ani produkčního propojení. Před zapnutím společně
ověřte skutečné GPS/ETA s Jízdou, přihlášení běžného uživatele `csm-mobile`,
odříznuté konce jízd, více zařízení, změnu dne, 429/503, durable mazání po
restartu, audit a kvalitu souhrnů v SIM. Produkční síťové propojení a předání
službového tokenu podléhají samostatnému schválení.
