package ai.bluecollar.towdispatch.driver.data.repo

import ai.bluecollar.towdispatch.driver.data.api.TowDispatchApi
import ai.bluecollar.towdispatch.driver.data.api.dto.CancelRequest
import ai.bluecollar.towdispatch.driver.data.api.dto.JobDto
import ai.bluecollar.towdispatch.driver.data.api.dto.MyJobDto
import ai.bluecollar.towdispatch.driver.data.api.dto.TransitionRequest
import ai.bluecollar.towdispatch.driver.data.local.JobDao
import ai.bluecollar.towdispatch.driver.data.local.JobEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class JobsRepository @Inject constructor(
    private val api: TowDispatchApi,
    private val jobDao: JobDao,
) {
    fun observeJobs(): Flow<List<JobEntity>> = jobDao.observeAll()
    fun observeJob(id: String): Flow<JobEntity?> = jobDao.observeById(id)

    /** Fetches assigned jobs from the API and writes them to the local cache. */
    suspend fun refresh(): Result<Int> = runCatching {
        val rows = api.myJobs().map(::toEntity)
        jobDao.upsertAll(rows)
        jobDao.deleteNotIn(rows.map { it.id })
        rows.size
    }

    suspend fun transition(jobId: String, to: String, reason: String? = null): Result<JobDto> = runCatching {
        val updated = api.transition(jobId, TransitionRequest(to = to, reason = reason))
        // Patch local cache so the UI reflects the new status immediately.
        jobDao.getById(jobId)?.let { existing ->
            jobDao.upsert(existing.copy(status = updated.status, updatedAt = updated.updatedAt))
        }
        updated
    }

    suspend fun cancel(jobId: String, reason: String): Result<JobDto> = runCatching {
        api.cancel(jobId, CancelRequest(reason = reason))
    }

    private fun toEntity(my: MyJobDto): JobEntity {
        val j = my.job
        val c = my.customer
        val v = my.vehicle
        return JobEntity(
            id = j.id,
            jobNumber = j.jobNumber,
            status = j.status,
            serviceType = j.serviceType,
            pickupAddress = j.pickupAddress,
            pickupLat = j.pickupLat,
            pickupLng = j.pickupLng,
            dropoffAddress = j.dropoffAddress,
            dropoffLat = j.dropoffLat,
            dropoffLng = j.dropoffLng,
            customerName = c?.name,
            customerPhone = c?.phone,
            vehicleYear = v?.year,
            vehicleMake = v?.make,
            vehicleModel = v?.model,
            vehicleColor = v?.color,
            vehiclePlate = v?.plate,
            vehicleVin = v?.vin,
            specialInstructions = v?.specialInstructions,
            authorizedBy = j.authorizedBy,
            authorizedByName = j.authorizedByName,
            rateQuotedCents = j.rateQuotedCents,
            notes = j.notes,
            assignedAt = j.assignedAt,
            updatedAt = j.updatedAt,
        )
    }
}
