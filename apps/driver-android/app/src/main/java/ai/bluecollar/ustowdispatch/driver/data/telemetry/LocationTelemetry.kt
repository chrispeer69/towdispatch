package ai.bluecollar.ustowdispatch.driver.data.telemetry

import ai.bluecollar.ustowdispatch.driver.data.api.UsTowDispatchApi
import ai.bluecollar.ustowdispatch.driver.data.api.dto.TelemetryBatchRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.TelemetryEventDto
import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * GPS telemetry pipeline matching apps/web/src/lib/driver/telemetry.ts.
 *
 * Wraps FusedLocationProviderClient at PRIORITY_BALANCED_POWER_ACCURACY,
 * 60s cadence with minUpdateDistanceMeters=25 — significant-change only.
 * Samples land in an in-memory buffer and flush every [FLUSH_INTERVAL_MS]
 * or on demand (e.g. shift end, job transition).
 *
 * Background-location handling: this class refuses to start until
 * ACCESS_FINE_LOCATION is granted (foreground). The Android 11+ background
 * permission is intentionally NOT requested here — driver UI should stay
 * foregrounded during shift (per the iOS parity contract); operators will
 * gate the background ask behind a setting in a future session.
 */
@Singleton
class LocationTelemetry @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: UsTowDispatchApi,
) {
    private val fused = LocationServices.getFusedLocationProviderClient(context)
    private val buffer = ArrayDeque<TelemetryEventDto>()
    private val mutex = Mutex()
    private val _state = MutableStateFlow(State.IDLE)
    val state: StateFlow<State> = _state

    @Volatile private var activeShiftId: String? = null

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.lastLocation?.let { onLocation(it) }
        }
    }

    enum class State { IDLE, RUNNING, MISSING_PERMISSION }

    fun isLocationPermissionGranted(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun start(shiftId: String?) {
        if (!isLocationPermissionGranted()) {
            _state.value = State.MISSING_PERMISSION
            return
        }
        activeShiftId = shiftId
        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, SAMPLE_INTERVAL_MS)
            .setMinUpdateIntervalMillis(SAMPLE_INTERVAL_MS)
            .setMinUpdateDistanceMeters(MIN_DISTANCE_METERS)
            .build()
        fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
        _state.value = State.RUNNING
    }

    fun stop() {
        fused.removeLocationUpdates(callback)
        activeShiftId = null
        _state.value = State.IDLE
    }

    private fun onLocation(loc: Location) {
        val event = TelemetryEventDto(
            shiftId = activeShiftId,
            recordedAt = Instant.ofEpochMilli(loc.time).toString(),
            lat = loc.latitude,
            lng = loc.longitude,
            speedMph = if (loc.hasSpeed()) (loc.speed.toDouble() * MPS_TO_MPH).coerceIn(0.0, 300.0) else null,
            headingDegrees = if (loc.hasBearing()) loc.bearing.toDouble() else null,
            accuracyMeters = if (loc.hasAccuracy()) loc.accuracy.toDouble().coerceAtMost(100_000.0) else null,
            eventKind = "ping",
        )
        // Drop oldest if buffer overflows — never block the location callback.
        synchronized(buffer) {
            buffer.addLast(event)
            while (buffer.size > BUFFER_CAP) buffer.removeFirst()
        }
    }

    /**
     * Manual flush. Returns the number of events POSTed. Safe to call on
     * any dispatcher — uses a mutex to serialize concurrent flushes (avoids
     * sending the same buffered sample twice).
     */
    suspend fun flush(): Int = mutex.withLock {
        val snapshot: List<TelemetryEventDto> = synchronized(buffer) {
            if (buffer.isEmpty()) return@withLock 0
            buffer.toList().also { buffer.clear() }
        }
        try {
            api.postTelemetryBatch(TelemetryBatchRequest(events = snapshot))
            snapshot.size
        } catch (e: Exception) {
            // Push samples back onto the buffer head so we retry next flush.
            synchronized(buffer) {
                snapshot.asReversed().forEach { buffer.addFirst(it) }
                while (buffer.size > BUFFER_CAP) buffer.removeFirst()
            }
            throw e
        }
    }

    fun bufferedSamples(): Int = synchronized(buffer) { buffer.size }

    /** Test-only: feed a fake [TelemetryEventDto] without going through the FusedLocationProvider. */
    internal fun injectForTest(event: TelemetryEventDto) {
        synchronized(buffer) {
            buffer.addLast(event)
            while (buffer.size > BUFFER_CAP) buffer.removeFirst()
        }
    }

    companion object {
        const val SAMPLE_INTERVAL_MS = 60_000L
        const val FLUSH_INTERVAL_MS = 60_000L
        const val MIN_DISTANCE_METERS = 25f
        const val BUFFER_CAP = 200
        const val MPS_TO_MPH = 2.236936
    }
}
