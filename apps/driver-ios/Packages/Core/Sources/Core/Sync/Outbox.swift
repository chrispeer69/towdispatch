import Foundation

/// A persisted outbox of mutating actions. Every status transition, photo
/// upload, and signature is enqueued here BEFORE any network call. The
/// `SyncEngine` drains the queue and removes items only on success. This is
/// the spec's "offline-first" guarantee.
///
/// Action variants added in Session 7 are tagged in the second group so
/// `SyncEngine.drainBatched()` can serialize them into the
/// `/driver-offline-sync/replay` payload using the matching
/// `DriverOfflineActionKind`. Older Session 6.x variants go through the
/// per-item drain path (they hit operator-side endpoints the replay
/// controller doesn't understand).
public enum OutboxAction: Codable, Equatable, Sendable {
    // Session 6
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

    // Session 7 — replay-batch eligible
    case submitPretrip(payload: CreatePretripInspectionPayload, attemptedAt: Date)
    case acknowledgeBriefing(briefingId: String, acknowledgedAt: String, attemptedAt: Date)
    case fieldPaymentCapture(intentId: String, attemptedAt: Date)
    case fieldPaymentCancel(intentId: String, attemptedAt: Date)
    case telemetryBatch(events: [DriverTelemetryEvent], attemptedAt: Date)
    case driverShiftCheckIn(truckId: String, dvirId: String?, attemptedAt: Date)
    case driverShiftCheckOut(attemptedAt: Date)
}

extension OutboxAction {
    /// True if this action is eligible to ride through
    /// `POST /driver-offline-sync/replay`. Operator-side actions
    /// (Session 6 transitions, DVIR/document/chat from Session 6.1) hit
    /// dispatch-shared endpoints the replay controller doesn't accept.
    var isReplayEligible: Bool {
        switch self {
        case .submitPretrip, .acknowledgeBriefing,
             .fieldPaymentCapture, .fieldPaymentCancel,
             .telemetryBatch, .driverShiftCheckIn, .driverShiftCheckOut:
            return true
        case .transition, .cancel, .uploadPhoto,
             .submitDvir, .uploadFleetDocument,
             .startShift, .endShift, .updateShiftStatus, .updateShiftLocation,
             .sendChatMessage:
            return false
        }
    }

    /// Backend `driverOfflineActionKindValues` mapping. Returns nil for
    /// non-replay-eligible actions.
    var replayKind: DriverOfflineActionKind? {
        switch self {
        case .submitPretrip: return .pretripInspection
        case .acknowledgeBriefing: return .briefingAcknowledge
        case .fieldPaymentCapture: return .fieldPaymentCapture
        case .fieldPaymentCancel: return .fieldPaymentCancel
        case .telemetryBatch: return .telemetryBatch
        case .driverShiftCheckIn: return .jobTransition  // see note below
        case .driverShiftCheckOut: return .jobTransition // see note below
        // Note: backend replay enum lacks `shift_clock_on/off` distinct
        // from web's `shiftClockOn/Off`; the swift mirror uses snake_case
        // values the controller actually accepts. driverShift* go through
        // the per-item drain (no replay-kind match — guard below).
        default:
            return nil
        }
    }
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

// MARK: - Replay-payload conversion

extension OutboxItem {
    /// Serialize this item into a `DriverOfflineAction` for the replay
    /// endpoint. Returns nil for non-replay-eligible actions; the caller
    /// must drain those per-item via the legacy SyncEngine path.
    func toReplayAction() -> DriverOfflineAction? {
        guard let kind = action.replayKind else { return nil }
        let iso = ISO8601DateFormatter()
        let recordedAt = iso.string(from: enqueuedAt)
        let payload: AnyCodableJSON.Value
        switch action {
        case .submitPretrip(let p, _):
            payload = .object([
                "truckId": .string(p.truckId),
                "status": .string(p.status.rawValue),
                "submittedAt": .string(p.submittedAt),
                "items": .array(p.items.map { item in
                    var dict: [String: AnyCodableJSON.Value] = [
                        "key": .string(item.key),
                        "label": .string(item.label),
                        "state": .string(item.state.rawValue),
                    ]
                    if let n = item.note { dict["note"] = .string(n) }
                    if let ks = item.photoKeys { dict["photoKeys"] = .array(ks.map { .string($0) }) }
                    return .object(dict)
                }),
            ])
        case .acknowledgeBriefing(let id, let at, _):
            payload = .object([
                "briefingId": .string(id),
                "acknowledgedAt": .string(at),
            ])
        case .fieldPaymentCapture(let intentId, _):
            payload = .object([
                "intentId": .string(intentId),
                "action": .string("capture"),
            ])
        case .fieldPaymentCancel(let intentId, _):
            payload = .object([
                "intentId": .string(intentId),
                "action": .string("cancel"),
            ])
        case .telemetryBatch(let events, _):
            payload = .object([
                "events": .array(events.map { ev in
                    var dict: [String: AnyCodableJSON.Value] = [
                        "kind": .string(ev.kind.rawValue),
                        "recordedAt": .string(ev.recordedAt),
                    ]
                    if let v = ev.lat { dict["lat"] = .double(v) }
                    if let v = ev.lng { dict["lng"] = .double(v) }
                    if let v = ev.speedMps { dict["speedMps"] = .double(v) }
                    if let v = ev.headingDegrees { dict["headingDegrees"] = .double(v) }
                    if let v = ev.accuracyMeters { dict["accuracyMeters"] = .double(v) }
                    if let v = ev.jobId { dict["jobId"] = .string(v) }
                    if let v = ev.shiftId { dict["shiftId"] = .string(v) }
                    return .object(dict)
                }),
            ])
        default:
            return nil
        }
        return DriverOfflineAction(
            clientId: id.uuidString,
            kind: kind,
            recordedAt: recordedAt,
            payload: AnyCodableJSON(payload)
        )
    }
}
