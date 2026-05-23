import XCTest
@testable import Core

final class DocumentsRepositoryTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("docs-test-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testQueueUploadAddsToOutbox() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = DocumentsRepository(api: NoopAPIForDocs(), localStore: store, outbox: outbox)
        let request = UploadDocumentRequest(
            ownerType: .driver, ownerId: "d1", docType: .license,
            fileName: "lic.jpg", mimeType: "image/jpeg",
            contentBase64: "ZmFrZQ=="
        )
        try await repo.queueUpload(request)
        XCTAssertEqual(outbox.pending().count, 1)
    }

    func testFilterByOwnerId() async throws {
        let store = try FileLocalStore(root: root)
        let outbox = try FileOutbox(fileURL: root.appendingPathComponent("outbox.json"))
        let repo = DocumentsRepository(api: NoopAPIForDocs(), localStore: store, outbox: outbox)
        try store.upsertDocument(sampleDoc(id: "1", ownerId: "d1"))
        try store.upsertDocument(sampleDoc(id: "2", ownerId: "d2"))
        let mine = await repo.cachedDocuments(ownerId: "d1")
        XCTAssertEqual(mine.count, 1)
        XCTAssertEqual(mine.first?.id, "1")
    }

    private func sampleDoc(id: String, ownerId: String) -> FleetDocument {
        FleetDocument(
            id: id, tenantId: "t1",
            ownerType: .driver, ownerId: ownerId,
            docType: .license, fileUrl: "https://x", fileName: "x",
            mimeType: "image/jpeg", sizeBytes: 0, uploadedBy: nil,
            uploadedAt: "2026-01-01T00:00:00Z",
            expiresAt: nil, notes: nil
        )
    }
}

private actor NoopAPIForDocs: USTowDispatchAPI {
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

    func driverListByTenant(_ body: DriverListByTenantRequest) async throws -> DriverPickerResponse { fatalError() }
    func driverLookupByCode(_ body: DriverLookupByCodeRequest) async throws -> DriverPickerResponse { fatalError() }
    func driverPinLogin(_ body: DriverPinLoginRequest) async throws -> DriverLoginResponse { fatalError() }
    func driverSetPin(_ body: SetPinRequest) async throws {}
    func driverClearFailedAttempts(_ body: ClearFailedAttemptsRequest) async throws {}
    func activeBriefing() async throws -> DriverDailyBriefing? { nil }
    func briefingNeedsAcknowledgment() async throws -> BriefingNeedsResponse { BriefingNeedsResponse(needs: false, briefing: nil) }
    func acknowledgeBriefing(id: String, body: AcknowledgeBriefingRequest) async throws -> DriverBriefingAcknowledgment { fatalError() }
    func submitPretrip(_ body: CreatePretripInspectionPayload) async throws -> DriverPretripInspection { fatalError() }
    func myRecentPretrips() async throws -> [DriverPretripInspection] { [] }
    func presignEvidence(_ body: JobEvidencePresignRequest) async throws -> JobEvidencePresignResponse { fatalError() }
    func finalizeEvidence(id: String, body: JobEvidenceFinalizeRequest) async throws -> JobEvidence { fatalError() }
    func failEvidence(id: String, body: JobEvidenceFailRequest) async throws -> JobEvidence { fatalError() }
    func listJobEvidence(jobId: String) async throws -> [JobEvidence] { [] }
    func replayOfflineActions(_ body: DriverOfflineBatchRequest) async throws -> DriverOfflineBatchResponse { fatalError() }
    func pingTelemetry(_ body: DriverTelemetryEvent) async throws -> DriverTelemetryEventDto { fatalError() }
    func batchTelemetry(_ body: DriverTelemetryBatchRequest) async throws -> DriverTelemetryBatchResponse { DriverTelemetryBatchResponse(inserted: 0) }
    func createFieldPaymentIntent(_ body: CreateFieldPaymentPayload) async throws -> JobFieldPayment { fatalError() }
    func captureFieldPayment(id: String) async throws -> JobFieldPayment { fatalError() }
    func cancelFieldPayment(id: String) async throws -> JobFieldPayment { fatalError() }
    func driverCheckIn(truckId: String, dvirId: String?) async throws -> DriverShift { fatalError() }
    func driverCheckOut() async throws -> DriverShift { fatalError() }
    func driverActiveShift() async throws -> DriverShift? { nil }
    func driverMyJobs() async throws -> [MyJob] { [] }
    func driverJob(id: String) async throws -> Job { fatalError() }
}
