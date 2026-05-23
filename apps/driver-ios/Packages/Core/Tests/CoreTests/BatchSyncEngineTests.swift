import XCTest
@testable import Core

final class BatchSyncEngineTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("batch-sync-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testReplayHappyPathClearsBatch() async throws {
        let api = StubUSTowDispatchAPI()
        var sentBodies: [DriverOfflineBatchRequest] = []
        await api.setReplayHandler { body in
            sentBodies.append(body)
            return DriverOfflineBatchResponse(results: body.actions.map {
                DriverOfflineReplayResult(clientId: $0.clientId, status: "applied", errorCode: nil, errorMessage: nil)
            })
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let localStore = try FileLocalStore(root: root)
        let engine = SyncEngine(api: api, outbox: outbox, localStore: localStore)

        _ = try outbox.enqueue(.acknowledgeBriefing(
            briefingId: "br1", acknowledgedAt: "2026-05-23T12:00:00Z", attemptedAt: Date()
        ))
        _ = try outbox.enqueue(.fieldPaymentCapture(intentId: "pi1", attemptedAt: Date()))

        await engine.drain()
        XCTAssertEqual(outbox.pending().count, 0)
        XCTAssertEqual(sentBodies.count, 1)
        XCTAssertEqual(sentBodies.first?.actions.count, 2)
    }

    func testPartialFailureRetainsOnlyFailed() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setReplayHandler { body in
            DriverOfflineBatchResponse(results: body.actions.enumerated().map { idx, action in
                if idx == 0 {
                    return DriverOfflineReplayResult(clientId: action.clientId, status: "applied", errorCode: nil, errorMessage: nil)
                }
                return DriverOfflineReplayResult(
                    clientId: action.clientId, status: "failed",
                    errorCode: "validation_error", errorMessage: "missing field"
                )
            })
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let engine = SyncEngine(api: api, outbox: outbox, localStore: try FileLocalStore(root: root))

        _ = try outbox.enqueue(.acknowledgeBriefing(briefingId: "br1", acknowledgedAt: "2026-05-23T12:00:00Z", attemptedAt: Date()))
        _ = try outbox.enqueue(.fieldPaymentCapture(intentId: "pi1", attemptedAt: Date()))

        await engine.drain()
        XCTAssertEqual(outbox.pending().count, 1)
        XCTAssertEqual(outbox.pending().first?.lastErrorMessage, "missing field")
    }

    func testBatch404FallsThroughToPerItemDrain() async throws {
        // When /replay returns 404, the engine flips to per-item drain.
        // Per-item drain for acknowledgeBriefing calls api.acknowledgeBriefing
        // which our stub answers with a synthesized ack — succeeds.
        let api = StubUSTowDispatchAPI()
        await api.setReplayHandler { _ in
            throw APIError.http(status: 404, message: "Cannot POST /driver-offline-sync/replay")
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let engine = SyncEngine(api: api, outbox: outbox, localStore: try FileLocalStore(root: root))

        _ = try outbox.enqueue(.acknowledgeBriefing(briefingId: "br1", acknowledgedAt: "2026-05-23T12:00:00Z", attemptedAt: Date()))
        await engine.drain()
        XCTAssertEqual(outbox.pending().count, 0, "per-item drain should have cleared the item after 404 fallback")
    }
}
