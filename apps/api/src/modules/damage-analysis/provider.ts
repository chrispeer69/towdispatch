/**
 * DamageProvider — the pluggable vision surface (Photo Damage Analysis,
 * Session 42).
 *
 * Mirrors the payments PaymentProvider pattern: a small contract, plain
 * DTOs, selected at runtime by a factory in damage-analysis.module.ts via
 * DAMAGE_ANALYSIS_PROVIDER (stub | anthropic | openai; default stub).
 *
 * `requiresImageBytes` lets the service decide whether to fetch + base64
 * the photos before calling `analyze`: the stub works off the photo key
 * alone and NEVER touches bytes or a network; the live providers need the
 * image bytes inlined.
 *
 * The prompt builder + parser here are shared by the Anthropic and OpenAI
 * providers and are pure/unit-testable (no network).
 */
import {
  type DamageArea,
  type DamagePhase,
  type ProviderFinding,
  type VehicleContext,
  damageAreaValues,
  damageSeverityValues,
  providerFindingSchema,
} from '@ustowdispatch/shared';

/**
 * Raised by a live provider. `transient` (network blip, 429, 5xx) tells the
 * worker the run is worth retrying; a permanent error (bad key, 4xx) is not.
 */
export class DamageProviderError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'DamageProviderError';
  }
}

export interface DamagePhoto {
  key: string;
  /** image/jpeg | image/png | … — used to build the data URL for live APIs. */
  mimeType: string;
  /** base64 (no data: prefix). Populated by the service for live providers. */
  base64?: string;
}

export interface DamageAnalyzeResult {
  findings: ProviderFinding[];
  raw: unknown;
  model: string;
}

export interface DamageProvider {
  readonly id: 'stub' | 'anthropic' | 'openai';
  readonly model: string;
  /** When true, the service must populate DamagePhoto.base64 before analyze. */
  readonly requiresImageBytes: boolean;
  analyze(
    photos: DamagePhoto[],
    phase: DamagePhase,
    vehicle: VehicleContext,
  ): Promise<DamageAnalyzeResult>;
}

/**
 * System/instruction prompt for the live vision providers. Constrains the
 * model to the exact enums and a strict JSON envelope so the response
 * parses deterministically. vehicle hints are non-PII (make/model/year/
 * color) by construction — the caller never passes VIN/plate/owner.
 */
export function buildVisionInstruction(phase: DamagePhase, vehicle: VehicleContext): string {
  const vehicleLine = [
    vehicle.year ? String(vehicle.year) : null,
    vehicle.color,
    vehicle.make,
    vehicle.model,
  ]
    .filter(Boolean)
    .join(' ');
  return [
    'You are a vehicle-damage inspector. Examine the attached photos of a vehicle',
    `taken at the ${phase.replace('_', '-')} stage of a tow.`,
    vehicleLine ? `Vehicle (for context only): ${vehicleLine}.` : '',
    'Identify visible exterior damage. Respond with STRICT JSON only — no prose,',
    'no markdown fences — matching exactly:',
    '{"findings":[{"area":<area>,"severity":<severity>,"confidencePct":<0-100 integer>,',
    '"description":<short string>,"boundingBox":{"photoKey":<string>,"x":<0-1>,"y":<0-1>,',
    '"w":<0-1>,"h":<0-1>}}]}',
    `area MUST be one of: ${damageAreaValues.join(', ')}.`,
    `severity MUST be one of: ${damageSeverityValues.join(', ')}.`,
    'boundingBox is optional; omit it if you cannot localize the damage.',
    'Report one finding per distinct damaged area. If a panel is undamaged, omit it',
    '(do not emit severity "none"). Return {"findings":[]} if you see no damage.',
  ]
    .filter(Boolean)
    .join(' ');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Extract the first balanced JSON object/array from a model's text reply. */
export function extractJsonBlock(text: string): unknown {
  const trimmed = text.trim();
  // Fast path: already pure JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to bracket scan
  }
  const start = trimmed.search(/[[{]/);
  if (start === -1) return null;
  const open = trimmed[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeConfidence(v: unknown): number {
  let n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  if (n > 0 && n <= 1) n *= 100; // model returned a fraction
  n = Math.round(n);
  return Math.max(0, Math.min(100, n));
}

/**
 * Coerce a model's parsed JSON into validated ProviderFindings. Unknown
 * areas/severities or malformed entries are dropped (defensive — a hostile
 * or hallucinated response can never inject an out-of-enum value). Accepts
 * both `confidencePct` and `confidence`, and snake_case `bounding_box`.
 */
export function parseVisionFindings(raw: unknown): ProviderFinding[] {
  const arr = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.findings)
      ? raw.findings
      : [];
  const out: ProviderFinding[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const candidate = {
      area: item.area as DamageArea,
      severity: item.severity,
      confidencePct: normalizeConfidence(item.confidencePct ?? item.confidence),
      description: typeof item.description === 'string' ? item.description : undefined,
      boundingBox: item.boundingBox ?? item.bounding_box ?? undefined,
    };
    const parsed = providerFindingSchema.safeParse(candidate);
    if (parsed.success && parsed.data.severity !== 'none') out.push(parsed.data);
  }
  return out;
}
