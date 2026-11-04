# Source handoff to Jízda (4 November 2026)

Not production activation. COP route and durable source projection are implemented
in a source candidate. Real isolated Synapse/SDK E2EE phased acceptance has passed;
live COP, APNs, physical device and controller provisioning remain separate gates.
For current evidence and typed mutation202 semantics see ../../36_SHARED_VEHICLE_COMMUNICATION.md.

Apply only after checking every original file against
`native-membership-baseline-sha256.json`. Apply the candidate patch to the SDK
root; add the DTO and facade Swift files to `Sources/CSMCommunicationKit/`.
Do not import `main.swift` into the package. No package version upgrade is needed.
The patch adds a native protocol, edits four core files and adds two tests to the
existing draft test file. It does not change GPS, personal DMs or direct calls.

Facade:

- requestSharedVehicleConversation(vehicleId:request:expectedScope:) returns
  a fresh validated receipt or typed joinRequired(pending). It never selects.
- acceptSharedVehicleConversationInvitation(pending:expectedScope:) revalidates
  context, explicitly accepts only the mapped current invite and obtains a fresh
  receipt. It never selects.
- selectSharedVehicleConversation(receipt:expectedScope:) revalidates the receipt
  and server mapping, requires actual native joined membership and then selects.
  Managed native room lookup never falls back to generic join.

The existing generic invite join loop conservatively excludes service-owned
`#cop.vehicle.` room aliases; an alias is never used as an authority grant.
Messaging must prove the canonical alias and service-controlled power policy.

A server-owned recipientEpoch is captured in the encrypted draft journal.
Different/missing epoch blocks resume, rebind and live-echo confirmation for that
journal. The original record remains stored; no text/history is deleted. An
untracked transport cannot send managed-group messages. This client guard does
not claim to recall SDK transactions already handed off or to prove SDK Megolm
key sharing; actual native acceptance remains a separate gate.

The candidate was applied only to a private copy of Jízda's current SDK. A full
CSMCommunicationKit-Package iOS Simulator build passed with the already resolved
MatrixRustSDK26.09.17/LiveKit2.17.0 dependencies.23 MatrixDraftSubmissionTests passed,
including audience-change retention/no replay and journal epoch rebinding.
Original Vendor, resolved checkouts and previous DerivedData were not modified.
A new dedicated synthetic simulator was used. No TestFlight upload or phone test.

## Required follow-up: fresh audience authority (patch2)

Apply `fresh-audience-authority-v2.patch` only after checking its five baseline
hashes. These are the c78169a overlay, not the original unmodified Vendor.
It also adds ManagedVehicleAuthorityTests.swift, which must not already exist.
The original candidate patch alone is insufficient to authorize a new send:
its cached Conversation and journal can agree while both are stale.

The follow-up requires an injected ManagedVehicleAudienceChecking before each
new managed draft handoff and replay. Missing checker, outage, stale authority
or account/configuration change denies handoff and preserves the pending journal.
The production factory injects COPManagedVehicleAudienceChecker: it obtains a
fresh own-actor/native identity mapping, then uses the existing scoped-token
fence for a fresh COP conversation request. Only HTTP200 exact ready receipt,
matching source membership revision/recipientEpoch/conversation/room and own
native identity can pass.202/409/429/503 never grant sending and are not retried.
Both checks use an ephemeral no-cache/no-cookie/no-redirect HTTPS transport.
This reuses a token-fencing primitive named VoiceOutboundScope; no call is made
or authorized and ordinary messages/calls/GPS retain their existing paths.

Actual isolated simulator evidence:31 tests passed:27 MatrixDraftSubmissionTests
and4 production-checker tests over an intercepted synthetic HTTP transport.
Cases include stale Conversation plus stale journal against changed server
state, missing checker, outage, account change during the awaited check, wrong
native actor and pending/rate-limit/server errors. These are not live COP or
actual Megolm decryption acceptance. The production COP route, durable projection
and lifecycle integration must exist and pass before the hidden UI is enabled.

The fresh check linearizes at server verification. It does not recall a
transaction already handed off to the Rust SDK/Matrix server or a notification
already handed off to APNs, and must not be described as doing so.
