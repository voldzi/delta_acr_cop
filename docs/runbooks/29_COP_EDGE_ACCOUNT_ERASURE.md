# COP Edge: ověřené odstranění kopií účtu

Stav 2026-10-16: implementace a izolované komponentové testy jsou připravené.
Tento dokument sám nepotvrzuje produkční nasazení ani společnou akceptaci všech
vlastníků dat. Produkční instalaci řídí runbook 28.

## Rozhraní a oprávnění

Používá se stávající serverový `COP_EDGE_ADMIN_TOKEN`, bez nového veřejného
portu. COP volá `GET /edge/internal/account-erasure/capabilities` a
`POST /edge/internal/account-erasure`. Závazné schéma je v OpenAPI COP,
`cop-edge-account-erasure-v1`. Nové chyby mají standardní obálku COP s
`correlationId`, bez těla požadavku, síťové výjimky nebo identity v chybové zprávě.

Požadavek obsahuje `phase=preflight|erase`, `scope=full_account`, `accountKey`,
původní `operationId`, krátkodobě předaného ověřeného aktéra, aktuální
`datasetBinding` a ověřené seznamy `reportIds`, `groupIds`, `incidentIds`,
`taskIds`, `drawingIds`. U UUID se sjednotí malá písmena, odstraní duplicity a
seznamy se seřadí. Digest je SHA256 JSON objektu s právě tímto pořadím klíčů.
Samotný prohlížeč tento interní kontrakt neovládá.

COP před odesláním mazání potvrzuje globální blokaci zápisů konkrétní operace.
Edge sám vytvoří trvalou blokaci v lokálním souboru před odstraněním obsahu.
Synchronizace, outbox, mazání, zápis souboru i kontrola dostupnosti používají
jednu serializační bariéru. Běžící synchronizace se dokončí před mazáním;
pozdější přehrání chráněné kopie se znovu nepřijme.

## Důkaz vlastnictví a zachování cizích dat

Obsah se odstraňuje pouze podle ověřené centrální obálky
`producerNodeId=node_central_cop`, odpovídajícího zdroje a přesné dvojice
`entityType/entityId` z předaného manifestu. Samotná vnořená reference nebo
shoda raw uživatelského ID není důkazem vlastnictví. Taková kopie zůstane
zachovaná a odpověď zůstává `202 pending/ownership_unresolved`.

Různé části COP mohou ve stejné operaci dodat různé dílčí manifesty. Edge je
trvale sjednocuje; dřívější chráněné reference neodebírá. Digest odpovědi patří
aktuálnímu požadavku, uložený digest celé sjednocené množině. Jiný účet,
aktér, operace nebo neodpovídající generace jsou odmítnuty. Odpověď
`200 completed` s `proofId` vzniká až po skutečné kontrole souboru a absence
ověřených kopií. `202` nikdy neznamená dokončení.

V journalu se neuchovává raw issuer/subject: pouze hash dvojice a hash subjectu,
nezbytné reference, operace a vazba na generaci. Jde o pseudonymní technickou
evidenci podle schválené retence, nikoli o anonymní data.

## Soubory, restart a obnova

Stávající `state.json` je rozšířen kompatibilně o `accountErasure`.
Zápis používá soukromý dočasný soubor, fsync souboru, atomický rename a fsync
adresáře. Po přijetí blokace vzniká značka `.erasure-fence-v1`. Chybějící nebo
neplatný dříve blokovaný stav se nesmí nahradit prázdným stavem. Ověření
capabilities skutečně čte soubor a porovnává jej s runtime stavem.

Přesně rozpoznané opuštěné dočasné snímky vlastního `state.json` se při mazání
odstraní; cizí soubory ani jiné aplikace se nemění. Při chybě přístupu či
nejistotě zůstává mazání nedokončené. Vyšší schválená restore generace musí mít
novou incarnation a ruší staré completion proofs; nižší nebo zaměněná vazba
je odmítnuta. Obnovu řídí společný postup runbooků 26 a 28.

## Provedené ověření

- 13 nových scénářů + 16 stávajících testů Edge: 29/29 prošlo.
- Prošly ESLint a TypeScript build Edge.
- Skutečný HTTP test ověřil autentizaci, validaci, strict capabilities,
  správnou korelovanou chybovou obálku a completion receipt.
- Ověřeny A/B izolace, vnořená reference B na A (zachována/pending), centrální
  kopie A, sjednocení dílčích manifestů, poškozený digest, restart,
  pozdní replay/outbox, generační konflikt a neplatný stav na disku.
- V izolovaném společném namespace běží skutečný Edge nad finálním kódem a
  skutečným Keycloak service account. TLS transport do syntetického Keycloaku
  je upraven pouze v testovací fixture; není to důkaz produkčního TLS.

Společný test `whole-media-edge-fixture.mjs` vytváří A/B soukromé hlášení,
přílohu přes skutečný `cop_api` upload, soukromou kresbu a centrální incident.
Edge získá incident přes skutečný OIDC sync s COP. Readback kontroluje
skutečné SQL řádky, S3 obsah a Edge kopie, včetně otisku zachovaných dat B.
Samostatný provider test již ověřil skutečné zastavení SeaweedFS, ukončení
přijatého legacy PUTu a zamítnutí stále platného starého podpisu. Společná
obnova testuje fyzický business DB snapshot a novou administrátorskou media
closure; netvrdí fyzickou obnovu S3/Edge volumes, pokud nebyla provedena.

An explicitly configured Edge erasure origin remains a required controlled copy
even when an older restored COP federation registry has no Edge row. COP must
perform the actual capability and erasure readbacks for that origin; an empty
registry cannot prove absence of newer Edge data. Unknown consumers still block
completion.


## Přesné nasazení před Root instalací COP API

Existující deployment podporuje neměnný Edge image a zdroj. Koordinátor z čistého
přezkoumaného commitu sestaví Edge přes stávající X5 builder:

```sh
/srv/cop/scripts/deploy-production.sh --build-only cop-edge
```

Po zaznamenání skutečného image ID a zdrojového commitu se jako stávající UID1000
provede pouze Edge release:

```sh
/srv/cop/scripts/deploy-production.sh --edge-image '<immutable sha256 image ID>' \
  --edge-source '<reviewed 40-hex source commit>'
```

Konkrétní hodnoty dodá koordinátor vydání. Pevný `cop-edge-release.py` pod stejným
deployment lockem ověří aktuální jediný COP Edge, celý nakonfigurovaný environment,
host parametry, porty a totožnost existujícího datového volume a sítí. Nemění jiné
služby, tajemství, sítě ani porty. Použije pouze image override pro tento image a
`up --no-build --pull never --no-deps cop-edge`; po startu zopakuje paritu a
skutečné health/readiness i autentizované erasure capabilities. Chyba nevrací
starý image, který by mohl ignorovat blokace.

Sedm přímých offline testů ověřilo piny, cizí volume/environment/proces/síť a
skutečné použití runtime parity. Tyto testy nedokládají produkční nasazení. Nový
skutečný Edge CID se potom vloží do `final-configuration.json`; Edge se po
vytvoření COP Root proofu nesmí nepozorovaně měnit. Toto pořadí předchází API
owner readiness a enable.
