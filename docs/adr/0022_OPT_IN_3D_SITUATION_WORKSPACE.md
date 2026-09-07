# ADR-0022: Opt-in 3D Situation Workspace

## Status

Accepted, 2026-09-07

## Context

COP needs a spatial overview that can make altitude, trajectories and geographic
context easier to understand without slowing the primary public map. The open
source [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) project
demonstrates useful interaction patterns: a separately activated globe, bounded
live contacts, explicit tracking, shareable camera state and honest distinction
between observations and estimates.

Its MIT license covers the source code, while its bundled models and third-party
datasets keep separate terms. COP must also preserve its own provider contracts,
access control, provenance and civil-purpose product boundary.

## Decision

1. COP provides `/globe` as an explicitly activated, lazy-loaded workspace.
   Opening the normal map does not fetch Cesium code or globe data.
2. The workspace is implemented independently with CesiumJS. No God's Eye View
   source, assets, credentials, provider adapters or third-party datasets are
   copied into COP.
3. The browser reads only the existing COP API. Provider credentials and direct
   provider endpoints remain server-side.
4. The default base layer is OpenStreetMap imagery with attribution. Optional
   commercial photorealistic providers are not enabled by this decision.
5. Device capability selects a balanced, limited or unsupported presentation.
   Object count, refresh frequency, labels and retained history are bounded.
6. A track is labelled `observed`, `estimated` or `stale`. Dead reckoning may
   bridge at most 20 seconds and must never be presented as a new observation.
7. Only the selected object receives a persistent label. Share links serialize a
   versioned, validated camera, layer and selected-object state.
8. User camera input owns navigation until a later explicit selection or restore
   action. An older asynchronous request cannot take control back.
9. Cesium and its static runtime assets have separate release budgets. The main
   app shell retains its existing compressed-size budget.

## Consequences

- Most users keep the faster and simpler 2D public experience.
- Operators can inspect height and trajectories without creating a second data
  or authorization path.
- The Cesium engine remains a large optional download and needs its own cache and
  compatibility monitoring.
- Photorealistic tiles, cinematic effects, voice control and third-party global
  feeds are outside this decision. They need separate privacy, licensing,
  accessibility, capacity and provider-term review.

## Verification

- Unit tests cover capability fallback, share-state validation, bounded history,
  observed/estimated/stale state and navigation ownership.
- `pnpm check:release` enforces separate shell, 3D workspace and Cesium budgets.
- Visual release checks cover `/`, `/globe`, narrow phone width, reduced motion
  and unsupported WebGL behavior.

## Related documents

- [Frontend architecture](../application/04_FRONTEND_ARCHITECTURE.md)
- [Public readiness implementation](../product/11_PUBLIC_READINESS_IMPLEMENTATION.md)
- [Observability](../observability.md)
