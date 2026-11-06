# Existing app-pusher reconciliation after routeAbsent

Status: source-bound implementation proposal, not an implemented endpoint or a
production operation. No owner request, token issuance, cleanup or pending-state
change was performed. Scope: COP and Messaging with Jízda; no infrastructure
administrator handoff required.

## Observed owner result

Installed/running Jízda 1.2 (83) read-only probe returned:

```
routeAbsent
lookupDerived
originalPairMissing
cacheMissing
```

There is no scoped Routing.Record to use for the local exact-original lookup.
This does not establish absence of all cache files, the installation seed,
Matrix device, crypto store or history. Repeating this same lookup cannot supply
new proof. Do not clear pending or run ordinary bootstrap/login as a workaround.

## Existing evidence and its limits

Messaging production source inspected at
`19c9b39669877dfeacbe1bd996e9c8da7c4cd1ec`:

| Evidence | Existing source | Proves / does not prove |
| --- | --- | --- |
| Current authenticated COP owner | OIDC/server-auth actor | Account authority; never browser-supplied owner/MXID |
| Persistent owner→Matrix account mapping | `MatrixIdentityStore.lookup/1`, unique `lookup_matrix_user/1` | Existing account only; no specific original crypto device |
| Notification registration | `DeviceRegistry` owner, bundle, token hash/encrypted token, revision, status | Exact app notification target when uniquely matched; not original Matrix device |
| Removed notification registration | `DeviceRegistry.handle_call({:delete,...})` marks inactive | Inactive row can still be evidence; deleting registration is not Matrix pusher removal |
| Typed app/installation binding | `verifiedAppScope`, `verifiedAppInstanceId`, `AccountSafety.bind` | Stronger binding if already present and matching; not assumed for legacy owner |
| Legacy bootstrap | nil appContext skips persistent app-device bind | Successful old login does not establish durable installation/device ownership |
| Existing Matrix bootstrap | `get_or_create` → provisioning → password login | Not suitable for existing-only repair |
| Existing server policy token helper | `MatrixClient.with_active_policy_token/2` | Existing precedent for short-lived server-only no-device delegation; not already a cleanup endpoint |

No production row was inspected to claim that any particular owner has the
necessary registration or typed binding. Presence remains to be checked through
a bounded authenticated preparation operation, never inferred from these schemas.

## Recommended narrow operation

Separate **removal of a stale notification pusher** from **restoration of a chat
session/crypto device**. Removing one pusher needs no replacement Matrix device,
no crypto-store migration and no user access/refresh token delivered to the app.
It cannot restore missing session credentials or make encrypted history readable.

Implement an additive, explicitly confirmed self-service cleanup contract:

1. COP authenticates the current owner and requires recent OIDC reauthentication
   for this recovery action, bound to state/nonce/PKCE, account, host app and
   operation. A successful login as another owner cancels the action. Existing
   login tokens without provable freshness cannot satisfy this step. Never ask
   the app for a Keycloak/Matrix password or reuse `get_or_create`.
2. Native app submits only its exact existing pending target, under the captured
   owner/scope/generation and positive detached-client proof. No cache scans,
   derived username aliases, account enumeration or token export. The expired
   Matrix token is not authentication and need not leave the device.
3. A read-only preparation step looks up the owner's existing Matrix mapping
   (including authoritative issuer/provenance and unique reverse mapping), then
   uniquely matches the existing registration, active **or inactive**, using
   owner + server-allowed Jízda bundle + stored token hash and actual decrypted
   token equality. Bundle/environment/gateway are server configuration, not
   arbitrary request routing. A registration UUID alone is not proof.
4. If typed app/installation binding exists, require an exact match; never replace
   it. If legacy binding is absent but the owner mapping and exact registration
   are proven, offer only the explicitly labelled **account-authorized removal
   of this one old app notification target**, not a claim of installation/device
   restoration. Fresh owner authentication plus this narrow confirmation is the
   authority; no fabricated device binding is written. Missing/ambiguous owner
   mapping, provenance, registration or app binding conflict stops the action.
5. Preparation returns a short-lived one-time operation reference, bound server
   side to owner/issuer/app/installation context, exact target digest, registry
   revision and fixed homeserver/gateway. Do not return raw pushkeys, tokens,
   another device's details or a list of the owner's devices. Rate-limit per
   owner and operation; log only operation/correlation and fixed outcome codes.
6. User confirms: “Odebrat starý příjem oznámení Jízdy. Historie a šifrovací klíče
   se nemění. Tato operace ještě neobnovuje přihlášení chatu.” This is a distinct
   recovery action, not implicit background work after ordinary sign-in.
7. Execute under the existing active-owner/deletion fence plus an exact-target
   operation/registration revision fence shared with register/delete/rebind.
   Recheck every captured binding before mutation. Re-registration or owner
   change invalidates the prepared action; never delete a successor registration.
8. Using the existing server admin authority, obtain a token for the already
   proven Matrix account through Synapse's admin login-as-user endpoint, with a
   maximum 60-second lifetime. This endpoint does not create a device. Do not
   call password login, user PUT, bootstrap/provisioning, `/sync`, room APIs,
   key APIs, device deletion or logout-all. Check capability/version first;
   unsupported delegation fails, never falls back to provisioning.
9. Keep the delegated token only in server memory. Verify `/account/whoami`
   returns the exact mapped Matrix user. Its no-device nature is expected and
   must not be interpreted as the original device. Verify the exact pusher under
   that user, fixed app ID, pushkey and configured gateway. Remove only that
   `(app_id, pushkey)` via `POST /_matrix/client/v3/pushers/set` with `kind:null`.
   No wildcard, all-pusher cleanup or Matrix device deletion.
10. Re-read the exact pusher state and confirm absence. A pre-existing absent
    pusher may complete only after all owner/target evidence was already proven.
    Always logout only the temporary delegated token, bounded by its expiry.
    No delegated access/refresh token is returned to COP or the native app.
11. Durable idempotent stages: prepared → authorized → removal_outcome_unknown
    or removal_confirmed → delegation_closed → complete. Timeout is not success;
    re-query exact state on resume rather than blindly repeating. Dependency
    failure is 503; limit is 429; ownership failure is 403. Persist only minimal
    target digests and outcomes; never access tokens, raw pushkeys or content.
12. Return an authenticated exact-operation receipt. Native code verifies the
    original owner, scope/generation, target digest, stored pending target and
    no concurrent producers before acknowledging **only that pusher target**.
    Never clear unrelated pending/unknown-registration state or override a
    prepared unknown refresh journal. Journal/session reconciliation remains a
    separate state when it lacks proof. No automatic chat activation follows.

If no exact registration evidence survives, recent authentication alone is not
original-installation proof. Do not silently downgrade to selecting an arbitrary
pusher. The UX must report `target_not_proven` and offer a separately reviewed
account-level recovery, without reset or deletion as a default. Restoring the
original crypto session then requires separate verifiable local/session material
or the established encrypted-store recovery UX; stale-pusher removal does not
supply that material.

## Required focused tests before endpoint deployment

- Two owners, same bundle and different installations: foreign/ambiguous target,
  absent mapping, issuer mismatch and typed-binding conflicts reject.
- Exact inactive legacy registration plus fresh same-owner confirmation succeeds
  only in the narrowly declared target-removal mode; no new binding is invented.
- Missing mapping/registration never creates a user, identity, installation or
  device. Client owner, Matrix ID, model/gateway and arbitrary URL inputs cannot
  select the authority or destination.
- Reauthentication wrong owner/stale auth, replayed/expired operation, registration
  rotation, consent/owner change and deletion-fence races reject safely.
- Exact app/pushkey removal preserves every other pusher, Matrix device, room,
  E2EE key and local history; zero password-login/bootstrap/provision calls.
- Simulate timeout before/after remote commit and token logout failure. No false
  complete, no leaked token, exact-state reconciliation and bounded delegation.
- App receipt for old epoch or another target cannot clear any pending state;
  prepared/unknown refresh journal remains unresolved rather than overwritten.

## Primary upstream references

- [Synapse login-as-user: bounded token, no new device, single-token logout](https://element-hq.github.io/synapse/v1.144/admin_api/user_admin_api.html#login-as-a-user).
- [Matrix exact app/pushkey pusher update/removal](https://spec.matrix.org/v1.16/client-server-api/#post_matrixclientv3pushersset).

These describe upstream capability, not proof that a new COP cleanup endpoint is
implemented, deployed, or accepted on the owner's phone.
