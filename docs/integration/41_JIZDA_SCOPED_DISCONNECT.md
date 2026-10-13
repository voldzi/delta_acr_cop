# 41. Jízda local activation and future installation revocation

Current decision on 2026-10-13: one existing COP account, `csm-mobile` and the
single login entry in Já. The separately proposed `jizda-mobile`/`jizda-cop`
OAuth provisioning is not authorized and is not required for the current local
feature choice. Its source plan is preserved only as
[historical context](../archive/2026-10-11_JIZDA_DEDICATED_CLIENT_UNLINK_PROPOSAL.md).
No Keycloak client manifest is included in this integration.

## Local feature choice

The published
[SDK 5b346c5 activation contract](https://github.com/voldzi/COP-Mobile/blob/5b346c517e7d993ad948fdd00132eefbc953352c/packages/CSMCommunicationKit/HOST_COMMUNICATION_ACTIVATION.md)
uses `CSMCommunicationActivationPolicy=explicit_host_consent`. Authentication and
routing do not implicitly start optional communication. The host hides chat,
CarPlay chat and shared features until the current account opts in; it must stop
its own voice, Dispatch and measurement producers on withdrawal. Preserve OIDC,
E2EE history, SwiftData, the COP account and COP Mobile.

The SDK removes exact known installation registration/pusher targets. Pending
removal, expired cleanup credentials or a registration whose device receipt was
lost remain pending; do not display them as server-revoked. Host integration,
voice shutdown, actual APNs/Matrix cleanup and physical acceptance are separate
gates. No such production acceptance is claimed by this source merge.

## Future server revocation

Server enforcement under the common client requires a new accepted,
installation-scoped credential/grant protocol: verified account, authenticated
binding to an installation key, proof of possession, restricted scopes,
revocation epoch and durable fences/readback across provider handoffs. A raw
bundle/header, IDFV, UUID or copied account token is not trusted app authority.
This protocol is planned, not implemented or accepted by the imported candidate.

The retained `cop-jizda-link-v1` compatibility source has its flags false and
client configuration empty. Its old adapter requires a separate verified client
and hardcodes `livePermissionsRevoked=false`; it cannot complete server unlink
and must not be enabled as the current product path. Do not set its client ID,
migrate refresh tokens or infer completion from APNs cleanup alone.

The common LiveKit participant identity remains a blocker for selective remote
revocation. Do not remove a shared subject to disconnect only Jízda. Unknown
legacy Matrix/push ownership remains unresolved rather than guessed. A request
with HTTP 202 is pending; HTTP 200 alone is insufficient without the matching
completed receipt and required actual provider proofs.

Whole COP account management/removal remains the separate
[plan 42](42_COP_ACCOUNT_REMOVAL_PLAN.md); local feature disable does not call it
or remove shared vehicles/records. The current producer boundary does not claim
to revoke another application's credentials or delete recipients' history.
