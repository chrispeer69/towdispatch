package ai.bluecollar.ustowdispatch.driver.data.repo

import ai.bluecollar.ustowdispatch.driver.data.api.UsTowDispatchApi
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidenceDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidenceFailRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidenceFinalizeRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidencePresignRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobEvidencePresignResponse
import ai.bluecollar.ustowdispatch.driver.data.local.PendingEvidenceDao
import ai.bluecollar.ustowdispatch.driver.data.local.PendingEvidenceEntity
import ai.bluecollar.ustowdispatch.driver.di.S3Upload
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * S3-presigned evidence upload pipeline. Three steps per piece of evidence:
 *
 *   1. POST /job-evidence/presign — server creates the row + returns a
 *      pre-signed upload URL with required headers.
 *   2. PUT bytes to that URL with the Content-Type header (and any extras
 *      the server stipulated in requiredHeaders).
 *   3. POST /job-evidence/{id}/finalize — server flips uploadStatus to
 *      "uploaded" and records width/height/lat/lng metadata.
 *
 * Failure on (2) or (3) → POST /job-evidence/{id}/fail with the reason so
 * the server can mark the row dead and surface to operators. The local
 * row is preserved in [PendingEvidenceEntity.STATUS_FAILED] until the user
 * dismisses it from the offline screen.
 *
 * Caller is responsible for capturing the file bytes (CameraX / picker /
 * signature export) and dropping them at [PendingEvidenceEntity.filePath].
 * This repository never reads them into memory; it streams via OkHttp.
 */
@Singleton
class EvidenceRepository @Inject constructor(
    private val api: UsTowDispatchApi,
    private val dao: PendingEvidenceDao,
    /**
     * S3 PUT must NOT carry the driver Authorization header — the URL is
     * already authenticated by the presign signature. We use a second
     * OkHttpClient instance (provided as @S3Upload) with no interceptors.
     */
    @S3Upload private val s3Client: OkHttpClient,
    private val json: Json,
) {
    fun observeForJob(jobId: String): Flow<List<PendingEvidenceEntity>> = dao.observeForJob(jobId)
    fun observePendingCount(): Flow<Int> = dao.observePendingCount()

    /** Capture-side: record the file on disk and queue for upload. */
    suspend fun enqueue(
        jobId: String,
        filePath: String,
        kind: String,
        contentType: String,
        sizeBytes: Long,
        capturedLat: Double?,
        capturedLng: Double?,
        tag: String?,
    ): String {
        val id = UUID.randomUUID().toString()
        dao.upsert(
            PendingEvidenceEntity(
                id = id,
                jobId = jobId,
                filePath = filePath,
                kind = kind,
                contentType = contentType,
                sizeBytes = sizeBytes,
                capturedAtIso = Instant.now().toString(),
                capturedLat = capturedLat,
                capturedLng = capturedLng,
                tag = tag,
            ),
        )
        return id
    }

    /**
     * Worker-side: drive a single row through the remaining steps. Idempotent
     * per checkpoint — calling drain() on an already-PRESIGNED row starts at
     * step 2, not step 1.
     */
    suspend fun drainOne(row: PendingEvidenceEntity): Result<JobEvidenceDto?> = runCatching {
        var current = row
        if (current.status == PendingEvidenceEntity.STATUS_PENDING) {
            val presign: JobEvidencePresignResponse = api.presignEvidence(
                JobEvidencePresignRequest(
                    jobId = current.jobId,
                    kind = current.kind,
                    contentType = current.contentType,
                    sizeBytes = current.sizeBytes,
                ),
            )
            val headersJson = presign.upload.requiredHeaders?.let {
                json.encodeToString(MapSerializer(String.serializer(), String.serializer()), it)
            }
            dao.markPresigned(
                id = current.id,
                evidenceId = presign.evidence.id,
                uploadUrl = presign.upload.url,
                headersJson = headersJson,
                status = PendingEvidenceEntity.STATUS_PRESIGNED,
            )
            current = current.copy(
                evidenceId = presign.evidence.id,
                uploadUrl = presign.upload.url,
                uploadHeadersJson = headersJson,
                status = PendingEvidenceEntity.STATUS_PRESIGNED,
            )
        }

        if (current.status == PendingEvidenceEntity.STATUS_PRESIGNED) {
            val file = File(current.filePath)
            if (!file.exists()) {
                dao.recordAttempt(current.id, PendingEvidenceEntity.STATUS_FAILED, "Local file missing")
                runCatching {
                    api.failEvidence(current.evidenceId!!, JobEvidenceFailRequest("local_file_missing"))
                }
                return@runCatching null
            }
            val mediaType = current.contentType.toMediaTypeOrNull()
            val body = file.asRequestBody(mediaType)
            val builder = Request.Builder()
                .url(current.uploadUrl!!)
                .put(body)
                .header("Content-Type", current.contentType)
            current.uploadHeadersJson?.takeIf { it.isNotBlank() }?.let { raw ->
                val map = json.decodeFromString(
                    MapSerializer(String.serializer(), String.serializer()),
                    raw,
                )
                map.forEach { (k, v) -> builder.header(k, v) }
            }
            val response = s3Client.newCall(builder.build()).execute()
            response.use { res ->
                if (!res.isSuccessful) {
                    dao.recordAttempt(
                        current.id,
                        PendingEvidenceEntity.STATUS_PRESIGNED,
                        "S3 PUT failed: ${res.code}",
                    )
                    error("S3 PUT failed with HTTP ${res.code}")
                }
            }
            dao.setStatus(current.id, PendingEvidenceEntity.STATUS_UPLOADED)
            current = current.copy(status = PendingEvidenceEntity.STATUS_UPLOADED)
        }

        if (current.status == PendingEvidenceEntity.STATUS_UPLOADED) {
            val finalized = api.finalizeEvidence(
                current.evidenceId!!,
                JobEvidenceFinalizeRequest(
                    capturedLat = current.capturedLat,
                    capturedLng = current.capturedLng,
                ),
            )
            dao.setStatus(current.id, PendingEvidenceEntity.STATUS_FINALIZED)
            return@runCatching finalized
        }
        null
    }

    suspend fun unfinalized(): List<PendingEvidenceEntity> = dao.unfinalized()
    suspend fun pruneFinalized() = dao.pruneFinalized()
}
