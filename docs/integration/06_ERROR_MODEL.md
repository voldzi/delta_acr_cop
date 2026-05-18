# 06 Error Model

Všechny API chyby používají jednotný envelope.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Payload does not match schema.",
    "details": [
      {
        "path": "geo.lat",
        "issue": "required"
      }
    ],
    "correlationId": "uuid"
  }
}
```

## Status kódy

- `400 Bad Request`: nevalidní JSON nebo schema.
- `401 Unauthorized`: chybí nebo selhala autentizace.
- `403 Forbidden`: zdroj nebo uživatel nemá oprávnění.
- `404 Not Found`: zdroj nebo subscription neexistuje.
- `409 Conflict`: idempotency conflict.
- `422 Unprocessable Entity`: business pravidla kontraktu selhala.
- `429 Too Many Requests`: rate limit.
- `500 Internal Server Error`: neočekávaná chyba.
- `503 Service Unavailable`: dočasná nedostupnost.
