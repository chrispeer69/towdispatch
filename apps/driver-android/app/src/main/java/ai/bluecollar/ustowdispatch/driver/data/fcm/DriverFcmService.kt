package ai.bluecollar.ustowdispatch.driver.data.fcm

import ai.bluecollar.ustowdispatch.driver.MainActivity
import ai.bluecollar.ustowdispatch.driver.R
import ai.bluecollar.ustowdispatch.driver.UsTowDispatchDriverApp
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONException
import org.json.JSONObject

/**
 * Session-15 FCM receiver.
 *
 * The backend sends a hybrid payload (both `notification` and `data`
 * blocks) so the system tray surfaces the alert even when the app is
 * force-stopped, AND our service still gets a chance to apply the
 * full moat: emergency channel, custom sound, deep link, instrumentation.
 *
 * Payload shape (from PushAdapter.buildFcmBody):
 *   data.event_type     — e.g. "dispatch.job_assigned"
 *   data.notification_id — server uuid
 *   data.delivery_id    — server uuid (used as Android tag)
 *   data.priority       — "emergency" | "high" | "normal" | "low"
 *   data.payload_json   — stringified JSON of the original payload
 *
 * Emergency dispatches (priority='emergency' OR event_type starting with
 * `dispatch.`) route to CHANNEL_JOBS_EMERGENCY. Everything else uses
 * CHANNEL_JOBS_NORMAL.
 */
class DriverFcmService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val eventType = data["event_type"] ?: "system.unknown"
        val priority = data["priority"] ?: "normal"
        val notificationId = data["notification_id"]
        val deliveryId = data["delivery_id"]
        val payloadJson = data["payload_json"]

        val isEmergencyDispatch = priority == "emergency" ||
            (eventType.startsWith("dispatch.") && (priority == "high" || priority == "emergency"))

        val channel = if (isEmergencyDispatch) {
            TowCommandDriverApp.CHANNEL_JOBS_EMERGENCY
        } else {
            TowCommandDriverApp.CHANNEL_JOBS_NORMAL
        }

        val title = message.notification?.title ?: prettifyEvent(eventType)
        val body = message.notification?.body ?: data["body"] ?: extractBodyFromPayload(payloadJson)

        // Deep link — tap routes to the job detail screen with the job id
        // pre-loaded if we have one. The MainActivity reads these extras on
        // resume and navigates accordingly.
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("deeplink", buildDeeplink(eventType, payloadJson))
            putExtra("notification_id", notificationId)
            putExtra("delivery_id", deliveryId)
        }
        val pi = PendingIntent.getActivity(
            this,
            (deliveryId ?: notificationId ?: "0").hashCode(),
            openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = NotificationCompat.Builder(this, UsTowDispatchDriverApp.CHANNEL_JOB_ALERTS)
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        val builder = NotificationCompat.Builder(this, channel)
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        val builder = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(
                if (isEmergencyDispatch) NotificationCompat.PRIORITY_MAX
                else NotificationCompat.PRIORITY_HIGH,
            )
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(pi)

        if (isEmergencyDispatch) {
            // setOngoing keeps the banner sticky until the driver opens it,
            // which forces an explicit accept/decline. Required by the
            // driver-app moat: silent timeout is unacceptable.
            builder.setOngoing(true)
        }
        deliveryId?.let { builder.setTag(it) }

        // Notify under the deliveryId hash so re-delivery of the same event
        // updates rather than spamming.
        val notifId = (deliveryId ?: notificationId ?: "0").hashCode()
        mgr.notify(notifId, builder.build())

        // Instrumentation: report receipt back to the API so the delivery row
        // flips to "delivered". The FcmReceiptReporter is best-effort.
        if (deliveryId != null) {
            FcmReceiptReporter.reportReceived(applicationContext, deliveryId)
        }
        Log.d(TAG, "FCM received event=$eventType priority=$priority delivery=$deliveryId")
    }

    override fun onNewToken(token: String) {
        // Hand off to the device-token registration use-case. We don't have
        // the user/tenant context here, so the reporter buffers the token and
        // flushes once the app has an auth session.
        FcmTokenRegistrar.queueToken(applicationContext, token)
    }

    private fun prettifyEvent(eventType: String): String = when {
        eventType.startsWith("dispatch.") -> "Dispatch"
        eventType.startsWith("motor_club.") -> "Motor club"
        eventType.startsWith("customer.") -> "Customer"
        eventType.startsWith("compliance.") -> "Compliance"
        else -> "TowCommand"
    }

    private fun extractBodyFromPayload(payloadJson: String?): String {
        if (payloadJson.isNullOrBlank()) return "Open the app to see details."
        return try {
            val j = JSONObject(payloadJson)
            j.optString(
                "subject",
                j.optString("body", "Open the app to see details."),
            )
        } catch (_: JSONException) {
            "Open the app to see details."
        }
    }

    private fun buildDeeplink(eventType: String, payloadJson: String?): String {
        if (payloadJson.isNullOrBlank()) return "/jobs"
        return try {
            val j = JSONObject(payloadJson)
            val jobId = j.optString("jobId", "")
            if (eventType.startsWith("dispatch.") && jobId.isNotBlank()) {
                "/jobs/$jobId"
            } else "/jobs"
        } catch (_: JSONException) {
            "/jobs"
        }
    }

    companion object {
        private const val TAG = "DriverFcmService"
    }
}
