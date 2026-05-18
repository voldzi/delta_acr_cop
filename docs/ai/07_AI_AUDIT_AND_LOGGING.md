# 07 AI Audit and Logging

AI audit musí být dostatečný pro rekonstrukci dotazu, policy rozhodnutí a vlivu odpovědi, ale nesmí zbytečně ukládat citlivá data.

## Auditovat

- `requestId`, uživatel, role a session metadata,
- purpose a safety scope,
- provider preference a skutečně použitý provider,
- policy výsledek,
- redactions/anonymization,
- model nebo local model version,
- structured output validation,
- status: completed, rejected, needs human review,
- `auditId` a korelační ID.

## Retence

Retence AI auditních dat musí odpovídat klasifikaci, právním požadavkům a provozní politice. Konkrétní doby retence jsou otevřená otázka.
