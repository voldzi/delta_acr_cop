# COP public analytics privacy notice — owner review

Status: proposed, NOT approved or published. Applies only to the synthetic public
demo. Activation requires approval of this text and the shared runtime/collector.
Do not describe collection as active before deployment acceptance.

## Czech proposal

### Měření návštěvnosti veřejné ukázky

Na veřejné syntetické povodňové ukázce COP měříme zobrazení této stránky, abychom
poznali její využití. Hlavní situační mapu, přihlášené pracovní části a chat tímto
měřením nesledujeme. Nesbíráme obsah zpráv, hlášení a formulářů, údaje o účtech,
polohu, pohyb po mapě ani kliknutí. Neodesíláme parametry adresy, fragment,
název stránky ani odkazující stránku.

Používáme společnou analytiku VCode/Umami bez analytických cookies a bez záznamu
obrazovky. Server pro souhrnný odhad návštěvnosti zpracovává technické údaje
požadavku a používá pravidelně obměňované anonymní identifikátory; nepřipojujeme
je k účtu v COP. Respektujeme Do Not Track a Global Privacy Control. Při výpadku
internetu se měření neukládá k pozdějšímu odeslání. Analytické záznamy mažeme
po 180 dnech. Statistiky nejsou veřejné a slouží pouze oprávněným správcům.

## English proposal

### Public demo visitor measurement

We measure pageviews of COP's public synthetic flood demonstration to understand
its use. This measurement does not cover the main situation map, authenticated
workspaces or chat. We do not collect messages, reports, form contents, account
information, location, map movement or clicks. URL parameters, fragments, page
titles and referrers are not sent.

We use shared VCode/Umami analytics without analytics cookies or session replay.
The server processes technical request information and uses regularly rotating
anonymous identifiers to estimate aggregate visits; we do not connect these to
COP accounts. We respect Do Not Track and Global Privacy Control. Offline
measurements are discarded rather than stored for later transmission. Analytics
records are deleted after 180 days. Statistics are private and available only to
authorized administrators.

## Publication gate

Owner must approve CZ/EN text in the coordinating VCode chat. Before publishing,
confirm shared collector request handling, technical-data scope, daily rotation,
logs, retention and backup behavior actually match this notice. Publish the
approved notice visibly on the demo before enabling measurement. This proposal
adds no legal conclusion about consent exemption or complete anonymization.
