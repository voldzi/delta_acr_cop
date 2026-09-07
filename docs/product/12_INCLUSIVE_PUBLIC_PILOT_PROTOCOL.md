# 12 Inclusive Public Pilot Protocol

Aktualizováno: 2026-09-07.

## Účel

Pilot ověří, zda lidé v ČR bez znalosti GIS nebo krizové terminologie zvládnou
zjistit situaci ve svém okolí, porozumět doporučenému kroku a bezpečně podat
hlášení. Výsledek je podklad pro rozhodnutí o veřejném vydání, nikoli marketingový
test spokojenosti.

## Povinný vzorek

Minimálně 48 účastníků v osmi skupinách po nejméně šesti lidech:

- lidé 65+;
- lidé používající VoiceOver, TalkBack nebo ovládání bez myši;
- lidé se zrakovým, motorickým nebo kognitivním omezením;
- slabší čtenáři a lidé s češtinou jako druhým jazykem;
- uživatelé starších nebo levných Android telefonů;
- uživatelé iPhonu a iPadu;
- lidé z obcí do 5 000 obyvatel a oblastí se slabým signálem;
- profesionální operátoři obcí, IZS nebo krizového řízení.

Vzorek musí pokrýt nejméně čtyři kraje, město i venkov, účet i anonymní režim a
simulované pomalé nebo přerušované připojení. Nábor nesmí sbírat diagnózu ani
přesnou domácí adresu, pokud nejsou pro konkrétní výzkum nezbytné a schválené.

## Testované úkoly

1. Bez vysvětlení zjistit, zda je v okolí aktuální výstraha, a říct vlastními
   slovy, co udělat.
2. Vybrat obec bez povolení GPS a ověřit, že posun mapy sledovanou obec nezmění.
3. Otevřít sdílený odkaz a rozpoznat, co je pozorování, odhad a zastaralá poloha.
4. Podat hlášení s fotografií, opravit polohu, zvolit soukromí média, přerušit
   síť a po obnovení dokončit odeslání bez duplicity.
5. Změnit přístup k existující příloze a ověřit, že druhý účet o přístup přijde.
6. Vrátit se z detailu, komunikace a volitelného 3D přehledu do stejného kontextu.

## Kritéria

- nejméně 90 % účastníků v každé skupině dokončí úkoly 1 a 2 bez zásahu;
- nejméně 85 % v každé skupině dokončí úkol 4 bez kritické chyby;
- medián času k první srozumitelné výstraze je do 30 sekund;
- žádný účastník nesmí zaměnit odhad za ověřené měření nebo veřejné médium za
  soukromé;
- všechny kritické cesty jsou ovladatelné klávesnicí a čtečkou a při 200% zoomu;
- ztráta sítě, dvojí klepnutí ani restart nevytvoří duplicitní report nebo médium.

Kritický omyl v bezpečnostním doporučení, soukromí, poloze nebo autorství zastaví
pilot pro danou cestu. Oprava musí projít opakovaným testem s dotčenou skupinou.

## Evidence

Ukládá se anonymní ID sezení, skupina, zařízení, hrubá síťová třída, dokončení,
čas, počet nápověd a klasifikace chyby. Nezapisuje se přesná poloha, obsah
hlášení, fotografie, hlas, tokeny ani identita do produktové telemetrie.
Výzkumné nahrávky mají samostatný souhlas, omezenou dobu uchování a vlastníka
výmazu.

## Výstup

Vlastník pilotu vydá tabulku výsledků po skupinách, seznam kritických chyb,
rozhodnutí `go / conditional go / no-go` a dohledatelné opravy. Celkový průměr
nesmí zakrýt selhání jedné skupiny.
