# Předání Jízdě v4: terminal call admission

Stav: publikovaný zdrojový kandidát, bez produkčního nasazení nebo aktivace.

- COP source `c5b12881f539e959fe7543927c5a5f25fe102401`, větev `codex/jizda-voice-terminal-20261011`.
- COP patch base `a8c3684996510155f0a8eb1737915305510c1320` (neměnné v3 předání); patch SHA256 `4e9567a8d00972127210aad4968ef61beef432889f76aa75a19f3c23603bd057`.
- SDK `73dcb1dfd1bc42775057ce5ddd17edb85ad574db` a Messaging
  `ed045c442f540c279d5ab6a54bf26a5dd121a759` zůstávají beze změny.
- Archiv v2/v3, candidate33 i právě zmrazená v2 candidate34 se nepřepisují.
  Starší označení candidate34 ve v3 není pokynem upravit nyní zmrazenou v2.
  Mobilní delta patří do nového samostatně přijatého kandidáta.

## Serverový výsledek

Scoped API i všechny signaling/validate cesty kontrolují přesný canonical
callId a cop-call room. Missing/terminal/mismatch je403
VOICE_CALL_ADMISSION_DENIED; stavový výpadek/timeout je503
VOICE_CALL_STATE_UNAVAILABLE. Ringing/accepted/connecting_media respektují
stávající expiresAt, connected může pokračovat po invitation deadline.
Guard běží před/po mint, po posledním response await, před dispatch/po ACK,
při signaling událostech a bounded idle kontrolou.

Gateway vyžaduje explicitní persistent PostgreSQL. Čtení a API denial
compensation mají každé5s request deadline; API SQL má query/statement5s
limit. Není to5s end-to-end SLA ani důkaz úspěšné kompenzace. Po chybě se
media nevrátí a pozdní await neobnoví úspěšnou odpověď.

Pozdní skutečný ACK se zachová v durable evidenci, ale skončený hovor jej
klientovi nepředá. Přesný operational remove/readback nikdy nevytváří
app/installation completion proof a nemaže pending rows. Read/remote Join
nejsou jedna transakce; remove404/timeout/inventory zůstávají nejistota.
Legacy identita/transport a cross-app cesta zůstávají zachované.

## Samostatný mobilní návrh

Nejprve dokončit zmrazenou v2 candidate34. Poté samostatně projednat v3
optional participantIdentity a x-cop-installation-id ze stejné online
bootstrap/current account generation. V tomto v4 nejsou nová JSON pole.

- 403 VOICE_CALL_ADMISSION_DENIED zastaví konkrétní join/rejoin; bezpečně
  načíst canonical call state pouze pro aktuální account generation.
- 503 VOICE_CALL_STATE_UNAVAILABLE zobrazit jako výpadek služby; bounded
  retry pouze ve stejné generaci, zrušit při end/account switch/revoke.
- Žádný legacy/direct-SFU/account fallback. Remote Leave/disconnect není
  důvod automaticky obnovit terminal call.
- 202 revoking zůstává pending, 200 revoked vyžaduje provider proof;
  terminal closure není dokončené app unlink ani account deletion.
- Lokální navigation-only UX nevytváří remote mutation či revocation.

Podrobný model, quiescence/compaction návrh a budoucí mobile delta:
`docs/integration/47_VOICE_TERMINAL_ADMISSION_AND_COMPACTION_PLAN.md`.
ADR0048 a binding JSON OpenAPI jsou v source patchi; generated YAML je synchronní.
Compaction je pouze návrh: nic se automaticky nemaže ani neuvolňuje podle stáří.

## Ověření

- Finální úplná regrese:1801 passed,16 conditional skipped. Z těch16 byly
  samostatně4 PostgreSQL testy skutečně ověřeny:4/4; ostatních12 nepřístupné.
- V regresi:gateway43,helper18,COP scoped HTTP26,ledger14,receipt4.
  Poslední focused API/helper/CallStore52/52.
- PostgreSQL:cross-pool canonical end, skutečný timeout pod drženým table
  lockem pro read/compensation, issue/revoke/restart, primary singleton/loss.
- Build,TypeScript,ESLint,skeleton,11JSONSchema,analytics,diffcheck PASS.
  OpenAPI valid s26warning; stávající web chunk warning. Dependencies nezměněny.
- 2-worker regrese měla jeden nezměněný media-conversion1s wait failure;
  finální kompletní1-worker regrese prošla. Test tablelock po opravě drží
  vlastní session; žádná úprava converter runtime/timeouts.

## Zbývající akceptace

Real LiveKit/sole-ingress/single provider connect/no-proxy-retry,
historické ACK/remove404 quiescence, fyzický iPhone a mobilní/legacy regrese,
přijatá compaction/restore politika, legacy ownership, moderator operation a
all11 account-erasure owner proofs. Žádné skutečné účty, nové secrets,
produkční infrastruktura, smazání, odvolání nebo aktivace nebyly provedeny.

Rollback před skutečnými scoped granty může vrátit source/intake-off. Po
existenci scoped state zachovat gateway admission, ledger/fences/epoch a
maintenance; neobnovit direct signaling či legacy fallback a neodmazat pending.

Lokální archiv: `/private/tmp/cop-account-safety-handoff-v4-20261011.tar.gz`. SHA256 archivu je v publikovaném v4 manifestu.

SHA-256 archivu: `3e74a3f7c079466aa1b652370e8e9a14138cb1870cfd5677078f623cc1c74caa`.
