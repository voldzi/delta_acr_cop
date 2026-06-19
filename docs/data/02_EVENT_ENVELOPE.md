# 02 Event Envelope

Event envelope je základní kontrakt pro změny přicházející do COP systému.

Původní schéma `cop-ingest-v1` zůstává baseline pro ingest objektů. Rozšířený
domain-event směr pro civilní COP je v
[13 Event Contract and AsyncAPI Direction](../integration/13_EVENT_CONTRACT_AND_ASYNCAPI.md).

## Povinné koncepty

- `eventId`: idempotentní identita události.
- `eventType`: typ změny.
- `contractVersion`: verze integrační smlouvy.
- `source`: `sourceSystemId`, `sourceDeviceId`, `adapterId`, `adapterVersion`.
- `correlationId`: dohledání souvisejících requestů.
- `producerTimestamp`: čas vzniku u zdroje.
- `ingestTimestamp`: čas přijetí doplněný COP systémem.
- `classification`: úroveň, releasability, caveats.
- `geo`: poloha a přesnost, pokud relevantní.
- `payload`: observed object nebo jiný canonical payload.
- `quality`: confidence a hodnocení zdroje.
- `simulation`: syntetický původ dat.

Schema baseline je v [canonical-event-envelope.schema.json](../api/schemas/canonical-event-envelope.schema.json).
