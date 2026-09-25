# ADR 0028: Sdílený AI Router jen pro agregovaný MCP stav zdrojů

## Rozhodnutí

COP smí volitelně použít samostatnou interní službu AI Router spravovanou SIM
pro existující placený souhrn `cop.sources.health`. Výsledek MCP nástroje COP
nejdříve zredukuje na počty stavů zdrojů. Do Routeru předá výhradně tuto
agregaci, uživatelský identifikátor pro limit a třídu `public_aggregate`.
Externí ekonomický model je dovolen, dražší eskalace nikoli. Výstup zůstává
asistivní a vyžaduje lidské posouzení.

Přepínač `COP_AI_ROUTER_ENABLED` je ve výchozím stavu vypnutý. Nepřepíná
obecného AI providera, COP chat, situační shrnutí, Matrix/E2EE ani mapová
data. Odpovídající `/usage` po zapnutí ukazuje Router-wide agregát obou
konzumentů; přímá stará evidence COP je oddělená. Bez Routeru se tyto dva
endpointy uzavřou chybou, nikoli tichým fallbackem na jiný placený model.

## Důvod

Umožňuje společné limity a správu nákladů pro první schválenou datovou třídu,
aniž by se rozšířil přenos živých incidentů, osobních hlášení nebo šifrované
komunikace. Obecný COP chat potřebuje vlastní datovou a E2EE revizi.

## Návrat

Vypnout `COP_AI_ROUTER_ENABLED` a obnovit pouze COP API. Rozpočtová evidence
Routeru ani starého asistenta se nemaže.
