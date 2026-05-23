package ai.bluecollar.ustowdispatch.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * S3-presigned-upload work queue. Each row captures one piece of evidence
 * (photo, video, signature) whose bytes are on local disk and need to be
 * pushed via the three-step presign / PUT / finalize flow.
 *
 * Lifecycle:
 *   STATUS_PENDING   — bytes captured, presign not yet requested
 *   STATUS_PRESIGNED — server returned evidence id + upload URL; bytes not yet PUT
 *   STATUS_UPLOADED  — S3 PUT succeeded; finalize not yet POSTed
 *   STATUS_FINALIZED — finalize OK; row eligible for pruning
 *   STATUS_FAILED    — terminal failure; surfaced on the offline screen
 *
 * Two-row lifecycle keeps the worker idempotent: a retry resumes from the
 * latest checkpoint instead of restarting from scratch.
 */
@Entity(tableName = "pending_evidence")
data class PendingEvidenceEntity(
    @PrimaryKey val id: String,
    val jobId: String,
    val filePath: String,
    /** "photo" | "video" | "signature" (mirrors shared jobEvidenceKindValues) */
    val kind: String,
    val contentType: String,
    val sizeBytes: Long,
    val capturedAtIso: String,
    val capturedLat: Double? = null,
    val capturedLng: Double? = null,
    /** Free-form caption / tag (e.g. "pre_tow_corner_fl"). Not sent to S3. */
    val tag: String? = null,
    /** Returned by /job-evidence/presign once status >= PRESIGNED. */
    val evidenceId: String? = null,
    val uploadUrl: String? = null,
    val uploadHeadersJson: String? = null,
    val status: String = STATUS_PENDING,
    val attempts: Int = 0,
    val lastError: String? = null,
) {
    companion object {
        const val STATUS_PENDING = "pending"
        const val STATUS_PRESIGNED = "presigned"
        const val STATUS_UPLOADED = "uploaded"
        const val STATUS_FINALIZED = "finalized"
        const val STATUS_FAILED = "failed"
    }
}

@Dao
interface PendingEvidenceDao {
    @Query("SELECT * FROM pending_evidence WHERE status NOT IN ('finalized') ORDER BY capturedAtIso ASC")
    suspend fun unfinalized(): List<PendingEvidenceEntity>

    @Query("SELECT * FROM pending_evidence WHERE jobId = :jobId ORDER BY capturedAtIso ASC")
    fun observeForJob(jobId: String): Flow<List<PendingEvidenceEntity>>

    @Query("SELECT COUNT(*) FROM pending_evidence WHERE status NOT IN ('finalized','failed')")
    fun observePendingCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: PendingEvidenceEntity)

    @Query("UPDATE pending_evidence SET status = :status WHERE id = :id")
    suspend fun setStatus(id: String, status: String)

    @Query(
        "UPDATE pending_evidence SET evidenceId = :evidenceId, uploadUrl = :uploadUrl, " +
            "uploadHeadersJson = :headersJson, status = :status WHERE id = :id",
    )
    suspend fun markPresigned(
        id: String,
        evidenceId: String,
        uploadUrl: String,
        headersJson: String?,
        status: String,
    )

    @Query(
        "UPDATE pending_evidence SET status = :status, attempts = attempts + 1, lastError = :error " +
            "WHERE id = :id",
    )
    suspend fun recordAttempt(id: String, status: String, error: String?)

    @Query("DELETE FROM pending_evidence WHERE status = 'finalized'")
    suspend fun pruneFinalized()
}
