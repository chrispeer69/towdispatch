package ai.bluecollar.ustowdispatch.driver.data.fcm

import ai.bluecollar.ustowdispatch.driver.MainActivity
import ai.bluecollar.ustowdispatch.driver.R
import ai.bluecollar.ustowdispatch.driver.UsTowDispatchDriverApp
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Handles incoming push notifications. The web dashboard / dispatch back-end
 * is expected to send a data-only message with at least:
 *   - `type`: "new_job" | "job_updated"
 *   - `jobNumber`: human-readable
 *   - `body`: optional override
 *
 * For Session 7 we just render a high-importance system notification with the
 * default alarm sound so a driver in the field hears it over road noise.
 * Topic subscription / token registration with the server is out of scope —
 * the contract engineer will wire that up in Phase 1.
 */
class DriverFcmService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val type = message.data["type"] ?: "new_job"
        val jobNumber = message.data["jobNumber"]
        val title = when (type) {
            "new_job" -> "New job assigned"
            "job_updated" -> "Job updated"
            else -> "Dispatch update"
        }
        val body = message.data["body"]
            ?: jobNumber?.let { "Job #$it" }
            ?: message.notification?.body
            ?: "Open the app to see details."

        val mgr = getSystemService(NotificationManager::class.java) ?: return

        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = NotificationCompat.Builder(this, UsTowDispatchDriverApp.CHANNEL_JOB_ALERTS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
            .setVibrate(longArrayOf(0, 600, 300, 600))
            .setContentIntent(pi)

        mgr.notify(System.currentTimeMillis().toInt(), builder.build())
    }

    override fun onNewToken(token: String) {
        // Phase 1: POST this token to a /push/register endpoint so the
        // backend can address this device. Intentionally a no-op for v0.
    }
}
