import Foundation

/// Drains the outbox against the live API. Idempotent — safe to call on
/// reachability changes, app foregrounding, or a manual user pull-to-refresh.
///
/// Two drain strategies:
///   1. **Batched** (Session 7) — replay-eligible items are bundled into a
///      single `POST /driver-offline-sync/replay` (max 50 per call to keep
///      the request body bounded). The server returns per-item results so
///      we retain only the failed ones.
///   2. **Per-item** (Session 6 fallback) — operator-shared mutations hit
///      their individual endpoints. Also used when the replay route 404s
///      (older backend, local dev without the controller registered).
public actor SyncEngine {
    public static let replayBatchSize = 50

    private let api: USTowDispatchAPI
    private let outbox: Outbox
    private let localStore: LocalStore
    private var isDraining = false
    private var batchedEndpointAvailable = true

    public init(api: USTowDispatchAPI, outbox: Outbox, localStore: LocalStore) {
        self.api = api
        self.outbox = outbox
        self.localStore = localStore
    }

    public func drain() async {
        guard !isDraining else { return }
        isDraining = true
        defer { isDraining = false }

        // 1) Batched drain for replay-eligible items.
        if batchedEndpointAvailable {
            await drainBatched()
        }

        // 2) Per-item drain for items the batched drain didn't handle:
        //    a) operator-shared mutations (not in the replay enum), and
        //    b) replay-eligible items if the batched endpoint 404'd above
        //       (latched off via `batchedEndpointAvailable`).
        for item in outbox.pending() {
            // Items that are replay-eligible and that the batched endpoint
            // already attempted (success → removed, failure → recorded with
            // an error message) should not be re-tried per-item in the same
            // drain call. They'll be re-tried in the next drain() invocation
            // when the batch endpoint is given another shot.
            if batchedEndpointAvailable && item.action.isReplayEligible {
                continue
            }
            do {
                try await executePerItem(item)
                try outbox.remove(id: item.id)
            } catch {
                try? outbox.recordFailure(id: item.id, error: String(describing: error))
                if shouldStopDrain(for: error) { return }
            }
        }
    }

    /// Bundle replay-eligible items into `POST /driver-offline-sync/replay`
    /// calls, max 50 actions per call. Removes the items the server
    /// reports as `applied`/`skipped`; leaves failed items in the queue
    /// with an updated `lastErrorMessage`. On 404 (route absent) flips
    /// `batchedEndpointAvailable = false` so the rest of the drain falls
    /// through to per-item.
    private func drainBatched() async {
        let pending = outbox.pending()
        let eligible = pending.compactMap { item -> (OutboxItem, DriverOfflineAction)? in
            guard let action = item.toReplayAction() else { return nil }
            return (item, action)
        }
        guard !eligible.isEmpty else { return }

        for slice in eligible.chunked(into: Self.replayBatchSize) {
            let actions = slice.map { $0.1 }
            do {
                let resp = try await api.replayOfflineActions(
                    DriverOfflineBatchRequest(actions: actions)
                )
                let byClientId = Dictionary(
                    uniqueKeysWithValues: resp.results.map { ($0.clientId, $0) }
                )
                for (item, _) in slice {
                    let result = byClientId[item.id.uuidString]
                    switch result?.status {
                    case "applied", "skipped":
                        try? outbox.remove(id: item.id)
                    case "failed":
                        let msg = result?.errorMessage ?? result?.errorCode ?? "replay-failed"
                        try? outbox.recordFailure(id: item.id, error: msg)
                    default:
                        // Server didn't echo the row (older endpoint shape).
                        // Treat as transient — leave in queue.
                        try? outbox.recordFailure(id: item.id, error: "no-result-from-server")
                    }
                }
            } catch let apiError as APIError {
                if case .http(404, _) = apiError {
                    // Backend doesn't expose /driver-offline-sync/replay yet.
                    // Fall through to per-item drain (preserves Session 6
                    // behavior). Latches off so we don't re-attempt this
                    // session.
                    batchedEndpointAvailable = false
                    return
                }
                if shouldStopDrain(for: apiError) { return }
                // Other error: mark items as attempted, move on.
                for (item, _) in slice {
                    try? outbox.recordFailure(id: item.id, error: apiError.localizedDescription)
                }
            } catch {
                for (item, _) in slice {
                    try? outbox.recordFailure(id: item.id, error: String(describing: error))
                }
            }
        }
    }

    private func executePerItem(_ item: OutboxItem) async throws {
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
        case .submitPretrip(let payload, _):
            _ = try await api.submitPretrip(payload)
        case .acknowledgeBriefing(let id, let at, _):
            _ = try await api.acknowledgeBriefing(
                id: id, body: AcknowledgeBriefingRequest(acknowledgedAt: at)
            )
        case .fieldPaymentCapture(let intentId, _):
            _ = try await api.captureFieldPayment(id: intentId)
        case .fieldPaymentCancel(let intentId, _):
            _ = try await api.cancelFieldPayment(id: intentId)
        case .telemetryBatch(let events, _):
            _ = try await api.batchTelemetry(DriverTelemetryBatchRequest(events: events))
        case .driverShiftCheckIn(let truckId, let dvirId, _):
            let shift = try await api.driverCheckIn(truckId: truckId, dvirId: dvirId)
            try localStore.upsertShift(shift)
        case .driverShiftCheckOut(_):
            let shift = try await api.driverCheckOut()
            try localStore.upsertShift(shift)
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

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map { start in
            Array(self[start..<Swift.min(start + size, count)])
        }
    }
}
