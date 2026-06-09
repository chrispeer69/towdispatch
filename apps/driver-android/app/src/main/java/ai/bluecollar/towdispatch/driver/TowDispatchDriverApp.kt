package ai.bluecollar.towdispatch.driver

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class TowDispatchDriverApp : Application() {
    override fun onCreate() {
        super.onCreate()
        createJobAlertChannel()
    }

    private fun createJobAlertChannel() {
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_JOB_ALERTS,
            "Job alerts",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "New jobs and dispatch updates"
            enableVibration(true)
            enableLights(true)
        }
        mgr.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_JOB_ALERTS = "job_alerts"
    }
}
