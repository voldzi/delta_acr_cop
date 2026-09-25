# ADR 0030: Zkontrolovaný interní obsah v externím COP chatu

**Rozhodnutí 25. 9. 2026:** Schválený rozsah budoucí externí větve je běžná
interní otázka a upravené podklady. Toto rozhodnutí mění požadovanou politiku
pro další implementaci; samo o sobě nezapíná externí zpracování běžného chatu.
Aktuální produkční `cop_chat` s třídou `internal` zůstává na lokálním modelu.

## Rozhodnutí o třídách

| Třída | Předání Routeru | Externí OpenAI API |
| --- | --- | --- |
| `synthetic` | Jen ověřené fiktivní body | Možné po výslovném povolení |
| `public_aggregate` | Typovaný agregát bez identifikátorů a volného textu | Možné po výslovném povolení |
| `internal` | Schválený omezený kontext | Pouze lokální model |
| navržená `internal_minimized` | Běžná otázka a zvlášť upravené podklady, které COP před odesláním zkontroloval | Možné po výslovné volbě externího zpracování konkrétního požadavku |
| chráněný obsah | Jen podle samostatného účelu a oprávnění | V této změně nepovoleno |

Do `internal_minimized` nesmí přejít dešifrované soukromé ani skupinové
zprávy, osobní údaje, kontakty a identifikátory osob, citlivé incidenty,
syrové situační záznamy, přílohy, partnerská neveřejná data ani neomezený
`chatContext`. COP musí vytvořit nový typovaný výstup z povolených polí;
prosté přejmenování třídy, odstranění několika známých vzorů nebo potvrzení
uživatele samo o sobě pravdivost klasifikace nezaručuje. Obsah, u kterého
nelze bezpečně doložit úpravu, zůstane `internal` na lokálním modelu.

Router má pro tuto novou třídu vyžadovat oddělenou atestaci COP,
`allowExternal=true`, službovou identitu COP a výslovnou volbu externího
zpracování daného požadavku. Smí vybrat jen ekonomický `gpt-6-luna`, při
limitu nebo výpadku musí selhat bez přímého OpenAI bypassu. Zachová stabilní
neprůhledné ID uživatele, denní a měsíční finanční limit, limit na uživatele
a audit tokenů a ceny. Běžný chat nesmí být automaticky překlasifikován na
`internal_minimized` jen proto, že uživatel zvolil externí model.

Před aktivací musí být ověřeno nastavení konkrétního OpenAI API projektu,
zpracovatelský vztah, doba uchování, případná regionální volba a podmínky
pro daný účel; současný Router používá `api.openai.com` a `store:false`.
`store:false` samo o sobě neprokazuje nulové uchování ani evropskou rezidenci.
Testy musí prokázat odmítnutí chráněných a nesprávně atestovaných vstupů,
limity, účtování, výpadek a rollback. Do jejich dokončení se produkční
externí rozsah nemění.

## Právní a dodavatelský podklad

GDPR požaduje zejména účelové omezení, minimalizaci a právní titul
(čl. 5–6), pravidla pro zpracovatele (čl. 28), odpovídající zabezpečení
(čl. 32) a podle okolností pravidla mezinárodního předání (kapitola V).
Konkrétní účel COP a případné další české, smluvní či partnerské povinnosti
je třeba posoudit zvlášť; žádný obecný zákaz ani automatické povolení
OpenAI API z těchto ustanovení neplyne.

OpenAI uvádí, že API vstupy a výstupy nepoužívá pro trénink ve výchozím
nastavení. Výchozí provozní logy pro kontrolu zneužití a dostupnost
evropského zpracování závisejí na konkrétní konfiguraci a způsobilosti
projektu. Zdroj: [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj),
[OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data),
[OpenAI DPA](https://openai.com/policies/data-processing-addendum/).
