package ai.bluecollar.ustowdispatch.driver.data.fcm

import android.content.Context
import android.util.Log

/**
 * Best-effort delivery-receipt reporter. The backend uses the receipt to
 * flip notification_deliveries.status='delivered' for push channels —
 * FCM doesn't return a delivery callback by default, so we self-report
 * from the device.
 *
 * Buffering: if the network is down or the auth session is missing, we
 * stash the deliveryId in shared-prefs and flush on next app launch via
 * MainActivity. Persistence is intentionally cheap (SharedPreferences) —
 * if the device reboots before the flush, we lose the receipt and the
 * dashboard just shows the push as 'sent' rather than 'delivered'. That
 * loss is acceptable given the alternative is a Room table for a feature
 * that's already a "nice to have" downstream of the moat.
 */
object FcmReceiptReporter {
    private const val TAG = "FcmReceiptReporter"
    private const val PREFS = "fcm_receipts"
    private const val PENDING_KEY = "pending"

    fun reportReceived(ctx: Context, deliveryId: String) {
        // Queue locally — the actual HTTP report is done by the work that
        // owns the auth header (see FcmReceiptFlusher in the UI layer).
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = prefs.getStringSet(PENDING_KEY, emptySet())?.toMutableSet() ?: mutableSetOf()
        current.add(deliveryId)
        prefs.edit().putStringSet(PENDING_KEY, current).apply()
        Log.d(TAG, "queued receipt deliveryId=$deliveryId pending=${current.size}")
    }

    fun drainPending(ctx: Context): Set<String> {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = prefs.getStringSet(PENDING_KEY, emptySet()) ?: emptySet()
        if (current.isEmpty()) return emptySet()
        prefs.edit().remove(PENDING_KEY).apply()
        return current.toSet()
    }
}
