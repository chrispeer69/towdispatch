import Foundation

public actor ChatRepository {
    private let api: USTowDispatchAPI
    private let localStore: LocalStore
    private let outbox: Outbox

    public init(api: USTowDispatchAPI, localStore: LocalStore, outbox: Outbox) {
        self.api = api
        self.localStore = localStore
        self.outbox = outbox
    }

    public func cachedMessages(jobId: String) -> [ChatMessage] {
        localStore.loadChatMessages(jobId: jobId).sorted { $0.createdAt < $1.createdAt }
    }

    public func refresh(jobId: String) async throws -> [ChatMessage] {
        let msgs = try await api.listChatMessages(jobId: jobId)
        for m in msgs { try localStore.appendChatMessage(m) }
        return cachedMessages(jobId: jobId)
    }

    /// Queue a new outbound message. Returned with delivery state `.queued`.
    public func send(jobId: String, kind: ChatMessageKind, body: String? = nil, attachmentUrl: String? = nil, durationSeconds: Int? = nil) throws -> ChatMessage {
        let msg = ChatMessage(
            jobId: jobId,
            sender: .driver,
            kind: kind,
            body: body,
            attachmentUrl: attachmentUrl,
            durationSeconds: durationSeconds,
            deliveryState: .queued
        )
        try localStore.appendChatMessage(msg)
        _ = try outbox.enqueue(.sendChatMessage(message: msg, attemptedAt: Date()))
        return msg
    }
}
