# 26 — Account erasure: backup restore protection

Status: source implemented and isolated PostgreSQL acceptance passed on 16 October 2026. Production installation is recorded separately in the coordinated account-erasure release. This document does not claim production activation.

## Meaning of the owner checkpoint

`backup_restore` verifies suppression of erased COP/Jízda accounts after a managed restore under ADR0055. It does **not** claim deletion of an entire VM backup, physical erasure of every PBS copy, or contents inspection from a backup catalog. Existing protected backups can retain historical content until their configured managed expiration. Restoring such content into the exposed application is prohibited.

The accepted trust boundary is the reviewed application plus database administrators and Proxmox operators. Administrators must keep a restore quarantined and preserve independent deletion evidence. There is no new privileged broker, no claim of protection against malicious Root, and no automatic inference of missing principals.

## Actual runtime binding

The server entrypoint binds `createBackupRestoreErasureAdapter` only to its actual `PostgresAccountErasureContinuity` instance in `database_v2` mode, using the existing OIDC issuer and account-erasure identity secret. This owner adds no secret, environment acceptance boolean, database table, public endpoint, or Proxmox permission. Missing/foreign continuity cannot become ready.

Every readiness/assessment reads the real immutable independent PostgreSQL journal and current administrator-enrolled dataset identity, then verifies the actual business SQL replay against the journal frontier. Completion additionally requires the original account MAC derived from the verified actor, operation UUID, canonical requested date and exact current dataset binding. It does not depend on Keycloak cleanup; Keycloak remains the last domain. The proof is an operation/dataset-bound hash, not user content or an external credential.

`completed` for this owner means current restoration suppression is verified. Global deletion still requires every other actual owner. A pending202 is not completed deletion. A backup catalog alone, a manually populated positive callback, expiry of a URL, and a copied terminal checkpoint are not sufficient.

## Administrator restore procedure

1. Stop COP and every affected owner before application data are restored. Keep their ordinary external exposure closed through the whole procedure using the established maintenance procedure. Do not restore `cop_account_safety_guard` together with application data.
2. Record the independent current `guardStoreId`, `applicationStoreId`, configuration fingerprint, old incarnation/generation and journal frontier from the existing protected database connection. Preserve the original account/operation records and identity secret. Do not print secrets or put connection strings into command arguments.
3. Restore the selected application/provider datasets into quarantine. Read the restored local dataset binding. No startup boolean accepts this snapshot.
4. Through the existing reviewed administrator connections invoke the compiled `transitionAccountErasureDataset(guardPool, businessPool, plan)` stage. `plan` contains the exact existing guard/store/configuration identities, `previous` independent binding, `restoredLocal` binding, and `next` with a new incarnation UUID and generation exactly old+1. The function validates both databases and the complete original immutable chain, resets replay to zero, and writes only the new marker. An interrupted exact retry is accepted; arbitrary re-enrollment is rejected. The first-empty provisioning script is **not** a restore tool.
5. Update the existing deployment incarnation binding to that exact administrator value. Start the guarded candidate in quarantine. Its normal startup replays the independent fences into the actual local SQL store, clears copied component completion after a generation change and verifies the installed frontier by SQL readback. The old runtime binding must fail503.
6. Allow each actual provider to redo cleanup/readback against its restored data. A copied final receipt cannot satisfy this step. A job without its original encrypted principal remains pending. The existing fresh authenticated actor receipt-recovery path may rebind only the same original MAC and operation; no automatic principal recovery from journal metadata is implemented. Otherwise leave the affected owner quarantined for verified operator recovery.
7. Verify zero removable data for each erased account in every affected owner, original permanent fences, no late writers, and unaffected control-user data. Confirm SIM identity/access are preserved. Reopen exposure only after those checks; unresolved jobs or revived removable content keep the affected owner quarantined.
8. Preserve independent pseudonymous anti-resurrection evidence while any referring restorable copy or incomplete delivery exists under the separately approved policy. Continue the existing backup expiration policy; this adapter does not change Proxmox/PBS retention or authorize manual deletion of backups.

## Actual isolated evidence

Run `node scripts/test-backup-restore-erasure.mjs` with the repository's Node24 runtime. It creates two new loopback PostgreSQL18 databases with a synthetic admin and restricted runtime, and removes the owned cluster on exit. It refuses production routes or a foreign fixture identity. No Docker, Proxmox or production service is contacted.

Five passed test groups cover:

- a missing actual local replay refusing readiness;
- exact original account/operation/date completion and retry;
- rejection of another actor/account/operation/date/dataset;
- read-permission loss, a changed SQL incarnation and cancellation;
- real `pg_dump`/`pg_restore` of the business database, unchanged independent journal, administrator generation transition, old runtime refusal, fresh fence replay, pending operation without an encrypted principal, explicit fresh-actor recovery, re-cleanup of synthetic A content and preserved synthetic B content.

The backup owner and PostgreSQL are real in this run. The other providers are explicitly synthetic adapters; this is not whole Synapse/LiveKit/Keycloak/storage acceptance, a production PBS restore, or physical iPhone acceptance. The fixture restores real old A content while quarantined, demonstrating why the restore guard and subsequent provider cleanup are separate requirements.

Machine-readable result: [backup restore evidence](../testing/account-erasure-backup-restore-owner-20261016.json).
