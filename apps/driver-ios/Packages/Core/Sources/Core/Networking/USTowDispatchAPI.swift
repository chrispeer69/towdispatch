import Foundation

/// High-level API surface used by the app. Wraps the lower-level `APIClient`.
public protocol USTowDispatchAPI: Sendable {
    func login(_ body: LoginRequest) async throws -> LoginResponse
    func refresh(_ body: RefreshRequest) async throws -> RefreshResponse
    func logout(_ body: LogoutRequest) async throws
    func me() async throws -> MeResponse
    func myJobs() async throws -> [MyJob]
    func myDriverProfile() async throws -> DriverProfile
    func transition(jobId: String, to: JobStatus, reason: String?) async throws -> Job
    func cancel(jobId: String, reason: String) async throws -> Job
    func uploadJobPhoto(jobId: String, photo: PhotoUploadRequest) async throws -> PhotoUploadResponse

    // Session 6.1
    func submitDvir(_ body: CreateDvirPayload) async throws -> Dvir
    func listDvirs(driverId: String?, truckId: String?) async throws -> [Dvir]
    func uploadDocument(_ body: UploadDocumentRequest) async throws -> FleetDocument
    func listDocuments(ownerType: DocumentOwnerType?, ownerId: String?) async throws -> [FleetDocument]
    func listExpirations() async throws -> ExpirationsResponse
    func driverTrucks(driverId: String) async throws -> [DriverTruckAssignment]

    func startShift(driverId: String, truckId: String?) async throws -> DriverShift
    func endShift(shiftId: String) async throws -> DriverShift
    func updateShiftStatus(shiftId: String, status: DriverShiftStatus) async throws -> DriverShift
    func updateShiftLocation(shiftId: String, lat: Double, lng: Double) async throws -> DriverShift

    func sendChatMessage(_ body: SendChatMessageRequest) async throws -> ChatMessage
    func listChatMessages(jobId: String) async throws -> [ChatMessage]
}

public struct DriverTruckAssignment: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let driverId: String
    public let truckId: String
    public let isPrimary: Bool
    public let createdAt: String
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

public actor LiveUSTowDispatchAPI: USTowDispatchAPI {
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

    // ---------- Session 6.1 ----------

    public func submitDvir(_ body: CreateDvirPayload) async throws -> Dvir {
        try await client.request(.POST, Endpoints.dvirs, body: body, authorize: true)
    }

    public func listDvirs(driverId: String? = nil, truckId: String? = nil) async throws -> [Dvir] {
        var path = Endpoints.dvirs
        var qs: [String] = []
        if let driverId { qs.append("driverId=\(driverId)") }
        if let truckId { qs.append("truckId=\(truckId)") }
        if !qs.isEmpty { path += "?" + qs.joined(separator: "&") }
        return try await client.request(.GET, path, body: nil, authorize: true)
    }

    public func uploadDocument(_ body: UploadDocumentRequest) async throws -> FleetDocument {
        try await client.request(.POST, Endpoints.fleetDocuments, body: body, authorize: true)
    }

    public func listDocuments(ownerType: DocumentOwnerType? = nil, ownerId: String? = nil) async throws -> [FleetDocument] {
        var path = Endpoints.fleetDocuments
        var qs: [String] = []
        if let ownerType { qs.append("ownerType=\(ownerType.rawValue)") }
        if let ownerId { qs.append("ownerId=\(ownerId)") }
        if !qs.isEmpty { path += "?" + qs.joined(separator: "&") }
        return try await client.request(.GET, path, body: nil, authorize: true)
    }

    public func listExpirations() async throws -> ExpirationsResponse {
        try await client.request(.GET, Endpoints.fleetExpirations, body: nil, authorize: true)
    }

    public func driverTrucks(driverId: String) async throws -> [DriverTruckAssignment] {
        try await client.request(.GET, Endpoints.driverTrucks(driverId: driverId), body: nil, authorize: true)
    }

    public func startShift(driverId: String, truckId: String? = nil) async throws -> DriverShift {
        try await client.request(
            .POST, Endpoints.startShift,
            body: StartShiftRequest(driverId: driverId, truckId: truckId),
            authorize: true
        )
    }

    public func endShift(shiftId: String) async throws -> DriverShift {
        try await client.request(
            .POST, Endpoints.endShift,
            body: EndShiftRequest(shiftId: shiftId),
            authorize: true
        )
    }

    public func updateShiftStatus(shiftId: String, status: DriverShiftStatus) async throws -> DriverShift {
        try await client.request(
            .POST, Endpoints.shiftStatus(shiftId: shiftId),
            body: UpdateShiftStatusRequest(status: status),
            authorize: true
        )
    }

    public func updateShiftLocation(shiftId: String, lat: Double, lng: Double) async throws -> DriverShift {
        try await client.request(
            .POST, Endpoints.shiftLocation(shiftId: shiftId),
            body: UpdateShiftLocationRequest(lat: lat, lng: lng),
            authorize: true
        )
    }

    public func sendChatMessage(_ body: SendChatMessageRequest) async throws -> ChatMessage {
        try await client.request(.POST, Endpoints.chatThread(jobId: body.jobId), body: body, authorize: true)
    }

    public func listChatMessages(jobId: String) async throws -> [ChatMessage] {
        try await client.request(.GET, Endpoints.chatThread(jobId: jobId), body: nil, authorize: true)
    }
}
