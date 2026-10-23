# Přesný návrh návratu routovací verze COP

Stav: pouze návrh. Není schválený, implementovaný ani aplikovaný. Původní
schválený forward review a jeho otisky zůstávají beze změny.

## Co současný guard skutečně dovoluje

Schválen je pouze přechod `251374f1… → 3f0054cb…`. Původní guard výslovně odmítá
běžný rollback po hranici ochrany mazání i `recover --rollback`
(`guarded_rollback_requires_intake_pause`). Nové `prepare` navíc odmítá existující
rozpracovanou aktivaci. Tuto ochranu neobcházíme a intake nepozastavujeme.

Pokud chyba vznikne před aktivací, původní API zůstane běžet. Pokud vznikne až
po spuštění kandidáta a před potvrzením aktivního ukazatele, zůstane uložený
checkpoint. Dosavadní podporovanou cestou je dopředné dokončení stejného
schváleného kandidáta. Dostupnost COP v takovém stavu není garantována; nelze
slíbit automatický návrat ani dobu obnovy.

## Navržená přesná reverzní dvojice

- Zdroj: `sha256:3f0054cb10e7c563c47cb010a7ea7cfbf4ff5a738e1261d77434be283baab430`.
- Cíl: `sha256:251374f1b612dec0b0f0335250f91bb44f9e420d0d92bc2a2a3f9bf459b02a0c`.
- Cílová aplikační revize: `c1ca66ff49c8e250ec260bd199f0d41502d8d600`.
- Konfigurace, auth, oprávnění, klíče, databázový stav, mounty a sítě se nemění.
- Žádný reset, mazání, obnovení zálohy, downgrade schématu ani pauza intake.

Po úspěšně potvrzeném forward nasazení by šlo připravit nový čerstvý `maintain`
release pro tuto jedinou reverzní dvojici. Jeho zdrojem musí být skutečně
přijatá nová verze s aktuálním CID/CAS, současnými fences a rozpracovanými úlohami.
Nelze použít starý důkaz nebo starý snapshot konfigurace. Hostitelský guard
zůstane novější a zachová historii obou schválených vazeb. Návrh musí znovu ověřit
shodu image konfigurace, pouze osm povolených routovacích souborů, kontinuitu
providerů/fences, čerstvou owner atestaci, paritu konfigurace/peerů a zdraví služby.
Starý aplikační obraz stále obsahuje stejnou ochranu mazání. Nová schopnost
příjezdu by zmizela; požadavky na ni musejí bezpečně selhat bez fallbacku.

To je slučitelné s modelem nových přezkoumaných `maintain` releasů, ale současný
uzavřený helper tuto reverzní dvojici nepovoluje. Vyžaduje samostatné výslovné
schválení a implementaci. Samotný souhlas s forward review ji nepokrývá.

## Selhání uprostřed forward aktivace

U rozpracovaného nasazení nestačí uvedený nový běžný `maintain` release: guard
má dosud `pending.json` a odmítne novou přípravu. Bez samostatného přesně
omezeného postupu návratu pro pending stav zůstává k dispozici jen dopředné
recover. Nesmí se mazat checkpoint, přepisovat aktivní ukazatel, vyvolávat
obyčejné Compose přepnutí ani vypínat ochranu mazání.

Proto dnes nelze návrat prezentovat jako hotovou, ověřenou vlastnost. Uživatel
může buď nejprve schválit přípravu obou reverzních stavů, nebo informovaně
přijmout forward nasazení s uvedeným recover-only rizikem. Do rozhodnutí produkce
zůstává beze změny.

Strojově přesný návrh je v sousedním
`user-selected-arrival-reversion-proposal.json`.
