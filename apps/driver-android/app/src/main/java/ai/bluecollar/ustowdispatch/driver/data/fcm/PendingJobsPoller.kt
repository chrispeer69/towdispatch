package ai.bluecollar.ustowdispatch.driver.data.fcm

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/**
 * Driver-app moat fallback poller.
 *
 * Background loop that hits GET /dispatch/driver/jobs/pending every 15
 * seconds when FCM hasn't delivered a message in 30 seconds. The "FCM is
 * healthy" signal is reset whenever DriverFcmService.onMessageReceived
 * fires (via [recordFcmDelivery]); if 30s elapse without a tick, we
 * begin polling. When a new FCM message arrives we stop polling for
 * battery — the fallback is on-demand, not constant.
 *
 * The HTTP transport is intentionally tiny: a plain HttpURLConnection.
 * Sharing the Retrofit instance from the data layer would mean importing
 * a Hilt-scoped dependency into a Service which complicates testing.
 * Anything that needs more than this should evolve into a WorkManager
 * Worker instead.
 */
class PendingJobsPoller(
    private val context: Context,
    private val baseUrl: String,
    private val authHeaderProvider: () -> String?,
    private val onJobs: (List<PendingJob>) -> Unit,
) {
    data class PendingJob(
        val jobId: String,
        val jobNumber: String,
        val serviceType: String,
        val pickupAddress: String,
    )

    private val scope = CoroutineScope(Dispatchers.IO)
    private var pollingJob: Job? = null
    private val lastFcmAt = AtomicLong(System.currentTimeMillis())

    /** Should be called by DriverFcmService whenever an FCM message arrives. */
    fun recordFcmDelivery() {
        lastFcmAt.set(System.currentTimeMillis())
        // FCM is healthy — stop polling if we were doing so.
        pollingJob?.let {
            it.cancel()
            pollingJob = null
            Log.d(TAG, "FCM live — pausing fallback poll")
        }
    }

    fun start() {
        if (pollingJob != null) return
        pollingJob = scope.launch {
            // Wait the silence threshold before the first poll. If an FCM
            // message arrives during the wait, [recordFcmDelivery] cancels us.
            while (true) {
                val silentFor = System.currentTimeMillis() - lastFcmAt.get()
                if (silentFor < SILENT_THRESHOLD_MS) {
                    delay(SILENT_THRESHOLD_MS - silentFor)
                    continue
                }
                pollOnce()
                delay(POLL_INTERVAL_MS)
            }
        }
        Log.d(TAG, "fallback poller started")
    }

    fun stop() {
        pollingJob?.cancel()
        pollingJob = null
    }

    private fun pollOnce() {
        try {
            val auth = authHeaderProvider() ?: return
            val url = java.net.URL("$baseUrl/dispatch/driver/jobs/pending")
            val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 5_000
                readTimeout = 8_000
                setRequestProperty("Authorization", auth)
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode in 200..299) {
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val parsed = parse(body)
                if (parsed.isNotEmpty()) onJobs(parsed)
            } else {
                Log.w(TAG, "fallback poll http=${conn.responseCode}")
            }
            conn.disconnect()
        } catch (err: Exception) {
            Log.w(TAG, "fallback poll failed: ${err.message}")
        }
    }

    private fun parse(body: String): List<PendingJob> {
        return try {
            val root = JSONObject(body)
            val arr = root.optJSONArray("jobs") ?: return emptyList()
            (0 until arr.length()).mapNotNull { i ->
                val j = arr.optJSONObject(i) ?: return@mapNotNull null
                val pickup = j.optJSONObject("pickup")
                PendingJob(
                    jobId = j.optString("jobId"),
                    jobNumber = j.optString("jobNumber"),
                    serviceType = j.optString("serviceType"),
                    pickupAddress = pickup?.optString("address") ?: "",
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    companion object {
        private const val TAG = "PendingJobsPoller"
        /** Silence window before we start polling. */
        private const val SILENT_THRESHOLD_MS = 30_000L
        /** Poll cadence once we are in fallback mode. */
        private const val POLL_INTERVAL_MS = 15_000L
    }
}
