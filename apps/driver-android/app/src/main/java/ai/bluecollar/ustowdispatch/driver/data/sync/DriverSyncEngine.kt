package ai.bluecollar.ustowdispatch.driver.data.sync

import ai.bluecollar.ustowdispatch.driver.data.api.UsTowDispatchApi
import ai.bluecollar.ustowdispatch.driver.data.api.dto.OfflineReplayActionDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.OfflineReplayBatchRequest
import ai.bluecollar.ustowdispatch.driver.data.local.OfflineActionEntity
import ai.bluecollar.ustowdispatch.driver.data.repo.OutboxRepository
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Drains the offline outbox against POST /driver-offline-sync/replay.
 *
 * Behavior:
 * - Pulls up to [BATCH_SIZE] pending rows in clientTimestamp order so the
 *   server applies dependent actions in the same sequence the driver fired
 *   them (a transition to in_progress that precedes a payment capture, etc).
 * - Maps the server's per-action result to a row-level state change:
 *     applied/skipped → STATUS_APPLIED / STATUS_SKIPPED (pruned by [OutboxRepository.pruneResolved])
 *     failed          → recordAttempt with the failureReason; eligible for retry
 * - On HTTP 404 the endpoint isn't deployed yet — falls back to per-item
 *   replay by POSTing the same batch with a single action each. Same
 *   404 there → mark the row failed.
 */
@Singleton
class DriverSyncEngine @Inject constructor(
    private val api: UsTowDispatchApi,
    private val outbox: OutboxRepository,
    private val json: Json,
) {
    suspend fun drain(): DrainResult {
        var batchesProcessed = 0
        var applied = 0
        var failed = 0
        while (true) {
            val rows = outbox.pending(BATCH_SIZE)
            if (rows.isEmpty()) break
            val request = OfflineReplayBatchRequest(actions = rows.map(::toDto))
            try {
                val response = api.replayOfflineBatch(request)
                val byUuid = response.results.associateBy { it.clientEventUuid }
                rows.forEach { row ->
                    when (val result = byUuid[row.clientEventUuid]) {
                        null -> outbox.recordAttempt(
                            row.clientEventUuid,
                            OfflineActionEntity.STATUS_PENDING,
                            "Server did not return a result for this action",
                        )
                        else -> when (result.status) {
                            "applied" -> {
                                outbox.setStatus(row.clientEventUuid, OfflineActionEntity.STATUS_APPLIED)
                                applied++
                            }
                            "skipped" -> outbox.setStatus(row.clientEventUuid, OfflineActionEntity.STATUS_SKIPPED)
                            "failed" -> {
                                outbox.recordAttempt(
                                    row.clientEventUuid,
                                    OfflineActionEntity.STATUS_PENDING,
                                    result.failureReason ?: "failed",
                                )
                                failed++
                            }
                            else -> outbox.recordAttempt(
                                row.clientEventUuid,
                                OfflineActionEntity.STATUS_PENDING,
                                "Unknown server status: ${result.status}",
                            )
                        }
                    }
                }
            } catch (e: HttpException) {
                if (e.code() == 404) {
                    // Endpoint not deployed — fall back to per-item drain.
                    return drainPerItem(rows, alreadyApplied = applied)
                }
                rows.forEach {
                    outbox.recordAttempt(
                        it.clientEventUuid,
                        OfflineActionEntity.STATUS_PENDING,
                        "HTTP ${e.code()}: ${e.message()}",
                    )
                }
                return DrainResult(batchesProcessed + 1, applied, failed + rows.size, e)
            } catch (e: Exception) {
                rows.forEach {
                    outbox.recordAttempt(
                        it.clientEventUuid,
                        OfflineActionEntity.STATUS_PENDING,
                        e.localizedMessage,
                    )
                }
                return DrainResult(batchesProcessed + 1, applied, failed + rows.size, e)
            }
            batchesProcessed++
            outbox.pruneResolved()
            if (rows.size < BATCH_SIZE) break
        }
        outbox.pruneResolved()
        return DrainResult(batchesProcessed, applied, failed, null)
    }

    private suspend fun drainPerItem(rows: List<OfflineActionEntity>, alreadyApplied: Int): DrainResult {
        var applied = alreadyApplied
        var failed = 0
        rows.forEach { row ->
            val single = OfflineReplayBatchRequest(actions = listOf(toDto(row)))
            try {
                val response = api.replayOfflineBatch(single)
                val first = response.results.firstOrNull { it.clientEventUuid == row.clientEventUuid }
                when (first?.status) {
                    "applied" -> {
                        outbox.setStatus(row.clientEventUuid, OfflineActionEntity.STATUS_APPLIED); applied++
                    }
                    "skipped" -> outbox.setStatus(row.clientEventUuid, OfflineActionEntity.STATUS_SKIPPED)
                    else -> {
                        outbox.recordAttempt(
                            row.clientEventUuid,
                            OfflineActionEntity.STATUS_PENDING,
                            first?.failureReason ?: "no result",
                        )
                        failed++
                    }
                }
            } catch (e: HttpException) {
                outbox.recordAttempt(
                    row.clientEventUuid,
                    OfflineActionEntity.STATUS_PENDING,
                    "HTTP ${e.code()}: ${e.message()}",
                )
                failed++
            } catch (e: Exception) {
                outbox.recordAttempt(
                    row.clientEventUuid,
                    OfflineActionEntity.STATUS_PENDING,
                    e.localizedMessage,
                )
                failed++
            }
        }
        outbox.pruneResolved()
        return DrainResult(1, applied, failed, null)
    }

    private fun toDto(row: OfflineActionEntity): OfflineReplayActionDto {
        val payload = json.parseToJsonElement(row.payloadJson) as JsonElement
        return OfflineReplayActionDto(
            actionKind = row.actionKind,
            payload = payload,
            clientTimestamp = row.clientTimestampIso,
            clientEventUuid = row.clientEventUuid,
            jobId = row.jobId,
            shiftId = row.shiftId,
        )
    }

    data class DrainResult(
        val batchesProcessed: Int,
        val applied: Int,
        val failed: Int,
        val terminalError: Throwable?,
    )

    companion object {
        const val BATCH_SIZE = 50
        const val UNIQUE_WORK_NAME = "driver-sync"
    }
}
