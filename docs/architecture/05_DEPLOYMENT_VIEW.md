# 05 Deployment View

Baseline počítá se třemi cílovými režimy nasazení:

- lokální vývoj přes Docker Compose,
- integrační/testovací prostředí v on-prem nebo cloud infrastruktuře,
- edge/degraded režim s lokální cache a omezenou konektivitou.

```mermaid
flowchart LR
    DEV["Developer Workstation\nDocker Compose"]
    INT["Integration Environment\nAPI + DB + Bus + Observability"]
    EDGE["Edge Node\nLocal cache + sync gateway"]
    IDP["OIDC Provider"]
    AIEXT["External AI Provider\noptional"]
    LOCALAI["Local LLM\noptional"]

    DEV --> INT
    INT --> IDP
    INT --> AIEXT
    INT --> LOCALAI
    EDGE <--> INT
```

Externí AI provider musí být vypnutelný. Edge režim nesmí obcházet policy enforcement ani auditní požadavky.
