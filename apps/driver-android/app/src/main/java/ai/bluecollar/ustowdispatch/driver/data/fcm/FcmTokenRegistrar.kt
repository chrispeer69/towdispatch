package ai.bluecollar.ustowdispatch.driver.data.fcm

import android.content.Context
import android.provider.Settings
import android.util.Log

/**
 * FCM token registrar. Stashes the latest token in SharedPreferences so
 * the next authenticated app start can POST it to
 * /api/notifications/devices.
 *
 * The FCM service runs outside the auth lifecycle (it can fire when the
 * user is logged out), so we defer the actual API call to a flusher
 * triggered from the authenticated UI layer. The deviceId we send is the
 * Android ANDROID_ID — stable per app install per device but cannot be
 * used to correlate to anything outside this tenant.
 */
object FcmTokenRegistrar {
    private const val TAG = "FcmTokenRegistrar"
    private const val PREFS = "fcm_token_registrar"
    private const val KEY_TOKEN = "pending_token"
    private const val KEY_DEVICE_ID = "device_id"

    fun queueToken(ctx: Context, token: String) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_TOKEN, token).apply()
        Log.d(TAG, "queued new FCM token for next flush")
    }

    fun consumePendingToken(ctx: Context): String? {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val tok = prefs.getString(KEY_TOKEN, null)
        if (tok != null) prefs.edit().remove(KEY_TOKEN).apply()
        return tok
    }

    fun deviceId(ctx: Context): String {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val cached = prefs.getString(KEY_DEVICE_ID, null)
        if (cached != null) return cached
        // Fall back to ANDROID_ID. Per-app on Android 8+; stable enough for
        // our tenant-scoped registry. If permission is later denied we can
        // synthesise a uuid here without breaking any contract.
        val androidId = Settings.Secure.getString(
            ctx.contentResolver,
            Settings.Secure.ANDROID_ID,
        ) ?: java.util.UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE_ID, androidId).apply()
        return androidId
    }
}
