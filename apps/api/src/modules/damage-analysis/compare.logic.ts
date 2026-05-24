/**
 * Pure pre-vs-post damage comparison (Photo Damage Analysis, Session 42).
 *
 * No I/O, no DB, no Nest — fully unit-testable. The service maps persisted
 * findings into `ComparableFinding`s and calls `compareFindings`.
 *
 * Classification (fraud-claim defense favours flagging NEW damage):
 *   - newDamage    — confident post-tow damage in an area with no
 *                    confident pre-tow damage, OR a confident severity
 *                    escalation vs pre-tow.
 *   - preExisting  — confident post-tow damage already present pre-tow at
 *                    equal-or-greater severity.
 *   - inconclusive — a damage finding below the confidence threshold, or a
 *                    pre-tow finding not re-detected post-tow (lost
 *                    finding) — can't be confirmed either way.
 *
 * Severity 'none' means "inspected, clean" and is never itself a finding.
 * Dismissed findings (operator-rejected false positives) are ignored.
 *
 * Confidence representation: findings carry `confidencePct` (0-100 int);
 * the threshold is a fraction (0..1, default 0.65). The ONLY place the two
 * representations meet is `isConfident` below — `confidencePct / 100 >=
 * threshold`.
 */
import {
  DEFAULT_DAMAGE_CONFIDENCE_THRESHOLD,
  type DamageArea,
  type DamageSeverity,
  damageSeverityRank,
} from '@ustowdispatch/shared';
import type { BoundingBox, CompareFindingEntry, CompareResult } from '@ustowdispatch/shared';

export interface ComparableFinding {
  area: DamageArea;
  severity: DamageSeverity;
  operatorSeverity?: DamageSeverity | null;
  confidencePct: number;
  isDismissed?: boolean | null;
  description?: string | null;
  boundingBox?: BoundingBox | null;
}

/** Effective severity: an operator override wins over the model's call. */
function effectiveSeverity(f: ComparableFinding): DamageSeverity {
  return f.operatorSeverity ?? f.severity;
}

/** The single boundary where confidencePct (0-100) meets threshold (0..1). */
function isConfident(f: ComparableFinding, threshold: number): boolean {
  return f.confidencePct / 100 >= threshold;
}

function isActiveDamage(f: ComparableFinding): boolean {
  return !f.isDismissed && effectiveSeverity(f) !== 'none';
}

function toEntry(
  f: ComparableFinding,
  priorSeverity: DamageSeverity | null,
  reason: string,
): CompareFindingEntry {
  return {
    area: f.area,
    severity: effectiveSeverity(f),
    confidencePct: f.confidencePct,
    priorSeverity,
    description: f.description ?? null,
    boundingBox: f.boundingBox ?? null,
    reason,
  };
}

export interface CompareOptions {
  /** Confidence threshold as a fraction 0..1. Default 0.65. */
  threshold?: number;
}

/**
 * Compare pre-tow and post-tow findings. Deterministic and order-stable.
 */
export function compareFindings(
  pre: ComparableFinding[],
  post: ComparableFinding[],
  options: CompareOptions = {},
): CompareResult {
  const threshold = options.threshold ?? DEFAULT_DAMAGE_CONFIDENCE_THRESHOLD;

  // Pre-tow baseline: per area, the worst CONFIDENT pre-tow damage.
  const preBaseline = new Map<DamageArea, DamageSeverity>();
  for (const f of pre) {
    if (!isActiveDamage(f) || !isConfident(f, threshold)) continue;
    const sev = effectiveSeverity(f);
    const current = preBaseline.get(f.area);
    if (current === undefined || damageSeverityRank[sev] > damageSeverityRank[current]) {
      preBaseline.set(f.area, sev);
    }
  }

  const newDamage: CompareFindingEntry[] = [];
  const preExisting: CompareFindingEntry[] = [];
  const inconclusive: CompareFindingEntry[] = [];
  const postCoveredAreas = new Set<DamageArea>();

  for (const f of post) {
    if (!isActiveDamage(f)) continue; // clean / dismissed — not a finding
    const sev = effectiveSeverity(f);
    const prior = preBaseline.get(f.area) ?? null;

    if (!isConfident(f, threshold)) {
      inconclusive.push(
        toEntry(f, prior, `post-tow ${f.area} below confidence threshold (${f.confidencePct}%)`),
      );
      continue;
    }

    postCoveredAreas.add(f.area);

    if (prior === null) {
      newDamage.push(toEntry(f, prior, `no pre-tow damage recorded in ${f.area}`));
    } else if (damageSeverityRank[sev] > damageSeverityRank[prior]) {
      newDamage.push(toEntry(f, prior, `severity increased ${prior} → ${sev} in ${f.area}`));
    } else {
      preExisting.push(toEntry(f, prior, `present pre-tow in ${f.area} at ${prior}`));
    }
  }

  // Lost findings: confident pre-tow damage with no confident post-tow
  // damage in that area — can't confirm it on the post vehicle, and it is
  // certainly not NEW. Inconclusive.
  for (const f of pre) {
    if (!isActiveDamage(f) || !isConfident(f, threshold)) continue;
    if (postCoveredAreas.has(f.area)) continue;
    // Only emit one lost-finding entry per area (use the baseline severity).
    const baselineSev = preBaseline.get(f.area);
    if (baselineSev === undefined || effectiveSeverity(f) !== baselineSev) continue;
    inconclusive.push(toEntry(f, baselineSev, `pre-tow ${f.area} damage not re-detected post-tow`));
  }

  return { newDamage, preExisting, inconclusive };
}

/** One-line human summary for the comparison row. */
export function summarizeComparison(result: CompareResult, threshold: number): string {
  const pct = Math.round(threshold * 100);
  return (
    `${result.newDamage.length} new, ${result.preExisting.length} pre-existing, ` +
    `${result.inconclusive.length} inconclusive (confidence ≥ ${pct}%)`
  );
}
