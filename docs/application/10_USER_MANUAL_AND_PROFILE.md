# 10 User Manual and Profile

COP web obsahuje vestavěný manuál pro občany i operátory. Manuál je dostupný z topbaru a přes malé kontextové otazníky u nastavení, profilů a rozložení plochy.

## Rychlý Návod Pro Uživatele

### Bez Přihlášení

Bez přihlášení lze aplikaci použít pro základní orientaci:

1. otevřít mapu,
2. zapnout veřejné vrstvy,
3. zobrazit detail veřejného objektu,
4. vyhledat místo,
5. sledovat veřejné výstrahy a kontextové vrstvy.

Bez účtu nelze ukládat profil, přidávat hlášení, používat chat, ukládat zákresy
ani otevírat neveřejná média.

### Přihlášení

Přihlášení slouží k práci s osobními daty, chráněnými médii a chatem. Po
přihlášení může uživatel:

- uložit rozložení pracovní plochy,
- vytvořit nebo upravit profil,
- vložit komunitní hlášení,
- nahrát média k hlášení,
- pracovat v chatu a chatových skupinách,
- vytvářet uživatelské zóny,
- vytvářet a sdílet zákresy,
- spravovat přístup k médiím podle viditelnosti nebo vybraných uživatelů.

### Mapové Vrstvy

Vrstvy jsou rozdělené podle účelu. Běžný uživatel má pracovat hlavně s
uživatelskými kategoriemi, ne s technickými zdroji:

- Rizika a výstrahy,
- Počasí,
- Doprava,
- Komunikace,
- Letecký provoz,
- Hlášení,
- Zákresy,
- Referenční vrstvy.

Technické zdroje, diagnostika, raw feedy a provider metadata patří do detailu
nebo provozní obrazovky. Nemají být hlavní navigací pro občana.

### Hlášení

Tlačítko `Nahlásit` slouží pro vložení informace z terénu:

1. vybrat typ rizika nebo události,
2. doplnit stručný název a popis,
3. nastavit polohu z aktuální polohy, mapy nebo média,
4. určit stupeň nebezpečí,
5. nastavit očekávanou platnost,
6. přiložit fotografii, video, PDF nebo jiný dokument,
7. zvolit přístup k médiím,
8. uložit hlášení.

Text hlášení a stupeň výstrahy jsou mapová informace. Média mohou být chráněná
ACL a otevře je jen oprávněný uživatel.

### Chat A Skupiny

Chat je samostatná aplikace vložená do COP. Slouží pro lidskou komunikaci,
přímé zprávy, veřejné i soukromé skupiny a sdílení souborů. Doporučený postup:

1. vybrat existující chat nebo založit konverzaci s osobou,
2. vytvořit skupinu v `cop-chat`, pokud má komunikovat více lidí,
3. psát zprávy běžným jazykem,
4. sdílet média jako chatovou přílohu,
5. nepoužívat chat jako úložiště technických logů.

Pokud má zpráva z chatu vytvořit mapový záznam, uživatel použije v COP akci
`Nahlásit` a vědomě zadá text, polohu, platnost a přílohy do reportovacího
formuláře. COP web z chatu automaticky nevytváří hlášení ani skupiny.

### Zákresy

Zákresy jsou samostatná vrstva pro ruční situační náčrt:

- značka,
- linie,
- šipka,
- polygon,
- kruh/oblast,
- text,
- měření.

Zákres lze uložit jako soukromý, skupinový, událostní nebo veřejný. Na mobilu
musí být jasně zvolen režim `Pohyb mapy` nebo `Zákres`, aby kreslení
nepřekáželo běžnému posunu mapy.

### Média A Galerie

Detail hlášení může obsahovat multimediální galerii:

- fotografie,
- PDF,
- video,
- 3D/XR derivát videa, pokud existuje,
- zvuk nebo jiné dokumenty v další fázi.

Po otevření galerie má uživatel vidět náhled, název, krátký popis, autora,
čas, polohu a informaci o oprávnění.

### Mobilní Použití

Na telefonu má být mapový režim jednoduchý:

- spodní navigace,
- mapový detail jako malý bottom sheet,
- chat jako samostatná obrazovka,
- vrstvy jako bottom sheet,
- zákres jako explicitní režim,
- žádné překrývající se technické panely.

Pokud některá funkce vyžaduje větší prostor, má se otevřít jako samostatný
mobilní režim místo plovoucího desktop panelu.

## Pracovní plocha

Mapa je primární plocha aplikace. Uživatel může:

- skrýt nebo sbalit levý katalog vrstev,
- skrýt nebo sbalit pravý detail,
- skrýt dolní stavový řádek,
- měnit šířku levého a pravého panelu na desktopu.

Rozložení se ukládá do `preferences.workspaceLayout`. Přihlášený uživatel ho synchronizuje přes `/api/v1/me/preferences`; nepřihlášený uživatel ho má pouze lokálně v prohlížeči.

## Skiny a šablony

Web podporuje tři uložené skiny v `preferences.workspaceSkin`:

- `civil`: klidnější občanský vzhled pro běžné sdílení a orientaci,
- `operations`: hustší operační vzhled pro dispečink a krizový štáb,
- `field`: kontrastní terénní vzhled s mapou v popředí.

Šablona není samostatný bezpečnostní režim. Jde o uživatelskou zkratku, která nastaví skin, rozložení panelů, mapový podklad, symboliku a zobrazení výstražných oblastí. Klient, který šablony nepodporuje, musí `workspaceSkin` zachovat při ukládání preferencí.

## Profil uživatele

Profilová karta se ukládá do `preferences.operatorProfile`. Pole:

- `avatarDataUrl`: zmenšený PNG/JPEG/WebP avatar jako data URL do 250 kB,
- `displayName`,
- `role`,
- `organization`,
- `email`,
- `phone`,
- `contactNote`,
- `publicContact`.

Avatar a kontaktní údaje nejsou autentizační údaje. Přihlášení, hesla a ověření identity zůstávají v identity provideru. COP profil slouží pro krizovou komunikaci, komunitní hlášení a lepší orientaci v chatu.

## Vestavěná nápověda

Nápověda má šest základních sekcí:

- Přehled aplikace,
- Pracovní plocha,
- Mapové vrstvy,
- Profil a kontakt,
- Komunitní hlášení,
- Výstrahy a sledované oblasti.

Texty musí být krátké, civilní a akční. Technické detaily zdrojů patří do detailu/provenance, ne do běžné nápovědy. Nápověda nesmí obsahovat targeting, navádění, doporučení zásahu ani pokyny k použití síly.

## Dopad na nativní klienty

iOS/iPadOS klient může `operatorProfile`, `workspaceLayout` a `workspaceSkin` použít pro vlastní UI. Pokud některé pole nepodporuje, musí ho při ukládání preferencí zachovat a nesmí ho mazat. Pro iPad je vhodné mapovat `workspaceLayout` na split view a inspector; pro iPhone stačí uložit preference panelů bez desktop resize ovládání. `workspaceSkin` může nativní klient mapovat na vlastní sadu barev a hustotu UI.
