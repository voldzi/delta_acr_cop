# COP public analytics privacy notice — owner review

Status: proposed, NOT approved or published. Exact COP opening and shared text
from VCode docs/analytics-public-webs-privacy-review.md, 2026-10-04.

## Czech proposal

Na veřejné syntetické povodňové ukázce COP měříme zobrazení této stránky, abychom poznali její využití. Hlavní situační mapu, přihlášené pracovní části a chat tímto měřením nesledujeme.

Měření používá společnou službu VCode/Umami v naší infrastruktuře bez analytických cookies a bez záznamu obrazovky. Zaznamenává pouze otevření předem vybraných veřejných stránek. Nesledujeme kliknutí, neodesíláme obsah formulářů, údaje o účtu, rezervace, polohu, zprávy, zdravotní údaje, odpovědi ani herní postup. Nepředáváme parametry adres, fragmenty, názvy stránek ani odkazující stránku a nespojujeme statistiky s vaším účtem.

Při přijetí požadavku služba dočasně zpracuje síťovou adresu zařízení a údaje prohlížeče pro denně obměňované technické označení návštěv. IP adresu neukládá v čitelné podobě do analytické databáze. Odhad návštěvníků není přesným počtem konkrétních lidí. Statistiky nejsou veřejné a přístup k nim mají jen oprávnění správci. Analytické záznamy včetně jejich záloh uchováváme nejvýše 180 dní.

Respektujeme Do Not Track a Global Privacy Control: při jejich zapnutí návštěvu neodešleme. Události bez připojení zahazujeme a neukládáme k pozdějšímu odeslání. Toto měření je oddělené od případných dosavadních produktových či herních statistik a nepředává do společné služby jejich údaje.

## English proposal

We measure pageviews of COP's public synthetic flood demonstration to understand its use. This measurement excludes the main situation map, authenticated workspaces and chat.

Measurement uses the shared VCode/Umami service within our infrastructure without analytics cookies or screen recording. It records only views of selected public pages. We do not track clicks or send form contents, account information, bookings, location, messages, health data, answers or game progress. URL parameters, fragments, page titles and referring pages are not sent, and statistics are not linked to your account.

When a request arrives, the service temporarily processes the device's network address and browser information to derive a daily changing technical visit identifier. IP addresses are not stored in readable form in the analytics database. Estimated visitors are not an exact count of individuals. Statistics are private and available only to authorized administrators. Analytics records, including their backups, are retained for no more than 180 days.

We respect Do Not Track and Global Privacy Control: when enabled, no visit is sent. Offline events are discarded rather than stored for later transmission. This measurement is separate from any existing product or game statistics and does not forward their data to the shared service.

## Publication gate

One concrete owner approval in the VCode chat covers this proposal. It is prepared
in the demo UI, hidden while collection is false. This does not replace other COP
privacy terms or invent a controller contact. No publication or activation before
approval. Central maximum retention includes backups, with active purge at 170
days and daily backup rotation to stay within 180 days.
