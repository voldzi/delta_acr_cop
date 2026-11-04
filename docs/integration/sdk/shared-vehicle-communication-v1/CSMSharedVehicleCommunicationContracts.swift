import Foundation

public struct CSMSharedVehicleConversationRequest: Codable, Sendable, Equatable {
    public let operationId: UUID
    public let expectedMembershipRevision: Int

    public init(operationId: UUID, expectedMembershipRevision: Int) {
        self.operationId = operationId
        self.expectedMembershipRevision = expectedMembershipRevision
    }
}

/// A server observation, never a reusable grant of membership or an instruction to join a room.
public struct CSMSharedVehicleConversationReceipt: Decodable, Sendable, Equatable {
    public enum ContractVersion: String, Decodable, Sendable { case v1 = "cop-shared-vehicle-communication-v1" }
    public enum Scope: String, Decodable, Sendable { case sharedVehicle = "shared_vehicle" }
    public enum HistoryPolicy: String, Decodable, Sendable { case fromMembership = "from_membership" }
    public enum Revocation: String, Decodable, Sendable { case serverEnforced = "server_enforced" }

    public let contractVersion: ContractVersion
    public let operationId: UUID
    public let confirmed: Bool
    /// COP mobility account UUID, not the Keycloak subject UUID.
    public let accountId: UUID
    public let vehicleId: UUID
    public let membershipRevision: Int
    public let conversationId: String
    public let roomId: String
    public let scope: Scope
    public let historyPolicy: HistoryPolicy
    public let revocation: Revocation
    public let serverTimestamp: String

    /// Call against a freshly loaded membership in the same unchanged session/producer epoch.
    /// The host must still check its epoch before and after every await and before selection.
    public func matches(accountId: UUID, vehicleId: UUID, request: CSMSharedVehicleConversationRequest) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let dateIsValid = formatter.date(from: serverTimestamp) != nil || ISO8601DateFormatter().date(from: serverTimestamp) != nil
        return confirmed && self.accountId == accountId && self.vehicleId == vehicleId &&
        operationId == request.operationId && membershipRevision == request.expectedMembershipRevision &&
        membershipRevision > 0 && membershipRevision <= 9_007_199_254_740_991 &&
        !conversationId.isEmpty && conversationId.utf8.count <= 255 &&
        roomId.utf8.count <= 255 && roomId.range(of: #"^![^\s:]+:[^\s]+$"#, options: .regularExpression) != nil &&
        dateIsValid
    }
}
