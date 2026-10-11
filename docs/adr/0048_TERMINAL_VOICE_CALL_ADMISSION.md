# ADR 0048: Autoritativní stav hovoru při scoped admission

- Stav: přijatá zdrojová implementace; produkční aktivace není součástí.
- Navazuje na ADR 0047 a neměnné předání v3.

## Rozhodnutí

Ověřený grant účtu a instalace sám nestačí k novému připojení. Dedicated
Jízda musí navíc splnit autoritativní stav konkrétního COP hovoru. Sdílený
read-only guard kontroluje přesný `callId`, SFU room `cop-call-<callId>`,
existenci záznamu a jeho fázi. `created` a terminal fáze odmítá. `ringing`,
`accepted` a `connecting_media` respektují existující `expiresAt`; accepted
fáze používají stávající media timeout. `connected` invitation deadline
neukončuje. Guard neposouvá fázi ani časovou hranici v CallStore.

API guard opakuje před/po mint a po posledním await před úspěšnou odpovědí.
Samostatná signaling brána musí mít povinný guard nad skutečným PostgreSQL
CallStore, bez memory/disabled fallbacku. Opakuje jej před dispatch, po
prvním pozitivním ACK, na událostech a omezenou kontrolou nečinných spojení.
Známý nepovolený stav vrací 403 `VOICE_CALL_ADMISSION_DENIED`; výpadek čtení
503 `VOICE_CALL_STATE_UNAVAILABLE`, bez credentials či alternativní cesty.
Legacy klienti zachovávají svou dosavadní cestu.

Nové admission čtení i denial compensation mají samostatný request deadline
5 sekund. API CallStore používá rovněž PostgreSQL query/statement timeout
5 sekund; ostatní store factory neměníme. Timeout kompenzace neprokazuje
úspěšný terminal přechod a nesmí vrátit credentials po pozdním await.

## Hranice důkazu

Čtení CallStore a vzdálený SFU Join nejsou jedna transakce. Terminální stav
pozorovaný během dispatch/ACK vede k uzavření přesného transportu a samostatnému
operational cleanupu účastníka. Neprokazuje app/installation quiescence.
Durable handshake evidence zůstává zachovaná, včetně neznámých pokusů; 101,
prázdný inventář, socket close a remove404 nejsou completion proof.

## Retence a klient

Tato změna nic nekompaktuje ani nemaže. Samostatný návrh v integration47
vyžaduje schválení politiky a důkazů před runtime realizací. Mobilní změna
je samostatný návrh; zmrazené v2 SDK/host/archiv se nemění. Produkční síť,
účty, odvolávání a aktivace zůstávají mimo toto předání.

Podrobnosti a výsledky: [integration47](../integration/47_VOICE_TERMINAL_ADMISSION_AND_COMPACTION_PLAN.md).
