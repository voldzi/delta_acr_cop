# 03 Ingest API Contract

Ingest API přijímá single event nebo batch. Všechny payloady používají `canonical-event-envelope.schema.json`.

```mermaid
flowchart LR
    REQ["HTTP request"]
    AUTH["Authenticate"]
    SRC["Source Registry"]
    JSON["JSON parse"]
    SCHEMA["JSON Schema validation"]
    IDEMP["Idempotency"]
    ACCEPT["202 Accepted"]
    QUEUE["Queue/Event bus"]
    ERROR["Standard error model"]

    REQ --> AUTH --> SRC --> JSON --> SCHEMA --> IDEMP --> ACCEPT --> QUEUE
    AUTH --> ERROR
    SRC --> ERROR
    JSON --> ERROR
    SCHEMA --> ERROR
    IDEMP --> ERROR
```

## Endpointy

- `POST /api/v1/ingest/events`
- `POST /api/v1/ingest/batches`

Batch request musí obsahovat `batchId`, `contractVersion`, `sourceSystemId` a pole `events`.
