# 04 Source and Device Identity

Zdroj dat musí být registrovaný v Source Registry a autentizovaný při každém ingest requestu.

## Zdrojová identita

- `sourceSystemId`,
- `sourceDeviceId`,
- `sourceType`,
- trust profile,
- allowed event/object types,
- classification limit,
- lifecycle status.

## Device identity

Klientská zařízení používají session binding, endpoint posture a MDM/MAM signály. Nevyhovující zařízení nesmí získat plný COP pohled.
