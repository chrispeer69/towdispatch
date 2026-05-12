import XCTest
@testable import Core

final class ShiftRepositoryTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("shift-test-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testStartShiftEnqueuesAndCachesOptimistic() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = ShiftRepository(api: NoopAPIForShift(), localStore: store, outbox: outbox)

        let shift = try await repo.startShift(driverId: "d1", truckId: "t1")
        XCTAssertNil(shift.endedAt)
        XCTAssertEqual(shift.status, .available)
        XCTAssertEqual(outbox.pending().count, 1)
        let active = await repo.currentShift()
        XCTAssertNotNil(active)
    }

    func testEndShiftMarksEnded() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = ShiftRepository(api: NoopAPIForShift(), localStore: store, outbox: outbox)
        let shift = try await repo.startShift(driverId: "d1", truckId: nil)
        try await repo.endShift(shift)
        let active = await repo.currentShift()
        XCTAssertNil(active)
        let pending = outbox.pending().map(\.action)
        XCTAssertTrue(pending.contains(where: {
            if case .endShift = $0 { return true } else { return false }
        }))
    }

    func testUpdateStatusReplacesPriorOptimistic() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = ShiftRepository(api: NoopAPIForShift(), localStore: store, outbox: outbox)
        let shift = try await repo.startShift(driverId: "d1", truckId: nil)
        try await repo.updateStatus(shift, status: .onBreak)
        XCTAssertEqual(store.activeShift()?.status, .onBreak)
    }
}

final class HOSStatusTests: XCTestCase {
    func testWithinWindow() {
        let started = Date(timeIntervalSinceNow: -3600 * 10) // 10h ago
        let hos = HOSStatus(shiftStartedAt: started)
        XCTAssertFalse(hos.pastWindow)
        XCTAssertNil(hos.mostUrgentThresholdHit)
        XCTAssertEqual(hos.remainingHours, 4, accuracy: 0.01)
    }

    func testHitsFirstThreshold() {
        let started = Date(timeIntervalSinceNow: -3600 * 12.5)
        let hos = HOSStatus(shiftStartedAt: started)
        XCTAssertEqual(hos.mostUrgentThresholdHit, 12)
    }

    func testHitsHighestThresholdBeforeWindowClose() {
        let started = Date(timeIntervalSinceNow: -3600 * 13.6)
        let hos = HOSStatus(shiftStartedAt: started)
        XCTAssertEqual(hos.mostUrgentThresholdHit, 13.5)
        XCTAssertFalse(hos.pastWindow)
    }

    func testPastWindow() {
        let started = Date(timeIntervalSinceNow: -3600 * 15)
        let hos = HOSStatus(shiftStartedAt: started)
        XCTAssertTrue(hos.pastWindow)
        XCTAssertLessThan(hos.remainingHours, 0)
    }
}

private actor NoopAPIForShift: TowCommandAPI {
    func login(_ body: LoginRequest) async throws -> LoginResponse { fatalError() }
    func refresh(_ body: RefreshRequest) async throws -> RefreshResponse { fatalError() }
    func logout(_ body: LogoutRequest) async throws {}
    func me() async throws -> MeResponse { fatalError() }
    func myJobs() async throws -> [MyJob] { [] }
    func myDriverProfile() async throws -> DriverProfile { fatalError() }
    func transition(jobId: String, to: JobStatus, reason: String?) async throws -> Job { fatalError() }
    func cancel(jobId: String, reason: String) async throws -> Job { fatalError() }
    func uploadJobPhoto(jobId: String, photo: PhotoUploadRequest) async throws -> PhotoUploadResponse { fatalError() }
    func submitDvir(_ body: CreateDvirPayload) async throws -> Dvir { fatalError() }
    func listDvirs(driverId: String?, truckId: String?) async throws -> [Dvir] { [] }
    func uploadDocument(_ body: UploadDocumentRequest) async throws -> FleetDocument { fatalError() }
    func listDocuments(ownerType: DocumentOwnerType?, ownerId: String?) async throws -> [FleetDocument] { [] }
    func listExpirations() async throws -> ExpirationsResponse { fatalError() }
    func driverTrucks(driverId: String) async throws -> [DriverTruckAssignment] { [] }
    func startShift(driverId: String, truckId: String?) async throws -> DriverShift { fatalError() }
    func endShift(shiftId: String) async throws -> DriverShift { fatalError() }
    func updateShiftStatus(shiftId: String, status: DriverShiftStatus) async throws -> DriverShift { fatalError() }
    func updateShiftLocation(shiftId: String, lat: Double, lng: Double) async throws -> DriverShift { fatalError() }
    func sendChatMessage(_ body: SendChatMessageRequest) async throws -> ChatMessage { fatalError() }
    func listChatMessages(jobId: String) async throws -> [ChatMessage] { [] }
}
