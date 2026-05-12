import XCTest
@testable import Core

final class JobsRepositoryTests: XCTestCase {
    private var storeRoot: URL!
    private var outboxURL: URL!

    override func setUpWithError() throws {
        storeRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("repo-test-\(UUID().uuidString)")
        outboxURL = storeRoot.appendingPathComponent("outbox.json")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: storeRoot) }

    func testTransitionEnqueuesAndUpdatesOptimistically() async throws {
        let store = try FileLocalStore(root: storeRoot)
        let outbox = try FileOutbox(fileURL: outboxURL)
        let api = NoopAPI()
        let repo = JobsRepository(api: api, localStore: store, outbox: outbox)

        let job = sampleJob(id: "j1", status: .dispatched)
        try store.saveJobs([MyJob(job: job, customer: nil, vehicle: nil)])

        try await repo.transition(jobId: "j1", to: .enroute)
        XCTAssertEqual(store.loadJobs().first?.job.status, .enroute)
        XCTAssertEqual(outbox.pending().count, 1)
    }

    func testInvalidTransitionThrows() async throws {
        let store = try FileLocalStore(root: storeRoot)
        let outbox = try FileOutbox(fileURL: outboxURL)
        let api = NoopAPI()
        let repo = JobsRepository(api: api, localStore: store, outbox: outbox)

        let job = sampleJob(id: "j1", status: .completed)
        try store.saveJobs([MyJob(job: job, customer: nil, vehicle: nil)])

        do {
            try await repo.transition(jobId: "j1", to: .enroute)
            XCTFail("Expected throw")
        } catch let err as InvalidJobTransitionError {
            XCTAssertEqual(err.from, .completed)
            XCTAssertEqual(err.to, .enroute)
        }
    }

    private func sampleJob(id: String, status: JobStatus) -> Job {
        Job(id: id, tenantId: "t1", jobNumber: "TC-001", status: status,
            serviceType: "tow", pickupAddress: "x", authorizedBy: "stub",
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z")
    }
}

private actor NoopAPI: TowCommandAPI {
    func login(_ body: LoginRequest) async throws -> LoginResponse { fatalError() }
    func refresh(_ body: RefreshRequest) async throws -> RefreshResponse { fatalError() }
    func logout(_ body: LogoutRequest) async throws {}
    func me() async throws -> MeResponse { fatalError() }
    func myJobs() async throws -> [MyJob] { [] }
    func myDriverProfile() async throws -> DriverProfile { fatalError() }
    func transition(jobId: String, to: JobStatus, reason: String?) async throws -> Job { fatalError() }
    func cancel(jobId: String, reason: String) async throws -> Job { fatalError() }
    func uploadJobPhoto(jobId: String, photo: PhotoUploadRequest) async throws -> PhotoUploadResponse { fatalError() }
}
