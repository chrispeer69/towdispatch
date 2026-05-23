package ai.bluecollar.ustowdispatch.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * Outbox row for every mutating driver action — job transitions, briefing
 * acknowledgments, pretrip submissions, evidence finalizations, telemetry
 * batches, field-payment captures, notes. The sync engine drains rows in
 * FIFO order by [clientTimestampIso], one batch per /driver-offline-sync
 * /replay call (max 50 per batch).
 *
 * Mirrors apps/web/src/lib/driver/offline.ts's `OfflineQueueEntry`.
 */
@Entity(tableName = "offline_actions")
data class OfflineActionEntity(
    @PrimaryKey val clientEventUuid: String,
    /** Mirrors shared `OfflineActionKind` — e.g. "job_status_transition", "submit_pretrip". */
    val actionKind: String,
    /** Payload as a serialized JSON string. Re-parsed by the sync engine. */
    val payloadJson: String,
    val clientTimestampIso: String,
    val jobId: String?,
    val shiftId: String?,
    val attemptCount: Int = 0,
    val lastError: String? = null,
    /** "pending" — eligible; "applied" — server ack; "failed" — gave up; "skipped" — dedup. */
    val status: String = STATUS_PENDING,
) {
    companion object {
        const val STATUS_PENDING = "pending"
        const val STATUS_APPLIED = "applied"
        const val STATUS_FAILED = "failed"
        const val STATUS_SKIPPED = "skipped"
    }
}

@Dao
interface OfflineActionDao {
    @Query("SELECT * FROM offline_actions WHERE status = 'pending' ORDER BY clientTimestampIso ASC LIMIT :limit")
    suspend fun pending(limit: Int = 50): List<OfflineActionEntity>

    @Query("SELECT * FROM offline_actions ORDER BY clientTimestampIso DESC")
    fun observeAll(): Flow<List<OfflineActionEntity>>

    @Query("SELECT COUNT(*) FROM offline_actions WHERE status = 'pending'")
    fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM offline_actions WHERE status = 'pending'")
    suspend fun pendingCount(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: OfflineActionEntity)

    @Query("UPDATE offline_actions SET status = :status WHERE clientEventUuid = :uuid")
    suspend fun setStatus(uuid: String, status: String)

    @Query(
        "UPDATE offline_actions SET status = :status, attemptCount = attemptCount + 1, lastError = :error " +
            "WHERE clientEventUuid = :uuid",
    )
    suspend fun recordAttempt(uuid: String, status: String, error: String?)

    @Query("DELETE FROM offline_actions WHERE status IN ('applied','skipped')")
    suspend fun pruneResolved()

    @Query("DELETE FROM offline_actions")
    suspend fun clearAll()
}
