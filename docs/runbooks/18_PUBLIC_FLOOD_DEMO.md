# Veřejná povodňová ukázka pro sdílení

Veřejná adresa po nasazení webové služby: `https://cop.zeleznalady.cz/ardos-demo/`.
Návštěvník bez účtu stiskne **Spustit scénář** a tlačítkem **Další krok** projde
modelovou situaci, modelově schválené sdělení obce, možnost předání a výpadek.
**Začít znovu** vrátí stránku na úvod. Stránka nevyžaduje operátora.
Samostatný odkaz **Otevřít aktuální mapu COP** vede na existující mapový klient
s mapovým share stavem pro střední Čechy. Tato živá mapa neobsahuje syntetický
scénář a není součástí demonstračního toku ani živým SIM feedem této stránky.

Ukázka je samostatný statický soubor v `apps/cop-web/public/ardos-demo/`.
Scénář běží pouze v paměti prohlížeče. Nic neukládá, neposílá API požadavky
a nepracuje s produkčními incidenty ani s chráněným scénářem
`flood-central-bohemia`. Skutečný seed/reset zůstává pod stávající autorizací.
Fiktivní obec, schválení, text, časy a schéma mapy jsou vždy označeny jako
syntetická data. Výpadek přepne sdělení do zřetelného stavu
**NEAKTUÁLNĚ OVĚŘENO**; poslední ověřený text zůstává čitelný s časem ověření.

ARDOS je zde pouze možný kanál pro přenos schváleného krátkého sdělení.
Stránka neprovádí integraci, netvrdí partnerství ani doručení. Neveřejná
opt-in integrace v SIM se touto ukázkou nezapíná.

## Ověření a nasazení

1. Lokálně ověřit `bash scripts/validate-skeleton.sh` a build webu.
2. Před nasazením zaznamenat commit a běžící image `cop-web` na `/srv/cop`.
3. Na `docker.home.cz` po stažení cílového commitu postavit pouze `cop-web`
   a obnovit jen tuto službu: `docker compose build cop-web` a
   `docker compose up -d --no-deps cop-web`.
4. Ověřit `/health/ready`, veřejnou URL, průchod všemi čtyřmi kroky a veřejné
   odmítnutí `POST /api/v1/demo/scenarios/flood-central-bohemia/seed` bez
   autentizace. Neposílat do veřejného testu token.
5. Při regresi vrátit uložený image webu, obnovit jen `cop-web` a znovu ověřit
   veřejnou URL a zdraví API.

Ukázka neobsahuje skutečné pokyny pro aktuální událost. Odkaz se sdílí až po
ověření odpovědi veřejné domény a interakce v prohlížeči.
