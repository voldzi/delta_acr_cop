# Public privacy text candidate for the VCode/Jízda owner

Source candidate updated 2026-10-13; no new runtime readback or publication.
The confirmed operator is VCode (Jiří Volek) and public support is
`podpora@zeleznalady.cz`. Communication-report retention has an approved
90-day maximum, shortened to at most 30 days after closure; content-free audit
has a 180-day maximum. Other retention and backup rules still require their
actual owners' confirmation. Current gates are in
`../integration/43_ACCOUNT_SAFETY_COMPLETION.md`.

Not published and not ready for App Review. Target is the existing public
`https://vcode.zeleznalady.cz/jizda/privacy/`, maintained by VCode, not a new COP
privacy URL. This change does not grant a deployment in that repository.

Before publication, the owner must insert the confirmed operator/contact and
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

The current design keeps one COP account and one login entry in Já using
`csm-mobile`, with explicit local host consent. Dedicated Jízda OAuth provisioning
is not authorized. Local disable is not a completed server unlink. Whole COP
removal remains a separate action; full server unlink and coordinated erasure
are not yet accepted/deployed.
Only after scoped acceptance may the public notice say that **Odpojit Jízdu**
stops that app's verified registrations/live permissions while preserving COP
Mobile, shared identity/history/vehicles and local SwiftData. Pending cleanup
must be stated as pending. The separate **Správa / odstranění účtu COP** must
link to a real canonical deletion form after acceptance, with actual impact,
retained exceptions and pending/completed status; its URL is currently null.
Do not substitute a support email, generic account console, sign-out or202.
The COP administrator is the selected moderation owner. The confirmed public
contact and approved report retention must be included; erasure exceptions,
other retention and backup policy remain required publication fields.


## New account-deletion scope approved 2026-10-17 — not deployed

Po nasazení nové funkce bude odstranění účtu dostupné na webu COP. Uživatel ověří přihlášený účet, znovu se přihlásí a potvrdí odstranění. Následně se zablokuje přístup a server dokončí mazání i po zavření stránky. Přijatý požadavek není potvrzení úplného dokončení.

Nový rozsah zahrnuje údaje v COP a SIM i společnou přihlašovací identitu; zanikne také přístup do dalších aplikací používajících toto přihlášení. Tyto další aplikace spravují svá data samostatně. Nezbytná pseudonymní evidence mazání a šifrovaná technická vazba se uchovají pro zabránění návratu smazaných dat po obnově, dokud existují příslušné obnovitelné kopie nebo nedokončené doručení. Nejde o anonymní data. Evidence neobsahuje zprávy, přístupové tokeny ani uživatelský OpenAI klíč.

This candidate must remain conditional until the actual deployment and whole-service acceptance are recorded. The owner also approved a one-time reset of current test-user data without a new backup; this does not change shared Proxmox backup configuration or establish a new general retention period.
