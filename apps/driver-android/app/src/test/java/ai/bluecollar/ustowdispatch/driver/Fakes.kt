package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.data.local.OfflineActionDao
import ai.bluecollar.ustowdispatch.driver.data.local.OfflineActionEntity
import ai.bluecollar.ustowdispatch.driver.data.repo.BriefingCache
import ai.bluecollar.ustowdispatch.driver.data.repo.OutboxRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap

/**
 * In-memory test doubles. Kept here in the test source set so the
 * production layer doesn't gain a `@VisibleForTesting` surface.
 */

class FakeOutboxDao : OfflineActionDao {
    private val store = ConcurrentHashMap<String, OfflineActionEntity>()
    private val pendingCount = MutableStateFlow(0)
    private val allFlow = MutableStateFlow<List<OfflineActionEntity>>(emptyList())

    override suspend fun pending(limit: Int): List<OfflineActionEntity> =
        store.values.filter { it.status == OfflineActionEntity.STATUS_PENDING }
            .sortedBy { it.clientTimestampIso }.take(limit)

    override fun observeAll(): Flow<List<OfflineActionEntity>> = allFlow

    override fun observePendingCount(): Flow<Int> = pendingCount

    override suspend fun pendingCount(): Int = store.values.count {
        it.status == OfflineActionEntity.STATUS_PENDING
    }

    override suspend fun upsert(entity: OfflineActionEntity) {
        store[entity.clientEventUuid] = entity
        republish()
    }

    override suspend fun setStatus(uuid: String, status: String) {
        store[uuid]?.let { store[uuid] = it.copy(status = status) }
        republish()
    }

    override suspend fun recordAttempt(uuid: String, status: String, error: String?) {
        store[uuid]?.let {
            store[uuid] = it.copy(status = status, attemptCount = it.attemptCount + 1, lastError = error)
        }
        republish()
    }

    override suspend fun pruneResolved() {
        store.values
            .filter { it.status == OfflineActionEntity.STATUS_APPLIED || it.status == OfflineActionEntity.STATUS_SKIPPED }
            .forEach { store.remove(it.clientEventUuid) }
        republish()
    }

    override suspend fun clearAll() {
        store.clear()
        republish()
    }

    private fun republish() {
        allFlow.value = store.values.sortedByDescending { it.clientTimestampIso }
        pendingCount.value = store.values.count { it.status == OfflineActionEntity.STATUS_PENDING }
    }
}

fun FakeOutbox(): OutboxRepository = OutboxRepository(FakeOutboxDao(), MockWebServerSupport.json)

class FakeBriefingCache(initial: Pair<String, String> = Pair("", "")) : BriefingCache {
    private var cached: Pair<String, String> = initial
    override suspend fun cached(): Pair<String, String> = cached
    override suspend fun save(briefingId: String, isoDate: String) {
        cached = Pair(briefingId, isoDate)
    }
}

fun FakeTokenStore(): FakeBriefingCache = FakeBriefingCache()
