# 15 PoC Cleanup And Walkthrough 2026-06-24

Tento záznam popisuje provozní přípravu COP/CSM na řízený PoC průchod po
dokončení samostatné aplikace `cop-chat`. Cílem bylo odstranit staré testovací
skupiny, staré chatové místnosti a nepoužitelné historické konverzace tak, aby
demo začínalo v čistém a opakovatelném stavu.

Dokument neobsahuje hesla, recovery klíče ani tokeny. Přístupové údaje patří
do provozního secret managementu.

## Rozsah

- produkce `docker.home.cz`,
- veřejná adresa `https://cop.zeleznalady.cz/`,
- samostatný chat `https://cop.zeleznalady.cz/chat/`,
- COP API, `cop-chat`, CSM Messaging API a Matrix/Synapse,
- resetovatelný demo scénář `flood-central-bohemia`.

## Záloha Před Čištěním

Před zásahem byla na produkčním hostu vytvořena záloha:

```text
/home/voldzi/cop-poc-backups/cop-poc-20260624-232001
```

Záloha obsahuje databázové dumpy COP/CSM Messaging, snapshot Synapse a auditní
textové/JSON výstupy. Součástí složky jsou také finální snapshoty po vyčištění
a po reálném UI testu.

## Vyčištění

Pro PoC byly odstraněny staré Matrix místnosti a staré CSM konverzační metadata.
Z původních pracovních dat byly vyčištěny testovací skupiny jako `RealnýTest`,
`Testovací skupina`, `voda u potoka` a další staré demo/testovací záznamy.

CSM Messaging store používá tabulku `csm_messaging_stores` se sloupci
`store_name` a `payload`. Pro vyčištění konverzací se proto používá JSONB
payload store, ne starší předpoklad `name/data`.

Výchozí stav po vyčištění a před reálným UI testem:

| Kontrola | Výsledek |
| --- | --- |
| Synapse admin rooms | `total_rooms=0` |
| CSM Messaging conversations | `conversationCount=0` |
| CSM Messaging identities | `identityCount=3` |
| COP demo groups | `groupCount=1` |
| COP demo reports | `reportCount=3` |
| COP demo drawings | `drawingCount=3` |

Tři Matrix identity byly ponechány záměrně, protože patří přesně k PoC účtům a
seed ownerovi `lab`. Nejde o chatové zprávy ani konverzace. Ponechání identit
zkracuje demo setup a neobnovuje starou historii.

## Seed Stav

Po resetu byl znovu spuštěn seed `flood-central-bohemia`.

Výsledný seed:

- jedna skupina: `DEMO Povodeň - Středočeský kraj`,
- tři aktivní členové skupiny: `lab`, první demo operátor, druhý demo operátor,
- tři komunitní hlášení,
- tři zákresy,
- chat metadata se zobrazují jako `Krizový štáb - Povodeň`,
- staré paralelní chatové skupiny v COP webu nejsou používány.

## Reálný UI Test Chatu

Produkční test proběhl přes `https://cop.zeleznalady.cz/chat/`.

Scénář testu:

1. Přihlášení prvního demo operátora.
2. Ověření, že seznam chatů obsahuje pouze PoC skupinu.
3. Otevření skupiny `DEMO Povodeň - Středočeský kraj`.
4. Ověření hlavičky konverzace `3 členové` a režimu `E2EE`.
5. Odeslání zprávy prvním demo operátorem.
6. Odhlášení, přihlášení druhého demo operátora.
7. Ověření, že druhý demo operátor vidí stejnou skupinu a první zprávu hned po
   otevření, bez nutnosti odejít ze stránky a vrátit se.
8. Odeslání odpovědi druhým demo operátorem.
9. Návrat na prvního demo operátora.
10. Ověření, že první demo operátor vidí obě zprávy ve stejné konverzaci.

Výsledek: test prošel.

Stav po reálném UI testu:

| Kontrola | Výsledek |
| --- | --- |
| Synapse admin rooms | `total_rooms=1` |
| Matrix room encryption | `m.megolm.v1.aes-sha2` |
| Matrix joined members | `2` |
| CSM Messaging conversations | `conversationCount=1` |
| CSM Messaging identities | `identityCount=3` |
| COP demo status | `ready` |

`joined_members=2` je očekávaný stav pro reálný chat: dva demo operátoři jsou
účastníci Matrix místnosti. `lab` zůstává seed owner a člen COP skupiny, ale v
samotném testovacím Matrix chatu nebyl přihlášen jako konverzující uživatel.

## Připravený Klientský Scénář

1. Otevřít `https://cop.zeleznalady.cz/`.
2. Ukázat čisté levé menu a mapový workspace bez duplicitních chatových panelů.
3. Ukázat demo událost `Povodeň - Středočeský kraj`.
4. Přepnout vrstvy: výstrahy, povodně/voda, komunitní hlášení a zákresy.
5. Otevřít komunitní hlášení a ukázat popis, polohu, platnost a média.
6. Otevřít `Komunikace` nebo samostatně `https://cop.zeleznalady.cz/chat/`.
7. Ukázat jedinou PoC skupinu s lidským názvem a bez starých testovacích skupin.
8. Poslat krátkou zprávu v chatu, případně sdílet polohu nebo přílohu.
9. Přepnout na druhý demo účet a ukázat doručení ve stejné konverzaci.
10. Vrátit se do mapy a ukázat, že chat je samostatná lidská komunikace; mapový
    záznam vzniká přes hlášení, ne automatickým kopírováním z chatu.
11. Ukázat zákres evakuačního bodu nebo uzávěry.
12. Ukázat `health/ready` a `health/dependencies` pro provozní důvěru.

## Kontrolní Příkazy

Produkční služby:

```sh
ssh docker.home.cz 'cd /srv/cop && docker compose ps cop-api cop-chat'
ssh docker.home.cz 'cd /srv/csm-messaging && docker compose ps'
```

COP API:

```sh
curl -fsS https://cop.zeleznalady.cz/health/ready
```

PoC demo status z interní sítě:

```sh
cd /srv/cop
set -a; . ./.env; set +a
curl -fsS -H "Authorization: Bearer ${COP_PUBLIC_LAB_VALUE:-$COP_LAB_TOKEN}" \
  http://127.0.0.1:4310/api/v1/demo/scenarios/flood-central-bohemia/status
```

CSM Messaging health:

```sh
curl -fsS http://127.0.0.1:4050/health/ready
```

## Bezpečnostní Poznámky

- Chat je E2EE přes Matrix a webový klient neukládá plaintext zprávy do COP API.
- Recovery klíče se nesmí vkládat do dokumentace ani screenshotů. Pokud byl
  recovery klíč během testování zachycen ve screenshotu, před formálním
  předáním se musí recovery/key-backup cyklus znovu bezpečně otočit.
- Staré zprávy nejsou součást PoC. Pro PoC je důležitý čistý start a ověřené
  doručení nové historie mezi autorizovanými členy.
- Automatické mazání zpráv má zůstat vypnuté, pokud není pro konkrétní
  konverzaci záměrně nastavené.

## Akceptační Výsledek

PoC chat je připravený pro řízenou ukázku:

- staré skupiny a staré Matrix místnosti jsou odstraněné,
- demo seed je opakovatelný,
- produkční `cop-chat` používá jednu PoC skupinu,
- dva demo operátoři vidí stejnou E2EE historii,
- první otevření historie funguje bez odchodu a návratu,
- provozní snapshoty jsou uložené v záloze na `docker.home.cz`,
- aplikace je nasazená z GitHubu na produkčním hostu.
