# 03 Next Codex Prompt NATO Renderer

Navrhni a implementuj skeleton `packages/nato-symbol-renderer` pro hlavní COP systém podle `docs/interoperability/02_APP6_STANAG2019_SYMBOL_RENDERING.md`.

Renderer musí poskytovat funkci `resolveSymbol(objectType, affiliation, domain, status, modifiers) -> SymbolResolution`, mapping katalog, fallback pravidla, podporu lokálních rozšíření, golden tests a API handler pro `POST /api/v1/symbology/resolve`.

První fáze necílí na certifikovanou NATO shodu. Cílem je architektonická připravenost, verzovaný mapping katalog, testovatelnost a oddělení datového významu od prezentace. Nepřidávej targeting, navádění ani weapon workflow.
