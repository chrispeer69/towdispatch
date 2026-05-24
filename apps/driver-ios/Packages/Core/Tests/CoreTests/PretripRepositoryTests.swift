import XCTest
@testable import Core

final class PretripRepositoryTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("pretrip-test-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testFreshShiftRequiresInspection() async throws {
        let api = StubUSTowDispatchAPI()
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = PretripRepository(api: api, outbox: outbox)
        _ = try await repo.refresh()
        let requires = await repo.requiresFreshInspection()
        XCTAssertTrue(requires)
    }

    func testRecentPassingInspectionSatisfiesGate() async throws {
        let api = StubUSTowDispatchAPI()
        let now = Date()
        await api.setMyRecentPretripsHandler {
            [DriverPretripInspection(
                id: "p1", tenantId: "t1", driverId: "d1", truckId: "tr1",
                shiftId: nil, status: .pass, items: [],
                odometerMiles: nil, notes: nil,
                submittedAt: ISO8601DateFormatter().string(from: now),
                createdAt: ISO8601DateFormatter().string(from: now)
            )]
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = PretripRepository(api: api, outbox: outbox)
        _ = try await repo.refresh()
        let requires = await repo.requiresFreshInspection(now: now)
        XCTAssertFalse(requires)
    }

    func testSubmitEnqueuesOutboxAction() async throws {
        let api = StubUSTowDispatchAPI()
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = PretripRepository(api: api, outbox: outbox)
        let payload = CreatePretripInspectionPayload(
            truckId: "tr1", status: .pass, items: [],
            submittedAt: ISO8601DateFormatter().string(from: Date())
        )
        try await repo.submit(payload)
        XCTAssertEqual(outbox.pending().count, 1)
        guard case .submitPretrip(let p, _) = outbox.pending().first?.action else {
            XCTFail("Expected submitPretrip outbox entry")
            return
        }
        XCTAssertEqual(p.truckId, "tr1")
    }

    func testFormBuilderRollupAndValidation() throws {
        var form = PretripFormBuilder.defaultCategories
        for catIdx in form.indices {
            for itemIdx in form[catIdx].items.indices {
                form[catIdx].items[itemIdx].state = .ok
            }
        }
        XCTAssertEqual(PretripFormBuilder.rollupStatus(form), .pass)

        // Marking brakes_service as fail → unsafe.
        if let brakesIdx = form.firstIndex(where: { $0.key == "tires_brakes" }) {
            if let itemIdx = form[brakesIdx].items.firstIndex(where: { $0.key == "brakes_service" }) {
                form[brakesIdx].items[itemIdx].state = .fail
                form[brakesIdx].items[itemIdx].note = "Soft pedal"
                form[brakesIdx].items[itemIdx].photoKeys = ["evidence-1"]
            }
        }
        XCTAssertEqual(PretripFormBuilder.rollupStatus(form), .failUnsafe)

        // Mirrors validation: fail without note throws.
        var bad = PretripFormBuilder.defaultCategories
        bad[0].items[0].state = .fail
        XCTAssertThrowsError(
            try PretripFormBuilder.buildPayload(form: bad, truckId: "tr1")
        )
    }
}
