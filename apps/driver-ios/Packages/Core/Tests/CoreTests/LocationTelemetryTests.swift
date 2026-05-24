import XCTest
@testable import Core

final class LocationTelemetryTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("loc-tel-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testBufferReceivesSimulatedSamples() async throws {
        let api = StubUSTowDispatchAPI()
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let source = StubLocationSource()
        let tel = LocationTelemetry(api: api, outbox: outbox, source: source)
        await tel.start(shiftId: "shift1")
        source.simulate(LocationSample(lat: 40.0, lng: -75.0, timestamp: Date(), accuracyMeters: 10, speedMps: 22, headingDegrees: 90))
        source.simulate(LocationSample(lat: 40.01, lng: -75.01, timestamp: Date(), accuracyMeters: 9, speedMps: 24, headingDegrees: 91))
        // Yield a few times so the actor's append tasks settle.
        for _ in 0..<5 { await Task.yield() }
        let buf = await tel.buffered()
        XCTAssertEqual(buf.count, 2)
        await tel.stop()
    }

    func testFlushDrainsBufferAndCallsBatch() async throws {
        let api = StubUSTowDispatchAPI()
        var sentEventCount = 0
        await api.setBatchTelemetryHandler { req in
            sentEventCount += req.events.count
            return DriverTelemetryBatchResponse(inserted: req.events.count)
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let source = StubLocationSource()
        // Long flush interval so the explicit `flush()` is the only thing
        // that drains.
        let tel = LocationTelemetry(
            api: api, outbox: outbox, source: source,
            config: .init(flushIntervalSeconds: 9_000, maxBufferSize: 200)
        )
        await tel.start(shiftId: "shift1")
        source.simulate(LocationSample(lat: 1, lng: 2, timestamp: Date()))
        source.simulate(LocationSample(lat: 1, lng: 2, timestamp: Date()))
        source.simulate(LocationSample(lat: 1, lng: 2, timestamp: Date()))
        for _ in 0..<5 { await Task.yield() }
        await tel.flush()
        XCTAssertEqual(sentEventCount, 3)
        let bufAfter = await tel.buffered()
        XCTAssertEqual(bufAfter.count, 0)
        await tel.stop()
    }

    func testFlushFailureSpillsToOutbox() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setBatchTelemetryHandler { _ in
            throw APIError.offline
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let source = StubLocationSource()
        let tel = LocationTelemetry(
            api: api, outbox: outbox, source: source,
            config: .init(flushIntervalSeconds: 9_000, maxBufferSize: 200)
        )
        await tel.start(shiftId: "shift1")
        source.simulate(LocationSample(lat: 1, lng: 2, timestamp: Date()))
        for _ in 0..<5 { await Task.yield() }
        await tel.flush()
        XCTAssertEqual(outbox.pending().count, 1)
        guard case .telemetryBatch(let events, _) = outbox.pending().first?.action else {
            XCTFail("Expected telemetryBatch outbox entry")
            return
        }
        XCTAssertEqual(events.count, 1)
        await tel.stop()
    }
}
