# ADR 0024: VCode-owned COP Mobile identity

- Status: Accepted
- Date: 2026-09-22

## Context

The initial native contract used the legacy Apple team `LM6W548X36` and bundle
ID `cz.zeleznalady.csm.messenger`. COP Mobile is moving to the maintainer-owned
Apple team before its first public release. The Device API and Universal Links
bind the native application to an exact bundle/team identity.

## Decision

COP accepts `cz.voldzi.copmobile` as the iOS bundle ID and publishes
`MC3RPR926P.cz.voldzi.copmobile` in its AASA document. The OpenAPI contract,
runtime validation, web build default and deployment configuration use the same
values. The change is coordinated with COP Mobile and CSM Messaging; production
configuration must not mix old and new identities.

## Consequences

- Existing legacy development builds no longer satisfy the current Device API
  identity check.
- A rollback requires restoring the API bundle ID, AASA app ID and Messaging
  APNs topics together.
- A new APNs key owned by `MC3RPR926P` is required for notification and VoIP
  acceptance tests.
