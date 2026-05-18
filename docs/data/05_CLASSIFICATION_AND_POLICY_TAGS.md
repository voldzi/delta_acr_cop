# 05 Classification and Policy Tags

Každý event a COP object musí nést klasifikační a policy metadata.

## Povinné oblasti

- classification level: `UNCLASSIFIED`, `RESTRICTED`, `CONFIDENTIAL`, `SECRET`,
- releasability: např. `CZE`, `NATO`,
- handling caveats: např. `SYNTHETIC`,
- source trust profile,
- synthetic flag,
- AOR a layer policy,
- device trust a session context.

RBAC určuje roli, ABAC vyhodnocuje atributy uživatele, zařízení, zdroje, dat a relace.
