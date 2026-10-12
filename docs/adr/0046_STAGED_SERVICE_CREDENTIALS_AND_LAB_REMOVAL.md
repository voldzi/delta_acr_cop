# ADR 0046: Staged service credentials and lab removal

Status: accepted for source preparation; production identities, permissions,
deployment and activation are pending separate acceptance.
Date: 2026-10-12.

## Context

Removing a shared lab credential from the public API must preserve verified
browser BFF, native clients and legitimate server callers. The existing Edge
and MCP gateway use a static central bearer. Replacing it with one short-lived
JWT would fail after expiration. A healthy Edge container does not prove COP
authentication; its readiness response is local and remains HTTP 200 when
degraded.

## Decision

Frontend Docker/Compose defaults use OIDC and an empty public lab value. The
standalone chat's development lab fallback is DEV-only. Explicit local lab
configuration remains supported; the API development defaults are separate.

Prepare a server-only `@cop/core/service-token` export for Edge/MCP. The opt-in
`oidc` mode uses Keycloak `client_credentials` with distinct configured clients,
fixed HTTPS issuer-derived endpoint, bounded exchange, no redirect, single-flight
RAM cache and renewal before expiry. It never falls back to static credentials.
The compatible `static` mode remains the default until the real migration is
accepted. An upstream 401 invalidates only the token used by that request;
POST/side effects are not automatically retried. Token-provider errors and
upstream Edge errors do not retain credentials or untrusted response text.

Keycloak's service-account flow normally supplies an access token without a
refresh token; the client obtains another access token when needed. The helper
does not store refresh tokens or create browser/user sessions.
[Keycloak service-account documentation](https://www.keycloak.org/docs/latest/server_admin/index.html#_service_accounts).

This source preparation does not provision new clients or grant permissions.
Do not use `SYSTEM_CLIENT`, `INTEGRATION_ADMIN` or `SECURITY_ADMIN` as a shortcut
for the new service principals. Existing user/integration policy remains intact.

## Scoped authorization

- Separate confidential service clients for Edge synchronization and MCP reads,
  with interactive login/direct grants disabled and no realm administration roles.
- Server-owned exact issuer, service subject and authorized-client binding,
  exact expected access-token audience and signed `cop_tenant_id` claim.
  Keep `cop-web` and `csm-mobile` in the existing allowed-client configuration;
  additions require reviewed grants and must not replace the existing list.
- Edge capability restricted to the approved installation's node: heartbeat,
  its outbox flush, its replay and its cursor acknowledgement. Bind both URL and
  body node IDs. Preserve existing classification/release-policy checks and
  prevent heartbeat metadata from raising the installation's clearance or role.
  No source registry, canonical arbitrary ingest, other nodes or general
  domain-event administrative access.
- MCP capability restricted to an explicit set of approved read tools. Review
  the data and tenant boundary of each tool; `read_only` does not mean public.
  Do not grant audit, federation, event replay or dead-letter access by default.
  Apply the same check to REST invoke and every JSON-RPC `tools/call`, including
  batches, and filter advertised tools to the actual service grant.
- Match configured service principals before evaluating broad roles; a service
  cannot escape its binding through extra token roles, forged headers or input.
  Unknown subject/client combinations fail closed.

The source implements these grants through `COP_SERVICE_AUTH_BINDINGS`, after
the global signature/issuer/expiry/client verification hook. They are not
production grants until configured and accepted. Absent/empty bindings preserve
the legacy policy; malformed configured bindings fail startup. Detection also
reserves canonicalized service subjects and service audiences so a token with
missing/different `azp` or padded subject cannot fall through to broad human
roles. Admission requires exact raw signed identity. The token provider alone
cannot authorize privileged endpoints. No new network bypass or public token
exception is part of this design.

Outbox admission validates the same normalized publication model as the handler,
including nested classification and event-type-derived channel, for every batch
member before the first state mutation. Edge cannot write AI audit, provider
health or notification channels through omitted/overridden channels. Unknown
graph clearance denies replay with 503 and no items. MCP reads use the public
data view; `cop_tenant_id` scopes the service credential grant and does not by
itself establish a new general tenant data model.

Both clients also bound the complete central response by time and bytes
(defaults 10 seconds/16 MiB), cancel unread readiness/error bodies and refuse
redirects. This fixes existing slow-body hangs and prevents 307/308 from
replaying a POST at another endpoint. Failed Edge acknowledgements remain in
the existing outbox for a later sync; MCP fails with sanitized 503 before
publishing a partial response.

## Rollout and evidence

Keep source/build verification, production deployment and production cutover
separate. First verify the token-provider exchange, renewal/concurrency,
invalid-token handling and outage behavior with synthetic credentials. Then
accept scoped API policy, approved secret destinations and real provider grants.
Deploy pinned clients while preserving every active Compose overlay. Verify
renewal over at least two token lifetimes and token-provider outage/recovery.
MCP readiness proves only its tools-registry read. Edge heartbeat/flush tests
require an explicitly owned synthetic node/event fixture; do not create real
domain writes as an authentication probe.

Verify actual read-only COP BFF and native requests without exporting tokens.
After all client proofs, switch the API to OIDC with lab disabled. Preserve
public reads, write-role gates, data and existing sessions. Repeat invalid and
anonymous denial and real positive authentication. Rollback uses recorded
images/configuration and preserves OIDC grants; automatic lab reactivation is
not a successful security rollback. The operational procedure is in
[runbook 08](../runbooks/08_KEYCLOAK_COP.md#bezpecne-odstraneni-lab-pristupu).
