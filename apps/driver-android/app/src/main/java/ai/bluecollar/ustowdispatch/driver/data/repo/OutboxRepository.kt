package ai.bluecollar.ustowdispatch.driver.data.repo

import ai.bluecollar.ustowdispatch.driver.data.local.OfflineActionDao
import ai.bluecollar.ustowdispatch.driver.data.local.OfflineActionEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Enqueue-side of the offline outbox. Every mutating driver action goes
 * through this repository before touching the network, so the sync engine
 * can recover from process death and connectivity drops without losing
 * intent. Drain logic lives in [ai.bluecollar.ustowdispatch.driver.data.sync.DriverSyncEngine].
 */
@Singleton
class OutboxRepository @Inject constructor(
    private val dao: OfflineActionDao,
    private val json: Json,
) {
    /**
     * Append a row. [clientEventUuid] doubles as the dedup key — pass the
     * same value on retry from a higher-level retry loop and the row is
     * upserted rather than duplicated. Server-side replay is also UUID-keyed.
     */
    suspend fun enqueue(
        actionKind: String,
        payload: JsonElement,
        jobId: String? = null,
        shiftId: String? = null,
        clientEventUuid: String = UUID.randomUUID().toString(),
        clientTimestampIso: String = Instant.now().toString(),
    ): String {
        dao.upsert(
            OfflineActionEntity(
                clientEventUuid = clientEventUuid,
                actionKind = actionKind,
                payloadJson = json.encodeToString(JsonElement.serializer(), payload),
                clientTimestampIso = clientTimestampIso,
                jobId = jobId,
                shiftId = shiftId,
            ),
        )
        return clientEventUuid
    }

    fun observeAll(): Flow<List<OfflineActionEntity>> = dao.observeAll()
    fun observePendingCount(): Flow<Int> = dao.observePendingCount()
    suspend fun pendingCount(): Int = dao.pendingCount()
    suspend fun pending(limit: Int = 50): List<OfflineActionEntity> = dao.pending(limit)
    suspend fun setStatus(uuid: String, status: String) = dao.setStatus(uuid, status)
    suspend fun recordAttempt(uuid: String, status: String, error: String?) =
        dao.recordAttempt(uuid, status, error)
    suspend fun pruneResolved() = dao.pruneResolved()
    suspend fun clearAll() = dao.clearAll()
}
