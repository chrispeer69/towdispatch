import Foundation

/// Chat messages live on the iOS device until the backend chat module is
/// shipped. The wire format I'm targeting is `/dispatch/chat/threads/{jobId}/messages`
/// — a thread per job. When the backend lands, only `Endpoints.swift`
/// needs to update.
///
/// Locally we keep an outbox-queued mutation per outbound message; inbound
/// is via push notification once the backend pushes them.

public enum ChatMessageSender: String, Codable, Sendable {
    case driver
    case dispatcher
    case system
}

public enum ChatMessageKind: String, Codable, Sendable {
    case text
    case voice
    case photo
    case video
    case quickReply = "quick_reply"
}

public enum ChatDeliveryState: String, Codable, Sendable {
    /// In the outbox, not yet sent.
    case queued
    /// Sent to the server, not yet ack'd.
    case sent
    /// Server confirmed.
    case delivered
    /// Recipient read it.
    case read
    /// Send failed permanently.
    case failed
}

public struct ChatMessage: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let jobId: String
    public let sender: ChatMessageSender
    public let kind: ChatMessageKind
    public let body: String?
    public let attachmentUrl: String?
    public let durationSeconds: Int?
    public let createdAt: Date
    public var deliveryState: ChatDeliveryState

    public init(
        id: String = UUID().uuidString,
        jobId: String,
        sender: ChatMessageSender,
        kind: ChatMessageKind,
        body: String? = nil,
        attachmentUrl: String? = nil,
        durationSeconds: Int? = nil,
        createdAt: Date = Date(),
        deliveryState: ChatDeliveryState = .queued
    ) {
        self.id = id
        self.jobId = jobId
        self.sender = sender
        self.kind = kind
        self.body = body
        self.attachmentUrl = attachmentUrl
        self.durationSeconds = durationSeconds
        self.createdAt = createdAt
        self.deliveryState = deliveryState
    }
}

public enum ChatQuickReply {
    public static let driverReplies: [String] = [
        "On the way",
        "ETA 5 minutes",
        "Customer not on scene",
        "Need additional equipment",
        "Vehicle gone on arrival",
        "Customer cancelled at scene",
        "Police involved — standing by",
        "Done — heading back",
    ]
}

public struct SendChatMessageRequest: Codable, Sendable {
    public let clientMessageId: String
    public let jobId: String
    public let kind: String
    public let body: String?
    public let attachmentUrl: String?
    public let durationSeconds: Int?

    public init(message: ChatMessage) {
        self.clientMessageId = message.id
        self.jobId = message.jobId
        self.kind = message.kind.rawValue
        self.body = message.body
        self.attachmentUrl = message.attachmentUrl
        self.durationSeconds = message.durationSeconds
    }
}
