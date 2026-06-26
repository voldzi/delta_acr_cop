# ADR-0011: Shared Messaging Workspace Package

## Status

Accepted

## Context

`cop-chat` and `cop-web` both depend on the same Matrix messaging client,
runtime unread bridge and chat iframe wire contract. Previously these modules
lived under `apps/cop-web/src/messaging`, while `cop-chat` imported them through
deep relative paths and manually included `cop-web` files in its TypeScript
configuration.

That made builds fragile, coupled the standalone chat application to the web
client source tree and made further chat performance work harder to test.

## Decision

Move the shared Matrix client, runtime bridge and messaging types into the
workspace package `@cop/messaging`.

Applications import shared messaging code through package exports:

- `@cop/messaging/matrixClient`
- `@cop/messaging/runtime`
- `@cop/messaging/bridge`
- `@cop/messaging/types`

The package owns the browser Matrix session abstraction and the same-origin
chat/web bridge payloads. COP API REST wrapper functions remain in
`apps/cop-web/src/cop-data.ts` for now.

## Consequences

- `cop-chat` no longer imports implementation files from `cop-web/src/messaging`.
- Messaging tests can run at the package boundary.
- Future iOS/web contract and Matrix SDK changes have a clearer owner.
- Further extraction can move API client types or higher-level chat state into
  dedicated packages without another deep-import migration.

## Alternatives Considered

- Keep deep relative imports: rejected because it preserves fragile app-to-app
  coupling.
- Duplicate messaging code in both apps: rejected because E2EE behavior, unread
  bridge payloads and Matrix recovery semantics must remain identical.
- Move all `cop-data` REST helpers immediately: deferred because it is a wider
  API-client refactor and not required for this chat performance step.
