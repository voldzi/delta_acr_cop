# 03 OpenAI Provider

OpenAI provider je volitelný externí provider pro asistivní use-cases, pokud to umožní policy a klasifikace dat.

## Požadavky

- aktuální API, modely, structured outputs a tool use ověřit proti oficiální dokumentaci při implementaci,
- neposílat citlivá data bez explicitní konfigurace,
- aplikovat redaction/anonymization před voláním providera,
- validovat strukturovaný výstup,
- auditovat request, provider, model, policy výsledek, redactions a response metadata,
- umožnit centrální vypnutí providera.

OpenAI provider nesmí mít přístup k neomezeným interním toolům. Tool calling smí používat pouze explicitně schválené read-only nebo bezpečné nástroje.
