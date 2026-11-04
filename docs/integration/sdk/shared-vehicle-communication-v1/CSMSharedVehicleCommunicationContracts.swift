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
    public let recipientEpoch: Int
    public let roomGeneration: Int
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
        recipientEpoch > 0 && recipientEpoch <= 9_007_199_254_740_991 &&
        membershipRevision > 0 && membershipRevision <= 9_007_199_254_740_991 &&
        roomGeneration > 0 && roomGeneration <= 9_007_199_254_740_991 &&
        !conversationId.isEmpty && conversationId.utf8.count <= 255 &&
        roomId.utf8.count <= 255 && roomId.range(of: #"^![^\s:]+:[^\s]+$"#, options: .regularExpression) != nil &&
        dateIsValid
    }
}

/// Invitation preparation only. This value is never accepted by the selection API.
public struct CSMSharedVehicleConversationPending: Decodable, Sendable, Equatable {
    public enum State: String, Decodable, Sendable { case joinRequired = "join_required" }
    public let contractVersion: CSMSharedVehicleConversationReceipt.ContractVersion
    public let operationId: UUID
    public let confirmed: Bool
    public let accountId: UUID
    public let vehicleId: UUID
    public let membershipRevision: Int
    public let recipientEpoch: Int
    public let roomGeneration: Int
    public let conversationId: String
    public let roomId: String
    public let scope: CSMSharedVehicleConversationReceipt.Scope
    public let historyPolicy: CSMSharedVehicleConversationReceipt.HistoryPolicy
    public let revocation: CSMSharedVehicleConversationReceipt.Revocation
    public let serverTimestamp: String
    public let state: State

    public func matches(accountId: UUID, vehicleId: UUID, request: CSMSharedVehicleConversationRequest) -> Bool {
        !confirmed && CSMSharedVehicleConversationReceipt(
            contractVersion: contractVersion, operationId: operationId, confirmed: true,
            accountId: self.accountId, vehicleId: self.vehicleId, membershipRevision: membershipRevision,
            recipientEpoch: recipientEpoch, roomGeneration: roomGeneration, conversationId: conversationId, roomId: roomId, scope: scope,
            historyPolicy: historyPolicy, revocation: revocation, serverTimestamp: serverTimestamp
        ).matches(accountId: accountId, vehicleId: vehicleId, request: request)
    }
}

public enum CSMSharedVehicleConversationStateError: Error, Sendable, Equatable {
    case joinRequired(CSMSharedVehicleConversationPending)

    public var code: String { "VEHICLE_COMMUNICATION_JOIN_REQUIRED" }
}

enum CSMSharedVehicleConversationResolution: Decodable {
    case ready(CSMSharedVehicleConversationReceipt)
    case pending(CSMSharedVehicleConversationPending)

    private enum CodingKeys: CodingKey { case confirmed }
    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        if try fields.decode(Bool.self, forKey: .confirmed) {
            self = .ready(try CSMSharedVehicleConversationReceipt(from: decoder))
        } else {
            self = .pending(try CSMSharedVehicleConversationPending(from: decoder))
        }
    }
}
