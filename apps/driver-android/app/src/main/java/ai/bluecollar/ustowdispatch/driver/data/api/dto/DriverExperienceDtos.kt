package ai.bluecollar.ustowdispatch.driver.data.api.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// ---------------- Driver PIN auth ----------------

@Serializable
data class DriverPickerEntry(
    val id: String,
    val firstName: String,
    val lastName: String,
    val preferredName: String? = null,
    val employeeNumber: String? = null,
)

@Serializable
data class DriverPickerTenant(
    val id: String,
    val slug: String,
    val name: String,
)

@Serializable
data class DriverPickerResponse(
    val tenant: DriverPickerTenant,
    val drivers: List<DriverPickerEntry>,
)

@Serializable
data class DriverLookupByCodeRequest(val companyCode: String)

@Serializable
data class DriverListByTenantRequest(val tenantSlug: String)

@Serializable
data class DriverPinLoginRequest(
    val driverId: String,
    val pin: String,
    val tenantSlug: String,
)

@Serializable
data class DriverPinLoginResponse(
    val accessToken: String,
    val expiresIn: Int,
    val driver: DriverPickerEntry,
    val tenant: DriverPickerTenant,
)

// ---------------- Briefing ----------------

/**
 * Slim mirror of the shared DriverDailyBriefingDto. We capture only the
 * fields the in-truck UI renders; unknown server fields are dropped by
 * the Json decoder (ignoreUnknownKeys = true in NetworkModule).
 */
@Serializable
data class DriverDailyBriefingDto(
    val id: String,
    val tenantId: String,
    val title: String,
    val body: String? = null,
    val videoUrl: String? = null,
    val effectiveOn: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val publishedAt: String? = null,
    val publishedById: String? = null,
)

@Serializable
data class BriefingNeedsResponse(
    val needs: Boolean,
    val briefing: DriverDailyBriefingDto? = null,
)

@Serializable
data class AcknowledgeBriefingRequest(
    val acknowledgedAtClient: String,
    val watchedSeconds: Int? = null,
    val clientEventUuid: String? = null,
)

@Serializable
data class DriverBriefingAcknowledgmentDto(
    val id: String,
    val briefingId: String,
    val driverId: String,
    val tenantId: String,
    val acknowledgedAt: String,
    val watchedSeconds: Int? = null,
)

// ---------------- Pre-trip / DVIR ----------------

@Serializable
data class PretripInspectionItem(
    val key: String,
    val label: String,
    /** "pass" | "fail" | "na" */
    val state: String,
    val note: String? = null,
    val photoKeys: List<String>? = null,
)

@Serializable
data class CreatePretripPayload(
    val truckId: String,
    /** "pass" | "fail_safe" | "fail_unsafe" */
    val status: String,
    val items: List<PretripInspectionItem>,
    val submittedAt: String,
    val shiftId: String? = null,
    val odometerMiles: Int? = null,
    val notes: String? = null,
)

@Serializable
data class DriverPretripInspectionDto(
    val id: String,
    val tenantId: String,
    val driverId: String,
    val truckId: String,
    val status: String,
    val submittedAt: String,
    val createdAt: String,
)

// ---------------- Evidence (S3 presigned) ----------------

@Serializable
data class JobEvidencePresignRequest(
    val jobId: String,
    /** mirrors shared jobEvidenceKindValues — e.g. "photo", "video", "signature" */
    val kind: String,
    val contentType: String,
    val sizeBytes: Long,
)

@Serializable
data class JobEvidenceDto(
    val id: String,
    val jobId: String,
    val s3Key: String,
    val kind: String,
    val uploadStatus: String,
    val capturedAt: String? = null,
    val capturedLat: Double? = null,
    val capturedLng: Double? = null,
)

@Serializable
data class JobEvidenceUpload(
    val url: String,
    val key: String,
    val expiresAt: Long,
    val requiredHeaders: Map<String, String>? = null,
)

@Serializable
data class JobEvidencePresignResponse(
    val evidence: JobEvidenceDto,
    val upload: JobEvidenceUpload,
)

@Serializable
data class JobEvidenceFinalizeRequest(
    val width: Int? = null,
    val height: Int? = null,
    val durationSeconds: Double? = null,
    val capturedLat: Double? = null,
    val capturedLng: Double? = null,
)

@Serializable
data class JobEvidenceFailRequest(val reason: String)

// ---------------- Offline replay ----------------

@Serializable
data class OfflineReplayActionDto(
    val actionKind: String,
    val payload: JsonElement,
    val clientTimestamp: String,
    val clientEventUuid: String,
    val jobId: String? = null,
    val shiftId: String? = null,
)

@Serializable
data class OfflineReplayBatchRequest(val actions: List<OfflineReplayActionDto>)

@Serializable
data class OfflineReplayResultItem(
    val clientEventUuid: String,
    /** "applied" | "failed" | "skipped" */
    val status: String,
    val failureReason: String? = null,
)

@Serializable
data class OfflineReplayResponse(val results: List<OfflineReplayResultItem>)

// ---------------- Telemetry ----------------

@Serializable
data class TelemetryEventDto(
    val shiftId: String? = null,
    /** ISO-8601 timestamp from the GPS sample. */
    val recordedAt: String,
    val lat: Double,
    val lng: Double,
    val speedMph: Double? = null,
    val headingDegrees: Double? = null,
    val accuracyMeters: Double? = null,
    /** "ping" | "shift_start" | "shift_end" | "job_transition" */
    val eventKind: String = "ping",
    val jobId: String? = null,
)

@Serializable
data class TelemetryBatchRequest(val events: List<TelemetryEventDto>)

// ---------------- Field payment ----------------

@Serializable
data class FieldPaymentCreateIntentRequest(
    val jobId: String,
    val amountCents: Long,
    val tipCents: Long = 0,
    val currency: String = "usd",
    /** "card_present_tap" — Tap to Pay; "manual_entry" — keyed; etc. */
    val paymentMethod: String = "card_present_tap",
    val receiptEmail: String? = null,
    val shiftId: String? = null,
)

@Serializable
data class JobFieldPaymentDto(
    val id: String,
    val jobId: String,
    val status: String,
    val amountCents: Long,
    val tipCents: Long = 0,
    val currency: String,
    val createdAt: String,
    val updatedAt: String,
)

// ---------------- Generic error shape ----------------

/**
 * Backend errors from Nest's exception filter come back as JSON with at
 * least {message, code}. The driver-auth/login path adds `lockedUntil`
 * (ISO 8601) when status is account_locked. Kept permissive — fields we
 * don't care about (statusCode, error) are simply ignored.
 */
@Serializable
data class DriverApiErrorBody(
    val message: String? = null,
    val code: String? = null,
    val lockedUntil: String? = null,
    @SerialName("statusCode") val statusCode: Int? = null,
)
