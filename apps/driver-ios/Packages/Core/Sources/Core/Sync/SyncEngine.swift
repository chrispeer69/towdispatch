import Foundation

/// Drains the outbox against the live API. Idempotent — safe to call on
/// reachability changes, app foregrounding, or a manual user pull-to-refresh.
public actor SyncEngine {
    private let api: USTowDispatchAPI
    private let outbox: Outbox
    private let localStore: LocalStore
    private var isDraining = false

    public init(api: USTowDispatchAPI, outbox: Outbox, localStore: LocalStore) {
        self.api = api
        self.outbox = outbox
        self.localStore = localStore
    }

    public func drain() async {
        guard !isDraining else { return }
        isDraining = true
        defer { isDraining = false }

        for item in outbox.pending() {
            do {
                try await execute(item)
                try outbox.remove(id: item.id)
            } catch {
                try? outbox.recordFailure(id: item.id, error: String(describing: error))
                if shouldStopDrain(for: error) { return }
            }
        }
    }

    private func execute(_ item: OutboxItem) async throws {
        switch item.action {
        case .transition(let jobId, let to, let reason, _):
            let job = try await api.transition(jobId: jobId, to: to, reason: reason)
            try localStore.updateJob(job)
        case .cancel(let jobId, let reason, _):
            let job = try await api.cancel(jobId: jobId, reason: reason)
            try localStore.updateJob(job)
        case .uploadPhoto(let jobId, let photo, _):
            _ = try await api.uploadJobPhoto(jobId: jobId, photo: photo)
        case .submitDvir(let payload, _):
            let dvir = try await api.submitDvir(payload)
            try localStore.upsertDvir(dvir)
        case .uploadFleetDocument(let payload, _):
            let doc = try await api.uploadDocument(payload)
            try localStore.upsertDocument(doc)
        case .startShift(let driverId, let truckId, _):
            let shift = try await api.startShift(driverId: driverId, truckId: truckId)
            try localStore.upsertShift(shift)
        case .endShift(let shiftId, _):
            let shift = try await api.endShift(shiftId: shiftId)
            try localStore.upsertShift(shift)
        case .updateShiftStatus(let shiftId, let status, _):
            let shift = try await api.updateShiftStatus(shiftId: shiftId, status: status)
            try localStore.upsertShift(shift)
        case .updateShiftLocation(let shiftId, let lat, let lng, _):
            let shift = try await api.updateShiftLocation(shiftId: shiftId, lat: lat, lng: lng)
            try localStore.upsertShift(shift)
        case .sendChatMessage(let message, _):
            let request = SendChatMessageRequest(message: message)
            let server = try await api.sendChatMessage(request)
            try localStore.acknowledgeChatMessage(clientId: message.id, server: server)
        }
    }

    /// Network errors stop the drain (we'll retry on next reachability event).
    /// Permanent server errors (4xx other than 401) leave the item with a
    /// failure record; we continue with the next item.
    private func shouldStopDrain(for error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        switch apiError {
        case .offline, .transport, .unauthorized, .noActiveSession:
            return true
        default:
            return false
        }
    }
}
