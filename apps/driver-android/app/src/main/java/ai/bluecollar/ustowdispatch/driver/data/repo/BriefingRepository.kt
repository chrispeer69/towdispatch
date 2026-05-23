package ai.bluecollar.ustowdispatch.driver.data.repo

import ai.bluecollar.ustowdispatch.driver.data.api.UsTowDispatchApi
import ai.bluecollar.ustowdispatch.driver.data.api.dto.AcknowledgeBriefingRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.BriefingNeedsResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverDailyBriefingDto
import ai.bluecollar.ustowdispatch.driver.data.prefs.AuthTokenStore
import ai.bluecollar.ustowdispatch.driver.data.sync.OfflineActionKind
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import retrofit2.HttpException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Mirrors apps/web/src/lib/driver/briefing-helpers.ts:
 *
 *   - GET /driver-briefings/needs-acknowledgment   ↪ gating decision
 *   - GET /driver-briefings/active                  ↪ full payload for the screen
 *   - POST /driver-briefings/{id}/acknowledge       ↪ records the ack
 *
 * Gating rule:
 *   server.needs=true                                       → REQUIRED (block workspace)
 *   server.needs=false AND a briefing object is present     → COMPACT (pill only)
 *   no briefing object                                       → NONE
 */
/**
 * Tiny indirection so unit tests can drop AuthTokenStore entirely. Two
 * impls exist: the production [AuthTokenStoreBriefingCache] and an in-test
 * fake.
 */
interface BriefingCache {
    suspend fun cached(): Pair<String, String>
    suspend fun save(briefingId: String, isoDate: String)
}

@Singleton
class AuthTokenStoreBriefingCache @Inject constructor(
    private val tokenStore: AuthTokenStore,
) : BriefingCache {
    override suspend fun cached(): Pair<String, String> = Pair(
        tokenStore.briefingAckBriefingId.first(),
        tokenStore.briefingAckDate.first(),
    )
    override suspend fun save(briefingId: String, isoDate: String) =
        tokenStore.saveBriefingAcknowledgment(briefingId, isoDate)
}

@Module
@InstallIn(SingletonComponent::class)
abstract class BriefingCacheModule {
    @Binds
    abstract fun bindBriefingCache(impl: AuthTokenStoreBriefingCache): BriefingCache
}

@Singleton
class BriefingRepository @Inject constructor(
    private val api: UsTowDispatchApi,
    private val outbox: OutboxRepository,
    private val cache: BriefingCache,
) {
    sealed class GateState {
        data class Required(val briefing: DriverDailyBriefingDto) : GateState()
        data class Compact(val briefing: DriverDailyBriefingDto) : GateState()
        data object None : GateState()
        data class Failure(val message: String) : GateState()
    }

    suspend fun fetchGate(): GateState {
        return try {
            val response: BriefingNeedsResponse = api.briefingNeedsAcknowledgment()
            val briefing = response.briefing ?: return GateState.None
            if (response.needs) GateState.Required(briefing) else GateState.Compact(briefing)
        } catch (e: HttpException) {
            if (e.code() == 404) GateState.None
            else GateState.Failure("HTTP ${e.code()}: ${e.message()}")
        } catch (e: Exception) {
            GateState.Failure(e.localizedMessage ?: "Briefing fetch failed")
        }
    }

    suspend fun fetchActive(): Result<DriverDailyBriefingDto> = runCatching { api.briefingActive() }

    /** Returns the cached briefingId/date pair (empty strings if none). */
    suspend fun cachedAcknowledgment(): Pair<String, String> = cache.cached()

    /**
     * Acknowledge — best-effort online, falls back to the outbox so the
     * gate unblocks immediately even when the truck is parked underground.
     */
    suspend fun acknowledge(briefingId: String, watchedSeconds: Int? = null): Result<Unit> {
        val clientEventUuid = UUID.randomUUID().toString()
        val nowIso = Instant.now().toString()
        val isoDate = LocalDate.now(ZoneId.systemDefault()).toString()
        // Always cache locally so the gate flips even when offline.
        cache.save(briefingId, isoDate)
        return try {
            api.acknowledgeBriefing(
                briefingId,
                AcknowledgeBriefingRequest(
                    acknowledgedAtClient = nowIso,
                    watchedSeconds = watchedSeconds,
                    clientEventUuid = clientEventUuid,
                ),
            )
            Result.success(Unit)
        } catch (e: Exception) {
            val queued: JsonObject = buildJsonObject {
                put("briefingId", JsonPrimitive(briefingId))
                put("acknowledgedAtClient", JsonPrimitive(nowIso))
                if (watchedSeconds != null) put("watchedSeconds", JsonPrimitive(watchedSeconds))
                put("clientEventUuid", JsonPrimitive(clientEventUuid))
            }
            outbox.enqueue(
                actionKind = OfflineActionKind.ACKNOWLEDGE_BRIEFING,
                payload = queued,
                clientEventUuid = clientEventUuid,
                clientTimestampIso = nowIso,
            )
            Result.success(Unit)
        }
    }
}
