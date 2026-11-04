import Foundation

let account = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
let vehicle = UUID(uuidString: "00000000-0000-4000-8000-000000000002")!
let operation = UUID(uuidString: "00000000-0000-4000-8000-000000000003")!
let request = CSMSharedVehicleConversationRequest(operationId: operation, expectedMembershipRevision: 3)
let base: [String: Any] = [
    "contractVersion": "cop-shared-vehicle-communication-v1", "confirmed": true,
    "operationId": operation.uuidString, "accountId": account.uuidString, "vehicleId": vehicle.uuidString,
    "membershipRevision": 3, "conversationId": "conv_vehicle", "roomId": "!vehicle:synthetic.example",
    "scope": "shared_vehicle", "historyPolicy": "from_membership", "revocation": "server_enforced",
    "serverTimestamp": "2026-11-04T10:00:00.123Z"
]
func decode(_ value: [String: Any]) throws -> CSMSharedVehicleConversationReceipt {
    try JSONDecoder().decode(CSMSharedVehicleConversationReceipt.self, from: JSONSerialization.data(withJSONObject: value))
}
let receipt = try decode(base)
precondition(receipt.matches(accountId: account, vehicleId: vehicle, request: request))
precondition(!receipt.matches(accountId: UUID(), vehicleId: vehicle, request: request))
precondition(!receipt.matches(accountId: account, vehicleId: UUID(), request: request))
precondition(!receipt.matches(accountId: account, vehicleId: vehicle, request: .init(operationId: UUID(), expectedMembershipRevision: 3)))
precondition(!receipt.matches(accountId: account, vehicleId: vehicle, request: .init(operationId: operation, expectedMembershipRevision: 4)))
for (key, value) in [("confirmed", false as Any), ("roomId", "room" as Any), ("conversationId", "" as Any), ("serverTimestamp", "invalid" as Any)] {
    var changed = base; changed[key] = value
    let altered = try decode(changed)
    precondition(!altered.matches(accountId: account, vehicleId: vehicle, request: request))
}
for key in ["contractVersion", "scope", "historyPolicy", "revocation"] {
    var changed = base; changed[key] = "unsupported"
    do { _ = try decode(changed); fatalError("unsupported enum accepted") } catch {}
}
let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
precondition(Set(encoded.keys) == Set(["operationId", "expectedMembershipRevision"]))
print("Shared vehicle communication DTO isolation and late-receipt checks passed")
