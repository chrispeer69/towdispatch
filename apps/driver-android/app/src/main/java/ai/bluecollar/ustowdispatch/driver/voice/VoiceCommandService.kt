package ai.bluecollar.ustowdispatch.driver.voice

/*
 * Voice-Controlled Driver Workflows (Session 45)
 *
 * SCAFFOLDING — not yet wired into the app's DI graph or the Android Auto
 * manifest. Documents the intended Android Auto + SpeechRecognizer flow and
 * is the seed the native team grows into the production CarAppService. See
 * docs/voice-driver/native-integration.md.
 *
 * Flow: android.speech.SpeechRecognizer transcribes a push-to-talk utterance
 * → POST /voice-driver/command → TextToSpeech speaks responseText → if
 * followUpQuestion is non-null, re-arm the recognizer for a confirmation
 * turn. No client confirmation state — the server tracks pending destructive
 * actions for 90s.
 *
 * Production follow-up (deferred): add the call to
 * data/api/UsTowDispatchApi.kt (Retrofit @POST("voice-driver/command")) and
 * wire this through Hilt. Manifest needs RECORD_AUDIO, androidx.car.app, and
 * a <service> with category androidx.car.app.category.NAVIGATION.
 */

/**
 * Request/response mirror of the shared Zod contract
 * (packages/shared/src/voice-driver). Kept local until the endpoint is added
 * to UsTowDispatchApi.kt.
 */
data class VoiceCommandRequest(
    val transcript: String,
    val platform: String = "android_auto",
    val jobId: String? = null,
    val locale: String = "en", // "en" | "es"
)

data class VoiceCommandResponse(
    val recognizedIntent: String,
    val confidence: Double,
    val actionExecuted: Boolean,
    val responseText: String,
    val followUpQuestion: String?,
    val confirmationRequired: Boolean,
    val jobId: String?,
    val jobStatus: String?,
)

/**
 * Drives the hands-free loop. UI binding (an Android Auto `Screen` with a
 * push-to-talk action) is deferred; this class owns the recognize → POST →
 * speak cycle.
 *
 * @param post injected by the native team — posts to the driver-scoped API
 *   and returns the decoded response. Stubbed here.
 */
class VoiceCommandController(
    private val locale: String = "en",
    private val post: suspend (VoiceCommandRequest) -> VoiceCommandResponse,
    private val speak: (String, String) -> Unit, // (text, bcp47Lang) → TTS
) {
    /**
     * Send a finished transcript through the API and speak the result.
     * Returns true when the caller should re-arm the recognizer (the
     * response asked a follow-up question, e.g. a confirmation prompt).
     */
    suspend fun handle(transcript: String, jobId: String? = null): Boolean {
        val request = VoiceCommandRequest(transcript = transcript, jobId = jobId, locale = locale)
        return try {
            val response = post(request)
            speak(response.responseText, if (locale == "es") "es-US" else "en-US")
            response.followUpQuestion != null
        } catch (e: Exception) {
            speak("Sorry, that didn't work.", if (locale == "es") "es-US" else "en-US")
            false
        }
    }
}
