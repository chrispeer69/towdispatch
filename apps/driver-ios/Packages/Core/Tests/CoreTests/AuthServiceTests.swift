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

private actor FakeAPI: TowCommandAPI {
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
}
