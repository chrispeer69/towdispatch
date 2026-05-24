/**
 * Voice-Controlled Driver Workflows (Session 45) — intent catalog + the
 * shared enums for the voice command contract.
 *
 * The parser (apps/api/src/modules/voice-driver/voice-intent.parser.ts) is a
 * pure keyword/pattern function — no LLM in v1. It emits one of the 12
 * driver intents below, or 'clarify' when its confidence falls under
 * VOICE_DRIVER_CONFIDENCE_MIN. The "yes/no" spoken confirmation that gates
 * destructive intents is handled at the service layer, NOT as a public
 * intent — see SESSION_45_DECISIONS.md.
 */
import { z } from 'zod';

// The 12 driver intents the parser recognizes. This is the canonical public
// catalog; keep it at exactly 12.
export const voiceIntentValues = [
  'accept_job', // acknowledge a dispatched job
  'decline_job', // refuse the job (destructive — needs confirmation)
  'en_route', // moving to the pickup → status enroute
  'arrive_on_scene', // arrived at pickup → status on_scene
  'vehicle_loaded', // vehicle is loaded, service underway → status in_progress
  'en_route_drop', // driving to the drop-off (informational; no distinct status)
  'arrive_drop', // arrived at drop-off (informational; no distinct status)
  'clear_job', // job complete → status completed (destructive — needs confirmation)
  'request_help', // escalate to dispatch (informational)
  'repeat_address', // read back the job address (read-only)
  'eta_update', // report a new ETA in minutes (informational)
  'mark_breakdown', // driver's own truck broke down (destructive — needs confirmation)
] as const;
export type VoiceIntent = (typeof voiceIntentValues)[number];

export const voiceIntentEnum = z.enum(voiceIntentValues);

// What the response may report as recognized: the 12 intents plus 'clarify'
// (sub-threshold or unrecognized). 'confirm_yes' / 'confirm_no' are internal
// to the service log and never surface on the public response.
export const recognizedIntentValues = [...voiceIntentValues, 'clarify'] as const;
export type RecognizedIntent = (typeof recognizedIntentValues)[number];
export const recognizedIntentEnum = z.enum(recognizedIntentValues);

export const voicePlatformValues = ['ios_carplay', 'android_auto', 'web', 'other'] as const;
export type VoicePlatform = (typeof voicePlatformValues)[number];
export const voicePlatformEnum = z.enum(voicePlatformValues);

// Spoken-response language. Spanish parity is mandatory (CLAUDE.md Rule 4):
// every response_text ships in both en + es.
export const voiceLocaleValues = ['en', 'es'] as const;
export type VoiceLocale = (typeof voiceLocaleValues)[number];
export const voiceLocaleEnum = z.enum(voiceLocaleValues);

// The destructive intents that require a spoken confirmation before the
// service executes them.
export const DESTRUCTIVE_VOICE_INTENTS: readonly VoiceIntent[] = [
  'decline_job',
  'clear_job',
  'mark_breakdown',
] as const;

export function isDestructiveIntent(intent: VoiceIntent): boolean {
  return DESTRUCTIVE_VOICE_INTENTS.includes(intent);
}
