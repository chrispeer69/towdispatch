package ai.bluecollar.ustowdispatch.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * Photos captured locally that have not yet been confirmed uploaded.
 * Offline-first: capture writes the row + on-disk file path, the upload
 * worker drains rows when network is available.
 */
@Entity(tableName = "pending_photos")
data class PendingPhotoEntity(
    @PrimaryKey val id: String,
    val jobId: String,
    val filePath: String,
    val capturedAtIso: String,
    val lat: Double?,
    val lng: Double?,
    val tag: String,
    val status: String,
    val attempts: Int = 0,
    val lastError: String? = null,
) {
    companion object {
        const val STATUS_PENDING = "pending"
        const val STATUS_UPLOADING = "uploading"
        const val STATUS_UPLOADED = "uploaded"
        const val STATUS_FAILED = "failed"
    }
}

@Dao
interface PendingPhotoDao {
    @Query("SELECT * FROM pending_photos WHERE jobId = :jobId ORDER BY capturedAtIso ASC")
    fun observeForJob(jobId: String): Flow<List<PendingPhotoEntity>>

    @Query("SELECT * FROM pending_photos WHERE status IN ('pending','failed') ORDER BY capturedAtIso ASC")
    suspend fun pending(): List<PendingPhotoEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(photo: PendingPhotoEntity)

    @Query("UPDATE pending_photos SET status = :status, attempts = attempts + 1, lastError = :error WHERE id = :id")
    suspend fun markFailed(id: String, status: String, error: String?)

    @Query("UPDATE pending_photos SET status = :status WHERE id = :id")
    suspend fun setStatus(id: String, status: String)

    @Query("SELECT COUNT(*) FROM pending_photos WHERE jobId = :jobId")
    suspend fun countForJob(jobId: String): Int

    @Query("SELECT COUNT(*) FROM pending_photos WHERE jobId = :jobId AND status = 'uploaded'")
    suspend fun uploadedCountForJob(jobId: String): Int
}
