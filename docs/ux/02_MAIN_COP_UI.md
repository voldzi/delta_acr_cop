# 02 Main COP UI

Hlavní UI má šest oblastí:

- top status bar: stav systému, latency, aktivní zdroje, počet objektů, online/degraded/offline a AI provider status,
- left layer panel: vrstvy, filtry, AOR, confidence threshold a synthetic toggle,
- central map canvas: MapLibre, symboly, clustering, AOI a timeline overlay,
- right object detail panel: detail, provenance, source history, confidence, audit link a symbol resolution,
- bottom timeline/replay panel: časový posun a změny confidence,
- AI assistant drawer: povolené datové dotazy a vysvětlení.

Pravý horní roh top baru obsahuje operátorský vstup. V pilotu neslouží k autentizaci, ale otevírá centrum nastavení pro uživatelské volby mapy, dat, vlastní polohy a budoucího účtu.

Primární aktualizace COP dat probíhá přes live SSE stream. Nastavení intervalu je proto v centru nastavení jako `Fallback synchronizace`; používá se v degraded režimu, při výpadku streamu, po obnově záložky a pro méně dynamická data.

UI nesmí obsahovat targeting, navádění ani ovládání prostředků.
