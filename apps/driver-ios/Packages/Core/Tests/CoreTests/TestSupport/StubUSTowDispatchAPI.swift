/// Shared test stub for `USTowDispatchAPI`.
///
/// Every method has a mutable `var ... Handler` closure. Default closures
/// return sensible safe defaults (empty arrays, `fatalError()` for shapes
/// that have no neutral default). Tests construct `StubUSTowDispatchAPI()`
/// then override only the handlers they care about, e.g.:
///
///     let api = StubUSTowDispatchAPI()
///     await api.setDriverPinLoginHandler { _ in
///       DriverLoginResponse(accessToken: "tok", expiresIn: 43200,
///         driver: .init(id: "d1", firstName: "F", lastName: "L", preferredName: nil, employeeNumber: nil),
///         tenant: .init(id: "t1", slug: "demo", name: "Demo"))
///     }
///
/// Using closures (not subclassing) keeps the helper a single actor — tests
/// don't have to re-declare 40+ no-op methods every time they want to stub
/// one or two calls.
import Foundation
@testable import Core

actor StubUSTowDispatchAPI: USTowDispatchAPI {
    // MARK: - Handler storage

    var loginHandler: (LoginRequest) async throws -> LoginResponse = { _ in
        fatalError("StubUSTowDispatchAPI.login not configured")
    }
    var refreshHandler: (RefreshRequest) async throws -> RefreshResponse = { _ in
        fatalError("StubUSTowDispatchAPI.refresh not configured")
    }
    var logoutHandler: (LogoutRequest) async throws -> Void = { _ in }
    var meHandler: () async throws -> MeResponse = {
        fatalError("StubUSTowDispatchAPI.me not configured")
    }
    var myJobsHandler: () async throws -> [MyJob] = { [] }
    var myDriverProfileHandler: () async throws -> DriverProfile = {
        fatalError("StubUSTowDispatchAPI.myDriverProfile not configured")
    }
    var transitionHandler: (String, JobStatus, String?) async throws -> Job = { _, _, _ in
        fatalError("StubUSTowDispatchAPI.transition not configured")
    }
    var cancelHandler: (String, String) async throws -> Job = { _, _ in
        fatalError("StubUSTowDispatchAPI.cancel not configured")
    }
    var uploadJobPhotoHandler: (String, PhotoUploadRequest) async throws -> PhotoUploadResponse = { _, _ in
        fatalError("StubUSTowDispatchAPI.uploadJobPhoto not configured")
    }

    // Session 6.1
    var submitDvirHandler: (CreateDvirPayload) async throws -> Dvir = { _ in
        fatalError("StubUSTowDispatchAPI.submitDvir not configured")
    }
    var listDvirsHandler: (String?, String?) async throws -> [Dvir] = { _, _ in [] }
    var uploadDocumentHandler: (UploadDocumentRequest) async throws -> FleetDocument = { _ in
        fatalError("StubUSTowDispatchAPI.uploadDocument not configured")
    }
    var listDocumentsHandler: (DocumentOwnerType?, String?) async throws -> [FleetDocument] = { _, _ in [] }
    var listExpirationsHandler: () async throws -> ExpirationsResponse = {
        fatalError("StubUSTowDispatchAPI.listExpirations not configured")
    }
    var driverTrucksHandler: (String) async throws -> [DriverTruckAssignment] = { _ in [] }
    var startShiftHandler: (String, String?) async throws -> DriverShift = { _, _ in
        fatalError("StubUSTowDispatchAPI.startShift not configured")
    }
    var endShiftHandler: (String) async throws -> DriverShift = { _ in
        fatalError("StubUSTowDispatchAPI.endShift not configured")
    }
    var updateShiftStatusHandler: (String, DriverShiftStatus) async throws -> DriverShift = { _, _ in
        fatalError("StubUSTowDispatchAPI.updateShiftStatus not configured")
    }
    var updateShiftLocationHandler: (String, Double, Double) async throws -> DriverShift = { _, _, _ in
        fatalError("StubUSTowDispatchAPI.updateShiftLocation not configured")
    }
    var sendChatMessageHandler: (SendChatMessageRequest) async throws -> ChatMessage = { _ in
        fatalError("StubUSTowDispatchAPI.sendChatMessage not configured")
    }
    var listChatMessagesHandler: (String) async throws -> [ChatMessage] = { _ in [] }

    // Session 7
    var driverListByTenantHandler: (DriverListByTenantRequest) async throws -> DriverPickerResponse = { _ in
        fatalError("StubUSTowDispatchAPI.driverListByTenant not configured")
    }
    var driverLookupByCodeHandler: (DriverLookupByCodeRequest) async throws -> DriverPickerResponse = { _ in
        fatalError("StubUSTowDispatchAPI.driverLookupByCode not configured")
    }
    var driverPinLoginHandler: (DriverPinLoginRequest) async throws -> DriverLoginResponse = { _ in
        fatalError("StubUSTowDispatchAPI.driverPinLogin not configured")
    }
    var driverSetPinHandler: (SetPinRequest) async throws -> Void = { _ in }
    var driverClearFailedAttemptsHandler: (ClearFailedAttemptsRequest) async throws -> Void = { _ in }

    var activeBriefingHandler: () async throws -> DriverDailyBriefing? = { nil }
    var briefingNeedsAcknowledgmentHandler: () async throws -> BriefingNeedsResponse = {
        BriefingNeedsResponse(needs: false, briefing: nil)
    }
    var acknowledgeBriefingHandler: (String, AcknowledgeBriefingRequest) async throws -> DriverBriefingAcknowledgment = { id, body in
        DriverBriefingAcknowledgment(id: UUID().uuidString, briefingId: id, driverId: "d1", acknowledgedAt: body.acknowledgedAt)
    }

    var submitPretripHandler: (CreatePretripInspectionPayload) async throws -> DriverPretripInspection = { _ in
        fatalError("StubUSTowDispatchAPI.submitPretrip not configured")
    }
    var myRecentPretripsHandler: () async throws -> [DriverPretripInspection] = { [] }

    var presignEvidenceHandler: (JobEvidencePresignRequest) async throws -> JobEvidencePresignResponse = { _ in
        fatalError("StubUSTowDispatchAPI.presignEvidence not configured")
    }
    var finalizeEvidenceHandler: (String, JobEvidenceFinalizeRequest) async throws -> JobEvidence = { _, _ in
        fatalError("StubUSTowDispatchAPI.finalizeEvidence not configured")
    }
    var failEvidenceHandler: (String, JobEvidenceFailRequest) async throws -> JobEvidence = { _, _ in
        fatalError("StubUSTowDispatchAPI.failEvidence not configured")
    }
    var listJobEvidenceHandler: (String) async throws -> [JobEvidence] = { _ in [] }

    var replayOfflineActionsHandler: (DriverOfflineBatchRequest) async throws -> DriverOfflineBatchResponse = { req in
        DriverOfflineBatchResponse(results: req.actions.map {
            DriverOfflineReplayResult(clientId: $0.clientId, status: "applied", errorCode: nil, errorMessage: nil)
        })
    }

    var pingTelemetryHandler: (DriverTelemetryEvent) async throws -> DriverTelemetryEventDto = { _ in
        fatalError("StubUSTowDispatchAPI.pingTelemetry not configured")
    }
    var batchTelemetryHandler: (DriverTelemetryBatchRequest) async throws -> DriverTelemetryBatchResponse = { req in
        DriverTelemetryBatchResponse(inserted: req.events.count)
    }

    var createFieldPaymentIntentHandler: (CreateFieldPaymentPayload) async throws -> JobFieldPayment = { _ in
        fatalError("StubUSTowDispatchAPI.createFieldPaymentIntent not configured")
    }
    var captureFieldPaymentHandler: (String) async throws -> JobFieldPayment = { _ in
        fatalError("StubUSTowDispatchAPI.captureFieldPayment not configured")
    }
    var cancelFieldPaymentHandler: (String) async throws -> JobFieldPayment = { _ in
        fatalError("StubUSTowDispatchAPI.cancelFieldPayment not configured")
    }

    var driverCheckInHandler: (String, String?) async throws -> DriverShift = { _, _ in
        fatalError("StubUSTowDispatchAPI.driverCheckIn not configured")
    }
    var driverCheckOutHandler: () async throws -> DriverShift = {
        fatalError("StubUSTowDispatchAPI.driverCheckOut not configured")
    }
    var driverActiveShiftHandler: () async throws -> DriverShift? = { nil }
    var driverMyJobsHandler: () async throws -> [MyJob] = { [] }
    var driverJobHandler: (String) async throws -> Job = { _ in
        fatalError("StubUSTowDispatchAPI.driverJob not configured")
    }

    // MARK: - Handler setters (actor-isolated mutation)

    func setLoginHandler(_ h: @escaping (LoginRequest) async throws -> LoginResponse) { loginHandler = h }
    func setRefreshHandler(_ h: @escaping (RefreshRequest) async throws -> RefreshResponse) { refreshHandler = h }
    func setDriverPinLoginHandler(_ h: @escaping (DriverPinLoginRequest) async throws -> DriverLoginResponse) { driverPinLoginHandler = h }
    func setBriefingNeedsHandler(_ h: @escaping () async throws -> BriefingNeedsResponse) { briefingNeedsAcknowledgmentHandler = h }
    func setSubmitPretripHandler(_ h: @escaping (CreatePretripInspectionPayload) async throws -> DriverPretripInspection) { submitPretripHandler = h }
    func setMyRecentPretripsHandler(_ h: @escaping () async throws -> [DriverPretripInspection]) { myRecentPretripsHandler = h }
    func setPresignEvidenceHandler(_ h: @escaping (JobEvidencePresignRequest) async throws -> JobEvidencePresignResponse) { presignEvidenceHandler = h }
    func setFinalizeEvidenceHandler(_ h: @escaping (String, JobEvidenceFinalizeRequest) async throws -> JobEvidence) { finalizeEvidenceHandler = h }
    func setFailEvidenceHandler(_ h: @escaping (String, JobEvidenceFailRequest) async throws -> JobEvidence) { failEvidenceHandler = h }
    func setReplayHandler(_ h: @escaping (DriverOfflineBatchRequest) async throws -> DriverOfflineBatchResponse) { replayOfflineActionsHandler = h }
    func setBatchTelemetryHandler(_ h: @escaping (DriverTelemetryBatchRequest) async throws -> DriverTelemetryBatchResponse) { batchTelemetryHandler = h }
    func setDriverLookupByCodeHandler(_ h: @escaping (DriverLookupByCodeRequest) async throws -> DriverPickerResponse) { driverLookupByCodeHandler = h }

    // MARK: - Protocol conformance

    func login(_ body: LoginRequest) async throws -> LoginResponse { try await loginHandler(body) }
    func refresh(_ body: RefreshRequest) async throws -> RefreshResponse { try await refreshHandler(body) }
    func logout(_ body: LogoutRequest) async throws { try await logoutHandler(body) }
    func me() async throws -> MeResponse { try await meHandler() }
    func myJobs() async throws -> [MyJob] { try await myJobsHandler() }
    func myDriverProfile() async throws -> DriverProfile { try await myDriverProfileHandler() }
    func transition(jobId: String, to: JobStatus, reason: String?) async throws -> Job {
        try await transitionHandler(jobId, to, reason)
    }
    func cancel(jobId: String, reason: String) async throws -> Job {
        try await cancelHandler(jobId, reason)
    }
    func uploadJobPhoto(jobId: String, photo: PhotoUploadRequest) async throws -> PhotoUploadResponse {
        try await uploadJobPhotoHandler(jobId, photo)
    }
    func submitDvir(_ body: CreateDvirPayload) async throws -> Dvir { try await submitDvirHandler(body) }
    func listDvirs(driverId: String?, truckId: String?) async throws -> [Dvir] {
        try await listDvirsHandler(driverId, truckId)
    }
    func uploadDocument(_ body: UploadDocumentRequest) async throws -> FleetDocument { try await uploadDocumentHandler(body) }
    func listDocuments(ownerType: DocumentOwnerType?, ownerId: String?) async throws -> [FleetDocument] {
        try await listDocumentsHandler(ownerType, ownerId)
    }
    func listExpirations() async throws -> ExpirationsResponse { try await listExpirationsHandler() }
    func driverTrucks(driverId: String) async throws -> [DriverTruckAssignment] { try await driverTrucksHandler(driverId) }
    func startShift(driverId: String, truckId: String?) async throws -> DriverShift {
        try await startShiftHandler(driverId, truckId)
    }
    func endShift(shiftId: String) async throws -> DriverShift { try await endShiftHandler(shiftId) }
    func updateShiftStatus(shiftId: String, status: DriverShiftStatus) async throws -> DriverShift {
        try await updateShiftStatusHandler(shiftId, status)
    }
    func updateShiftLocation(shiftId: String, lat: Double, lng: Double) async throws -> DriverShift {
        try await updateShiftLocationHandler(shiftId, lat, lng)
    }
    func sendChatMessage(_ body: SendChatMessageRequest) async throws -> ChatMessage { try await sendChatMessageHandler(body) }
    func listChatMessages(jobId: String) async throws -> [ChatMessage] { try await listChatMessagesHandler(jobId) }

    func driverListByTenant(_ body: DriverListByTenantRequest) async throws -> DriverPickerResponse { try await driverListByTenantHandler(body) }
    func driverLookupByCode(_ body: DriverLookupByCodeRequest) async throws -> DriverPickerResponse { try await driverLookupByCodeHandler(body) }
    func driverPinLogin(_ body: DriverPinLoginRequest) async throws -> DriverLoginResponse { try await driverPinLoginHandler(body) }
    func driverSetPin(_ body: SetPinRequest) async throws { try await driverSetPinHandler(body) }
    func driverClearFailedAttempts(_ body: ClearFailedAttemptsRequest) async throws { try await driverClearFailedAttemptsHandler(body) }

    func activeBriefing() async throws -> DriverDailyBriefing? { try await activeBriefingHandler() }
    func briefingNeedsAcknowledgment() async throws -> BriefingNeedsResponse { try await briefingNeedsAcknowledgmentHandler() }
    func acknowledgeBriefing(id: String, body: AcknowledgeBriefingRequest) async throws -> DriverBriefingAcknowledgment {
        try await acknowledgeBriefingHandler(id, body)
    }

    func submitPretrip(_ body: CreatePretripInspectionPayload) async throws -> DriverPretripInspection { try await submitPretripHandler(body) }
    func myRecentPretrips() async throws -> [DriverPretripInspection] { try await myRecentPretripsHandler() }

    func presignEvidence(_ body: JobEvidencePresignRequest) async throws -> JobEvidencePresignResponse { try await presignEvidenceHandler(body) }
    func finalizeEvidence(id: String, body: JobEvidenceFinalizeRequest) async throws -> JobEvidence { try await finalizeEvidenceHandler(id, body) }
    func failEvidence(id: String, body: JobEvidenceFailRequest) async throws -> JobEvidence { try await failEvidenceHandler(id, body) }
    func listJobEvidence(jobId: String) async throws -> [JobEvidence] { try await listJobEvidenceHandler(jobId) }

    func replayOfflineActions(_ body: DriverOfflineBatchRequest) async throws -> DriverOfflineBatchResponse { try await replayOfflineActionsHandler(body) }

    func pingTelemetry(_ body: DriverTelemetryEvent) async throws -> DriverTelemetryEventDto { try await pingTelemetryHandler(body) }
    func batchTelemetry(_ body: DriverTelemetryBatchRequest) async throws -> DriverTelemetryBatchResponse { try await batchTelemetryHandler(body) }

    func createFieldPaymentIntent(_ body: CreateFieldPaymentPayload) async throws -> JobFieldPayment { try await createFieldPaymentIntentHandler(body) }
    func captureFieldPayment(id: String) async throws -> JobFieldPayment { try await captureFieldPaymentHandler(id) }
    func cancelFieldPayment(id: String) async throws -> JobFieldPayment { try await cancelFieldPaymentHandler(id) }

    func driverCheckIn(truckId: String, dvirId: String?) async throws -> DriverShift { try await driverCheckInHandler(truckId, dvirId) }
    func driverCheckOut() async throws -> DriverShift { try await driverCheckOutHandler() }
    func driverActiveShift() async throws -> DriverShift? { try await driverActiveShiftHandler() }
    func driverMyJobs() async throws -> [MyJob] { try await driverMyJobsHandler() }
    func driverJob(id: String) async throws -> Job { try await driverJobHandler(id) }
}
