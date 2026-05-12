import XCTest
@testable import Core

final class LocalStoreTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("localstore-test-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testSaveAndLoadJobs() throws {
        let store = try FileLocalStore(root: root)
        let job = sampleJob(id: "j1", status: .new)
        try store.saveJobs([MyJob(job: job, customer: nil, vehicle: nil)])
        let loaded = store.loadJobs()
        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded.first?.job.id, "j1")
    }

    func testUpdateJobMutatesStatus() throws {
        let store = try FileLocalStore(root: root)
        let job = sampleJob(id: "j1", status: .new)
        try store.saveJobs([MyJob(job: job, customer: nil, vehicle: nil)])
        var updated = job
        updated.status = .enroute
        try store.updateJob(updated)
        XCTAssertEqual(store.loadJobs().first?.job.status, .enroute)
    }

    private func sampleJob(id: String, status: JobStatus) -> Job {
        Job(
            id: id, tenantId: "t1", jobNumber: "TC-001",
            status: status, serviceType: "tow",
            pickupAddress: "123 Main St",
            authorizedBy: "stub",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z"
        )
    }
}
