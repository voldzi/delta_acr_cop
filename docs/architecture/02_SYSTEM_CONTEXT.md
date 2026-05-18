# 02 System Context

Hlavní COP systém stojí mezi externími zdroji situačních dat a oprávněnými klienty. Zdroje posílají události přes ingest API. COP systém je normalizuje, koreluje, ukládá a distribuuje jako policy-filtered COP.

```mermaid
flowchart LR
    subgraph Sources["Externí zdroje"]
        SIM["Independent SIM"]
        AIR["Air systems"]
        GROUND["Ground systems"]
        UAV["UAV telemetry"]
        RESCUE["Rescue/crisis systems"]
        MANUAL["Manual reports"]
    end

    subgraph COP["Main COP System"]
        API["API Gateway"]
        REG["Source Registry"]
        CORE["Canonical Data Core"]
        FUSION["Correlation & Fusion"]
        STATE["COP State"]
        DIST["Distribution Gateway"]
        NATO["NATO Symbol Renderer"]
        AI["AI Gateway"]
        AUDIT["Audit & Provenance"]
        POLICY["RBAC/ABAC Policy"]
    end

    subgraph Clients["Klienti a konzumenti"]
        WEB["Web COP Client"]
        EDGE["Edge Node"]
        ADMIN["Admin Console"]
        EXT["External Consumers"]
    end

    SIM --> API
    AIR --> API
    GROUND --> API
    UAV --> API
    RESCUE --> API
    MANUAL --> API
    API --> REG
    API --> CORE
    CORE --> FUSION
    FUSION --> STATE
    STATE --> POLICY
    POLICY --> DIST
    POLICY --> NATO
    DIST --> WEB
    DIST --> EDGE
    STATE --> EXT
    ADMIN --> REG
    WEB --> AI
    API --> AUDIT
    AI --> AUDIT
```

SIM je v tomto pohledu pouze externí source system. Nesmí obcházet Source Registry ani validaci event envelope.
