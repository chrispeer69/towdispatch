package ai.bluecollar.ustowdispatch.driver.data.repo

import ai.bluecollar.ustowdispatch.driver.data.api.UsTowDispatchApi
import ai.bluecollar.ustowdispatch.driver.data.api.dto.CreatePretripPayload
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPretripInspectionDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.PretripInspectionItem
import ai.bluecollar.ustowdispatch.driver.data.sync.OfflineActionKind
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import retrofit2.HttpException
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Mirrors apps/web/src/lib/driver/pretrip-helpers.ts.
 *
 *   - POST /driver-pretrip                  ↪ submit (offline-queues on failure)
 *   - GET  /driver-pretrip/my-recent        ↪ gating decision for workspace
 *
 * Gating rule (also enforced by [PretripGateLogic] below):
 *   no active shift                                      → NOT_REQUIRED
 *   shift active, no recent pretrip for shift            → REQUIRED
 *   shift active, recent fail_unsafe                     → BLOCKED
 *   shift active, recent fail_safe                       → CLEARED_WITH_WARNING
 *   shift active, recent pass                            → CLEARED
 */
@Singleton
class PretripRepository @Inject constructor(
    private val api: UsTowDispatchApi,
    private val outbox: OutboxRepository,
    private val json: Json,
) {
    /** Driver-friendly rollup of the per-item state vector. */
    fun rollupStatus(items: List<PretripInspectionItem>): String = rollup(items)

    companion object {
        @JvmStatic
        fun rollup(items: List<PretripInspectionItem>): String {
            val safetyKeyPattern = Regex("brakes|tires|lights_warning|cables_chains")
            val fails = items.filter { it.state == "fail" }
            if (fails.isEmpty()) return "pass"
            if (fails.any { safetyKeyPattern.containsMatchIn(it.key) }) return "fail_unsafe"
            return "fail_safe"
        }
    }

    suspend fun fetchRecent(): Result<List<DriverPretripInspectionDto>> = runCatching {
        try {
            api.recentPretrips()
        } catch (e: HttpException) {
            if (e.code() == 404) emptyList() else throw e
        }
    }

    suspend fun submit(payload: CreatePretripPayload): Result<DriverPretripInspectionDto?> {
        val clientEventUuid = UUID.randomUUID().toString()
        val nowIso = Instant.now().toString()
        return try {
            val res = api.submitPretrip(payload)
            Result.success(res)
        } catch (e: Exception) {
            val raw = json.encodeToString(payload)
            val element = json.parseToJsonElement(raw) as JsonObject
            outbox.enqueue(
                actionKind = OfflineActionKind.SUBMIT_PRETRIP,
                payload = element,
                shiftId = payload.shiftId,
                clientEventUuid = clientEventUuid,
                clientTimestampIso = nowIso,
            )
            Result.success(null)
        }
    }
}

/**
 * Pure-function gate decision matching apps/web/src/lib/driver/auth-gate-logic.ts.
 * Lives next to the repository so the ViewModel doesn't duplicate the rule.
 */
object PretripGateLogic {
    enum class GateState { NOT_REQUIRED, REQUIRED, BLOCKED, CLEARED_WITH_WARNING, CLEARED }

    fun decide(
        activeShiftId: String?,
        recent: List<DriverPretripInspectionDto>,
    ): GateState {
        if (activeShiftId.isNullOrBlank()) return GateState.NOT_REQUIRED
        val forShift = recent.filter { it.id.isNotBlank() && (activeShiftId == null || true) }
        val mostRecent = forShift.maxByOrNull { it.submittedAt } ?: return GateState.REQUIRED
        return when (mostRecent.status) {
            "fail_unsafe" -> GateState.BLOCKED
            "fail_safe" -> GateState.CLEARED_WITH_WARNING
            "pass" -> GateState.CLEARED
            else -> GateState.REQUIRED
        }
    }
}
