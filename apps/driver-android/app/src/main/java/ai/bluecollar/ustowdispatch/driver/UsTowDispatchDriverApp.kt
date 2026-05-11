package ai.bluecollar.ustowdispatch.driver

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentResolver
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import dagger.hilt.android.HiltAndroidApp

/**
 * Two-channel notification setup driving the Session-15 driver-app moat.
 *
 *   * CHANNEL_JOBS_EMERGENCY — IMPORTANCE_HIGH (caps at the user's max), bypasses
 *     DND, custom loud sound (`new_job_alert`), aggressive vibration, badge.
 *     Used for `dispatch.job_assigned` and motor-club emergency events.
 *   * CHANNEL_JOBS_NORMAL — IMPORTANCE_HIGH, default sound, badge. Used for
 *     status updates, GOA flags, customer-side dispatch events.
 *
 * The legacy `CHANNEL_JOB_ALERTS` id is kept around as an alias on
 * Android 11 and below where channels can't be deleted gracefully on
 * update. We re-create it with IMPORTANCE_NONE so existing installs that
 * still see traffic addressed to it stay quiet rather than fire the old
 * default sound.
 */
@HiltAndroidApp
class UsTowDispatchDriverApp : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        // Looked up dynamically so the project compiles even before the audio
        // asset is dropped into res/raw. Replace with R.raw.new_job_alert once
        // the asset lands. If unresolved at runtime we fall through to the
        // default alarm tone via the AudioAttributes USAGE_ALARM hint.
        val rawId = resources.getIdentifier("new_job_alert", "raw", packageName)
        val customSoundUri: Uri? = if (rawId != 0) {
            Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://$packageName/$rawId")
        } else null
        val audioAttrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        // Emergency channel: max importance the platform allows + DND override.
        val emergency = NotificationChannel(
            CHANNEL_JOBS_EMERGENCY,
            "Emergency dispatch",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "New jobs that need an immediate response. Bypasses Do Not Disturb."
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 700, 200, 700, 200, 700)
            enableLights(true)
            setBypassDnd(true)
            if (customSoundUri != null) {
                setSound(customSoundUri, audioAttrs)
            }
            setShowBadge(true)
            // Lock-screen visibility — show full content so a driver glancing at the
            // phone in a glove can read the job without unlocking.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
        }
        mgr.createNotificationChannel(emergency)

        // Normal-priority channel: still HIGH (loud + heads-up) but no DND bypass.
        val normal = NotificationChannel(
            CHANNEL_JOBS_NORMAL,
            "Dispatch updates",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Job status updates, customer notes, motor-club ETA pushes."
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 250, 200, 250)
            enableLights(true)
            setShowBadge(true)
        }
        mgr.createNotificationChannel(normal)

        // Legacy alias — keep silent so we never accidentally fire the old default
        // sound on devices that haven't yet rotated to the new channels.
        val legacy = NotificationChannel(
            CHANNEL_JOB_ALERTS_LEGACY,
            "Legacy job alerts (do not use)",
            NotificationManager.IMPORTANCE_NONE,
        )
        mgr.createNotificationChannel(legacy)
    }

    companion object {
        /** Used by job-assigned and emergency dispatch pushes. Loud + DND-override. */
        const val CHANNEL_JOBS_EMERGENCY = "towcommand_jobs_emergency"

        /** Used by status-update / motor-club ETA pushes. Loud, no DND override. */
        const val CHANNEL_JOBS_NORMAL = "towcommand_jobs_normal"

        /** Legacy channel id from Session 7 — silenced. */
        const val CHANNEL_JOB_ALERTS_LEGACY = "job_alerts"

        /** Kept for source-compat. New code should reference the specific id. */
        const val CHANNEL_JOB_ALERTS = CHANNEL_JOBS_EMERGENCY
    }
}
