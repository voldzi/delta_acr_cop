# ADR-0020: Phone-Only Opportunistic Mesh
## Status

Accepted for a controlled technology pilot. Production enablement is subject to
the release gates in the development specification.

## Context

COP aims to preserve essential text, SOS and location communication during a
cellular or internet outage. The primary product requirement is that a person
needs only a supported iPhone or Android phone with COP Mobile installed.
External LoRa hardware may be evaluated later, but must not be required for the
first phone-only capability.

COP already has an encrypted and signed `csm-mesh-v1` central ACK boundary and
an edge outbox. It does not have nearby-device discovery, phone-to-phone links
or multi-hop relay behavior.

Apple Wi-Fi Aware provides secure, infrastructure-free peer-to-peer Wi-Fi on
supported iPhone and iPad hardware. Android offers Wi-Fi Aware on a subset of
devices. Google Nearby Connections provides an iOS/Android abstraction over
Bluetooth and Wi-Fi and covers devices where native Wi-Fi Aware is unavailable.
None of these frameworks provides COP's durable multi-hop, identity,
authorization, deduplication or central reconciliation semantics.

iOS and Android background execution remains policy-controlled. A phone-only
network therefore cannot promise permanent discovery or guaranteed delivery
when the application is suspended, force-quit or power constrained.

## Decision

- COP will implement phone-only offline communication as an application-level,
  opportunistic store-carry-forward network.
- Apple Wi-Fi Aware with the Network framework is the preferred nearby
  transport on capable Apple devices.
- Android Wi-Fi Aware is preferred on compatible Android devices.
- Google Nearby Connections is the cross-platform and legacy-device fallback.
- A bounded Bluetooth or Apple-only peer-to-peer adapter may be retained as a
  last-resort transport, but deprecated Multipeer Connectivity is not the
  foundation of the new architecture.
- Every transport is hidden behind one `NearbyTransport` contract.
- COP owns identity, authorization, application encryption, signatures,
  priority, expiry, relay limits, deduplication and exactly-once central
  materialization.
- Nearby frameworks provide links only; they do not define COP delivery.
- Every message enters a durable encrypted outbox before transmission.
- A peer durable-storage receipt, gateway acceptance, central acceptance,
  recipient delivery and read state remain distinct.
- The nearby protocol uses a compact binary `csm-nearby-v1` representation,
  never raw Matrix events or the JSON API contract.
- The current `/api/v1/mobile/mesh/*` endpoints remain the central ACK boundary.
  Canonical conversation materialization is designed and contracted before the
  feature becomes available to end users.
- Emergency mesh mode is explicit and visible. COP does not claim unrestricted
  background execution or guaranteed delivery.
- MeshCore/LoRa remains a potential future transport adapter and is not a
  dependency of the phone-only pilot.

## Consequences

### Positive

- The first pilot requires no external radio for end users.
- Modern iPhone and Android devices can use secure, high-bandwidth local links.
- Older devices can participate through capability-negotiated fallbacks.
- Chat and outbox logic remain independent of Apple or Google frameworks.
- A future LoRa, managed gateway or other radio can reuse the same envelope,
  relay and acknowledgement model.

### Negative

- Reliability depends on proximity, device density, OS runtime and battery.
- Cross-platform behavior requires a larger physical-device test matrix.
- Explicit pairing and COP trust enrollment add onboarding work.
- The application must implement and secure multi-hop relay semantics.
- Older phones such as iPhone 11 cannot use Apple Wi-Fi Aware.
- Background delivery cannot be expressed as a hard service-level guarantee.

## Rejected Alternatives

### MeshCore as the mandatory first transport

Rejected because each user would require an external LoRa companion device. It
remains valuable for later long-range deployments.

### Apple Multipeer Connectivity as the primary architecture

Rejected for a new implementation because it is Apple-only, has lifecycle
limitations and is deprecated in the current SDK.

### Google Nearby Connections as the only transport

Rejected because native Wi-Fi Aware offers a standards-based system path on
supported devices. Nearby Connections remains an important fallback.

### Treat peer receipt as delivered

Rejected because a nearby peer may never reach the recipient or central COP.

### Synchronize Matrix events directly over nearby links

Rejected because Matrix payloads, key state and timeline semantics are too
heavy and tightly coupled for a bounded opportunistic transport.

## Implementation Reference

[Phone-Only Mesh Communication for COP Mobile](../mobile/02_PHONE_ONLY_MESH_DEVELOPMENT_SPEC.md)
