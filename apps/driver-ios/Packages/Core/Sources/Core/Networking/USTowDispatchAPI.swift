import Foundation

/// High-level API surface used by the app. Wraps the lower-level `APIClient`.
///
/// The protocol grew significantly in Session 7. Methods are grouped by
/// the controller they target so the call sites in repositories can scan
/// the surface quickly.
public protocol USTowDispatchAPI: Sendable {
    // ---------- Operator auth ----------
    func login(_ body: LoginRequest) async throws -> LoginResponse
    func refresh(_ body: RefreshRequest) async throws -> RefreshResponse
    func logout(_ body: LogoutRequest) async throws
    func me() async throws -> MeResponse
    func myJobs() async throws -> [MyJob]
    func myDriverProfile() async throws -> DriverProfile
    func transition(jobId: String, to: JobStatus, reason: String?) async throws -> Job
    func cancel(jobId: String, reason: String) async throws -> Job
    func uploadJobPhoto(jobId: String, photo: PhotoUploadRequest) async throws -> PhotoUploadResponse

    // ---------- Session 6.1 (operator-shared fleet + chat) ----------
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

    // ---------- Session 7: Driver PIN auth ----------
    func driverListByTenant(_ body: DriverListByTenantRequest) async throws -> DriverPickerResponse
    func driverLookupByCode(_ body: DriverLookupByCodeRequest) async throws -> DriverPickerResponse
    func driverPinLogin(_ body: DriverPinLoginRequest) async throws -> DriverLoginResponse
    func driverSetPin(_ body: SetPinRequest) async throws
    func driverClearFailedAttempts(_ body: ClearFailedAttemptsRequest) async throws

    // ---------- Session 7: Daily briefing ----------
    func activeBriefing() async throws -> DriverDailyBriefing?
    func briefingNeedsAcknowledgment() async throws -> BriefingNeedsResponse
    func acknowledgeBriefing(id: String, body: AcknowledgeBriefingRequest) async throws -> DriverBriefingAcknowledgment

    // ---------- Session 7: Pre-trip ----------
    func submitPretrip(_ body: CreatePretripInspectionPayload) async throws -> DriverPretripInspection
    func myRecentPretrips() async throws -> [DriverPretripInspection]

    // ---------- Session 7: Evidence (S3 presign → PUT → finalize) ----------
    func presignEvidence(_ body: JobEvidencePresignRequest) async throws -> JobEvidencePresignResponse
    func finalizeEvidence(id: String, body: JobEvidenceFinalizeRequest) async throws -> JobEvidence
    func failEvidence(id: String, body: JobEvidenceFailRequest) async throws -> JobEvidence
    func listJobEvidence(jobId: String) async throws -> [JobEvidence]

    // ---------- Session 7: Offline-sync replay ----------
    /// Batched outbox drain. Returns per-item results so the caller can
    /// retain only the failed items. On 404 (route absent), the SyncEngine
    /// falls back to per-item drain via the individual endpoints.
    func replayOfflineActions(_ body: DriverOfflineBatchRequest) async throws -> DriverOfflineBatchResponse

    // ---------- Session 7: Driver telemetry ----------
    func pingTelemetry(_ body: DriverTelemetryEvent) async throws -> DriverTelemetryEventDto
    func batchTelemetry(_ body: DriverTelemetryBatchRequest) async throws -> DriverTelemetryBatchResponse

    // ---------- Session 7: Field payments ----------
    func createFieldPaymentIntent(_ body: CreateFieldPaymentPayload) async throws -> JobFieldPayment
    func captureFieldPayment(id: String) async throws -> JobFieldPayment
    func cancelFieldPayment(id: String) async throws -> JobFieldPayment

    // ---------- Session 7: Driver-scope shifts + jobs (PIN-gated mirror) ----------
    func driverCheckIn(truckId: String, dvirId: String?) async throws -> DriverShift
    func driverCheckOut() async throws -> DriverShift
    func driverActiveShift() async throws -> DriverShift?
    func driverMyJobs() async throws -> [MyJob]
    func driverJob(id: String) async throws -> Job
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

public struct DriverCheckInRequest: Codable, Sendable {
    public let truckId: String
    public let dvirId: String?
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

    // ---------- Session 7: Driver PIN auth ----------

    public func driverListByTenant(_ body: DriverListByTenantRequest) async throws -> DriverPickerResponse {
        try await client.request(.POST, Endpoints.driverAuthListByTenant, body: body, authorize: false)
    }

    public func driverLookupByCode(_ body: DriverLookupByCodeRequest) async throws -> DriverPickerResponse {
        try await client.request(.POST, Endpoints.driverAuthLookupByCode, body: body, authorize: false)
    }

    public func driverPinLogin(_ body: DriverPinLoginRequest) async throws -> DriverLoginResponse {
        try await client.request(.POST, Endpoints.driverAuthLogin, body: body, authorize: false)
    }

    public func driverSetPin(_ body: SetPinRequest) async throws {
        try await client.requestVoid(.POST, Endpoints.driverAuthSetPin, body: body, authorize: true)
    }

    public func driverClearFailedAttempts(_ body: ClearFailedAttemptsRequest) async throws {
        try await client.requestVoid(.POST, Endpoints.driverAuthClearFailedAttempts, body: body, authorize: true)
    }

    // ---------- Session 7: Daily briefing ----------

    public func activeBriefing() async throws -> DriverDailyBriefing? {
        try await client.request(.GET, Endpoints.driverBriefingActive, body: nil, authorize: true)
    }

    public func briefingNeedsAcknowledgment() async throws -> BriefingNeedsResponse {
        try await client.request(.GET, Endpoints.driverBriefingNeedsAck, body: nil, authorize: true)
    }

    public func acknowledgeBriefing(id: String, body: AcknowledgeBriefingRequest) async throws -> DriverBriefingAcknowledgment {
        try await client.request(.POST, Endpoints.driverBriefingAcknowledge(id: id), body: body, authorize: true)
    }

    // ---------- Session 7: Pre-trip ----------

    public func submitPretrip(_ body: CreatePretripInspectionPayload) async throws -> DriverPretripInspection {
        try await client.request(.POST, Endpoints.driverPretripSubmit, body: body, authorize: true)
    }

    public func myRecentPretrips() async throws -> [DriverPretripInspection] {
        try await client.request(.GET, Endpoints.driverPretripMyRecent, body: nil, authorize: true)
    }

    // ---------- Session 7: Evidence ----------

    public func presignEvidence(_ body: JobEvidencePresignRequest) async throws -> JobEvidencePresignResponse {
        try await client.request(.POST, Endpoints.evidencePresign, body: body, authorize: true)
    }

    public func finalizeEvidence(id: String, body: JobEvidenceFinalizeRequest) async throws -> JobEvidence {
        try await client.request(.POST, Endpoints.evidenceFinalize(id: id), body: body, authorize: true)
    }

    public func failEvidence(id: String, body: JobEvidenceFailRequest) async throws -> JobEvidence {
        try await client.request(.POST, Endpoints.evidenceFail(id: id), body: body, authorize: true)
    }

    public func listJobEvidence(jobId: String) async throws -> [JobEvidence] {
        try await client.request(.GET, Endpoints.jobEvidenceList(jobId: jobId), body: nil, authorize: true)
    }

    // ---------- Session 7: Offline-sync replay ----------

    public func replayOfflineActions(_ body: DriverOfflineBatchRequest) async throws -> DriverOfflineBatchResponse {
        try await client.request(.POST, Endpoints.driverOfflineSyncReplay, body: body, authorize: true)
    }

    // ---------- Session 7: Driver telemetry ----------

    public func pingTelemetry(_ body: DriverTelemetryEvent) async throws -> DriverTelemetryEventDto {
        try await client.request(.POST, Endpoints.driverTelemetryPing, body: body, authorize: true)
    }

    public func batchTelemetry(_ body: DriverTelemetryBatchRequest) async throws -> DriverTelemetryBatchResponse {
        try await client.request(.POST, Endpoints.driverTelemetryBatch, body: body, authorize: true)
    }

    // ---------- Session 7: Field payments ----------

    public func createFieldPaymentIntent(_ body: CreateFieldPaymentPayload) async throws -> JobFieldPayment {
        try await client.request(.POST, Endpoints.fieldPaymentCreateIntent, body: body, authorize: true)
    }

    public func captureFieldPayment(id: String) async throws -> JobFieldPayment {
        try await client.request(.POST, Endpoints.fieldPaymentCapture(id: id), body: nil, authorize: true)
    }

    public func cancelFieldPayment(id: String) async throws -> JobFieldPayment {
        try await client.request(.POST, Endpoints.fieldPaymentCancel(id: id), body: nil, authorize: true)
    }

    // ---------- Session 7: Driver-scope shifts + jobs ----------

    public func driverCheckIn(truckId: String, dvirId: String? = nil) async throws -> DriverShift {
        try await client.request(
            .POST,
            Endpoints.driverShiftsCheckIn,
            body: DriverCheckInRequest(truckId: truckId, dvirId: dvirId),
            authorize: true
        )
    }

    public func driverCheckOut() async throws -> DriverShift {
        try await client.request(.POST, Endpoints.driverShiftsCheckOut, body: nil, authorize: true)
    }

    public func driverActiveShift() async throws -> DriverShift? {
        try await client.request(.GET, Endpoints.driverShiftsMe, body: nil, authorize: true)
    }

    public func driverMyJobs() async throws -> [MyJob] {
        try await client.request(.GET, Endpoints.driverJobsMe, body: nil, authorize: true)
    }

    public func driverJob(id: String) async throws -> Job {
        try await client.request(.GET, Endpoints.driverJob(id: id), body: nil, authorize: true)
    }
}
