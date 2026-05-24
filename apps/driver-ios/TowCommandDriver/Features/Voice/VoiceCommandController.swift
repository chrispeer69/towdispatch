//
//  VoiceCommandController.swift
//  Voice-Controlled Driver Workflows (Session 45)
//
//  SCAFFOLDING — not yet wired into the app target or the CarPlay scene
//  manifest. This file documents the intended CarPlay + speech flow and is
//  the seed the native team grows into the production controller. See
//  docs/voice-driver/native-integration.md.
//
//  Flow: SFSpeechRecognizer transcribes a push-to-talk utterance →
//  POST /voice-driver/command → AVSpeechSynthesizer speaks responseText →
//  if followUpQuestion is non-nil, re-arm the recognizer for a confirmation
//  turn. No client confirmation state — the server tracks pending
//  destructive actions for 90s.
//
//  Production follow-up (deferred): add `/voice-driver/command` to
//  Packages/Core/.../Networking/Endpoints.swift and a `postVoiceCommand`
//  method on USTowDispatchAPI.swift, then drive this controller from there.
//  Requires Info.plist NSSpeechRecognitionUsageDescription +
//  NSMicrophoneUsageDescription and the CarPlay entitlement.
//

import AVFoundation
import Foundation
import Speech

/// Request/response mirror of the shared Zod contract
/// (packages/shared/src/voice-driver). Kept local until the endpoint is
/// added to the shared networking layer.
struct VoiceCommandRequest: Encodable {
    let transcript: String
    let platform: String   // "ios_carplay"
    let jobId: String?
    let locale: String     // "en" | "es"
}

struct VoiceCommandResponse: Decodable {
    let recognizedIntent: String
    let confidence: Double
    let actionExecuted: Bool
    let responseText: String
    let followUpQuestion: String?
    let confirmationRequired: Bool
    let jobId: String?
    let jobStatus: String?
}

/// Drives the hands-free loop. UI binding (a CarPlay `CPListTemplate` with a
/// push-to-talk button) is deferred; this object owns the recognize → POST →
/// speak cycle.
final class VoiceCommandController: NSObject {
    private let recognizer = SFSpeechRecognizer()
    private let synthesizer = AVSpeechSynthesizer()
    private let audioEngine = AVAudioEngine()
    private var locale: String

    /// Injected by the native team: posts the request to the driver-scoped
    /// API and returns the decoded response. Stubbed here.
    private let post: (VoiceCommandRequest) async throws -> VoiceCommandResponse

    init(locale: String = "en",
         post: @escaping (VoiceCommandRequest) async throws -> VoiceCommandResponse) {
        self.locale = locale
        self.post = post
    }

    /// Request mic + speech authorization. Call before the first listen.
    func requestAuthorization() async -> Bool {
        await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { status in
                cont.resume(returning: status == .authorized)
            }
        }
    }

    /// Send a finished transcript through the API and speak the result.
    /// Returns true when the caller should re-arm the recognizer (the
    /// response asked a follow-up question, e.g. a confirmation prompt).
    @discardableResult
    func handle(transcript: String, jobId: String? = nil) async -> Bool {
        let request = VoiceCommandRequest(
            transcript: transcript,
            platform: "ios_carplay",
            jobId: jobId,
            locale: locale
        )
        do {
            let response = try await post(request)
            speak(response.responseText)
            return response.followUpQuestion != nil
        } catch {
            speak(NSLocalizedString("voice.error", comment: "Generic voice command failure"))
            return false
        }
    }

    private func speak(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: locale == "es" ? "es-US" : "en-US")
        synthesizer.speak(utterance)
    }
}
