# 05 NATO Renderer

NATO renderer je součást hlavního COP systému. SIM a jiné externí zdroje neposílají finální symboliku, ale canonical objektové atributy.

## Odpovědnosti

- přijmout canonical object nebo symbol resolve request,
- mapovat `objectType + affiliation + domain + status + modifiers`,
- vrátit symbol code, standard version, fallback flag a renderer metadata,
- oddělit datový význam od prezentace,
- podporovat testovatelný mapping katalog.

První fáze necílí na certifikovanou NATO shodu. Cílí na architektonickou připravenost, verzovaný katalog, mapping matrix a contract tests.
