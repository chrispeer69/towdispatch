import XCTest
@testable import Core

final class AuthServiceTests: XCTestCase {

    func testSignInPersistsSession() async throws {
        let api = FakeAPI()
        let store = InMemoryTokenStore()
        let service = AuthService(api: api, store: store)

        let session = try await service.signIn(email: "a@b.com", password: "pw")
        XCTAssertEqual(session.user.id, "user-1")
        XCTAssertEqual(store.load()?.accessToken, "access-token")
        let signed = await service.isSignedIn()
        XCTAssertTrue(signed)
    }

    func testSignOutClearsSession() async throws {
        let api = FakeAPI()
        let store = InMemoryTokenStore()
        let service = AuthService(api: api, store: store)
        _ = try await service.signIn(email: "a@b.com", password: "pw")
        await service.signOut()
        XCTAssertNil(store.load())
        let signed = await service.isSignedIn()
        XCTAssertFalse(signed)
    }

    func testRefreshAccessToken() async throws {
        let api = FakeAPI()
        let store = InMemoryTokenStore()
        let service = AuthService(api: api, store: store)
        _ = try await service.signIn(email: "a@b.com", password: "pw")
        let newToken = try await service.refreshAccessToken()
        XCTAssertEqual(newToken, "refreshed-access")
    }
}

private actor FakeAPI: USTowDispatchAPI {
    func login(_ body: LoginRequest) async throws -> LoginResponse {
        LoginResponse(
            status: "ok",
            user: AuthUser(id: "user-1", email: body.email, firstName: "A", lastName: "B", role: "driver"),
            tenant: AuthTenant(id: "t1", slug: "demo", name: "Demo", status: "active"),
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresIn: 900
        )
    }
    func refresh(_ body: RefreshRequest) async throws -> RefreshResponse {
        RefreshResponse(accessToken: "refreshed-access", refreshToken: "refreshed-refresh", expiresIn: 900)
    }
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
