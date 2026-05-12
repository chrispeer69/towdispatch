import Foundation

public actor DocumentsRepository {
    private let api: TowCommandAPI
    private let localStore: LocalStore
    private let outbox: Outbox

    public init(api: TowCommandAPI, localStore: LocalStore, outbox: Outbox) {
        self.api = api
        self.localStore = localStore
        self.outbox = outbox
    }

    public func cachedDocuments(ownerId: String? = nil) -> [FleetDocument] {
        let all = localStore.loadDocuments()
        guard let ownerId else { return all }
        return all.filter { $0.ownerId == ownerId }
    }

    public func refresh(ownerType: DocumentOwnerType?, ownerId: String?) async throws -> [FleetDocument] {
        let docs = try await api.listDocuments(ownerType: ownerType, ownerId: ownerId)
        for d in docs { try localStore.upsertDocument(d) }
        return docs
    }

    public func cachedExpirations() -> ExpirationsResponse? { localStore.loadExpirations() }

    public func refreshExpirations() async throws -> ExpirationsResponse {
        let exp = try await api.listExpirations()
        try localStore.saveExpirations(exp)
        return exp
    }

    public func queueUpload(_ request: UploadDocumentRequest) throws {
        _ = try outbox.enqueue(.uploadFleetDocument(payload: request, attemptedAt: Date()))
    }
}
