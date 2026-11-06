# OIDC introspection client repair — observed evidence

The original terminal result remains unsuccessful and is not rewritten:
`CLIENT_READBACK_AUTHORIZATIONSERVICESENABLED`, created_confirmed, rollback not
verified. Before/attempt show the exact client absent immediately before POST.
The client was not created twice. Admin session logout and private RSA/cipher
cleanup passed; no owner token was used.

Independent diagnostics now prove the intended existing own secret is accepted
by Keycloak: invalid synthetic token → HTTP200 active=false. The actual unchanged
Messaging UserOrServiceAuth returns HTTP401 UNAUTHORIZED for the same kind of
invalid token, replacing its earlier infrastructure503. This is negative-path
transport/credential evidence, not valid-owner recovery or all-client security
acceptance. Same container/image/restartCount0 and runtime→own.env equality were
rechecked; .env predates the operation.

The running Keycloak image is exactly26.8.0. Its [GET client resource](https://raw.githubusercontent.com/keycloak/keycloak/26.8.0/services/src/main/java/org/keycloak/services/resources/admin/ClientResource.java)
uses ModelToRepresentation. That [converter](https://raw.githubusercontent.com/keycloak/keycloak/26.8.0/server-spi-private/src/main/java/org/keycloak/models/utils/ModelToRepresentation.java)
sets authorizationServicesEnabled only when an authorization resource server
exists, assigning true; it does not assign false in the other branch. Therefore
our strict required-false readback can reject a legitimately omitted field.
This source explains a possible false negative; independent authoritative
settings/resource-server and scope/role readback remains required. No original
guard was edited, no absence blindly accepted, and no further client mutation,
secret transfer, admin login or automatic retry was performed.

## Subsequent independent acceptance (not a rewrite of the failed result)

`subsequent-readonly-acceptance.sanitized.json` combines independent Jízda Keycloak
UI evidence, exact26.8.0 provider source and actual unchanged Messaging diagnostics.
The UI confirmed enabled+confidential authentication, Authorization OFF, all login
and token-grant flows OFF, no client roles/default or optional assigned scopes,
no dedicated mappers or role mappings, and Full scope allowed OFF. The dedicated
scope is inherent with assignment type None. No UI write, credentials page,
export or session-token extraction was performed.

The strict optional-field parser produced a false negative for this provider;
original result and guards remain unchanged. No client was recreated, rolled back,
rotated or modified after the original create. Authenticated credential transport
and the intended security configuration now have separate positive read-only
proof. Owner chat recovery is still a separate pending phone acceptance.
