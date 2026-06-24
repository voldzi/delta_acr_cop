# 03 Container View

```mermaid
flowchart TB
    BROWSER["Browser/PWA\nReact + MapLibre"]
    WEB["cop-web\nstatic web runtime"]
    CHAT["cop-chat\nstandalone /chat messenger"]
    API["cop-api\nREST/OpenAPI, auth, policy, audit"]
    EDGE["cop-edge-node\nlocal outbox + replay cache"]
    MCP["cop-mcp-gateway\nstandalone MCP facade"]
    SIM["SIM providers\nserver-to-server data"]
    MSG["CSM Messaging\nMatrix/bootstrap/notifications"]
    DB["PostgreSQL/PostGIS\ntracks, reports, sketches, federation"]
    S3["SeaweedFS/S3\nmedia attachments"]
    AI["AI Gateway\nOllama/local/mock"]
    OBS["Observability\nhealth, metrics, OTel-ready logs"]

    BROWSER --> WEB
    BROWSER --> CHAT
    WEB --> API
    CHAT --> API
    CHAT --> MSG
    API --> SIM
    API --> MSG
    API --> DB
    API --> S3
    API --> AI
    EDGE --> API
    MCP --> API
    API --> OBS
    EDGE --> OBS
    MCP --> OBS
```

Aktuální pilotní fyzické služby v tomto repozitáři:

- `cop-web`: webový klient a PWA shell.
- `cop-chat`: samostatná chatovací aplikace publikovaná pod `/chat/`.
  Používá existující COP auth, messaging metadata endpointy a browser Matrix
  SDK; COP API pořád neproxyuje plaintext zprávy.
- `cop-api`: centrální rozhodovací backend, katalog vrstev, provider adaptéry,
  komunitní hlášení, média, sketch drawings, messaging bridge, policy a audit.
- `cop-edge-node`: samostatná edge služba s lokálním outboxem, replay cache a
  synchronizací do centrálního COP API.
- `cop-mcp-gateway`: samostatná MCP gateway pro externí agenty. Gateway
  neobsahuje vlastní business logiku; server-side volá auditované a
  allowlistované nástroje v `cop-api`.

Záměrně oddělené služby mimo tento repozitář:

- SIM poskytuje data pouze server-to-server.
- CSM Messaging řeší Matrix, zařízení a push doručení.
- SeaweedFS/S3 drží binární média.

Logické moduly jako fusion, policy, AI a observability zatím běží primárně v
`cop-api`; při růstu zátěže se mohou dále vyčlenit bez změny veřejného kontraktu.
