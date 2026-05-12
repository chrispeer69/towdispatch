import Foundation

/// High-level API surface used by the app. Wraps the lower-level `APIClient`.
public protocol TowCommandAPI: Sendable {
    func login(_ body: LoginRequest) async throws -> LoginResponse
    func refresh(_ body: RefreshRequest) async throws -> RefreshResponse
    func logout(_ body: LogoutRequest) async throws
    func me() async throws -> MeResponse
    func myJobs() async throws -> [MyJob]
    func myDriverProfile() async throws -> DriverProfile
    func transition(jobId: String, to: JobStatus, reason: String?) async throws -> Job
    func cancel(jobId: String, reason: String) async throws -> Job
    func uploadJobPhoto(jobId: String, photo: PhotoUploadRequest) async throws -> PhotoUploadResponse
}

public struct TransitionRequest: Codable, Sendable {
    public let to: String
    public let reason: String?
    public init(to: JobStatus, reason: String? = nil) {
        self.to = to.rawValue
        self.reason = reason
    }
}

public struct CancelRequest: Codable, Sendable {
    public let reason: String
    public init(reason: String) { self.reason = reason }
}

public actor LiveTowCommandAPI: TowCommandAPI {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func login(_ body: LoginRequest) async throws -> LoginResponse {
        try await client.request(.POST, Endpoints.login, body: body, authorize: false)
    }
    public func refresh(_ body: RefreshRequest) async throws -> RefreshResponse {
        try await client.request(.POST, Endpoints.refresh, body: body, authorize: false)
    }
    public func logout(_ body: LogoutRequest) async throws {
        try await client.requestVoid(.POST, Endpoints.logout, body: body, authorize: true)
    }
    public func me() async throws -> MeResponse {
        try await client.request(.GET, Endpoints.me, body: nil, authorize: true)
    }
    public func myJobs() async throws -> [MyJob] {
        try await client.request(.GET, Endpoints.myJobs, body: nil, authorize: true)
    }
    public func myDriverProfile() async throws -> DriverProfile {
        try await client.request(.GET, Endpoints.myDriverProfile, body: nil, authorize: true)
    }
    public func transition(jobId: String, to: JobStatus, reason: String? = nil) async throws -> Job {
        try await client.request(
            .POST,
            Endpoints.transition(jobId: jobId),
            body: TransitionRequest(to: to, reason: reason),
            authorize: true
        )
    }
    public func cancel(jobId: String, reason: String) async throws -> Job {
        try await client.request(
            .POST,
            Endpoints.cancel(jobId: jobId),
            body: CancelRequest(reason: reason),
            authorize: true
        )
    }
    public func uploadJobPhoto(jobId: String, photo: PhotoUploadRequest) async throws -> PhotoUploadResponse {
        try await client.request(
            .POST,
            Endpoints.uploadJobPhoto(jobId: jobId),
            body: photo,
            authorize: true
        )
    }
}
