package ai.bluecollar.ustowdispatch.driver.data.sync

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
 * One-shot worker that drains the offline outbox once. Kicked from:
 *  - app start (when there are pending rows)
 *  - connectivity changes (NetworkCallback in ConnectivityObserver)
 *  - manual "Retry" tap on the offline screen
 *  - tail end of any mutating repo call
 *
 * Single uniqueWork name keeps concurrent enqueues collapsed.
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val engine: DriverSyncEngine,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return runCatching { engine.drain() }
            .map { drainResult ->
                if (drainResult.terminalError == null) Result.success() else Result.retry()
            }
            .getOrElse { Result.retry() }
    }

    companion object {
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                DriverSyncEngine.UNIQUE_WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }
    }
}
