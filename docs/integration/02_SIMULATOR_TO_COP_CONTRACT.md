# 02 Simulator to COP Contract

SIM projekt je samostatně vyvíjený producent syntetických dat. V COP vystupuje jako registrovaný `SourceSystem` s `sourceType=SIMULATOR` a `synthetic=true`.

```mermaid
sequenceDiagram
    participant SIM as SIM Project
    participant REG as Source Registry
    participant API as COP API Gateway
    participant ING as Ingest Service
    participant BUS as Event Bus
    participant AUD as Audit

    SIM->>API: POST /api/v1/sources
    API->>REG: register SourceSystem
    REG-->>API: registered
    API-->>SIM: 201 Created
    SIM->>API: POST /api/v1/ingest/events
    API->>REG: validate sourceSystemId
    API->>ING: validate schema + idempotency
    ING->>BUS: publish canonical event
    ING->>AUD: write ingest audit record
    API-->>SIM: 202 Accepted
```

SIM posílá canonical event envelope, nikoli interní COP state nebo symboly. COP odpovídá za validaci, fusion a distribuci.
