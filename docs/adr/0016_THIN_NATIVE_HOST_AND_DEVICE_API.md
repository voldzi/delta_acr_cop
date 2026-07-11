# ADR-0016: Thin Native Host and COP Device API

## Status

Accepted

## Context

COP already has a production web/PWA client and mobile-oriented REST endpoints.
Building a second, fully native map, chat and reporting client would duplicate
business logic, authorization behavior and release work. Browser APIs also
cannot reliably provide every required field capability, especially durable
background tracking, heading and attitude, share-extension inboxes, native
notification lifecycle and future device relay experiments.

The existing native iOS/iPadOS guide predates the thin-host decision and remains
useful only as documentation of the current mobile REST endpoints.

## Decision

COP keeps the web client as the single owner of product UI and business
workflows. A separate COP Mobile repository will implement an iOS/iPadOS 26+
thin native host around that web application. Android may later implement the
same contract.

The main COP repository is authoritative for two versioned workspace packages:

- `@cop/cop-device-contract` owns JSON Schema, TypeScript wire types and shared
  valid/invalid fixtures;
- `@cop/cop-device-sdk` exposes one capability-based `CopDevice` interface with
  browser, native and deterministic mock adapters.

The web selects an adapter from an explicitly installed transport, not from the
user agent. Native bridge activation, origin and main-frame enforcement remain
host responsibilities. The bridge transfers bounded structured data and opaque
asset handles; it never transfers file paths, binary/base64 content, an APNs
token or a web access/refresh token.

Bridge protocol `1.0.0` uses a handshake followed by session-bound
request/response/event envelopes. Existing COP REST endpoints and response
shapes are unchanged by this decision.

## Consequences

- Browser/PWA behavior remains available without the native host; unsupported
  native-only features are represented explicitly.
- Web UI can be tested against denied, unsupported and temporarily unavailable
  states before the iOS implementation exists.
- The mobile repository must consume a pinned contract artifact and run the
  same fixtures against Swift decoders/validators.
- Changes that break the bridge require a new major protocol version and a
  compatibility plan for independently deployed web and native builds.
- Push registration tickets, native sensors, media handoff and relay remain
  later phases; their presence in the namespace is not a claim that they are
  implemented.

## Alternatives Considered

- A fully native COP client was rejected because it duplicates the established
  web application and creates two sources of product truth.
- Ad-hoc JavaScript handlers were rejected because they lack shared schemas,
  compatibility negotiation and deterministic degraded-state testing.
- User-agent branching was rejected because platform identity does not prove a
  capability or permission state.
