# 10 User Manual and Profile

COP web obsahuje vestavěný manuál pro občany i operátory. Manuál je dostupný z topbaru a přes malé kontextové otazníky u nastavení, profilů a rozložení plochy.

## Pracovní plocha

Mapa je primární plocha aplikace. Uživatel může:

- skrýt nebo sbalit levý katalog vrstev,
- skrýt nebo sbalit pravý detail,
- skrýt pravý kontextový rail,
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

Avatar a kontaktní údaje nejsou autentizační údaje. Přihlášení, hesla a ověření identity zůstávají v identity provideru. COP profil slouží pro krizovou komunikaci, komunitní hlášení a lepší orientaci ve skupinách.

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
