# Source handoff to Jízda (4 November 2026)

Not production activation. The route and durable COP source projection are still
pending, as are real Synapse/E2EE/APNs acceptance and controller provisioning.

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
