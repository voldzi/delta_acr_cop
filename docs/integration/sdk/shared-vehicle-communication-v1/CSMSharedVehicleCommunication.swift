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

public extension CSMCommunicationRuntime {
    /// Selects only a freshly verified current mapping already joined in Matrix.
    func selectSharedVehicleConversation(
        receipt: CSMSharedVehicleConversationReceipt,
        expectedScope: String
    ) async throws {
        let generation = copSessionGeneration()
        let epoch = model.jizdaLifecycleSnapshot.generation
        let fresh = try await requestSharedVehicleConversation(vehicleId: receipt.vehicleId,
            request: .init(operationId: receipt.operationId, expectedMembershipRevision: receipt.membershipRevision),
            expectedScope: expectedScope)
        guard fresh.accountId == receipt.accountId, fresh.conversationId == receipt.conversationId,
              fresh.roomId == receipt.roomId, fresh.roomGeneration == receipt.roomGeneration,
              fresh.recipientEpoch == receipt.recipientEpoch else { throw CSMCOPSessionError(.invalidResponse) }
        await model.refreshConversations()
        guard generation == copSessionGeneration(), mobilitySessionScope() == expectedScope,
              model.permitsCommunicationProducers(epoch: epoch),
              let conversation = verifiedVehicleConversation(conversationId: fresh.conversationId,
                vehicleId: fresh.vehicleId, roomId: fresh.roomId,
                membershipRevision: fresh.membershipRevision, recipientEpoch: fresh.recipientEpoch) else {
            throw CSMServiceError.unavailable("Komunikace vozidla čeká na nové ověření.")
        }
        try await model.requireManagedVehicleJoined(conversation)
        guard generation == copSessionGeneration(), mobilitySessionScope() == expectedScope,
              model.permitsCommunicationProducers(epoch: epoch) else { throw CSMCOPSessionError(.accountChanged) }
        await model.selectConversation(conversation)
        guard generation == copSessionGeneration(), mobilitySessionScope() == expectedScope,
              model.permitsCommunicationProducers(epoch: epoch) else { throw CSMCOPSessionError(.accountChanged) }
    }

    /// A separate explicit user action; never called as part of selection.
    func acceptSharedVehicleConversationInvitation(
        pending: CSMSharedVehicleConversationPending,
        expectedScope: String
    ) async throws -> CSMSharedVehicleConversationReceipt {
        let generation = copSessionGeneration()
        let epoch = model.jizdaLifecycleSnapshot.generation
        let request = CSMSharedVehicleConversationRequest(operationId: pending.operationId,
            expectedMembershipRevision: pending.membershipRevision)
        do {
            let ready = try await requestSharedVehicleConversation(vehicleId: pending.vehicleId,
                request: request, expectedScope: expectedScope)
            guard ready.accountId == pending.accountId, ready.roomId == pending.roomId,
                  ready.conversationId == pending.conversationId, ready.roomGeneration == pending.roomGeneration,
                  ready.recipientEpoch == pending.recipientEpoch else { throw CSMCOPSessionError(.invalidResponse) }
            return ready
        } catch CSMSharedVehicleConversationStateError.joinRequired(let fresh) {
            guard fresh.accountId == pending.accountId, fresh.roomId == pending.roomId,
                  fresh.conversationId == pending.conversationId, fresh.roomGeneration == pending.roomGeneration,
                  fresh.recipientEpoch == pending.recipientEpoch else { throw CSMCOPSessionError(.invalidResponse) }
        }
        await model.refreshConversations()
        guard generation == copSessionGeneration(), mobilitySessionScope() == expectedScope,
              model.permitsCommunicationProducers(epoch: epoch),
              let conversation = verifiedVehicleConversation(conversationId: pending.conversationId,
                vehicleId: pending.vehicleId, roomId: pending.roomId,
                membershipRevision: pending.membershipRevision, recipientEpoch: pending.recipientEpoch) else {
            throw CSMServiceError.unavailable("Pozvánka vozidla již není aktuální.")
        }
        try await model.acceptManagedVehicleInvitation(conversation)
        guard generation == copSessionGeneration(), mobilitySessionScope() == expectedScope,
              model.permitsCommunicationProducers(epoch: epoch) else { throw CSMCOPSessionError(.accountChanged) }
        return try await requestSharedVehicleConversation(vehicleId: pending.vehicleId,
            request: request, expectedScope: expectedScope)
    }

    private func verifiedVehicleConversation(conversationId: String, vehicleId: UUID, roomId: String,
                                             membershipRevision: Int, recipientEpoch: Int) -> Conversation? {
        model.visibleConversations.first {
            $0.conversationId == conversationId && $0.activeMatrixRoomId == roomId &&
            $0.metadata["scope"] == "shared_vehicle" &&
            $0.metadata["externalId"] == vehicleId.uuidString.lowercased() &&
            $0.metadata["vehicleMembershipRevision"] == String(membershipRevision) &&
            $0.metadata["vehicleRecipientEpoch"] == String(recipientEpoch) &&
            $0.metadata["vehicleCommunicationState"] == "ready"
        }
    }
}
