# COP Device API v1

## Status and ownership

This is the current contract guide for the thin COP Mobile host. The main COP
repository owns the contract and TypeScript SDK. The separate COP Mobile
repository consumes a pinned artifact and will implement the iOS/iPadOS 26+
host; it must not create a competing source of truth.

Phase 1 adds no REST endpoint and changes no existing REST response shape.

## Packages

| Package                        | Responsibility                                                  |
| ------------------------------ | --------------------------------------------------------------- |
| `packages/cop-device-contract` | Protocol `1.0.0` types, JSON Schema and cross-platform fixtures |
| `packages/cop-device-sdk`      | `CopDevice` interface plus browser, native and mock adapters    |

The contract artifact includes `schemas/` and `fixtures/v1/`. The fixture
manifest records the schema and expected validity of each example. Swift and
future Kotlin CI must execute the same cases.

## Capability model

The web asks `system.getCapabilities()` and renders behavior from the returned
state. It does not inspect the user agent. Each namespace reports:

- availability: `supported`, `unsupported`, `experimental`, `restricted` or
  `temporarilyUnavailable`;
- current permission: `notDetermined`, `denied`, `restricted`, `granted`,
  `limited` or `unavailable`;
- whether background execution is supported, whether foreground is required,
  and human-readable limitations.

Permission denial is not the same as an unsupported capability. A temporarily
unavailable service may be retryable; an unsupported service is not.

## Namespaces

| Namespace       | v1 methods                                                  | Phase 1 behavior                                                |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| `system`        | capabilities, app info, device state                        | all adapters                                                    |
| `permissions`   | status, explicit request, open settings                     | browser subset; native proxy; mock                              |
| `location`      | current location, foreground updates                        | browser geolocation; native proxy; mock                         |
| `heading`       | foreground heading updates                                  | native proxy and mock; browser unsupported                      |
| `attitude`      | foreground quaternion/orientation updates                   | native proxy and mock; browser unsupported                      |
| `tracking`      | durable session start/read/stop                             | native proxy and mock; browser unsupported                      |
| `connectivity`  | path state and monitoring                                   | browser online/offline baseline; native proxy; mock             |
| `media`         | camera/pickers and opaque assets                            | native proxy and mock; browser unsupported in Device API        |
| `shares`        | list/claim/discard native inbox items                       | native proxy and mock; browser unsupported                      |
| `notifications` | state, authorization, local scheduling, remote registration | browser status/request subset; native proxy; mock               |
| `relay`         | status/start/stop/queue                                     | disabled in browser; native proxy and mock only for future work |

The namespace surface describes stable contract boundaries, not delivery status.
Native operations remain unavailable until the iOS implementation phase.

## Measurement semantics

- Location contains measurement and receipt timestamps, accuracy, cached/live
  source, reduced-accuracy state and validity.
- Course is direction of movement and must not be substituted for heading.
- Heading identifies magnetic or true north and includes accuracy/calibration.
- Attitude uses an explicit reference frame, quaternion and roll/pitch/yaw.
- Foreground subscriptions end with a bridge session. A durable tracking
  session is native-owned and must be rediscovered after a WebView reload.

## Assets and shares

`NativeAssetRef` contains an opaque UUID, MIME type, sanitized file name, size,
SHA-256, lifecycle timestamps, source and optional image dimensions. It never
contains file paths, security-scoped URLs or binary/base64 content. Upload
handoff to the existing community attachment workflow is a later contract
change and must accept only a bounded server-issued destination.

## Web integration

`apps/cop-web/src/cop-device.ts` creates a browser adapter unless a valid native
transport is explicitly installed as `window.__COP_DEVICE_NATIVE_TRANSPORT__`.
That object is only a transport hook, not a security boundary; the native host
must still verify the main-frame origin for every message.

The account settings panel shows the active adapter and the actual state of
location, heading, attitude, tracking, media, share, notification and relay
capabilities. It does not request permissions while merely rendering status.

## Versioning

Protocol and fixture baseline is `1.0.0`:

- patch: compatible clarification or bug fix;
- minor: optional method/capability addition;
- major: incompatible envelope, method or semantic change.

The web and host must negotiate an exact supported version during handshake. No
overlap results in a controlled blocked state.
