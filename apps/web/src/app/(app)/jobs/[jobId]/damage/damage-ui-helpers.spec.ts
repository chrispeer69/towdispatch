import type { DamageFindingDto } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import {
  AREA_LABEL,
  PHASE_LABEL,
  SEVERITY_LABEL,
  effectiveSeverity,
  photoLabel,
} from './damage-ui-helpers';

describe('damage-ui-helpers', () => {
  it('provides EN and ES labels for every phase / severity / area', () => {
    expect(PHASE_LABEL.en.pre_tow).toBe('Pre-tow');
    expect(PHASE_LABEL.es.pre_tow).toBe('Antes del remolque');
    expect(SEVERITY_LABEL.es.severe).toBe('Grave');
    expect(AREA_LABEL.es.front_bumper).toBe('Parachoques delantero');
    expect(AREA_LABEL.en.windshield).toBe('Windshield');
  });

  it('effectiveSeverity prefers the operator override', () => {
    const base = { severity: 'severe', operatorSeverity: null } as Pick<
      DamageFindingDto,
      'severity' | 'operatorSeverity'
    >;
    expect(effectiveSeverity(base)).toBe('severe');
    expect(effectiveSeverity({ severity: 'severe', operatorSeverity: 'minor' })).toBe('minor');
  });

  it('photoLabel returns the last path segment, truncating long names', () => {
    expect(photoLabel('tenants/x/job/evidence/front.jpg')).toBe('front.jpg');
    expect(photoLabel('a/b/c/this-is-a-really-long-evidence-filename.jpg')).toMatch(/^…/);
  });
});
