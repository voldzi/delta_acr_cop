# COP Device Bridge Protocol 1.0.0

## Boundary

The bridge is a local, untrusted boundary between the COP web main frame and a
native host. JSON Schema in `packages/cop-device-contract/schemas` is the wire
authority. TypeScript interfaces are developer ergonomics and do not replace
runtime validation at either side.

## Handshake

1. Web sends `hello` with a request UUID, supported semantic versions, web build
   ID and timestamp.
2. Native verifies the current main frame and exact origin.
3. Native replies with matching ID and either `ready` or `blocked`.
4. `ready` selects `1.0.0`, creates a random session UUID and returns
   capabilities and negotiated limits.
5. Reload, main-frame navigation or origin change invalidates the session and
   foreground subscriptions.

The Phase 1 baseline limit is 64 KiB per JSON message and a negotiated request
timeout. Binary data is never a bridge message.

## Envelopes

Requests contain `kind`, `protocolVersion`, UUID `id`, `sessionId`, method,
timestamp and object `params`. Responses correlate the same request/session and
contain exactly one of `result` or a sanitized error. Events use an event UUID,
session, monotonically increasing sequence, type, occurrence time and payload.

The native adapter ignores responses and events for stale sessions, correlates
each response once, enforces timeout and discards duplicate/out-of-order event
sequences.

## Stable error codes

The v1 set is defined in the contract package and includes unsupported,
permission, invalid request/state, origin/main-frame, protocol/session, timeout,
cancellation, lifecycle, transport/size/queue, asset, rate-limit and internal
errors. Messages must be safe to display. Details may contain only bounded
scalar diagnostics and must not contain paths, tokens, exact location or file
content.

## Native transport installation

The iOS feasibility host will install a main-frame transport object before COP
initializes. It has only:

```ts
postMessage(message: BridgeOutboundMessage): void
subscribe(listener: (message: unknown) => void): () => void
```

The host must deliver structured data to the callback. It must not interpolate
untrusted JSON into executable JavaScript. Presence of this object selects the
native adapter; otherwise COP uses the browser adapter. Platform names and user
agents are never selection criteria.

## Security requirements for Phase 2

- exact scheme/host/port allowlist, no wildcard or suffix matching;
- main-frame check at registration and for every request;
- schema validation, message size limit, method allowlist and per-method
  authorization;
- duplicate request-ID suppression and session invalidation on navigation;
- redacted logging without payloads for sensor samples, assets or credentials;
- no bridge on login, error, external or embedded origins;
- no arbitrary URL upload/navigation capability.

Phase 1 supplies schemas, SDK and fixtures. These host controls are acceptance
criteria for the iOS feasibility implementation, not claims about current code.
