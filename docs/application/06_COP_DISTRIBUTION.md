# 06 COP Distribution

COP distribuce poskytuje oprávněným klientům snapshot, delta updates a degraded/batch režimy.

```mermaid
flowchart LR
    STATE["COP State Store"]
    POLICY["RBAC/ABAC Policy Filter"]
    SUB["Subscription Service"]
    SNAP["Snapshot Builder"]
    DELTA["Delta Publisher"]
    STREAM["WebSocket/SSE Gateway"]
    CLIENT["COP Client / Edge Node"]
    AUDIT["Audit"]

    STATE --> POLICY --> SUB
    SUB --> SNAP --> STREAM
    SUB --> DELTA --> STREAM
    STREAM --> CLIENT
    SUB --> AUDIT
    STREAM --> AUDIT
```

Subscription je omezena oblastí zájmu, vrstvami, typy objektů, confidence thresholdem, syntetickým flagem a policy pravidly.
