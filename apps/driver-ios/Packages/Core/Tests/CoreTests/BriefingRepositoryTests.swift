import XCTest
@testable import Core

final class BriefingRepositoryTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("briefing-test-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testRefreshCachesServerResponse() async throws {
        let api = StubUSTowDispatchAPI()
        let briefing = sampleBriefing(mandatory: true)
        await api.setBriefingNeedsHandler {
            BriefingNeedsResponse(needs: true, briefing: briefing)
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = BriefingRepository(api: api, outbox: outbox, localAck: InMemoryBriefingAckStore())
        let resp = try await repo.refresh()
        XCTAssertTrue(resp.needs)
        let decision = await repo.bannerDecision()
        if case .banner(let b) = decision {
            XCTAssertEqual(b.id, briefing.id)
        } else {
            XCTFail("Expected .banner decision, got \(decision)")
        }
        let requires = await repo.requiresAcknowledgment()
        XCTAssertTrue(requires)
    }

    func testAcknowledgeEnqueuesActionAndFlipsGate() async throws {
        let api = StubUSTowDispatchAPI()
        let briefing = sampleBriefing(mandatory: true)
        await api.setBriefingNeedsHandler {
            BriefingNeedsResponse(needs: true, briefing: briefing)
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let ackStore = InMemoryBriefingAckStore()
        let repo = BriefingRepository(api: api, outbox: outbox, localAck: ackStore)
        _ = try await repo.refresh()

        try await repo.acknowledge(briefingId: briefing.id)

        XCTAssertEqual(outbox.pending().count, 1)
        guard case .acknowledgeBriefing(let id, _, _) = outbox.pending().first?.action else {
            XCTFail("Expected acknowledgeBriefing outbox entry")
            return
        }
        XCTAssertEqual(id, briefing.id)
        let stillRequires = await repo.requiresAcknowledgment()
        XCTAssertFalse(stillRequires)
        XCTAssertEqual(ackStore.read().briefingId, briefing.id)
    }

    func testNonMandatoryBriefingDoesNotGate() async throws {
        let api = StubUSTowDispatchAPI()
        let briefing = sampleBriefing(mandatory: false)
        await api.setBriefingNeedsHandler {
            BriefingNeedsResponse(needs: true, briefing: briefing)
        }
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = BriefingRepository(api: api, outbox: outbox, localAck: InMemoryBriefingAckStore())
        _ = try await repo.refresh()
        let requires = await repo.requiresAcknowledgment()
        XCTAssertFalse(requires)
    }

    private func sampleBriefing(mandatory: Bool) -> DriverDailyBriefing {
        DriverDailyBriefing(
            id: "br1", tenantId: "t1", title: "Daily Safety",
            bodyMarkdown: "**Watch for ice**", videoUrl: nil,
            activeFrom: "2026-05-23T00:00:00Z", activeUntil: nil,
            mandatory: mandatory,
            createdAt: "2026-05-23T00:00:00Z",
            updatedAt: "2026-05-23T00:00:00Z"
        )
    }
}
