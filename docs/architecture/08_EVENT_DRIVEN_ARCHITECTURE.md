# 08 Event Driven Architecture

Událost je základní jednotka změny. Pipeline musí podporovat validaci, idempotency, ordering metadata, replay, backpressure a audit.

```mermaid
flowchart LR
    IN["Ingest API"]
    V["Validation"]
    I["Idempotency"]
    E["Event Bus"]
    C["Canonical Model"]
    F["Fusion Engine"]
    S["COP State"]
    D["Distribution Gateway"]
    H["History/Provenance"]
    O["Observability"]

    IN --> V --> I --> E
    E --> C --> F --> S --> D
    E --> H
    V --> O
    I --> O
    F --> O
    D --> O
```

Event stream je interní mechanismus. Externí integrace používají publikovaná API a stream kontrakt.
