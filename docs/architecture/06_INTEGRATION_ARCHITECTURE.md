# 06 Integration Architecture

Integrace jsou vedené přes explicitní kontrakty. Každý zdroj je registrovaný v Source Registry a každá událost nese `sourceSystemId`, `adapterVersion`, `eventId`, `correlationId`, `producerTimestamp`, klasifikaci, informaci o syntetických datech a kvalitu.

```mermaid
flowchart LR
    SRC["External Source / SIM"]
    AUTH["mTLS/API token/OIDC client credentials"]
    REG["Source Registry check"]
    SCHEMA["Schema validation"]
    IDEMP["Idempotency check"]
    CLASS["Classification & policy tags"]
    BUS["Event bus publish"]
    AUDIT["Audit record"]

    SRC --> AUTH --> REG --> SCHEMA --> IDEMP --> CLASS --> BUS
    AUTH --> AUDIT
    REG --> AUDIT
    SCHEMA --> AUDIT
    IDEMP --> AUDIT
    CLASS --> AUDIT
```

SIM projekt se integruje jako `sourceType=SIMULATOR` a používá Shared Integration Contract v1.
