package ai.bluecollar.ustowdispatch.driver.data.api

import ai.bluecollar.ustowdispatch.driver.data.api.dto.AcknowledgeBriefingRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.BriefingNeedsResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.CancelRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.CreatePretripPayload
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverBriefingAcknowledgmentDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverDailyBriefingDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverListByTenantRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverLookupByCodeRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPickerResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPinLoginRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPinLoginResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPretripInspectionDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverProfileDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.FieldPaymentCreateIntentRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidenceDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidenceFailRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidenceFinalizeRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidencePresignRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidencePresignResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobFieldPaymentDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.LoginRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.LoginResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.LogoutRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.MeResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.MfaChallengeRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.MfaChallengeResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.MyJobDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.OfflineReplayBatchRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.OfflineReplayResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.PhotoUploadRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.PhotoUploadResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.RefreshRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.RefreshResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.TelemetryBatchRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.TransitionRequest
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface UsTowDispatchApi {
    // ---------------- Operator/legacy email+password auth ----------------

    @POST("/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("/auth/mfa/challenge")
    suspend fun mfaChallenge(@Body body: MfaChallengeRequest): MfaChallengeResponse

    @POST("/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): RefreshResponse

    @POST("/auth/logout")
    suspend fun logout(@Body body: LogoutRequest)

    @GET("/auth/me")
    suspend fun me(): MeResponse

    // ---------------- Jobs ----------------

    @GET("/dispatch/my-jobs")
    suspend fun myJobs(): List<MyJobDto>

    @GET("/dispatch/me/driver")
    suspend fun myDriverProfile(): DriverProfileDto

    @POST("/dispatch/jobs/{id}/transition")
    suspend fun transition(@Path("id") id: String, @Body body: TransitionRequest): JobDto

    @POST("/jobs/{id}/cancel")
    suspend fun cancel(@Path("id") id: String, @Body body: CancelRequest): JobDto

    /** Legacy inline base64 photo upload. Preferred path is /job-evidence presign+finalize below. */
    @POST("/dispatch/jobs/{id}/photos")
    suspend fun uploadJobPhoto(
        @Path("id") id: String,
        @Body body: PhotoUploadRequest,
    ): PhotoUploadResponse

    // ---------------- Driver PIN auth ----------------

    @POST("/driver-auth/lookup-by-code")
    suspend fun driverLookupByCode(@Body body: DriverLookupByCodeRequest): DriverPickerResponse

    @POST("/driver-auth/list-drivers")
    suspend fun driverListDrivers(@Body body: DriverListByTenantRequest): DriverPickerResponse

    @POST("/driver-auth/login")
    suspend fun driverPinLogin(@Body body: DriverPinLoginRequest): DriverPinLoginResponse

    // ---------------- Daily briefing ----------------

    @GET("/driver-briefings/active")
    suspend fun briefingActive(): DriverDailyBriefingDto

    @GET("/driver-briefings/needs-acknowledgment")
    suspend fun briefingNeedsAcknowledgment(): BriefingNeedsResponse

    @POST("/driver-briefings/{id}/acknowledge")
    suspend fun acknowledgeBriefing(
        @Path("id") id: String,
        @Body body: AcknowledgeBriefingRequest,
    ): DriverBriefingAcknowledgmentDto

    // ---------------- Pre-trip inspection ----------------

    @POST("/driver-pretrip")
    suspend fun submitPretrip(@Body body: CreatePretripPayload): DriverPretripInspectionDto

    @GET("/driver-pretrip/my-recent")
    suspend fun recentPretrips(): List<DriverPretripInspectionDto>

    // ---------------- Evidence (S3 presigned) ----------------

    @POST("/job-evidence/presign")
    suspend fun presignEvidence(@Body body: JobEvidencePresignRequest): JobEvidencePresignResponse

    @POST("/job-evidence/{id}/finalize")
    suspend fun finalizeEvidence(
        @Path("id") evidenceId: String,
        @Body body: JobEvidenceFinalizeRequest,
    ): JobEvidenceDto

    @POST("/job-evidence/{id}/fail")
    suspend fun failEvidence(
        @Path("id") evidenceId: String,
        @Body body: JobEvidenceFailRequest,
    ): JobEvidenceDto

    // ---------------- Offline replay (batch) ----------------

    @POST("/driver-offline-sync/replay")
    suspend fun replayOfflineBatch(@Body body: OfflineReplayBatchRequest): OfflineReplayResponse

    // ---------------- Telemetry ----------------

    @POST("/driver-telemetry/batch")
    suspend fun postTelemetryBatch(@Body body: TelemetryBatchRequest)

    // ---------------- Field payment ----------------

    @POST("/job-field-payments/create-intent")
    suspend fun createFieldPaymentIntent(@Body body: FieldPaymentCreateIntentRequest): JobFieldPaymentDto

    @POST("/job-field-payments/{id}/capture")
    suspend fun captureFieldPayment(@Path("id") paymentId: String): JobFieldPaymentDto

    @POST("/job-field-payments/{id}/cancel")
    suspend fun cancelFieldPayment(@Path("id") paymentId: String): JobFieldPaymentDto
}
