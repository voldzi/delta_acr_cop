# ADR 0027: Omezený OpenAI asistent nad MCP stavem zdrojů

## Rozhodnutí

První produkční použití OpenAI v COP je samostatná, výchozím nastavením vypnutá
funkce pro souhrn stavu datových zdrojů. Autentizovaný uživatel vyvolá
`cop.sources.health` přes stávající auditované COP MCP nástroje. Před odesláním
modelu `gpt-6-luna` se výsledek zredukuje **jen na počty zdrojů podle stavu**.
Žádná hlášení občanů, poloha, zprávy, partnerská data, identita uživatele ani
tokeny neopustí COP. Model není systémem pravdy a výstup vyžaduje operátora.

Server před placeným voláním v PostgreSQL transakčně rezervuje konzervativní
částku v denním a měsíčním globálním rozpočtu a v denním limitu uživatele.
Při selhání OpenAI či neznámé spotřebě rezervaci ponechá. Při úspěchu ji
nahradí odhadnutou částkou ze skutečných tokenů v odpovědi. Nejde o účetní
fakturu OpenAI; je to konzervativní interní limit podle standardního ceníku
platného při implementaci. Změna cen, regionální příplatek nebo dalších
placených nástrojů vyžaduje revizi limitu před aktivací. V této fázi nejsou
OpenAI předány žádné vzdálené MCP nástroje; jejich volání vlastní COP server.

## Důvody a hranice

- COP MCP zůstává interní, auditovaný a read-only; pro běžná mapová data se dál
  používají existující provider kontrakty.
- Samostatná funkce nemění výchozího AI providera ani AI chat. Tím nehrozí
  neúmyslné odeslání citlivého kontextu z jiných COP funkcí.
- Bez databáze, klíče nebo zapnutého přepínače asistent selže uzavřeně; COP
  mapa a další funkce běží dál.
- `store: false`, strop vstupu a výstupu, časový limit a žádné tool calling
  omezují retenci, náklady a latenci.

## Návrat

`COP_OPENAI_MCP_ENABLED=false` okamžitě vypne placené volání po restartu pouze
COP API. Rozpočtová evidence zůstává v PostgreSQL pro audit. Klíč se rotuje
samostatně a nikdy se nevkládá do Git repozitáře.
