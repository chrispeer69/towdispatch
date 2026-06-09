import XCTest
@testable import Core

final class ChatRepositoryTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("chat-test-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testSendQueuesMessageAsQueued() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = ChatRepository(api: NoopAPIForChat(), localStore: store, outbox: outbox)
        let msg = try await repo.send(jobId: "j1", kind: .text, body: "On the way")
        XCTAssertEqual(msg.deliveryState, .queued)
        let cached = await repo.cachedMessages(jobId: "j1")
        XCTAssertEqual(cached.count, 1)
        XCTAssertEqual(outbox.pending().count, 1)
    }

    func testAcknowledgeReplacesQueuedWithServer() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = ChatRepository(api: NoopAPIForChat(), localStore: store, outbox: outbox)
        let queued = try await repo.send(jobId: "j1", kind: .text, body: "x")
        let server = ChatMessage(
            id: queued.id, jobId: queued.jobId, sender: .driver, kind: .text,
            body: queued.body, deliveryState: .delivered
        )
        try store.acknowledgeChatMessage(clientId: queued.id, server: server)
        let cached = await repo.cachedMessages(jobId: "j1")
        XCTAssertEqual(cached.first?.deliveryState, .delivered)
    }
}

private actor NoopAPIForChat: TowDispatchAPI {
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
