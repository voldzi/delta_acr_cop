# 02 RBAC ABAC

RBAC určuje základní oprávnění podle role. ABAC zpřesňuje přístup podle atributů uživatele, zařízení, relace, dat a zdroje.

## Role

- `COP_OPERATOR`,
- `COP_ANALYST`,
- `COMMAND_VIEWER`,
- `INTEGRATION_ADMIN`,
- `SECURITY_ADMIN`,
- `AUDITOR`,
- `AI_ADMIN`,
- `AI_USER`,
- `SYSTEM_CLIENT`.

## ABAC atributy

Organizační jednotka, oblast odpovědnosti, clearance, klasifikace dat, releasability, důvěryhodnost zařízení, stav relace, zdroj dat a synthetic flag.

Policy evaluation musí být auditovatelná.
