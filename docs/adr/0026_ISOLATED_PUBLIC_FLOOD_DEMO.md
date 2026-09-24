# ADR 0026: Izolovaná veřejná povodňová ukázka

Stav: přijato

## Kontext

COP má řízený operátorský seed/reset `flood-central-bohemia`. Veřejný
samoobslužný průchod nesmí získat oprávnění k těmto zápisům ani vytvářet
běžné incidenty. Ukázka pro ARDOS má vysvětlit občanský tok bez existujícího
partnerského nebo doručovacího vztahu.

## Rozhodnutí

Publikujeme samostatnou statickou stránku pod `/ardos-demo/` v COP webu.
Celý syntetický scénář je lokální stav v prohlížeči, bez síťových volání a
bez perzistence. Mapa je schéma fiktivní obce. Modelové schválení má viditelnou
oblast, vydavatele, platnost a poslední ověření. Simulovaný výpadek zachová
poslední text s výrazným neaktuálním stavem. ARDOS popisujeme pouze jako
možný přenosový kanál.

## Důsledky

Veřejný odkaz funguje bez účtu a nemění API, OpenAPI ani autorizaci.
Návštěvník neuvidí živé COP vrstvy a ukázka neprokazuje skutečnou integraci,
doručení nebo provozní dostupnost při reálném výpadku.
