/**
 * Pure voice-intent parser — Voice-Controlled Driver Workflows (Session 45).
 *
 * `parseIntent(transcript, context)` is a deterministic, dependency-free
 * keyword/pattern matcher. NO LLM in v1 (latency + cost + offline-at-the-
 * truck reasons — see SESSION_45_DECISIONS.md); the `LlmIntentProvider`
 * interface at the bottom is the seam a future session plugs a model into.
 *
 * It returns the best-matching driver intent and its confidence. When the
 * best confidence falls below `context.confidenceThreshold`, the intent is
 * downgraded to `'clarify'` and a `suggestedRephrase` hint is attached
 * (the raw best guess is preserved in `rawIntent` for logging).
 *
 * English-only keywords in v1 (the SPOKEN RESPONSES are bilingual; the
 * recognized commands are not — documented in SESSION_45_DECISIONS.md).
 *
 * This file is intentionally framework-free so it can be unit-tested in
 * isolation and reused by the native apps' offline parser later.
 */
import type { RecognizedIntent, VoiceIntent } from '@ustowdispatch/shared';

export interface VoiceParseContext {
  /** Below this confidence the result is downgraded to 'clarify'. */
  confidenceThreshold: number;
}

export interface VoiceIntentEntities {
  /** Minutes parsed from an ETA phrase ("twenty minutes", "15 min"). */
  minutes?: number;
  /** Free-text reason ("decline because too far" → "too far"). */
  reason?: string;
  /** Yes/No confirmation token, when the utterance is a bare confirmation. */
  confirmation?: boolean;
}

export interface VoiceParseResult {
  /** Gated intent: the matched intent, or 'clarify' when sub-threshold. */
  intent: RecognizedIntent;
  /** The best-matched intent before threshold gating (null if nothing matched). */
  rawIntent: VoiceIntent | null;
  /** Best match confidence, 0.0–1.0. */
  confidence: number;
  entities: VoiceIntentEntities;
  /** Set only when intent === 'clarify': a hint the app can speak. */
  suggestedRephrase?: string;
}

// Confidence tiers. Default threshold is 0.75 (VOICE_DRIVER_CONFIDENCE_MIN):
// STRONG + MEDIUM clear it, WEAK does not (→ clarify) unless ops lowers it.
const STRONG = 0.92;
const MEDIUM = 0.78;
const WEAK = 0.55;

interface IntentRule {
  intent: VoiceIntent;
  confidence: number;
  patterns: RegExp[];
}

/**
 * Ordered most-specific → least-specific. The drop-phase rules are listed
 * BEFORE the pickup-phase rules that share words ("arrived", "en route") so
 * "arrived at the drop" resolves to arrive_drop, not arrive_on_scene.
 */
const RULES: IntentRule[] = [
  // --- drop-phase (must precede the pickup-phase "arrived"/"en route") ---
  {
    intent: 'en_route_drop',
    confidence: STRONG,
    patterns: [
      /\b(en ?route|head(ing|ed)?|on my way|driving|rolling|towing)\b.*\b(drop|destination|delivery|yard|impound|shop)\b/,
      /\bto the drop ?off\b/,
    ],
  },
  {
    intent: 'arrive_drop',
    confidence: STRONG,
    patterns: [
      /\b(arrived|reached|here|at)\b.*\b(drop|destination|delivery|yard|impound|shop)\b/,
      /\bat (the )?drop ?off\b/,
    ],
  },
  // --- pickup-phase status transitions ---
  {
    intent: 'en_route',
    confidence: STRONG,
    patterns: [
      /\ben ?route\b/,
      /\bon my way\b/,
      /\b(head(ing|ed)?|driving|rolling|leaving|departing|moving|going) (out|over|now|to|toward|towards|there)\b/,
      /\bon the road\b/,
    ],
  },
  {
    intent: 'arrive_on_scene',
    confidence: STRONG,
    patterns: [
      /\bon[ -]?scene\b/,
      /\b(arrived|i'?m here|im here|here now|at the scene|at the location|at the vehicle|reached the (scene|location|vehicle))\b/,
    ],
  },
  {
    intent: 'vehicle_loaded',
    confidence: STRONG,
    patterns: [
      /\b(loaded|hooked( up)?|winched on|on the (bed|hook|truck)|secured|strapped (down|in))\b/,
      /\b(vehicle|car|it) (is )?(loaded|secured|hooked|on the (bed|hook|truck))\b/,
    ],
  },
  {
    intent: 'clear_job',
    confidence: STRONG,
    patterns: [
      /\b(clear|cleared|clearing)( the)?( job| call)?\b/,
      /\b(complete[d]?|completing|finish(ed|ing)?|all done|wrap(ped)? up|job (is )?done|done with (the )?(job|call))\b/,
    ],
  },
  // --- non-transition driver actions ---
  {
    intent: 'decline_job',
    confidence: STRONG,
    patterns: [
      /\b(decline|reject|refuse|pass on (the|this) (job|call)|not taking|can'?t take|cannot take|can not take)\b/,
    ],
  },
  {
    intent: 'accept_job',
    confidence: STRONG,
    patterns: [
      /\b(accept|i'?ll take (it|this|the (job|call))|i will take|take (the|this) (job|call)|copy that|roger that)\b/,
    ],
  },
  {
    intent: 'mark_breakdown',
    confidence: STRONG,
    patterns: [
      /\b(broke ?down|break ?down|broken down)\b/,
      /\b(my )?(truck|wrecker|rig|engine) (is )?(down|broken|dead|stalled|overheating)\b/,
      /\b(mechanical (issue|problem|failure)|won'?t start|wont start|flat tire|blew a tire|out of (gas|fuel))\b/,
    ],
  },
  {
    intent: 'request_help',
    confidence: STRONG,
    patterns: [
      /\b(need|send|requesting|request) (a |an |some )?(hand|help|backup|back ?up|assistance|second truck|another truck)\b/,
      /\b(help me|dispatch help|call for backup)\b/,
    ],
  },
  {
    intent: 'repeat_address',
    confidence: STRONG,
    patterns: [
      /\b(repeat|say|read|what'?s|whats|what is|give me)( the)? address( again)?\b/,
      /\baddress again\b/,
      /\bwhere (am i going|to|is (it|the (job|call)))\b/,
    ],
  },
  {
    intent: 'eta_update',
    confidence: MEDIUM,
    patterns: [
      /\be\.?t\.?a\.?\b/,
      /\bestimated (time|arrival)\b/,
      /\b(be|i'?ll be|ill be|arriving|there) .*\b(minute|minutes|min|mins|hour|hours)\b/,
      /\b\d+ (minute|minutes|min|mins) (out|away)\b/,
    ],
  },
  // --- WEAK fallbacks: indicative-but-ambiguous single words. Below the
  //     default threshold so they surface as 'clarify' unless ops tunes it. ---
  { intent: 'request_help', confidence: WEAK, patterns: [/\b(help|backup)\b/] },
  { intent: 'clear_job', confidence: WEAK, patterns: [/\b(done|finished)\b/] },
  { intent: 'eta_update', confidence: WEAK, patterns: [/\b(minute|minutes|min|mins)\b/] },
];

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const YES_RE =
  /\b(yes|yeah|yep|yup|ya|affirmative|affirm|confirm|confirmed|correct|do it|go ahead|sure|please do|that'?s right)\b/;
const NO_RE = /\b(no|nope|nah|negative|cancel|stop|don'?t|do not|never ?mind|forget it|abort)\b/;

function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9'\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse minutes from "ETA twenty minutes" / "15 min" / "in 5 minutes". */
export function extractMinutes(text: string): number | undefined {
  const norm = normalize(text);

  // Digit form: "20 minutes", "be there in 5".
  const digit = norm.match(/\b(\d{1,3})\b\s*(?:minute|minutes|min|mins)?\b/);
  // Word form: "twenty five minutes", "twenty minutes".
  const wordMatch = norm.match(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](one|two|three|four|five|six|seven|eight|nine))?\b|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/,
  );

  // Prefer an explicit digit adjacent to a minutes word, else any number word.
  const hasMinutesWord = /\b(minute|minutes|min|mins)\b/.test(norm);
  if (digit && (hasMinutesWord || /\bin\b/.test(norm) || /\beta\b/.test(norm))) {
    const n = Number.parseInt(digit[1] as string, 10);
    if (n >= 0 && n <= 600) return n;
  }
  if (wordMatch) {
    if (wordMatch[1]) {
      const tens = NUMBER_WORDS[wordMatch[1]] ?? 0;
      const ones = wordMatch[2] ? (NUMBER_WORDS[wordMatch[2]] ?? 0) : 0;
      return tens + ones;
    }
    if (wordMatch[3]) return NUMBER_WORDS[wordMatch[3]];
  }
  // Bare digit with no units but an ETA-ish context.
  if (digit && (/\beta\b/.test(norm) || /\bin\b/.test(norm))) {
    const n = Number.parseInt(digit[1] as string, 10);
    if (n >= 0 && n <= 600) return n;
  }
  return undefined;
}

/** Pull a free-text reason from "... because/due to/reason <reason>". */
export function extractReason(text: string): string | undefined {
  const m = text.match(/\b(?:because|due to|reason(?:\s+is)?|since|cause)\b[:\s]+(.+)$/i);
  if (!m) return undefined;
  const reason = m[1]?.trim().replace(/[.\s]+$/, '');
  return reason && reason.length > 0 ? reason : undefined;
}

/** Detect a bare yes/no confirmation; undefined if the utterance is neither. */
export function extractConfirmation(text: string): boolean | undefined {
  const norm = normalize(text);
  const yes = YES_RE.test(norm);
  const no = NO_RE.test(norm);
  // "no" beats "yes" if both somehow appear — safer to NOT execute.
  if (no) return false;
  if (yes) return true;
  return undefined;
}

function extractEntities(
  intent: VoiceIntent | null,
  norm: string,
  raw: string,
): VoiceIntentEntities {
  const entities: VoiceIntentEntities = {};
  if (intent === 'eta_update') {
    const minutes = extractMinutes(raw);
    if (minutes !== undefined) entities.minutes = minutes;
  }
  if (intent === 'decline_job' || intent === 'mark_breakdown') {
    const reason = extractReason(raw);
    if (reason !== undefined) entities.reason = reason;
  }
  const confirmation = extractConfirmation(norm);
  if (confirmation !== undefined) entities.confirmation = confirmation;
  return entities;
}

/**
 * Parse a transcript into a driver intent. Pure + deterministic.
 */
export function parseIntent(transcript: string, context: VoiceParseContext): VoiceParseResult {
  const norm = normalize(transcript);
  const threshold = context.confidenceThreshold;

  let best: { intent: VoiceIntent; confidence: number } | null = null;
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(norm))) {
      if (!best || rule.confidence > best.confidence) {
        best = { intent: rule.intent, confidence: rule.confidence };
      }
    }
  }

  const entities = extractEntities(best?.intent ?? null, norm, transcript);

  if (!best) {
    return {
      intent: 'clarify',
      rawIntent: null,
      confidence: 0,
      entities,
      suggestedRephrase:
        "Sorry, I didn't catch that. Try: en route, on scene, loaded, clear job, or repeat address.",
    };
  }

  if (best.confidence < threshold) {
    return {
      intent: 'clarify',
      rawIntent: best.intent,
      confidence: best.confidence,
      entities,
      suggestedRephrase: "I'm not sure I understood. Could you say that again?",
    };
  }

  return {
    intent: best.intent,
    rawIntent: best.intent,
    confidence: best.confidence,
    entities,
  };
}

/**
 * Future-extension seam: a pluggable async intent provider (e.g. an LLM
 * classifier) the service could call when the keyword parser returns
 * 'clarify'. Unused in v1 — kept so the contract is committed and a later
 * session can wire a model without touching the service signature.
 */
export interface LlmIntentProvider {
  classify(transcript: string, context: VoiceParseContext): Promise<VoiceParseResult>;
}

/** No-op v1 provider: defers entirely to the pure keyword parser. */
export class KeywordOnlyIntentProvider implements LlmIntentProvider {
  classify(transcript: string, context: VoiceParseContext): Promise<VoiceParseResult> {
    return Promise.resolve(parseIntent(transcript, context));
  }
}
