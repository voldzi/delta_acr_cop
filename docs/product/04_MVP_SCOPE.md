# 04 MVP Scope

MVP má prokázat end-to-end tok od externí události přes canonical model až po distribuovaný COP pohled.

## MVP obsah

- registrace a správa SourceSystem,
- `POST /api/v1/ingest/events` a batch ingest,
- validace canonical event envelope,
- základní COP track query,
- subscription a stream skeleton,
- základní confidence/provenance model,
- NATO symbol resolver skeleton,
- AI Gateway s mock/local/external provider abstraction,
- audit skeleton,
- contract tests pro SIM payloady,
- webový COP klient jako skeleton v navazujícím kroku.
