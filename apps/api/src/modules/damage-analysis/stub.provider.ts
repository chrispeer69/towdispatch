/**
 * StubDamageProvider — deterministic, offline vision provider (Photo
 * Damage Analysis, Session 42).
 *
 * The default provider for dev / CI / tests. Findings are derived purely
 * from a hash of (phase + photoKey) so the same inputs always yield the
 * same findings — and DIFFERENT phases yield different findings, so a
 * pre/post comparison over the same photos produces a non-trivial result.
 *
 * It NEVER fetches photo bytes and NEVER calls a third party
 * (requiresImageBytes = false) — the "do not send photos to a third-party
 * API in stub mode" invariant is structural, not a runtime check.
 */
import { Injectable } from '@nestjs/common';
import {
  type DamageArea,
  type DamagePhase,
  type DamageSeverity,
  type ProviderFinding,
  damageAreaValues,
  damageSeverityValues,
} from '@ustowdispatch/shared';
import type { DamageAnalyzeResult, DamagePhoto, DamageProvider } from './provider.js';

/** FNV-1a 32-bit — small, stable, dependency-free. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

@Injectable()
export class StubDamageProvider implements DamageProvider {
  readonly id = 'stub' as const;
  readonly model = 'stub-deterministic-v1';
  readonly requiresImageBytes = false;

  async analyze(
    photos: DamagePhoto[],
    phase: DamagePhase,
    _vehicle: unknown,
  ): Promise<DamageAnalyzeResult> {
    const findings: ProviderFinding[] = [];
    for (const photo of photos) {
      const h = fnv1a(`${phase}:${photo.key}`);
      // ~1 in 4 photos is "clean" (no finding) — keeps results sparse/realistic.
      if (h % 4 === 0) continue;
      const area: DamageArea = damageAreaValues[h % damageAreaValues.length] ?? 'other';
      // severity in minor|moderate|severe (skip 'none' — a finding means damage).
      const sevIdx = 1 + ((h >>> 8) % 3);
      const severity: DamageSeverity = damageSeverityValues[sevIdx] ?? 'minor';
      const confidencePct = 65 + ((h >>> 16) % 35); // 65-99, always actionable
      findings.push({
        area,
        severity,
        confidencePct,
        description: `Stub-detected ${severity} damage on ${area.replace('_', ' ')}`,
        boundingBox: {
          photoKey: photo.key,
          x: ((h >>> 4) % 50) / 100,
          y: ((h >>> 12) % 50) / 100,
          w: 0.25,
          h: 0.25,
        },
      });
    }
    return {
      findings,
      raw: { provider: 'stub', phase, photoCount: photos.length, findingCount: findings.length },
      model: this.model,
    };
  }
}
