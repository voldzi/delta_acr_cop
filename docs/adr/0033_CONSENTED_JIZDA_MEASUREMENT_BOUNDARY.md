# ADR 0033: COP hranice dobrovolných měření Jízdy

Stav: přijato pro vypnutý pilot. Datum: 2026-10-02.

Jízda posílá pouze mobilní kontrakt `cop-driver-measurements-v1` přes
autentizované COP API. COP odvozuje denní HMAC pseudonym a oddělená stabilní
UUID z ověřeného OIDC subjektu, eviduje souhlas a jeho odvolání v PostgreSQL,
atestuje jej a serverově volá SIM `sim-driver-measurements-v1`. Při výpadku
SIM není jiná cesta. Sběr i adaptér zůstávají výchozím stavem vypnuté.

Odvolání se zapíše před voláním SIM. Pending mazání je trvalé a brání regrant;
stejný UTC den je regrant zakázán i po smazání kvůli SIM tombstone. Klíč HMAC
je stabilní a jeho fingerprint zabraňuje neřízené rotaci, která by znemožnila
zpětné odvození denních pseudonymů. Vzorky GPS se na COP neukládají.
Produkční spoj COP API a SIM situation-data-api používá samostatnou interní
Docker bridge síť `cop_sim_driver_measurements_internal`, bez veřejně
publikovaného měřicího portu. K síti se připojí jen tyto dvě služby. COP
Compose overlay udržuje připojení přes restart; službový token zůstává pouze
v chráněných produkčních secrets obou služeb. Nasazení tohoto spojení samo
nezapíná příjem měření.
Samostatný cleanup příznak zůstává zapnutý při rollbacku příjmu, aby revokace
zůstala dostupná. Pokud SIM vypnutý příjem blokuje i DELETE, stav mazání se
nesmí vydávat za dokončený.

Volba samostatné mobilní verze brání tomu, aby klient podvrhl interní
`contributorIdDay` či `consent`. Nevýhodou je nutná jednopolová změna
existujícího draftu Jízdy a samostatná integrace tří endpointů souhlasu.
Před zapnutím je nutná společná produkční a telefonní akceptace podle
[předávacího kontraktu](../integration/22_JIZDA_DRIVER_MEASUREMENTS_COP_HANDOFF.md).
