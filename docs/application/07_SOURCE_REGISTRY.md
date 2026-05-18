# 07 Source Registry

Source Registry eviduje zdroje dat, jejich oprávnění, trust profil, povolené event types, povolené object types a stav lifecycle.

```mermaid
stateDiagram-v2
    [*] --> Registered
    Registered --> Active: schválení
    Active --> Suspended: dočasné omezení
    Suspended --> Active: obnovení
    Active --> Revoked: revokace
    Suspended --> Revoked: revokace
    Revoked --> [*]
```

Každá ingest událost musí projít kontrolou Source Registry. Revokovaný zdroj nemá právo publikovat nové události.
