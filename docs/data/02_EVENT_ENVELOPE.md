# 02 Event Envelope

Event envelope je základní kontrakt pro změny přicházející do COP systému.

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
