import { describe, expect, it } from 'vitest';
import { buildVisionInstruction, extractJsonBlock, parseVisionFindings } from './provider.js';

describe('extractJsonBlock', () => {
  it('parses pure JSON', () => {
    expect(extractJsonBlock('{"findings":[]}')).toEqual({ findings: [] });
  });

  it('extracts JSON wrapped in prose / code fences', () => {
    const text = 'Here is the result:\n```json\n{"findings":[{"area":"hood"}]}\n```\nThanks!';
    expect(extractJsonBlock(text)).toEqual({ findings: [{ area: 'hood' }] });
  });

  it('returns null when no JSON is present', () => {
    expect(extractJsonBlock('no json here')).toBeNull();
  });
});

describe('parseVisionFindings', () => {
  it('validates and keeps well-formed findings', () => {
    const out = parseVisionFindings({
      findings: [
        { area: 'front_bumper', severity: 'moderate', confidencePct: 88, description: 'dent' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.area).toBe('front_bumper');
  });

  it('drops out-of-enum areas/severities (no injection)', () => {
    const out = parseVisionFindings({
      findings: [
        { area: 'engine_block', severity: 'moderate', confidencePct: 90 }, // bad area
        { area: 'hood', severity: 'catastrophic', confidencePct: 90 }, // bad severity
        { area: 'hood', severity: 'minor', confidencePct: 90 }, // good
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('minor');
  });

  it('drops severity "none" findings (a finding means damage)', () => {
    const out = parseVisionFindings({
      findings: [{ area: 'roof', severity: 'none', confidencePct: 99 }],
    });
    expect(out).toHaveLength(0);
  });

  it('normalizes a fractional confidence (0..1) to a percent', () => {
    const out = parseVisionFindings({
      findings: [{ area: 'hood', severity: 'minor', confidence: 0.82 }],
    });
    expect(out[0]?.confidencePct).toBe(82);
  });

  it('accepts snake_case bounding_box', () => {
    const out = parseVisionFindings({
      findings: [
        {
          area: 'hood',
          severity: 'minor',
          confidencePct: 90,
          bounding_box: { photoKey: 'k', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        },
      ],
    });
    expect(out[0]?.boundingBox?.photoKey).toBe('k');
  });

  it('returns [] for non-array / malformed input', () => {
    expect(parseVisionFindings(null)).toEqual([]);
    expect(parseVisionFindings('garbage')).toEqual([]);
    expect(parseVisionFindings({ nope: true })).toEqual([]);
  });
});

describe('buildVisionInstruction', () => {
  it('includes the phase and the allowed enums, and non-PII vehicle hints only', () => {
    const text = buildVisionInstruction('pre_tow', {
      make: 'Toyota',
      model: 'Camry',
      year: 2019,
      color: 'silver',
    });
    expect(text).toMatch(/pre-tow/);
    expect(text).toMatch(/front_bumper/);
    expect(text).toMatch(/2019 silver Toyota Camry/);
    expect(text).toMatch(/STRICT JSON/);
  });
});
