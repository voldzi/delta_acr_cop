# 13 Device Coverage Decision

Aktualizováno: 2026-09-07. Stav: přijato pro veřejný pilot, znovu vyhodnotit po
prvním měsíci měřeného provozu.

## Rozhodnutí

- Responsivní PWA je základní cesta pro Android, desktop a starší zařízení.
- Nativní COP Mobile podporuje iOS/iPadOS 26 a novější, protože vlastní
  komunikace, background/push, bezpečný bridge a aktuální Apple platformní API
  jsou v tomto rozsahu testovatelné jako jeden celek.
- Samostatný nativní Android klient se před pilotem nevytváří. Veřejné úkoly musí
  být splnitelné v PWA bez instalace a bez účtu, kromě publikace osobního hlášení.
- 3D přehled je volitelný. Omezené zařízení dostane snížený počet objektů a
  frekvenci; zařízení bez potřebné grafiky zůstane v plně funkční 2D mapě.

## Podmínky přehodnocení

Nativní Android nebo nižší iOS minimum se znovu posoudí, pokud produkční data
ukážou více než 5 % neúspěšných kritických cest kvůli omezení PWA/platformy,
pokud požadovaná push/offline funkce nejde v cílových prohlížečích spolehlivě
dodat, nebo pokud výzkumná skupina levných Android zařízení nesplní akceptační
kritéria. Rozhodnutí musí vyčíslit podíl zařízení, náklady na vývoj, bezpečnostní
aktualizace, přístupnost a provozní podporu.

## Release gate

PWA se ověřuje na aktuálním Chrome pro Android, Safari iOS, Safari macOS, Chrome,
Edge a Firefox, plus na nejstarších verzích uvedených v podporované matici.
COP Mobile vyžaduje připnutý schválený Xcode build, simulátorové testy, iPhone,
iPad, VoiceOver, velký text, omezený pohyb a pomalou síť. Bez této evidence lze
vydat web/API, ale mobilní binárku nelze označit jako veřejně připravenou.
