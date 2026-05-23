package ai.bluecollar.ustowdispatch.driver.data.sync

/**
 * Mirrors apps/web/src/lib/driver/offline-types.ts. The server's offline
 * replay endpoint dispatches on this string, so spellings must match
 * exactly. Any new kind needs a matching handler in the server's
 * driver-offline-sync service plus a [DriverSyncEngine] applier here.
 */
object OfflineActionKind {
    const val JOB_STATUS_TRANSITION = "job_status_transition"
    const val SUBMIT_PRETRIP = "submit_pretrip"
    const val ACKNOWLEDGE_BRIEFING = "acknowledge_briefing"
    const val UPLOAD_EVIDENCE = "upload_evidence"
    const val FINALIZE_EVIDENCE = "finalize_evidence"
    const val CAPTURE_FIELD_PAYMENT = "capture_field_payment"
    const val SHIFT_CLOCK_ON = "shift_clock_on"
    const val SHIFT_CLOCK_OFF = "shift_clock_off"
    const val NOTE_ADD = "note_add"
}
