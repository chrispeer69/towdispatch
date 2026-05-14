import Foundation

/// Reads from local store first; writes go through the outbox.
public actor DVIRRepository {
    private let api: USTowDispatchAPI
    private let localStore: LocalStore
    private let outbox: Outbox

    public init(api: USTowDispatchAPI, localStore: LocalStore, outbox: Outbox) {
        self.api = api
        self.localStore = localStore
        self.outbox = outbox
    }

    public func cached() -> [Dvir] { localStore.loadDvirs() }

    public func refresh(driverId: String) async throws -> [Dvir] {
        let list = try await api.listDvirs(driverId: driverId, truckId: nil)
        for d in list { try localStore.upsertDvir(d) }
        return list
    }

    /// Enqueue a DVIR submission. Computes the local status from defects so
    /// the UI can immediately reflect "out of service" even before the server
    /// ack arrives. The optimistic record gets a temporary id.
    public func submit(_ payload: CreateDvirPayload) async throws -> Dvir {
        let optimistic = Dvir(
            id: "local-\(UUID().uuidString)",
            tenantId: localStore.loadJobs().first?.job.tenantId ?? "",
            driverId: payload.driverId,
            truckId: payload.truckId,
            type: payload.type,
            submittedAt: ISO8601DateFormatter().string(from: Date()),
            odometerReading: payload.odometerReading,
            defects: payload.defects,
            status: DVIRRepository.computeStatus(payload.defects),
            notes: payload.notes
        )
        try localStore.upsertDvir(optimistic)
        _ = try outbox.enqueue(.submitDvir(payload: payload, attemptedAt: Date()))
        return optimistic
    }

    public static func computeStatus(_ defects: [DvirDefect]) -> DvirStatus {
        if defects.contains(where: { $0.severity == .outOfService }) { return .outOfService }
        if defects.isEmpty { return .noDefects }
        return .minor
    }
}
