package ai.bluecollar.towcommand.driver.data.repo

import ai.bluecollar.towcommand.driver.data.api.TowCommandApi
import ai.bluecollar.towcommand.driver.data.api.dto.PhotoUploadRequest
import ai.bluecollar.towcommand.driver.data.local.PendingPhotoDao
import ai.bluecollar.towcommand.driver.data.local.PendingPhotoEntity
import android.content.Context
import android.util.Base64
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PhotoRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dao: PendingPhotoDao,
    private val api: TowCommandApi,
) {
    fun observe(jobId: String): Flow<List<PendingPhotoEntity>> = dao.observeForJob(jobId)

    suspend fun countForJob(jobId: String): Int = dao.countForJob(jobId)
    suspend fun uploadedCountForJob(jobId: String): Int = dao.uploadedCountForJob(jobId)

    /** Stage a photo for upload. The file is already on disk; we just record + queue. */
    suspend fun enqueue(
        jobId: String,
        file: File,
        tag: String,
        lat: Double?,
        lng: Double?,
    ): PendingPhotoEntity {
        val entity = PendingPhotoEntity(
            id = UUID.randomUUID().toString(),
            jobId = jobId,
            filePath = file.absolutePath,
            capturedAtIso = isoNow(),
            lat = lat,
            lng = lng,
            tag = tag,
            status = PendingPhotoEntity.STATUS_PENDING,
        )
        dao.insert(entity)
        return entity
    }

    /**
     * Attempt to upload every pending row. Returns the number successfully
     * uploaded. Best-effort: failures stay in the queue with the last error.
     */
    suspend fun drain(): Int {
        var uploaded = 0
        for (row in dao.pending()) {
            dao.setStatus(row.id, PendingPhotoEntity.STATUS_UPLOADING)
            val file = File(row.filePath)
            if (!file.exists()) {
                dao.markFailed(row.id, PendingPhotoEntity.STATUS_FAILED, "Local file missing")
                continue
            }
            val bytes = runCatching { file.readBytes() }.getOrNull()
            if (bytes == null) {
                dao.markFailed(row.id, PendingPhotoEntity.STATUS_FAILED, "Read failed")
                continue
            }
            val req = PhotoUploadRequest(
                fileName = "${row.tag}_${row.id}.jpg",
                mimeType = "image/jpeg",
                contentBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                capturedAt = row.capturedAtIso,
                lat = row.lat,
                lng = row.lng,
                tag = row.tag,
            )
            val ok = runCatching { api.uploadJobPhoto(row.jobId, req) }
            if (ok.isSuccess) {
                dao.setStatus(row.id, PendingPhotoEntity.STATUS_UPLOADED)
                uploaded++
            } else {
                dao.markFailed(row.id, PendingPhotoEntity.STATUS_FAILED, ok.exceptionOrNull()?.message)
            }
        }
        return uploaded
    }

    private fun isoNow(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }
}
