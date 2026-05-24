/**
 * Voice-Controlled Driver Workflows (Session 45) — the request/response
 * contract the native apps (CarPlay / Android Auto) and the web demo speak.
 *
 * The native app captures a transcript via on-device speech recognition,
 * POSTs it to /voice-driver/command, then speaks `responseText` back via
 * TTS. `followUpQuestion`, when present, is the prompt the app should speak
 * and then listen for the next utterance (used for the destructive-intent
 * confirmation gate and for sub-threshold clarification).
 */
import { z } from 'zod';
import { recognizedIntentEnum, voiceLocaleEnum, voicePlatformEnum } from './intents';

export const voiceCommandRequestSchema = z
  .object({
    // Raw transcript from the on-device speech recognizer.
    transcript: z.string().min(1).max(2000),
    // Which surface produced the command.
    platform: voicePlatformEnum.default('other'),
    // Optional explicit job target. When omitted the service resolves the
    // driver's single active job (see SESSION_45_DECISIONS.md).
    jobId: z.string().uuid().optional(),
    // Language for the spoken response.
    locale: voiceLocaleEnum.default('en'),
  })
  .strict();
export type VoiceCommandRequest = z.infer<typeof voiceCommandRequestSchema>;

export const voiceCommandResponseSchema = z.object({
  // What the parser recognized (one of the 12 intents, or 'clarify').
  recognizedIntent: recognizedIntentEnum,
  // Parser confidence 0.0–1.0.
  confidence: z.number().min(0).max(1),
  // Whether a state-changing action actually executed this turn. A
  // confirmation prompt or a clarify both leave this false.
  actionExecuted: z.boolean(),
  // The string the native app SPEAKS back via TTS. Always populated.
  responseText: z.string(),
  // When set, the app should speak this and listen for the next utterance
  // (confirmation prompt, or "could you repeat that?").
  followUpQuestion: z.string().nullable(),
  // True when this turn queued a destructive action awaiting a spoken "yes".
  confirmationRequired: z.boolean(),
  // The job the command resolved to (null when none could be resolved).
  jobId: z.string().uuid().nullable(),
  // The job's status after the action (null when no transition happened).
  jobStatus: z.string().nullable(),
});
export type VoiceCommandResponse = z.infer<typeof voiceCommandResponseSchema>;
