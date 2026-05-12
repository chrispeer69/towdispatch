import Foundation

public actor ShiftRepository {
    private let api: TowCommandAPI
    private let localStore: LocalStore
    private let outbox: Outbox

    public init(api: TowCommandAPI, localStore: LocalStore, outbox: Outbox) {
        self.api = api
        self.localStore = localStore
        self.outbox = outbox
    }

    public func currentShift() -> DriverShift? { localStore.activeShift() }

    public func startShift(driverId: String, truckId: String?) async throws -> DriverShift {
        // Optimistic record while the start call is in flight / queued.
        let optimistic = DriverShift(
            id: "local-\(UUID().uuidString)",
            tenantId: localStore.loadDriverProfile().map { _ in "" } ?? "",
            driverId: driverId,
            truckId: truckId,
            status: .available,
            currentJobId: nil,
            lastLat: nil, lastLng: nil, lastPositionAt: nil,
            startedAt: ISO8601DateFormatter().string(from: Date()),
            endedAt: nil
        )
        try localStore.upsertShift(optimistic)
        _ = try outbox.enqueue(.startShift(driverId: driverId, truckId: truckId, attemptedAt: Date()))
        return optimistic
    }

    public func endShift(_ shift: DriverShift) async throws {
        let ended = DriverShift(
            id: shift.id, tenantId: shift.tenantId, driverId: shift.driverId,
            truckId: shift.truckId, status: shift.status, currentJobId: nil,
            lastLat: shift.lastLat, lastLng: shift.lastLng,
            lastPositionAt: shift.lastPositionAt, startedAt: shift.startedAt,
            endedAt: ISO8601DateFormatter().string(from: Date())
        )
        try localStore.upsertShift(ended)
        _ = try outbox.enqueue(.endShift(shiftId: shift.id, attemptedAt: Date()))
    }

    public func updateStatus(_ shift: DriverShift, status: DriverShiftStatus) async throws {
        let next = DriverShift(
            id: shift.id, tenantId: shift.tenantId, driverId: shift.driverId,
            truckId: shift.truckId, status: status, currentJobId: shift.currentJobId,
            lastLat: shift.lastLat, lastLng: shift.lastLng,
            lastPositionAt: shift.lastPositionAt, startedAt: shift.startedAt,
            endedAt: shift.endedAt
        )
        try localStore.upsertShift(next)
        _ = try outbox.enqueue(.updateShiftStatus(shiftId: shift.id, status: status, attemptedAt: Date()))
    }

    public func pingLocation(_ shift: DriverShift, lat: Double, lng: Double) async throws {
        _ = try outbox.enqueue(.updateShiftLocation(shiftId: shift.id, lat: lat, lng: lng, attemptedAt: Date()))
    }
}
