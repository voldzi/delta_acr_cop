# Pokyn pro správce: omezené nasazení chatu vozidla

Podklad je připravený ke schválení předání správci. Není oprávněním k zásahu,
instalačním příkazem ani potvrzením produkční akceptace.

Připravte Rootem ověřené sestavení a zapečetění této konkrétní dvojice:

- COP `voldzi/delta_acr_cop`, commit
  `dd545c2060e0996385122bc0cec9269a5b1af9f2`.
- Messaging `voldzi/csm_messaging`, commit
  `50e590c1078eb86ed1857cf336196c4bbf1c0fdc`.

Přesné otisky kontraktů, výchozí obrazy, pořadí a omezení jsou v
`release.review.json`. COP nyní běží jako image
`sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094`
na docker.home.cz; Messaging jako image
`sha256:531a5282d086300df960f270e5e17d4aa928abc3180af4d14a23d3edc18d9d25`
na comm.home.cz. Oba byly při čtecí kontrole zdravé; před změnou ověřte nový stav.

1. Čtecí kontrolou určete, proč běžnému účtu neprochází stávající COP X5 builder
   verifier. Použijte jen ověřené vyhrazené sestavování; žádný jiný builder,
   globální Docker změna ani prune. Připravte neměnné kontexty uvedených commitů,
   zaznamenejte skutečně vyřešené schválené základní obrazy a sestavte kandidáty.
   Doplňte skutečné image ID; zdrojový commit je nenahrazuje.
2. Zapečeťte pouze tyto dva výsledné obrazy a omezenou konfiguraci níže. Zachovejte
   všechny ostatní proměnné, secrets, sítě, porty, mounty a ochrany mazání.
   Není potřeba reset uživatelů, nová tabulka, rozšíření databázových rolí ani
   opakování historického instalačního postupu mazání.
3. Vystavte aplikaci pevnou bezobslužnou akci pouze pro tento zapečetěný release
   přes existující runtime guard. Stávající cop-reviewed-release je omezený na
   starší hotfix a tuto změnu nepovoluje; neobcházejte jej obecným sudo či přímou
   výměnou kontejneru. Instalační ochrany zůstávají účinné.
4. Nejprve nasaďte Messaging, pak COP, obojí s novým příjmem vypnutým. Ověřte
   skutečný image/config, live/ready/dependencies a zachování osobního chatu,
   přímých hovorů a dostupnosti mazání účtu. Žádný skutečný účet kvůli testu nemažte.

Jediné nové položky konfigurace jsou:

| Služba | Proměnná | První nasazení |
|---|---|---|
| COP | COP_SHARED_VEHICLE_COMMUNICATION_ENABLED | false |
| Messaging | CSM_SHARED_VEHICLE_COMMUNICATION_ADMISSION_ENABLED | false |
| Messaging | CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID | prázdné |
| Messaging | CSM_VEHICLE_CONTROLLER_CUSTODY_REVIEWED | false |

Následné naplnění identity a zapnutí příjmu je oddělená zapečetěná změna po
kontrole custody a společné akceptaci. Controller musí být nový ověřený technický
neinteraktivní účet bez admin role, hesla, zařízení a šifrovacích klíčů, mimo
rezervovaný prostor lidských identit. Nepoužívejte administrátora ani cop.ai.agent,
neoznačujte custody za ověřenou pouze podle nastavení. Existující službové tokeny
se nemění a žádná hodnota secrets se nepředává v dokumentu ani v chatu.

COP/Jízda pak ověří živou vazbu skutečné přihlášené identity, dvěma syntetickými
účty přesné členství a explicitní přijetí, pending202 a opakování původní operace,
odebrání/potvrzené nativní čtení, restart/pozdní výsledek a skutečný handoff
notifikace. Dosavadní izolované testy a SDK šifrování nenahrazují tento výsledek.
Žádný TestFlight ani změna GPS souhlasu není součástí úkolu.

**Návrat:** před jakýmkoliv enrollment lze přes guard vrátit přesné zdravé výchozí
obrazy pouze po doložení nulových zdrojových intentů a managed room records.
Po enrollment se vypíná nový příjem/UI, ale zůstávají nové writery a dokončují
původní revokace/uzavření; nevracejte starý writer, nemažte pending metadata a
nevracejte zdrojové členství. Přerušené nasazení vyžaduje kontrolu skutečných
obrazů, konfigurace a durable stavu, nikoli automatické opakování/reset.
