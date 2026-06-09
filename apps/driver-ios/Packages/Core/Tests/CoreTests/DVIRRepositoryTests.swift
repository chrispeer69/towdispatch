import XCTest
@testable import Core

final class DVIRRepositoryTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dvir-test-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testSubmitWithNoDefectsIsClean() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = DVIRRepository(api: NoopAPIForDvir(), localStore: store, outbox: outbox)
        let dvir = try await repo.submit(.init(driverId: "d1", truckId: "t1", type: .preTrip))
        XCTAssertEqual(dvir.status, .noDefects)
        XCTAssertEqual(outbox.pending().count, 1)
        XCTAssertEqual(store.loadDvirs().count, 1)
    }

    func testSubmitWithOOSDefectIsOutOfService() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = DVIRRepository(api: NoopAPIForDvir(), localStore: store, outbox: outbox)
        let dvir = try await repo.submit(.init(
            driverId: "d1", truckId: "t1", type: .preTrip,
            defects: [DvirDefect(component: "Brakes", severity: .outOfService)]
        ))
        XCTAssertEqual(dvir.status, .outOfService)
        XCTAssertTrue(dvir.isOutOfService)
    }

    func testSubmitWithMinorDefectsIsMinor() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = DVIRRepository(api: NoopAPIForDvir(), localStore: store, outbox: outbox)
        let dvir = try await repo.submit(.init(
            driverId: "d1", truckId: "t1", type: .preTrip,
            defects: [DvirDefect(component: "Wipers", severity: .minor)]
        ))
        XCTAssertEqual(dvir.status, .minor)
    }
}

private actor NoopAPIForDvir: TowDispatchAPI {
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
