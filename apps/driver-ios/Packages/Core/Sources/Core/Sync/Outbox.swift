import Foundation

/// A persisted outbox of mutating actions. Every status transition, photo
/// upload, and signature is enqueued here BEFORE any network call. The
/// `SyncEngine` drains the queue and removes items only on success. This is
/// the spec's "offline-first" guarantee.
public enum OutboxAction: Codable, Equatable, Sendable {
    case transition(jobId: String, to: JobStatus, reason: String?, attemptedAt: Date)
    case cancel(jobId: String, reason: String, attemptedAt: Date)
    case uploadPhoto(jobId: String, photo: PhotoUploadRequest, attemptedAt: Date)

    // Session 6.1
    case submitDvir(payload: CreateDvirPayload, attemptedAt: Date)
    case uploadFleetDocument(payload: UploadDocumentRequest, attemptedAt: Date)
    case startShift(driverId: String, truckId: String?, attemptedAt: Date)
    case endShift(shiftId: String, attemptedAt: Date)
    case updateShiftStatus(shiftId: String, status: DriverShiftStatus, attemptedAt: Date)
    case updateShiftLocation(shiftId: String, lat: Double, lng: Double, attemptedAt: Date)
    case sendChatMessage(message: ChatMessage, attemptedAt: Date)
}

public struct OutboxItem: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let action: OutboxAction
    public var attempts: Int
    public var lastErrorMessage: String?
    public let enqueuedAt: Date

    public init(action: OutboxAction, id: UUID = UUID(), enqueuedAt: Date = Date()) {
        self.id = id
        self.action = action
        self.attempts = 0
        self.lastErrorMessage = nil
        self.enqueuedAt = enqueuedAt
    }
}

public protocol Outbox: Sendable {
    func enqueue(_ action: OutboxAction) throws -> OutboxItem
    func pending() -> [OutboxItem]
    func remove(id: UUID) throws
    func recordFailure(id: UUID, error: String) throws
    func clear() throws
}

public final class FileOutbox: Outbox, @unchecked Sendable {
    private let fileURL: URL
    private let lock = NSLock()

    public init(fileURL: URL) throws {
        self.fileURL = fileURL
        let dir = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            try Data("[]".utf8).write(to: fileURL, options: .atomic)
        }
    }

    public static func defaultOutbox() throws -> FileOutbox {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = docs.appendingPathComponent("Outbox/outbox.json")
        return try FileOutbox(fileURL: url)
    }

    public func enqueue(_ action: OutboxAction) throws -> OutboxItem {
        lock.lock(); defer { lock.unlock() }
        var items = readUnlocked()
        let item = OutboxItem(action: action)
        items.append(item)
        try writeUnlocked(items)
        return item
    }

    public func pending() -> [OutboxItem] {
        lock.lock(); defer { lock.unlock() }
        return readUnlocked()
    }

    public func remove(id: UUID) throws {
        lock.lock(); defer { lock.unlock() }
        var items = readUnlocked()
        items.removeAll { $0.id == id }
        try writeUnlocked(items)
    }

    public func recordFailure(id: UUID, error: String) throws {
        lock.lock(); defer { lock.unlock() }
        var items = readUnlocked()
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        items[idx].attempts += 1
        items[idx].lastErrorMessage = error
        try writeUnlocked(items)
    }

    public func clear() throws {
        lock.lock(); defer { lock.unlock() }
        try writeUnlocked([])
    }

    private func readUnlocked() -> [OutboxItem] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder.iso.decode([OutboxItem].self, from: data)) ?? []
    }

    private func writeUnlocked(_ items: [OutboxItem]) throws {
        let data = try JSONEncoder.iso.encode(items)
        try data.write(to: fileURL, options: .atomic)
    }
}
