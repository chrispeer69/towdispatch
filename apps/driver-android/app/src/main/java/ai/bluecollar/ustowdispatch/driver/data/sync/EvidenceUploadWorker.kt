package ai.bluecollar.ustowdispatch.driver.data.sync

import ai.bluecollar.ustowdispatch.driver.data.local.PendingEvidenceEntity
import ai.bluecollar.ustowdispatch.driver.data.repo.EvidenceRepository
import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/**
 * Drains [PendingEvidenceEntity] rows through the S3-presign / PUT /
 * finalize pipeline. Backed by WorkManager so an interrupted upload picks
 * up where it left off after the next NetworkType.CONNECTED signal.
 *
 * Single uniqueWork name "driver-upload" matches Block E's invariant —
 * concurrent enqueues collapse rather than fanning out.
 */
@HiltWorker
class EvidenceUploadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val repo: EvidenceRepository,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val rows = repo.unfinalized()
        if (rows.isEmpty()) return Result.success()
        var anyRetryable = false
        rows.forEach { row ->
            val result = repo.drainOne(row)
            if (result.isFailure) anyRetryable = true
        }
        repo.pruneFinalized()
        return if (anyRetryable) Result.retry() else Result.success()
    }

    companion object {
        const val UNIQUE_WORK_NAME = "driver-upload"

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<EvidenceUploadWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }
    }
}
