# Public privacy text candidate for the VCode/Jízda owner

Not published and not ready for App Review. Target is the existing public
`https://vcode.zeleznalady.cz/jizda/privacy/`, maintained by VCode, not a new COP
privacy URL. This change does not grant a deployment in that repository.

Before publication, the owner must fill the approved operator/contact and
actual retention/backup rules, verify native/local/CloudKit sections against
Jízda and append the actual account deletion steps after they exist. Do not
publish a future feature as currently working.

## Wording supported by current COP evidence

Jízda může po přihlášení využívat služby COP pro komunikaci, společná vozidla,
Dispečink a dopravní informace. Při použití těchto funkcí se na příslušné servery
předává účet a údaje potřebné pro zvolenou funkci: například členství ve skupině,
sdílený záznam vozidla, trasa nebo hlášení. Další lidé ve stejné skupině mohou
vidět informace, které s nimi sdílíte.

Pro výpočet trasy se zpracovává začátek, cíl a případné průjezdní body. Při
vyhledávání místa se zpracovává zadaný dotaz. Sdílení polohy v Dispečinku je
omezené na zvolenou skupinu a dobu. Dobrovolná dopravní měření mají samostatný
souhlas; jejich sběr není v nynějším serverovém nastavení zapnutý.

Zprávy a jejich přílohy v Matrixu jsou šifrované mezi koncovými zařízeními.
Servery přesto zpracovávají údaje potřebné pro komunikaci, například členství,
identifikátory zpráv a zařízení, oznámení a provozní záznamy. Hovory používají
samostatnou signalizaci a přenos hlasu. Upozornění přes Apple APNs nebo VoIP push
slouží k oznámení zprávy či příchozího hovoru. Přihlašovací údaje a push tokeny
se nepředávají ostatním uživatelům.

Informace, které zveřejníte jako dopravní či komunitní hlášení, mohou být
zobrazené dalším uživatelům. U záznamů se eviduje autor a původ. Zveřejnění samo
neodstraňuje vztah těchto údajů k účtu. Kopie, které si jiný příjemce již
stáhl, nemusí být možné z jeho zařízení vzdáleně odstranit.

## Add only after the account-safety release is actually accepted

Hlášení nevhodné komunikace může obsahovat odkaz na zprávu, uživatele nebo hovor
a zvolený důvod. Text šifrované zprávy se do hlášení nepřipojuje automaticky.
Pokud sami vyberete a potvrdíte výňatek, odešle se tento výňatek oprávněnému
moderátorovi. Před potvrzením uvidíte, co odesíláte. Stav hlášení můžete sledovat.

Blokování se uplatňuje na serveru pro následnou komunikaci a příchozí hovory.
Stavové události skupiny a komunikace ostatních členů zůstávají dostupné.
Přesný rozsah právě probíhajícího hovoru a starší uložené historie musí odpovídat
skutečně dodanému klientovi a ověřenému serveru.

Account removal paragraph intentionally not drafted as a working feature:
first decide shared-account scope, implement the real operation, define and
test ownership/UGC/retention exceptions and restored-backup replay, then state
the actual profile action, confirmation, pending/completed meanings and notice.
Do not present sign-out, deactivation, a support email or202 as completed
account deletion. Approved moderation owner/contact and actual retention remain
mandatory publication fields.
