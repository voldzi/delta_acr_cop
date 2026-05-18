# 04 ADatP-3 APP-11 Messages

ADatP-3/APP-11 zprávy jsou kandidátem pro budoucí message adapter. V první fázi se dokumentuje pouze architektonická připravenost.

## Adapter princip

Adapter přečte externí zprávu, validuje ji, převede na canonical event envelope, doplní source metadata a uloží provenance o původní zprávě.

Chybové stavy musí být reprezentované přes standardní error model a nesmí měnit core canonical model podle konkrétního externího formátu.
