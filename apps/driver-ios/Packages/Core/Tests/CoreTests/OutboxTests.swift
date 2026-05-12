import XCTest
@testable import Core

final class OutboxTests: XCTestCase {
    private var tempURL: URL!

    override func setUpWithError() throws {
        tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("outbox-test-\(UUID().uuidString).json")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempURL)
    }

    func testEnqueueAndPending() throws {
        let outbox = try FileOutbox(fileURL: tempURL)
        let item = try outbox.enqueue(.transition(jobId: "job-1", to: .enroute, reason: nil, attemptedAt: Date()))
        XCTAssertEqual(outbox.pending().count, 1)
        XCTAssertEqual(outbox.pending().first?.id, item.id)
    }

    func testRemoveFromPending() throws {
        let outbox = try FileOutbox(fileURL: tempURL)
        let a = try outbox.enqueue(.cancel(jobId: "job-1", reason: "x", attemptedAt: Date()))
        _ = try outbox.enqueue(.cancel(jobId: "job-2", reason: "x", attemptedAt: Date()))
        try outbox.remove(id: a.id)
        XCTAssertEqual(outbox.pending().count, 1)
        XCTAssertEqual(outbox.pending().first?.action, .cancel(jobId: "job-2", reason: "x", attemptedAt: outbox.pending().first!.action.attemptedAt))
    }

    func testRecordFailureIncrementsAttempts() throws {
        let outbox = try FileOutbox(fileURL: tempURL)
        let item = try outbox.enqueue(.cancel(jobId: "job-1", reason: "x", attemptedAt: Date()))
        try outbox.recordFailure(id: item.id, error: "boom")
        try outbox.recordFailure(id: item.id, error: "boom2")
        let updated = outbox.pending().first!
        XCTAssertEqual(updated.attempts, 2)
        XCTAssertEqual(updated.lastErrorMessage, "boom2")
    }

    func testSurvivesProcessRestart() throws {
        let outbox = try FileOutbox(fileURL: tempURL)
        _ = try outbox.enqueue(.transition(jobId: "job-9", to: .completed, reason: nil, attemptedAt: Date()))
        let restored = try FileOutbox(fileURL: tempURL)
        XCTAssertEqual(restored.pending().count, 1)
    }
}

private extension OutboxAction {
    var attemptedAt: Date {
        switch self {
        case .transition(_, _, _, let d),
             .cancel(_, _, let d),
             .uploadPhoto(_, _, let d),
             .submitDvir(_, let d),
             .uploadFleetDocument(_, let d),
             .startShift(_, _, let d),
             .endShift(_, let d),
             .updateShiftStatus(_, _, let d),
             .updateShiftLocation(_, _, _, let d),
             .sendChatMessage(_, let d):
            return d
        }
    }
}
