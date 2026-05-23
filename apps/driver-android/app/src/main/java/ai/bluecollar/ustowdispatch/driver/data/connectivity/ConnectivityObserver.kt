package ai.bluecollar.ustowdispatch.driver.data.connectivity

import ai.bluecollar.ustowdispatch.driver.data.sync.EvidenceUploadWorker
import ai.bluecollar.ustowdispatch.driver.data.sync.SyncWorker
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Centralized reachability layer. Exposes a [StateFlow] of connectivity
 * status to the UI and pokes both WorkManager pipelines (`driver-sync` and
 * `driver-upload`) when the link comes back up, so queued mutations and
 * pending evidence drain without manual user action.
 *
 * Built on ConnectivityManager.NetworkCallback (the modern post-API-23
 * surface). Single observer is shared application-wide; collectAsState in
 * Compose just re-emits the latest snapshot.
 */
@Singleton
class ConnectivityObserver @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    enum class Status { AVAILABLE, UNAVAILABLE }

    private val scope = CoroutineScope(SupervisorJob())
    private val cm = context.getSystemService(ConnectivityManager::class.java)

    val statusFlow: Flow<Status> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(Status.AVAILABLE)
                // Drain queues opportunistically.
                SyncWorker.enqueue(context)
                EvidenceUploadWorker.enqueue(context)
            }
            override fun onLost(network: Network) {
                trySend(Status.UNAVAILABLE)
            }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                ) {
                    trySend(Status.AVAILABLE)
                }
            }
        }
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        // Seed with current state so consumers don't wait for the first event.
        trySend(currentStatus())
        cm?.registerNetworkCallback(request, callback)
        awaitClose { runCatching { cm?.unregisterNetworkCallback(callback) } }
    }

    val state: StateFlow<Status> = statusFlow.stateIn(scope, SharingStarted.Eagerly, currentStatus())

    fun currentStatus(): Status {
        val net = cm?.activeNetwork ?: return Status.UNAVAILABLE
        val caps = cm.getNetworkCapabilities(net) ?: return Status.UNAVAILABLE
        return if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) Status.AVAILABLE
        else Status.UNAVAILABLE
    }
}
