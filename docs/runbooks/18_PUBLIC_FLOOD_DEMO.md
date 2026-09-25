# Veřejná povodňová ukázka v mapě COP

Veřejný vstup po nasazení webové služby:
`https://cop.zeleznalady.cz/demo/flood-central-bohemia`.
Původní `/ardos-demo/` přesměrovává na tento vstup. Návštěvník bez účtu
stiskne **Spustit scénář** a tlačítkem **Další krok** projde situaci v mapě,
modelově schválené sdělení, možnost předání a výpadek. **Začít znovu** vrátí
úvod. Mapové prvky lze vybrat a zobrazit jejich detail.

Režim běží uvnitř webové aplikace COP a používá její `CopMap` MapLibre renderer,
georeferencovaný mapový podklad, značky, plochy, výběr prvků a projekci
existujícího `SituationFeature` kontraktu. Má vlastní kořenovou trasu, proto
nespouští běžný datový a operátorský tok `App`. Samotné scénářové prvky vznikají
pouze v paměti prohlížeče se zdrojem `demo-browser-only`. Režim nevolá COP API,
SIM, TAK ani ARDOS. Mapové dlaždice a písmo se načítají jako podklad mapy.
V režimu nejsou živé vrstvy ani ovládání zápisu incidentů a zákresů.

Operátorský seed/reset `flood-central-bohemia` zůstává chráněn dosavadní
autorizací. Veřejný režim jeho endpointy nevolá a nepoužívá jím zapsané
objekty. Syntetická data, fiktivní vydavatel, modelová platnost a modelový
výpadek jsou výrazně označeny. Po výpadku zůstane poslední text čitelný, ale
má stav **NEAKTUÁLNĚ OVĚŘENO** a čas posledního modelového ověření.

ARDOS je pouze příklad možného kanálu pro schválený krátký text. Stránka
neprovádí integraci, netvrdí partnerství ani doručení. Neveřejný opt-in tok
v SIM se nezapíná.

## Ověření a nasazení

1. Ověřit `bash scripts/validate-skeleton.sh`, web build, lint a test
   veřejného scénáře a offline workeru. V prohlížeči projít mapový tok na
   desktopu a telefonu včetně výběru prvku a stavu po výpadku.
2. Před nasazením zaznamenat Git commit a běžící image `cop-web` v `/srv/cop`.
3. Na `docker.home.cz` stáhnout cílový commit, postavit pouze `cop-web` a
   obnovit jen tuto službu: `docker compose build cop-web`, potom
   `docker compose up -d --no-deps cop-web`.
4. Veřejně ověřit HTTP přesměrování `/ardos-demo/`, obsah nové trasy,
   vykreslení skutečné mapy COP se syntetickými prvky, průchod všemi kroky,
   `/health/ready` a odpověď 401 na unauthenticated seed/reset POST s
   `Content-Type: application/json`. Neposílat veřejný test s tokenem.
5. Při regresi vrátit uložený web image, obnovit jen `cop-web` a znovu ověřit
   veřejnou trasu a zdraví API.

Odkaz se sdílí až po ověření obsahu a interakce na veřejné doméně, protože
neznámá SPA trasa může jinak vracet HTTP 200 s běžnou domovskou stránkou.
