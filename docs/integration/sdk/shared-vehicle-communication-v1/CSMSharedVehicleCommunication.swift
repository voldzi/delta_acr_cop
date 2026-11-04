import Foundation

public extension CSMCommunicationRuntime {
    /// Requests a fresh server observation only. Does not join, select, send or start a call.
    func requestSharedVehicleConversation(
        vehicleId: UUID,
        request: CSMSharedVehicleConversationRequest,
        expectedScope: String
    ) async throws -> CSMSharedVehicleConversationReceipt {
        let generation = copSessionGeneration()
        let producerEpoch = model.jizdaLifecycleSnapshot.generation
        func requireCurrentSession() throws {
            guard generation == copSessionGeneration(), mobilitySessionScope() == expectedScope,
                  model.permitsCommunicationProducers(epoch: producerEpoch) else {
                throw CSMCOPSessionError(.accountChanged)
            }
        }
        try requireCurrentSession()
        let account = try await mobilityAccount(expectedScope: expectedScope)
        try requireCurrentSession()
        let vehicle = try await sharedVehicleGet(vehicleId: vehicleId, expectedScope: expectedScope)
        try requireCurrentSession()
        guard vehicle.vehicleId == vehicleId, !vehicle.deleted,
              vehicle.membershipRevision == request.expectedMembershipRevision,
              vehicle.members.contains(where: { $0.accountId == account.accountId }) else {
            throw CSMServiceError.unavailable("Členství ve vozidle se změnilo.")
        }
        let result: CSMSharedVehicleConversationResolution = try await mobilityRequest(
            path: "/api/v1/shared-vehicles/v1/vehicles/\(vehicleId.uuidString.lowercased())/conversation",
            method: "POST", body: try JSONEncoder().encode(request), query: [], expectedScope: expectedScope,
            responseValidator: { status, result in
                switch result {
                case .ready where status == 200: break
                case .pending where status == 202: break
                default: throw CSMCOPSessionError(.invalidResponse)
                }
            }
        )
        try requireCurrentSession()
        switch result {
        case .ready(let receipt):
            guard receipt.matches(accountId: account.accountId, vehicleId: vehicleId, request: request) else {
                throw CSMCOPSessionError(.invalidResponse)
            }
            return receipt
        case .pending(let pending):
            guard pending.matches(accountId: account.accountId, vehicleId: vehicleId, request: request) else {
                throw CSMCOPSessionError(.invalidResponse)
            }
            throw CSMSharedVehicleConversationStateError.joinRequired(pending)
        }
    }
}
