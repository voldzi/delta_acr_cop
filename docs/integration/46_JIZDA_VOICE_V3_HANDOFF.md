# Předání Jízdě v3: hlasové granty účtu a instalace

Stav: **publikovaný zdrojový kandidát, bez nasazení nebo aktivace produkce**.

- COP source `496d81170d9fabae134bfa1bbea82a07cb43d329`, větev `codex/jizda-voice-grants-20261011`.
- Patch se aplikuje na COP base `8b56bb8620ea2d37ced3e2d7ca74589013deb008`; není to mobilní patch.
- Messaging `ed045c442f540c279d5ab6a54bf26a5dd121a759` a SDK
  `73dcb1dfd1bc42775057ce5ddd17edb85ad574db` z v2 zůstaly beze změny.
- Předchozí v2 archiv zůstal neměnný. Nové host/SDK změny patří do
  **candidate34**, nepřepisovat předaný candidate33.

## Přesné kroky integrace

1. Používat dedicated, serverem ověřený OIDC klient Jízdy a per-account
   instalační UUID z přijaté secure-storage konfigurace. Žádné nové UUID pro
   jednotlivé požadavky ani sdílená identita mezi účty.
2. Úspěšný online POST `/api/v1/messaging/bootstrap` s `installationId` musí
   předcházet médiím. `deviceId` ani UUID samy nedokládají oprávnění.
3. `CSMVoiceCallControl` musí u create/detail a akcí `accept`, `heartbeat`,
   `media_connected` serverově autentizovaným transportem přidat
   **`x-cop-installation-id`** ze stejné aktuální generace účtu. Po každém await
   ověřit platnost generace/účtu; A→B během mikrofonního dialogu nebo media
   connect nesmí použít credential A. `decline/cancel/end` zůstávají kompatibilní.
4. V `CSMVoiceCallMediaCredentials` doplnit volitelné
   **`participantIdentity: String?`**, výchozí nil pro starší JSON/initializers.
   Scoped odpověď nese serverovou opaque identity `cop-jizda-voice-v1-<UUID>`;
   neporovnávat ji s vlastním COP subjectem. Profil/peer prezentace nadále pochází
   z ověřeného call peer, nikoli z opaque identity. Klient identity nepřepisuje.
5. Pro odvolání instalace použít POST `/api/v1/me/voice-installations/revoke`,
   přesné tělo `{"installationId":"<UUID>"}` a stabilní UUID v
   `Idempotency-Key` při retry. Žádné userId/app/grants v těle. HTTP202 je
   `revoking`, nikoli úspěšně dokončené odvolání. 503 nezruší přijatý fence;
   opakovat stejnou operaci. Receipt nikdy netvrdí smazání celého účtu.
6. Po chybě nepřecházet na legacy subject credential, jiný účet, přímý SFU
   nebo globální unregister. Starší `csm-mobile` zůstává samostatně kompatibilní.
7. Změny SDK/hosta zde nejsou publikované ani nativně sestavené. Jízda je má
   integrovat koordinovaně po přijetí backend kontraktu a vykázat vlastní
   Foundation/native/physical výsledky podle konkrétní revize.

## Serverový výsledek a testy

COP vydává scoped grant až pod aktuální aktivní gateway epoch a kontrolu
opakuje po podpisu JWT. App/installation fence předchází cleanupu. Voice a
Messaging cleanup mohou postupovat nezávisle při výpadku jedné služby.
Neúspěšné vydání médií ukončí nový/čerstvě přijatý hovor; nevznikne nepravdivé
answered_elsewhere oznámení. Pending dispatch nelze dokončit podle101,
časovače, zavřeného socketu či prázdného inventáře.

- Úplná regrese: **1761 passed, 14 skipped**. Dvě skipnuté databázové zkoušky
  byly samostatně ověřeny na skutečném izolovaném PostgreSQL: **2/2 passed**.
- V regresi: ledger/COP HTTP **35**, syntetický loopback gateway **26**,
  JSON receipt kontrakty **4**. Build, TypeScript, ESLint, skeleton,
  11 JSON Schema, frozen offline lockfile a veřejná analytika prošly.
- OpenAPI je platné s26warnings; dvě nové souvisejí s WebSocket101 bez2xx.
  Web build má existující chunk-size upozornění.
- První4-worker regrese měla tři media-conversion timing failures; stejná
  nezměněná sada samostatně prošla20/20 a finální2-worker regrese bez selhání.

## Co zůstává před aktivací

Skutečný LiveKit, jediná signaling cesta, provider single connect attempt,
žádný proxy retry, fyzický iPhone a legacy ownership nejsou přijaté. Nutné
jsou dva účty/instalace, pokračující cizí COP Mobile hovor, old/refreshed JWT
po odvolání, pending join vs revoke, restart/výpadek a provider readback.

Historické/no-epoch granty i již ukončené acknowledged hovory s remove404
potřebují samostatný quiescence/reconciliation důkaz. Kopie platného grantu
zatím není automaticky zakázána samotným terminal call phase; autoritativní
call-state admission hook je další práce před plnou provozní akceptací.
Limit128 uchovaných grantů vyžaduje přijatou compaction politiku před běžným
dlouhodobým provozem. Moderátor role/proces, retenční provoz a all11 owner
proofs pro smazání účtu jsou samostatné brány. App Store completeness netvrdíme.

Podrobný kontrakt: `docs/integration/45_JIZDA_VOICE_GRANTS_AND_LEGACY_MIGRATION.md`.
Deployment/rollback: `deploy/communications/livekit/SCOPED_ADMISSION_CANDIDATE.md`.
Závazný kontrakt: `openapi/openapi.json`, source revision `496d81170d9fabae134bfa1bbea82a07cb43d329`.

## Neměnný lokální balík

Archiv: `/private/tmp/cop-account-safety-handoff-v3-20261011.tar.gz`

SHA-256: `863cca706fb1c298b4cbad8000385de743a677f899c5a3b77560dcd5feaa9d6c`. Obsahuje source patch, manifest a výsledky ověření.
