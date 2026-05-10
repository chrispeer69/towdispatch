package ai.bluecollar.towcommand.driver.data.api.dto

import kotlinx.serialization.Serializable

/**
 * Mirror of the server JobDto (packages/shared/src/schemas/job.ts). Kept
 * permissive: every nullable field on the server is nullable here too, and
 * unknown fields are ignored by the Json configuration in NetworkModule.
 */
@Serializable
data class JobDto(
    val id: String,
    val tenantId: String,
    val jobNumber: String,
    val status: String,
    val serviceType: String,
    val customerId: String? = null,
    val vehicleId: String? = null,
    val accountId: String? = null,
    val pickupAddress: String,
    val pickupLat: Double? = null,
    val pickupLng: Double? = null,
    val dropoffAddress: String? = null,
    val dropoffLat: Double? = null,
    val dropoffLng: Double? = null,
    val authorizedBy: String,
    val authorizedByName: String? = null,
    val rateQuotedCents: Long = 0,
    val notes: String? = null,
    val cancelledReason: String? = null,
    val assignedDriverId: String? = null,
    val assignedTruckId: String? = null,
    val assignedShiftId: String? = null,
    val assignedAt: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

/**
 * Trimmed customer/vehicle context the driver needs in the field. The server
 * hydrates these from the job's customerId/vehicleId in /dispatch/my-jobs.
 */
@Serializable
data class JobCustomerDto(
    val id: String,
    val name: String,
    val phone: String? = null,
)

@Serializable
data class JobVehicleDto(
    val id: String,
    val year: Int? = null,
    val make: String? = null,
    val model: String? = null,
    val color: String? = null,
    val plate: String? = null,
    val plateState: String? = null,
    val vin: String? = null,
    val specialInstructions: String? = null,
)

@Serializable
data class MyJobDto(
    val job: JobDto,
    val customer: JobCustomerDto? = null,
    val vehicle: JobVehicleDto? = null,
)

@Serializable
data class TransitionRequest(
    val to: String,
    val reason: String? = null,
)

@Serializable
data class CancelRequest(val reason: String)

@Serializable
data class PhotoUploadRequest(
    val fileName: String,
    val mimeType: String,
    val contentBase64: String,
    val capturedAt: String,
    val lat: Double? = null,
    val lng: Double? = null,
    /** Free-form tag, e.g. "pre_tow_corner_fl" or "goa" or "signature". */
    val tag: String? = null,
)

@Serializable
data class PhotoUploadResponse(
    val id: String,
    val fileUrl: String,
    val uploadedAt: String,
)

@Serializable
data class DriverProfileDto(
    val id: String,
    val firstName: String,
    val lastName: String,
    val preferredName: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val licenseExpiresAt: String? = null,
    val cdlExpiresAt: String? = null,
    val medicalCardExpiresAt: String? = null,
    val employmentStatus: String,
    val active: Boolean,
)
