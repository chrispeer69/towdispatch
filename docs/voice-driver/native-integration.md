# Voice-Controlled Driver Workflows — Native Integration Spec (Session 45)

Hands-free, voice-driven job actions for drivers in a moving truck. Drivers
can't tap a phone while driving; voice gives them job acceptance, status
updates, navigation read-back, and arrival/clearing actions without touching
the screen.

This document is the contract the native apps (iOS CarPlay, Android Auto)
and the web fallback implement against. **The backend (API + parser +
audit log) ships in Session 45. The native UI is scaffolding + spec only —
full CarPlay / Android Auto UI and wiring into the shared networking layer
is a follow-up for the native teams.**

---

## 1. The contract

One endpoint, driver-JWT scoped:

```
POST /voice-driver/command
Authorization: Bearer <driver-jwt>
Content-Type: application/json
```

Request (`VoiceCommandRequest`, `@ustowdispatch/shared`):

```jsonc
{
  "transcript": "I'm on scene",      // raw speech-to-text, required
  "platform": "ios_carplay",          // ios_carplay | android_auto | web | other
  "jobId": "0192...",                 // optional; omit to act on the driver's single active job
  "locale": "en"                       // en | es — language of the spoken response
}
```

Response (`VoiceCommandResponse`):

```jsonc
{
  "recognizedIntent": "arrive_on_scene", // one of the 12 intents, or "clarify"
  "confidence": 0.92,
  "actionExecuted": true,                 // did a state change happen this turn?
  "responseText": "You're marked on scene.", // SPEAK THIS via TTS
  "followUpQuestion": null,               // if set: speak it, then listen again
  "confirmationRequired": false,          // true → a destructive action is queued
  "jobId": "0192...",
  "jobStatus": "on_scene"                 // job status after the action (or null)
}
```

The native app's job is simple: **capture transcript → POST → speak
`responseText` → if `followUpQuestion` is non-null, listen for the next
utterance and POST again.**

When `VOICE_DRIVER_ENABLED=false` the endpoint returns `503
service_unavailable`; the app should fall back to manual tap controls.

---

## 2. Intent catalog (v1 — 12 intents)

| Intent | Example utterance | Effect |
|---|---|---|
| `accept_job` | "accept", "I'll take it" | acknowledge (no state change) |
| `decline_job` | "decline", "can't take this" | → `cancelled` **(confirm)** |
| `en_route` | "en route", "on my way" | → `enroute` |
| `arrive_on_scene` | "on scene", "I'm here" | → `on_scene` |
| `vehicle_loaded` | "loaded", "hooked up" | → `in_progress` |
| `en_route_drop` | "heading to the drop" | informational |
| `arrive_drop` | "at the drop-off" | informational |
| `clear_job` | "clear the job", "all done" | → `completed` **(confirm)** |
| `request_help` | "I need backup" | escalate to dispatch |
| `repeat_address` | "what's the address" | read pickup/drop address |
| `eta_update` | "ETA twenty minutes" | record minutes |
| `mark_breakdown` | "my truck broke down" | escalate **(confirm)** |

Below `VOICE_DRIVER_CONFIDENCE_MIN` (default 0.75) the parser returns
`recognizedIntent: "clarify"` and a `followUpQuestion` asking the driver to
repeat.

### Confirmation flow (destructive intents)

`decline_job`, `clear_job`, `mark_breakdown` are **two-turn**:

1. Driver: "decline this job" → response `confirmationRequired: true`,
   `followUpQuestion: "Confirm you want to decline this job? Say yes or no."`
2. Driver: "yes" → action executes. "no" → cancelled.

No client state is needed — the server tracks the pending confirmation
(see SESSION_45_DECISIONS.md). The app just speaks the prompt and posts the
next utterance. Pending confirmations expire after 90 seconds.

---

## 3. iOS — CarPlay + SFSpeechRecognizer

Scaffolding: `apps/driver-ios/TowCommandDriver/Features/Voice/VoiceCommandController.swift`

- A `CPTemplateApplicationSceneDelegate` registers a CarPlay scene with a
  single "Voice" `CPListTemplate` / push-to-talk button.
- `SFSpeechRecognizer` (on-device where available) transcribes; the final
  transcript is POSTed to `/voice-driver/command`.
- `AVSpeechSynthesizer` speaks `responseText`. If `followUpQuestion != nil`,
  re-arm the recognizer for the confirmation turn.
- Requires `NSSpeechRecognitionUsageDescription` and `NSMicrophoneUsageDescription`
  in Info.plist, and the CarPlay entitlement (`com.apple.developer.carplay-*`).

**Native follow-up:** add the endpoint to
`Packages/Core/Sources/Core/Networking/Endpoints.swift`
(`/voice-driver/command`) and a `postVoiceCommand` method on
`USTowDispatchAPI.swift`, then drive the scene from there. The stub keeps
the path local so the app target still builds without the CarPlay
entitlement provisioned.

---

## 4. Android — Android Auto + SpeechRecognizer

Scaffolding: `apps/driver-android/app/src/main/java/ai/bluecollar/ustowdispatch/driver/voice/VoiceCommandService.kt`

- A `CarAppService` + `Session` exposes a single voice `Screen` for Android
  Auto.
- `android.speech.SpeechRecognizer` transcribes; the transcript is POSTed to
  `/voice-driver/command`.
- `android.speech.tts.TextToSpeech` speaks `responseText`; re-arm on
  `followUpQuestion`.
- Manifest needs `RECORD_AUDIO`, the `androidx.car.app` library, and a
  `<service>` with `androidx.car.app.category.NAVIGATION`.

**Native follow-up:** add the call to
`app/src/main/java/.../data/api/UsTowDispatchApi.kt` (Retrofit
`@POST("voice-driver/command")`) and wire it through the existing DI graph.
The stub keeps the request/response data classes local until then.

---

## 5. Web fallback (testable today)

`apps/web/src/app/driver/voice/page.tsx` — a Web Speech API demo page that
runs the entire flow in a browser: `webkitSpeechRecognition` →
`/voice-driver/command` via `driverApi` → `speechSynthesis`. This is how
the flow is exercised end-to-end without a car. It surfaces the recognized
intent, confidence, and the spoken response so QA can validate intents and
the confirmation gate against a real driver session.

---

## 6. Deferred (not in v1)

- LLM intent provider (the `LlmIntentProvider` seam exists; v1 is keyword-only).
- Custom wake word ("Hey DISPATCH").
- Fully offline on-device parsing (the parser is pure and portable, but the
  native apps call the server in v1 so the audit log and transitions stay
  authoritative).
- Multi-job disambiguation by voice ("the Toyota" vs "the Ford") — v1 asks
  the driver to open the job when more than one is active.
