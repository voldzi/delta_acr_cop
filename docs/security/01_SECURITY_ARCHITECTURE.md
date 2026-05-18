# 01 Security Architecture

Security architecture vychází ze Zero Trust principu. Systém nedůvěřuje uživateli, zařízení, zdroji dat ani síti bez ověření.

## Kontrolní body

- OIDC/OAuth 2.1 pro uživatele a aplikace,
- mTLS nebo client credentials pro systémové zdroje,
- Source Registry pro identitu zdrojů,
- RBAC/ABAC policy enforcement,
- audit všech relevantních operací,
- data classification a releasability,
- redaction pro AI providery,
- endpoint trust pro web, tablet a edge node.

Security model musí být aplikovaný i v degraded/offline režimu.
