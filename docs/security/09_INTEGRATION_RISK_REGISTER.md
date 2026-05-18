# 09 Integration Risk Register

| ID | Riziko | Dopad | Mitigace | Stav |
| --- | --- | --- | --- | --- |
| R-001 | SIM pošle nevalidní payload | Rozbití ingest pipeline | JSON Schema, contract tests, 400/422 error model | Open |
| R-002 | Spoofing `sourceSystemId` | Neautorizovaná data v COP | mTLS/OIDC, Source Registry, audit | Open |
| R-003 | Duplicitní event při retry | Nekonzistentní COP state | `eventId`, idempotency key, 409 conflict | Open |
| R-004 | Syntetická data nejsou odlišena | Chybný situační výklad | `synthetic=true`, UI badge, audit filtry | Open |
| R-005 | AI odešle citlivá data externě | Data leakage | redaction, classification policy, provider disable | Open |
| R-006 | Mapping symboliky změní význam dat | Chybná prezentace | oddělit canonical model a renderer, golden tests | Open |
| R-007 | Offline cache obejde policy | Neautorizovaný přístup | endpoint trust, šifrování, session binding, TTL | Open |
