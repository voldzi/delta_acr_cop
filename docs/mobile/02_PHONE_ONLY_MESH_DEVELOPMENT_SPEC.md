# Phone-Only Mesh Communication for COP Mobile
## Status

Development specification for a controlled technology pilot. The production
feature remains disabled until the security, interoperability and field-test
gates in this document pass.

## Objective

COP Mobile shall exchange short, security-relevant messages between nearby
iPhone and Android devices when cellular service, internet access and local
Wi-Fi infrastructure are unavailable. A person shall need only a supported
phone with COP Mobile installed; LoRa or another external radio is not required
for the primary mode.

The feature is an opportunistic, delay-tolerant communication path. It is not a
guaranteed replacement for public mobile networks, TETRA or satellite
communications. Delivery depends on device proximity, application runtime,
battery state, operating-system policy and the presence of a path through other
COP devices.

## Product Scope

### Pilot payloads

- short direct and group text messages;
- SOS and safety alerts;
- location and small structured status payloads;
- delivery and expiry acknowledgements;
- compact gateway control messages.

### Deferred payloads

- compressed thumbnails;
- short voice notes;
- large structured reports.

### Out of scope

- live voice or video calls over multiple relay hops;
- full Matrix timeline synchronization over the nearby network;
- map tiles, arbitrary files or large media;
- anonymous automatic trust of every nearby device;
- continuous guaranteed operation after force-quitting the application;
- covert background operation;
- replacing central COP, Matrix, CSM Messaging or the authoritative audit log.

## Terminology

| Term | Meaning |
| --- | --- |
| nearby link | One authenticated connection between two nearby COP devices |
| relay | A COP device that durably stores and forwards an eligible envelope |
| gateway | A COP device or managed node that can deliver an envelope to central COP |
| phone-only mesh | The application-level store-carry-forward graph created from nearby links |
| central delivery | Acceptance by the authoritative COP/messaging backend, not merely by a nearby peer |
| emergency mesh mode | Explicit user session that increases nearby discovery and relay activity |

## Current COP Baseline

COP already exposes:

```http
POST /api/v1/mobile/mesh/ingest
GET /api/v1/mobile/mesh/acks
```

These endpoints accept only encrypted and signed `csm-mesh-v1` bundles and
provide an idempotent central ACK boundary. COP also has a file-backed edge
outbox and central replay contract. Neither component discovers phones, creates
nearby links or routes packets between devices.

The phone-only feature shall reuse the central ACK boundary after a gateway
regains internet access. It shall not send the existing JSON API representation
over the radio link.

## Platform Capability Matrix

Capabilities are detected at runtime. OS version or device model alone must
never be treated as proof that a transport is usable.

| Platform | Preferred transport | Fallback | Notes |
| --- | --- | --- | --- |
| iPhone 12+ with supported iOS | Apple Wi-Fi Aware + Network framework | Nearby Connections, then bounded BLE | Wi-Fi Aware is the preferred high-throughput path |
| iPhone 11 and unsupported Apple devices | Nearby Connections | bounded BLE or Apple-only peer-to-peer Wi-Fi adapter | No Wi-Fi Aware assumption |
| Android with Wi-Fi Aware | Android Wi-Fi Aware | Nearby Connections | Hardware support varies; check at runtime |
| Android without Wi-Fi Aware | Nearby Connections | bounded BLE | Google Play services availability must be checked |

Apple Wi-Fi Aware requires the `com.apple.developer.wifi-aware` entitlement,
declared Publish/Subscribe capabilities and services, physical-device testing
and explicit system pairing. The app must use `WACapabilities` before offering
the transport. Android must check `FEATURE_WIFI_AWARE` rather than relying on
the API level.

## Architectural Principles

1. The chat domain does not depend on a particular nearby framework.
2. Every outbound message enters one durable outbox before any transport runs.
3. Every envelope has one stable identifier across retries, relays and gateways.
4. Link encryption does not replace COP application-level encryption and
   signatures.
5. A nearby-peer receipt is not presented as final delivery.
6. Internet, Wi-Fi Aware, Nearby Connections and future external-radio
   transports are adapters behind one interface.
7. The central server remains the source of truth after connectivity returns.
8. Relays learn only the metadata needed for policy, routing, expiry and
   deduplication.
9. Background behavior is best effort and is never represented as guaranteed.
10. Safety traffic is bounded, prioritized and protected against broadcast
    storms.

## Target Components

### `NearbyMeshCoordinator`

Owns the user-visible mesh session and combines capability, power, permission,
transport and peer states. It contains no message timeline logic.

### `NearbyTransport`

Common interface implemented by:

- `AppleWiFiAwareTransport`;
- `GoogleNearbyTransport`;
- `BoundedBluetoothTransport`;
- test and simulation transports.

The interface supports discovery, authenticated connection establishment,
bounded frame exchange, path metrics and lifecycle events. It does not decide
which messages to relay.

### `MeshOutboxActor`

Encrypted, durable, per-account storage for outbound and relayed envelopes. It
must survive process termination and device restart. It owns retry timing,
expiry, priority and storage quotas.

### `MeshRelayEngine`

Runs deterministic anti-entropy synchronization after a nearby connection is
authenticated:

1. exchange compact inventories;
2. determine missing eligible envelopes;
3. transfer high-priority envelopes first;
4. persist before acknowledging peer storage;
5. record the receipt;
6. stop at quotas, expiry or policy boundaries.

### `MeshIdentityStore`

Maps a locally protected device key to the COP account, registered mobile
device and organization scope. Private keys use Secure Enclave/Keychain on
Apple platforms and hardware-backed Android Keystore where available.

### `MeshGatewayAdapter`

Selects locally stored envelopes eligible for central submission, transforms
them into the server `csm-mesh-v1` boundary and reconciles server ACKs. It does
not decrypt conversation content.

### `MeshPolicyEngine`

Evaluates classification, organization, conversation membership, payload type,
priority, hop limit, expiry, revocation state and relay permission before every
offer and acceptance.

## Logical Flow

```text
Chat composer
    |
    v
Durable MeshOutboxActor
    |
    +---- internet available ----> central COP / messaging
    |
    +---- nearby transport ------> peer durable outbox
                                      |
                                      +---- another nearby peer
                                      |
                                      +---- gateway -> central COP
```

An online send and a nearby send use the same logical message identifier. A
late online retry must not create a second timeline event after a gateway
already submitted the message.

## Wire Contracts

### Nearby frame

The phone-to-phone link uses a compact binary, length-prefixed protocol named
`csm-nearby-v1`. JSON, Matrix events and OpenAPI payloads are prohibited on this
link.

Required frame families:

- protocol and capability negotiation;
- ephemeral challenge and device proof;
- inventory summary and explicit missing-ID request;
- envelope fragment;
- peer durable-storage receipt;
- gateway/central receipt;
- flow control, error and graceful close.

All frames include a protocol version. Unknown mandatory capabilities fail
closed; unknown optional capabilities are ignored.

### Envelope metadata

The final binary layout is specified and test-vector controlled before
implementation. The logical fields are:

| Field | Purpose |
| --- | --- |
| `envelopeId` | globally stable, random identifier |
| `protocolVersion` | decoding and migration |
| `senderDeviceKeyId` | signed device identity reference |
| `conversationId` | opaque scoped destination reference |
| `createdAt` / `expiresAt` | replay and retention bounds |
| `priority` | normal, urgent, SOS |
| `payloadType` | text, location, control, manifest |
| `hopLimit` | maximum relay count |
| `relayCount` | current relay count |
| `cipherSuite` / `keyId` | application encryption profile |
| `ciphertext` | opaque encrypted content |
| `signature` | sender authenticity and integrity |

Mutable relay metadata must not be covered by the sender signature in a way
that requires relays to possess signing authority. The immutable content and
security header must be signed.

### Payload limits

Initial limits:

| Payload | Maximum encrypted size |
| --- | ---: |
| control / ACK | 2 KiB |
| location / status | 4 KiB |
| text | 16 KiB |
| manifest | 16 KiB |
| all envelope fragments combined | 64 KiB |

These are policy maxima, not targets. Normal messages should remain far
smaller. Media uses a deferred manifest and transfers only when both peers
advertise the required capability and power/network policy permits it.

## Routing and Deduplication

The pilot uses controlled epidemic store-carry-forward routing:

- stable `envelopeId` deduplicates all paths;
- default hop limit is 4, configurable by signed server policy;
- default lifetime is 24 hours, shorter for volatile location;
- SOS may use a higher hop limit and longer retention;
- a device never immediately returns an envelope to the peer from which it was
  received;
- per-peer and global rate limits prevent reconnect storms;
- relay storage has quotas by organization, conversation and priority;
- expired or revoked envelopes are removed without being forwarded;
- central acceptance terminates normal propagation after the receipt reaches a
  relay, subject to a bounded grace period.

The pilot may exchange explicit recent-ID inventories. Before production, large
inventories shall use a compact anti-entropy structure plus explicit protection
for SOS IDs so that probabilistic false positives cannot suppress safety
traffic.

## Delivery State Model

The UI and audit model distinguish transport progress:

| Internal state | User meaning |
| --- | --- |
| `localQueued` | Uloženo v telefonu |
| `peerStored` | Předáno okolnímu zařízení |
| `meshRelayed` | Šíří se nouzovou sítí |
| `gatewayAccepted` | Převzala brána COP |
| `centralAccepted` | Doručeno do COP |
| `recipientDelivered` | Doručeno příjemci |
| `read` | Přečteno |
| `expired` | Platnost vypršela |
| `rejected` | Nelze předat podle bezpečnostních pravidel |

`peerStored` and `meshRelayed` must never render with the same checkmark or
wording as `centralAccepted` or `recipientDelivered`.

## Identity, Trust and Cryptography

### Enrollment

1. An online COP session creates or activates a device signing key.
2. COP registers the public key against the account, device and organization.
3. The server returns a signed, time-bounded device credential and permitted
   mesh scopes.
4. The client stores private key material in platform-protected storage.
5. Offline peers validate the credential against cached COP trust anchors and
   revocation material.

The exact algorithm suite is selected in a separate reviewed security profile.
Apple Secure Enclave P-256 and Android hardware-backed equivalents are
preferred where interoperable. Algorithm agility is mandatory.

### Pairing and groups

- Wi-Fi link pairing establishes link trust only.
- COP conversation and organization authorization remains application-level.
- Service advertisements contain opaque, rotating identifiers, never names,
  email addresses, Matrix IDs or plaintext conversation identifiers.
- Pre-provisioned organization/group trust is preferred for emergency use.
- QR pairing may create a short-lived local incident group.
- Unknown devices are not auto-trusted merely because they run COP Mobile.

### Revocation

The client caches signed revocation updates while online. A revoked or expired
device cannot originate new accepted envelopes. Previously stored envelopes
follow explicit incident-retention policy. A maximum offline credential age is
defined before production so that indefinite offline use cannot bypass
revocation.

### Content protection

Wi-Fi Aware and Nearby Connections link encryption is defense in depth. Message
content remains encrypted end to end for the intended COP conversation.
Relays must not receive plaintext. Logs contain identifiers, sizes, timing,
transport and result only.

## iOS Lifecycle and Background Policy

- Build the preferred transport with the current Network and Wi-Fi Aware
  frameworks, not deprecated Multipeer Connectivity.
- Check Wi-Fi Aware capabilities at runtime.
- Request local-network, Bluetooth and pairing permissions only in context.
- The normal app mode performs opportunistic short sync when the app is active.
- Emergency mesh mode is explicitly started and stopped by the user and clearly
  displays battery and privacy impact.
- BackgroundTasks and system-granted runtime are used for bounded maintenance;
  they are not treated as permanent execution.
- Relaunch, suspension, force-quit, Low Power Mode, thermal pressure and lost
  permissions are first-class test cases.
- A Live Activity may present an active emergency session, but must not be used
  to claim or simulate unrestricted background execution.

## Android Lifecycle

- Check Wi-Fi Aware hardware support at runtime.
- Use Nearby Connections where Wi-Fi Aware is unavailable or cross-platform
  interoperability fails.
- Handle Google Play services absence explicitly.
- Foreground service use requires a visible, user-initiated emergency session
  and compliance with current Android policy.
- Doze, battery optimization, permission revocation and OEM background limits
  are test cases, not exceptional conditions.

## User Experience

### Entry points

- Chat continues to be the primary surface.
- Mesh transport selection is automatic.
- A separate “Nouzová komunikace” control shows availability and allows the
  user to start a higher-reliability emergency session.
- First use explains proximity, battery, background and delivery limitations.

### Status surface

Show:

- internet availability;
- nearby transport selected;
- number of authenticated nearby COP devices;
- whether a path to a gateway was recently observed;
- last successful nearby synchronization;
- battery impact and active emergency-session state.

Do not show framework names, radio diagnostics or technical errors in the
normal workflow. Administrator detail remains available in a redacted
diagnostic view.

### Safety behavior

- SOS is always confirmed by the sender before broadcast unless an approved
  one-action policy applies.
- The UI displays whether SOS is only local, held by peers or accepted
  centrally.
- Expired, rejected and undeliverable messages remain visible with a
  comprehensible explanation and retry options.
- The user can delete locally queued non-safety content, subject to audit
  policy.

## Central and Edge Integration

The gateway:

1. authenticates normally to COP;
2. submits encrypted, signed envelopes through
   `POST /api/v1/mobile/mesh/ingest`;
3. retains the local envelope until a terminal server ACK or expiry;
4. polls or receives ACK reconciliation;
5. emits compact receipts back into the nearby network;
6. materializes a message into the canonical messaging workflow exactly once.

The existing endpoint currently records metadata and acceptance only. Before
end-user messaging is enabled, the backend contract must define the authorized
handoff into the canonical conversation and its exactly-once mapping. Any API
change updates `openapi/openapi.json` and the generated YAML export.

`cop-edge-node` remains a central/edge synchronization process. A later managed
gateway adapter may run beside it, but phone relays do not become authoritative
edge nodes.

## Observability

Required aggregate metrics:

- discovery success and time to first authenticated peer;
- connection success by transport and device capability;
- envelopes offered, stored, deduplicated, expired and rejected;
- time to first peer storage and central acceptance;
- hop-count distribution;
- outbox size and oldest-item age;
- background wake and sync completion rates;
- battery and thermal impact in controlled tests;
- gateway reconciliation failures.

Metrics must not include plaintext, exact user location, conversation title or
contact names. Correlation uses rotating, scoped identifiers.

## Performance and Reliability Gates

| Scenario | Pilot gate | Production target |
| --- | ---: | ---: |
| local enqueue | p95 under 100 ms | p95 under 75 ms |
| discover an already active nearby peer | p95 under 8 s | p95 under 5 s |
| deliver 1 KiB to one connected peer | p95 under 2 s | p95 under 1 s |
| duplicate timeline entries after multi-path delivery | 0 | 0 |
| lost durable messages after process restart | 0 | 0 |
| SOS suppressed by inventory false positive | 0 | 0 |
| central materialization for one envelope | exactly once | exactly once |
| main-thread hang | none at or above 250 ms | none at or above 250 ms |

Background delivery is reported as a measured distribution by device/OS state,
not promoted as a guaranteed percentage until field evidence supports it.

## Test Matrix

### Devices

- iPhone 11 fallback path;
- iPhone 12 minimum Wi-Fi Aware generation;
- current iPhone generation on iOS 26;
- current iPhone generation on iOS 27;
- at least three Android vendors with and without Wi-Fi Aware;
- Android device without Google Play services if it remains in supported scope.

### Topologies

- two devices;
- four-device fully connected group;
- line A-B-C-D where A and D cannot connect directly;
- two separated groups joined later by a moving relay;
- one internet gateway;
- two competing gateways;
- gateway loss and recovery.

### Lifecycle

- foreground;
- locked screen;
- background;
- force-quit;
- Low Power Mode / Doze;
- application and phone restart;
- permission revoked during a session;
- Wi-Fi or Bluetooth toggled;
- clock skew;
- full local storage;
- expired device credential.

### Security and abuse

- unknown and revoked device;
- forged sender;
- modified ciphertext;
- replayed envelope;
- duplicate paths;
- oversized and fragmented payload;
- inventory flood;
- connection churn;
- invalid organization/group scope;
- compromised gateway attempting to alter content.

### Interoperability

- iOS to iOS over Wi-Fi Aware;
- Android to Android over Wi-Fi Aware;
- iOS to Android over Wi-Fi Aware;
- iOS to Android over Nearby Connections;
- fallback negotiation when preferred transport fails;
- upgrade where peers run adjacent protocol versions.

Wi-Fi Aware tests run on physical devices; Simulator is not an acceptance
environment.

## Delivery Phases

### Phase 0 — capability spike

- obtain and validate Apple Wi-Fi Aware entitlement;
- demonstrate iPhone-to-iPhone and iPhone-to-Android transfer;
- measure foreground and background behavior;
- verify iPhone 11 fallback;
- decide whether native Wi-Fi Aware interoperability is sufficient or Google
  Nearby remains required.

Exit: documented measurements and an explicit go/no-go.

### Phase 1 — secure one-hop pilot

- device identity and enrollment;
- common transport interface;
- durable outbox;
- one-hop text/location exchange;
- correct user-visible delivery states;
- no central materialization.

Exit: two platforms exchange signed encrypted messages without duplicates
across restart.

### Phase 2 — multi-hop store-carry-forward

- relay engine and anti-entropy;
- expiry, quotas, priorities and SOS;
- four-device and moving-relay tests;
- redacted diagnostics and metrics.

Exit: A-B-C-D delivery works repeatedly with A and D out of direct range.

### Phase 3 — gateway and central reconciliation

- server-authorized gateway;
- exactly-once canonical message mapping;
- ACK propagation;
- edge and central observability;
- mixed online/offline retry.

Exit: one user-visible message across web, iOS and Android regardless of the
path used.

### Phase 4 — controlled field pilot

- limited organization and pre-enrolled devices;
- urban, building and rural tests;
- battery and background measurements;
- security review, threat exercise and operations runbook;
- support and incident rollback process.

Exit: production decision based on measured reliability, not laboratory range.

## Release Gates

The feature remains behind a server-controlled capability flag until:

- Wi-Fi Aware entitlement and App Store policy are confirmed;
- cross-platform interoperability is proven on the supported matrix;
- cryptographic profile and key lifecycle pass review;
- exactly-once central materialization passes contract tests;
- force-quit and background limitations are reflected honestly in UI;
- SOS has no silent-loss or false-delivery state;
- outbox storage is encrypted, bounded and recoverable;
- operational dashboards and a kill switch exist;
- privacy and retention documentation are approved.

## Open Decisions

1. Minimum supported iOS and Android versions.
2. Whether devices without Google Play services are in production scope.
3. Required offline credential lifetime and revocation freshness.
4. Whether unknown nearby COP organizations may relay opaque envelopes.
5. Maximum storage contribution for relay traffic.
6. Final binary encoding and cryptographic algorithm profile.
7. Whether media manifests are included in the first field pilot.
8. Foreground-only versus user-activated emergency background policy.

## Authoritative External References

- [Apple Wi-Fi Aware](https://developer.apple.com/documentation/WiFiAware)
- [Apple: Connecting devices for peer-to-peer Wi-Fi](https://developer.apple.com/documentation/wifiaware/connecting-paired-devices)
- [Apple: Adopting Wi-Fi Aware](https://developer.apple.com/documentation/WiFiAware/Adopting-Wi-Fi-Aware)
- [Apple: Building peer-to-peer apps](https://developer.apple.com/documentation/WiFiAware/Building-peer-to-peer-apps)
- [Apple TN3151: Choosing the right networking API](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api)
- [Google Nearby Connections overview](https://developers.google.com/nearby/connections/overview)
- [Google Nearby Connections strategies](https://developers.google.com/nearby/connections/strategies)
- [Android Wi-Fi Aware](https://developer.android.com/develop/connectivity/wifi/wifi-aware)

## Related COP Documents

- [Native iOS/iPadOS COP App](01_NATIVE_IOS_IPADOS_APP.md)
- [Offline and Edge Architecture](../architecture/09_OFFLINE_AND_EDGE_ARCHITECTURE.md)
- [CSM Messaging Integration](../integration/09_CSM_MESSAGING_INTEGRATION.md)
- [ADR-0020 Phone-Only Opportunistic Mesh](../adr/0020_PHONE_ONLY_OPPORTUNISTIC_MESH.md)
