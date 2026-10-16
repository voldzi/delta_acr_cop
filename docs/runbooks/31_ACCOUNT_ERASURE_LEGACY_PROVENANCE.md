# 31 — Výslovné zařazení historické provenience COP

## Stav a hranice

Zdroj a izolované zkoušky jsou připraveny. Tento dokument nepotvrzuje produkční
zařazení ani dokončení mazání. Produkční data, přepínače a oprávnění touto prací
změněny nebyly. Běžící společný whole test a jeho časové lhůty se nepřepisují.

Historické tabulky používaly přesný serverem určený `sub`, ale neukládaly jeho
OIDC issuer. Nové přihlášení, UUID formát, e-mail ani shoda jmen nedokládají původ
starého řádku. Nejde o runtime backfill. Správce podle ADR0055 výslovně přezkoumá
historii writerů a autentizace a sváže důkaz s úplným otiskem každého řádku.
Nedoložený řádek zůstává nezměněný a blokuje příslušnou připravenost.

## Přesné položky inventury

| Doména / tabulka | Klíč | Původní identity | Povolená změna |
| --- | --- | --- | --- |
| `cop_community_reports` | `report_id` | `subject_id` | Chybějící nebo NULL witness `report` v `cop_community_erasure_ownership` |
| `cop_community_report_attachments` | `attachment_id` | Vlastní `subject_id`, nikoli autor rodičovského hlášení | Witness `attachment` |
| `cop_community_groups` | `group_id` | `owner_subject_id` | Witness `group` |
| `cop_community_group_members` | `group_id,subject_id` | Přesný `subject_id`; historické aliasy se nepřevádějí | Witness `membership`, klíč `group_id:subject_id` |
| `cop_community_report_confirmations` | `report_id,subject_id` | Vlastní `subject_id` | Witness `confirmation`, klíč `report_id:subject_id` |
| `cop_user_profiles` | `subject_id` | `subject_id` | Jen NULL `issuer`, pokud `erasure_fenced=false` |
| `cop_mobile_devices` | `subject_id,device_id` | `subject_id` | Jen NULL `owner_issuer` |
| `cop_mobile_mesh_acks` | `subject_id,envelope_id` | `subject_id` | Jen NULL `owner_issuer` |
| `cop_mobile_pairing_sessions` | `code` | Samostatně tvůrce, příjemce a `device_payload.subjectId` | Jen NULL `created_by_owner_issuer`, NULL `claimed_by_owner_issuer` a chybějící `device_payload.ownerIssuer`; payload musí patřit přesnému příjemci |
| `cop_voice_calls` | `call_id` | Iniciátor, všichni příjemci a případný přijímající | Jen NULL `owner_issuer`; jediná prokázaná autorita musí pokrývat všechny reference; žádné nové historické tokenové granty |
| `cop_community_owned_media`, `cop_community_metadata_owners` | Vlastní složené klíče | Samostatný autor objektu/pole | Tento helper je nezařazuje; nelze autora odhadnout z rodiče |
| `cop_web_sessions` | `session_id` | Uloženo uvnitř šifrovaného payloadu; `owner_hash` je HMAC | Pouze výslovný původní RS256 podpis: doplní profile.issuer do znovu zašifrovaného payloadu a source HMAC owner_hash; ostatní pole i tokenové stringy zůstávají beze změny |

Otisk zahrnuje **celý** řádek, včetně obsahu a geometrie, ale do plánu se ukládá
jen SHA256, přesný technický klíč a původní subject. Obsah ani šifrované tokeny se
nevypisují. Všechny otisky se počítají z PostgreSQL `to_jsonb(row)::text` při
`TimeZone=UTC`, nikoli z libovolně naformátovaného JSON klienta. Příklad výrazu:

```sql
SET LOCAL TimeZone='UTC';
SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')
FROM cop_user_profiles r WHERE subject_id=$1;
```

### Hardcoded `lab` není účet OIDC

Pro přesně doložené historické `report`, `group`, `membership` a `confirmation` s původním
subjectem `lab` vzniká oddělený `cop_legacy_nonaccount_provenance`. Neukládá se
vymyšlený issuer `urn:...`, nepřiděluje se vlastnictví žádnému člověku a nevzniká
účet. `writer_kind=hardcoded_lab` označuje historického serverového writera.

Ledger obsahuje jen druh/klíč, přesnou historickou revizi, digest přezkoumaného
důkazu, celý otisk řádku a celý otisk původního nullable ownership witnessu
(nebo SHA256 textu `null`, pokud witness neexistoval). Runtime uzná pouze
aktuálně shodnou dvojici. Změněný obsah, witness, osiřelý marker, neznámý druh či
nový neklasifikovaný lab řádek opět blokuje připravenost. Klasifikované rodiče a
členství aplikace nemění; cizí OIDC zápis, včetně OIDC `sub=lab`, vrací 404.
Kontrola tedy nevytváří skrytou možnost převlastnění ani obecnou výjimku pro lab.

První schema preparation zůstává přesně devět tabulek. Tento samostatný krok
přidá desátou tabulku pouze při skutečném lab plánu. Nový server ji také vytvoří
standardním init, avšak samotná prázdná tabulka žádná legacy data neklasifikuje.

## Pevný přezkoumaný plán

Soubor je pouze na produkčním serveru:
`/srv/cop/runtime/account-erasure-install/legacy-provenance-plan.json`,
Root, 0600, běžný soubor bez symlinku a dalších hardlinků. Nikdy nepatří do Gitu.
Plán má pevný kontrakt `cop-legacy-erasure-provenance-enrollment-v1` a obsahuje:

- `planId`, aktuální guard/store/incarnation/restore generation/configuration fingerprint;
- jediný skutečný COP API writer `containerId` a `imageId`;
- přesný konfigurací povolený OIDC issuer;
- evidence s autentizací `verified_oidc_sub` nebo `hardcoded_lab`, intervalem
  `[validFrom,validUntil)`, digests historické autentizační konfigurace a
  kompletní inventury writerů a přesnými `legacySourcePins` exportovanými helperem;
- přesně vyjmenované řádky `kind,key,fullRowSha256,ownershipBeforeSha256,
  originalSubjects,evidenceId`.

`sourcePins` představují konkrétní přezkoumanou implementaci historické hranice
v revizi `b13fbdc71f3d9821f8b857c3f73255a75c46fa76`. Správce musí doložit, že
historie všech skutečných writerů a konfigurací pokrývá vytvoření i změny řádku
v uvedeném intervalu. Pouhé opsání digestů bez tohoto přezkumu původ nepotvrzuje.
Aplikace neumí zpětně sama dokázat zdroj dat proti správci databáze; správce je
zde výslovně důvěryhodná autorita. Digest plánu je
`SHA256(JSON.stringify(JSON.parse(file)))`; předává se odděleně jako
`reviewedPlanSha256` v pevném instalačním podkladu. Helper nepřijímá nový SQL,
libovolný host, browserovou identitu ani pouhý souhlasový boolean.

OIDC `originalSubjects` jsou přesně seřazené, deduplikované původní UUID subjecty
ze všech referencí řádku. To není tvrzení, že každé UUID je prokazatelným účtem:
skutečný historický důkaz je povinný. Aliasy, e-maily, aktuální login a lab pod
OIDC větví jsou odmítnuty. Příloha může prokazatelně patřit jinému autorovi než
její rodič. Pairing i voice mají samostatně zkontrolované všechny identity.

## Úzká příprava chybějícího schématu

`prepareLegacyErasureSchema({mode,password,reviewedPlanSha256,hostWriterWitness})`
používá stejné pevné host/SQL předání jako enrollment. Čte přesný export
`legacy-erasure-schema.ts`, který musí testem odpovídat DDL skutečných stores.
Povoleno je jen osm `ADD COLUMN`: profile issuer a `erasure_fenced=false`,
device/mesh owner issuer, oba pairing owner issuery, voice owner issuer a BFF
owner hash; dále tři prázdné profile/BFF fence/metadata tabulky a existující
partial owner index. Žádný INSERT fingerprintu, GRANT, DELETE, backfill obsahu,
reset existujícího true flagu ani přepsání známého issueru. Existující jiný typ,
NULL/default, tabulka, vlastník, trigger/RLS nebo constraint drift se odmítne.

`check` vrací absenci výslovně v `missingColumns/missingTables/missingIndex`,
`schemaReady=false`; chybějící evidence se nesmí vydávat za nulu. `apply` drží
stejné zámky a po vytvoření ověří skutečný katalog i prázdné technické tabulky.
Tento krok nevytváří ani nedoplňuje žádné vlastnictví uživatelských řádků.

Nové NULL/default atributy mění úplný JSON otisk řádku. Pořadí je proto schema
prep → skutečná privátní full-row inventura → Root přezkum → enrollment. Předem
připravený plán smí používat pouze přesnou projekci chybějících pevně schválených
NULL/false atributů; skutečný celý post-DDL řádek se před enrollmentem stejně
musí shodovat. Starý otisk není automaticky nahrazen novým.

### Oddělený schema plán a nezávazná čtecí inventura

Příprava schématu může použít samostatný přezkoumaný kontrakt
`cop-legacy-erasure-schema-preparation-plan-v1` s přesnými položkami
`planId,binding,writer,exportedDdlSha256`. Digest DDL vrací čistý export
`legacyErasureSchemaDdlSha256()`. Tento plán neobsahuje tvrzení o historické
identitě; enrollment jej výslovně odmítne. Příprava nullable sloupců proto
nevyžaduje smyšlený důkaz jen kvůli následné skutečné inventuře.

`inspectLegacyErasureProvenance({password?})` čte pouze pevnou business session
route a ověřenou CA v READ ONLY transakci. Výsledek
`cop-legacy-provenance-proposed-inventory-v1` je **návrh faktů, nikoli plán**:
`enrollmentAllowed=false`, `historicalEvidenceVerified=false`. Vrací přesné
technické klíče, SQL hash celého řádku, hash witnessu, původní uložené reference a
časové meze. Nevrací volný obsah, jména, e-maily ani tokenové payloady; u relací
zůstává subject neprůhledný a vyžaduje původní podpis. Výstup i technické klíče
patří jen do privátního Root souboru 0600, nikoli do chatu nebo Gitu.

`proposedPostSchemaRowSha256` je přesná projekce pouze skutečně chybějících
pevných NULL/false sloupců. Nepřepíše existující issuer či true flag. Izolovaný
PG test ověřuje její shodu s celým skutečným řádkem po DDL; enrollment vždy znovu
ověří fyzický post-DDL hash. Návrh označuje neověřený OIDC původ, přesný lab,
smíšené reference a již známou provenienci odděleně. Žádnou třídu sám nezařadí.

Správce může historický přezkum opřít o výslovné potvrzení vlastníka systému,
že všechny dosavadní reálné účty COP/Jízdy vznikaly pouze v nynějším Keycloak
realmu `cop`, a o skutečné historické zdroje, konfigurace, inventuru writerů a
časové meze. Toto je důvěryhodný provozní fakt dle ADR0055, nikoli kryptografický
důkaz každého řádku. V přezkoumaném evidence bundle musí být uveden pravdivě;
původní podpisy relací se vždy ověřují zvlášť. Dnešní login, UUID či e-mail
samotný takový důkaz nenahrazuje.

## Čerstvý kandidát během jedné kontrolované odstávky

Statický inventurní otisk živých relací se mění při přihlášení a obnově tokenu.
Root proto nejdříve přezkoumá **pevnou historickou policy bez řádků**, nikoli
předem zastaralý hotový seznam. Policy je Root 0600 soubor
`/srv/cop/runtime/account-erasure-install/legacy-provenance-policy.json`:

- `contractVersion=cop-legacy-erasure-provenance-policy-v1`;
- `planId,binding,writer,issuer,evidence` se stejnými přesnými pravidly jako plán;
- `historicalIssuerAttestation` s kontraktem
  `cop-historical-issuer-operator-attestation-v1`, referencí
  `call_0ec214d3623f442da730ce7a86fbdbe6` a tvrzením
  `all_real_COP_Jizda_accounts_only_current_Keycloak_realm_cop`;
- `signedSessionPolicy` podle pravidel původního podpisu níže, pokud jsou relace.

Každé evidence má již přezkoumaný zdroj, autentizační konfiguraci, všechny writery
anebo jejich důvěryhodně doloženou historii a interval. Lidský fakt sám není
podpisem každého řádku. Policy neobsahuje `rows`; neznámá nebo překrývající se
historie nevytváří výchozí vlastnictví.

Pod **stejným storage lockem a nepřetržitou pauzou jediného skutečného COP
writera** se provede schema-only příprava a potom host
`inspectLegacyProvenancePolicyWriter({reviewedPolicySha256})`. Jeho kontrakt je
`cop-legacy-provenance-policy-host-writer-v1`; oproti plan witnessu používá
`reviewedPolicySha256`. Obsahuje skutečný CID/image/PID/StartedAt/source digest,
žádný callback s hodnotou true.

Node24 export `generateLegacyErasureProvenanceCandidate({password,
reviewedPolicySha256,hostWriterWitness})` pracuje pouze v READ ONLY transakcích.
Přečte čerstvé celé otisky a původní reference, přesnou guard/lokální vazbu a
nulový stav jobs/fences/leases. Původní subject relace smí zařadit až po skutečné
AES/RS256/JWKS kontrole; nepoužije dnešní login nebo pouhý dešifrovaný profil.
Neprovádí DDL, zařazení, přepsání řádku ani automatické opakování.

Vrací **privátní RAM** `{candidatePlan,summary}`; nic sám nevypisuje ani
neukládá. Host ukládá kandidáta pouze Root 0600 do chráněného adresáře 0700 na
serveru. Summary `cop-legacy-erasure-candidate-summary-v1` obsahuje jen
`candidateSha256,policySha256,sourceHelperSha256,bindingSha256,
hostWriterWitnessSha256,totalRows,countsByKind,oidcRows,nonAccountRows,
sessionRows,unresolved`. `totalRows` zahrnuje i zachované řádky; počet plánovaných
řádků je `oidcRows+nonAccountRows`, relace jsou podmnožinou `oidcRows`. Neznámý
původ znamená `unresolved>0`, `candidatePlan=null`, žádný použitelný digest.

Root v témže terminálu přezkoumá konkrétní souhrn a potvrdí **přesný SHA nového
kandidáta**. Teprve potom vznikne dosavadní pevný enrollment plán a spustí se
stávající CAS apply/readback; mezi tím se writer neobnoví. Jakákoli změna řádku
od jiného writera způsobí chybu. Neexistuje automatické přepsání hashů nebo retry
bez nového přezkumu. Po úspěšném readbacku lze podle schváleného postupu obnovit
writer a pokračovat stávající release pipeline; další drift opět blokuje GO.

Po dobu pauzy je COP API nedostupné nebo čeká do timeoutu; Keycloak/SIM identita
se nemění. Při chybě před rotací úložiště lze obnovit původní API, ale jeho další
zápisy zneplatní připravený snapshot. Po provedené S3 closure se starý klíč
nevrací: starý cacheovaný přístup k médiím zůstává 403, dokud není připravený
ověřený nový runtime. Samotný návrat starého image nevrací předchozí uploady.

### Skutečně zjištěné lab potvrzení

Čtecí inventura z 16. října obsahovala dvě confirmations, obě s přesným původním
subjectem `lab`, bez UUID či smíšených referencí. Revize `b13fbdc...` v
`security.ts` 173–179 vytváří pro lab token pevný neúčetní subject; handler
`confirmReport` předává ověřený actor a store ukládá přesný subject pod
`(report_id,subject_id)`. Proto ledger zahrnuje také `confirmation` s klíčem
`report_id:subject_id`. Stejný celý row/witness hash brání mutaci a přijetí
OIDC `sub=lab`; nejde o vymyšlený issuer. Tato klasifikace nebyla v produkci
provedena. Neoznačené lab confirmations blokují globální community připravenost.

### Rozdíl mezi host konfigurací a aktivním profilem

Aktuální host `.env` může postrádat session DSN, která existuje až v chráněném
runtime profilu, a obsahovat dvě schválené legacy duplicity. Produkční schema a
enrollment factories proto používají společný `loadOperatorEnvironment()`:
Root ověřený existující profil pouze read-only, přesné tři DSN do RAM, guard a
ostatní konfigurace z host souboru, před/po actual Docker Env/profile CAS.
Nevzniká nový secrets soubor, síťová cesta ani TLS výjimka. Jednorázová čtecí
inventura bez release plánu použila původní veřejný READ ONLY producer pod
skutečně ověřeným current CID/image/Env a s pevně ověřenou TLS CA. Podrobný
výsledek zůstal jen na serveru v souboru 0600; nemá platnost Root enrollmentu.

## Provozní propojení bez nového brokeru

Host má Node22, přesně připnutý SQL carrier Node24. Do carrieru se nepřidává
Docker socket ani Docker CLI. Existující Root instalátor pod `.storage.lock`
provede pozastavení a ověří přesnou runtime pointer/CID/image vazbu.

1. Host importuje `inspectLegacyProvenanceWriter({reviewedPlanSha256})` z
   `scripts/account-safety/enroll-legacy-erasure-provenance.mjs`. Funkce pouze
   čte pevný Root plán a skutečný Docker stav všech běžících COP compose API
   writerů. Musí jít o jediný přesný writer, `Running=true`, `Paused=true`.
   Vrací uzavřený witness s CID/image/PID/StartedAt, source digestem a digestem plánu.
2. Soukromým stdin předá tento witness a heslo jen v RAM do Node24
   `enrollLegacyErasureProvenance({mode,password,reviewedPlanSha256,
   hostWriterWitness})`. Produkční route je pevná session cesta s verify-full CA;
   callback `true` ani změna identity není přijatelná.
3. SQL helper drží skutečný content writer advisory lock, zámky všech dotčených
   business tabulek a guard lock. Vyžaduje správnou lokální i nezávislou vazbu,
   replay nula a žádný přijatý job, fence nebo nedokončenou write lease. Chybějící
   tabulka není nula. Krátké timeouty blokují místo nekonečného čekání.
4. Nejprve zkontroluje všechny úplné řádky a původní witnessy, teprve poté v jedné
   business transakci doplní vyjmenovanou provenienci. Nemění obsah, subjecty,
   role, oprávnění, existující známý issuer ani jiné účty. Následuje celý
   readback každého původního řádku a doplněného witnessu/markeru.
5. SQL receipt výslovně obsahuje `provenanceComplete=false` a
   `hostPostReadbackRequired=true`. Host musí po SQL znovu vykonat skutečný
   `inspectLegacyProvenanceWriter`, porovnat beze změny witness i původní runtime
   pointer a teprve potom může vydat finální provozní potvrzení a pokračovat.

`check` nemění data ani nevytváří ledger. `apply` je první, výslovné zařazení,
nikoli opakovatelný backfill: stejný již změněný řádek se znovu automaticky
nepřijme. Při neznámém výsledku se provede skutečný readback a Root přezkum;
nesmí se vracet issuer na NULL, slepě regenerovat plán nebo automaticky
přiřazovat zbytek podle nového loginu. Po přijatém mazacím jobu helper odmítá běh.

### Bezpečné opakování po úspěšném SQL kroku

Úspěšný `apply` vrací `sourceHelperSha256` a privátní `postState` s přesnými
`kind,key,fullRowSha256,ownershipSha256,nonAccountMarkerSha256`, dále
`postStateSha256`. Hash zahrnuje skutečný celý post-enrollment řádek (u relace
nový šifrovaný blob), skutečný ownership witness i případný lab marker. Žádný
obsah nebo token se do receipt nekopíruje. Root ukládá přesný původní receipt a
původní plán pod chráněným provozním checkpointem.

Po přerušení se již změněné řádky znovu nezařazují. Host pod stejným zámkem
ověří skutečně paused writer a předá witness do:

`verifyLegacyErasureProvenanceReceipt({password,reviewedPlanSha256,
hostWriterWitness,receipt})`.

Tento export provádí pouze READ ONLY transakce a skutečná nová SQL čtení.
Přijme jen původní kompletní `apply` receipt ze stejného source, původního plánu,
writer custody a dataset bindingu; požaduje beze změny všechny konečné řádky,
ledger a marker, prázdné jobs/fences/leases a skutečně nula aktivních NULL-owner
relací. Pro opakování nedešifruje ani nepřepisuje původní relaci a neprovádí nový
JWKS fetch. Úprava řádku nebo witnessu, odebraná či přidaná položka receipt,
změněný source/generace, nový neznámý session owner nebo neúplné potvrzení běh
blokují. Neexistuje oprava plánu podle nového loginu.

Výsledek `cop-legacy-erasure-provenance-receipt-readback-v1` má `verified=true`,
`readOnly=true`, skutečné finální digests a counts, avšak stále
`hostPostReadbackRequired=true`, `provenanceComplete=false` a
`wholeAccountComplete=false`. Teprve skutečný finální host readback pointeru,
CID/image/PID/StartedAt pod nepřerušeným zámkem dovolí pokračovat. Kopie receipt
bez čerstvého SQL a host readbacku není důkazem úspěšné obnovy kroku.

### Relace COP BFF: původní podepsaný důkaz

`kind=session` je součástí téhož pevného manifestu, má klíč `session_id`, celý
otisk původního řádku, `ownershipBeforeSha256=null` a právě jeden přesný původní
UUID subject. Jako autorita se nepoužívá současný login ani dešifrovaný profil.
Povinný `signedSessionPolicy` má přesně:

- `contractVersion=cop-legacy-original-signed-session-policy-v1`;
- stejný `issuer` a `authorizedParty` přesně odpovídající `COP_OIDC_CLIENT_ID`;
- `jwksUri` pevně `${issuer}/protocol/openid-connect/certs`, veřejné HTTPS na
  stejném originu issueru. Případná interní HTTP optimalizace běžného runtime se
  nemění a pro tento důkaz se nepoužije;
- `jwksSha256`: SHA256 JSON veřejného keysetu s rekurzivně seřazenými klíči
  objektů (pořadí polí zůstává), který předem přezkoumá Root;
- `encryptionKeyFingerprint`: přesný source
  SHA256(`cop-web-session-owner-key-v1\0` + SHA256(trim(existing session secret))).

Helper v soukromém carrieru načte existující secret z pevného produkčního
`.env`, nic negeneruje ani nevypisuje. JWKS GET neposílá token, cookie ani
Authorization; má timeout 3 s, zákaz redirectu, mez 128 KiB a nejvýše 32 klíčů.
Změněný digest, chybějící historický `kid`, duplicita, soukromý JWK, jiný issuer
nebo nedoložená certifikační větev blokují. JWT musí mít původní RS256 podpis
RSA klíčem nejméně 2048 bitů, přesné `iss/sub/azp` a žádný externí vložený klíč,
`jku`, kritické či přepínající hlavičky. Podpis se ověří před důvěrou v claims.

Původní payload se otevře AES-256-GCM pouze v RAM. Klíč, nonce/tag formát i HMAC
doménový prefix odpovídají skutečnému `PostgresWebSessionStore`. `profile.subjectId`
se musí přesně shodovat s podepsaným subjectem a profil dosud nesmí mít issuer;
existující owner hash se nikdy nepřepisuje. Metadata fingerprint, pokud existuje,
musí odpovídat stejnému klíči; helper jej nevkládá ani neresetuje.

Ověřují se historické `iat/exp/nbf` proti původnímu `row.updated_at`, nikoli proti
dnešnímu přihlášení. Povolená odchylka je 30 s, vydání nesmí předcházet vzniku
relace ani následovat po aktualizaci mimo tuto mez, JWT musel být v čase uložení
platný, délka access tokenu je nejvýše hodina a uložená access expiry musí
odpovídat podepsané expiry v uvedené odchylce. Payload a sloupec musí mít stejnou
access expiry. Expirovaný původní JWT tím nezíská novou platnost; všechny expiry,
created/updated časy, access/refresh/id tokenové stringy a ostatní JSON pole
zůstávají zachovány.

Po všech kontrolách a full-row/blob CAS se přidá **jen** `profile.issuer`,
payload se znovu zašifruje s novou náhodnou nonce a zapíše se přesný source
HMAC-SHA256(`SHA256(existing secret)`, `cop-web-session-owner-v1\0` +
JSON(`[issuer,sub]`)) do dosud NULL `owner_hash`. Skutečný následný PG readback
se znovu dešifruje a porovná celý payload i celý řádek. Receipt obsahuje pouze
otisky důkazů. Žádný plaintext token, soukromý klíč nebo obsah profilu nejde do
logu, souboru, Gitu či jinému poskytovateli.

`legacySessions.activeCount` po operaci znamená skutečný zbývající počet
aktivních NULL-owner relací. Dokončovací krok vyžaduje přesně nulu; `applied=true`
nebo jeden úspěšně zařazený řádek nestačí. Při chybě zůstává transakce bez změny,
nevzniká hromadné odhlášení, identity fallback ani záměna issueru. Keycloak/SIM
identita a přístup se tímto krokem nemění.

## Ověření

Vlastní nová PostGIS17.5 fixture a skutečně paused syntetický Docker writer;
žádná sdílená whole fixture, produkce ani build dist nebyly změněny. Podrobný
redigovaný výsledek: `docs/testing/account-erasure-legacy-provenance-20261016.json`.
Aktuálně prošlo 53 operátorských PG a 16 runtime/interop/conformance testů (69 celkem).
Testy pokrývají full-row/witness CAS, časové hranice, přesný důkaz a digest
plánu, všechny pairing/voice identity, device/mesh, B i provozní role, jobs,
leases, změnu generace, actual unpause odmítnutí, signed sessions včetně dnešního expiry/historického podpisu, špatných klíčů/claims/časů,
skutečnou BFF AES/HMAC interoperabilitu, úzkou runtime lab hranici, přesnou
projekci post-DDL inventury, schema-only plán a pouze čtecí ověření původního
post-enrollment receipt včetně negativních mutací, čerstvého kandidáta s osmi
původně podepsanými A/B relacemi a composite lab confirmation hranice. Jde o komponentové důkazy; produkční Root evidence bundle a původní podpisy aktuálních relací (v čtecím snapshotu osm),
finální host custody, společný whole test a následné nasazení jsou samostatné
povinné kroky.


## Pád po SQL COMMIT před uložením Root receipt

Příprava vytvoří jedinou technickou tabulku
`cop_legacy_erasure_enrollment_receipts` vlastněnou stávajícím DB administrátorem,
bez oprávnění aplikačních rolí. Původní raw receipt se uloží jako přesný JSON text
s otisky plánu/zdroje/bindingu ve **stejné transakci** jako zařazení provenance.
Neobsahuje tokeny, ciphertext ani obsah. Katalog, ACL, sloupce, PK a počet řádků
mají přesnou kontrolu; nejde o obecný auditní archiv.

Po pádu lze za stejného Root review a paused CID/PID/profile pouze načíst tento
původní výsledek a znovu skutečně ověřit všechny post-state otisky. Funkce
`recoverDurableLegacyErasureReceipt` nikdy neopakuje apply, šifrování ani JWKS
ověřování a nevymýšlí výsledek z nově přečtených řádků. Chybějící nebo změněný
SQL důkaz zůstane pending a writer paused. Po ověřeném uložení do Root0600
host receipt se přes `acknowledgeDurableLegacyErasureReceipt` znovu provede
readback a smaže se pouze přesný technický transfer řádek. Teprve potom se
writer unpause. Prokázaná prázdná tabulka po dřívějším přenosu je idempotentní;
provozní řádky se tím nemažou. Test skutečně zahodí původní návratovou hodnotu
po COMMIT, odstraní fixture JWKS a doloží recovery bez změny ciphertextu.


Po dokončeném Root readbacku a skutečném purge transferu se do host receipt
uloží také přesný `durableReceiptTransfer` před unpause. Pozdější opakování
nesmí vyžadovat staré full-row bajty profilu či relace, které běžný provoz mění.
`verifyCompletedLegacyErasureProvenance` vyžaduje tento původní kompletní Root
důkaz, skutečně prázdný transfer store a ověří aktuální stabilní ownership,
schéma i binding všech současných řádků. U relací kontroluje současný issuer,
subject a HMAC s původním klíčem v RAM; žádné nové historické JWT tvrzení,
reencryption nebo nahrazení původního receipt nevzniká. Chybné/vymazané ownership
údaje nebo nové nezařazené řádky blokují. Neúplná paused recovery nadále používá
přesný původní full-row CAS. Před zapnutím se vždy ještě provede skutečná aktuální
serverová owner-readiness; historická migrace ji nenahrazuje.
