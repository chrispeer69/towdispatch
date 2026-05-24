import { describe, expect, it } from 'vitest';
import { StubDamageProvider } from './stub.provider.js';

const photos = (keys: string[]) => keys.map((key) => ({ key, mimeType: 'image/jpeg' }));

describe('StubDamageProvider', () => {
  const provider = new StubDamageProvider();

  it('never requires image bytes (no third-party calls in stub mode)', () => {
    expect(provider.requiresImageBytes).toBe(false);
  });

  it('is deterministic — same inputs yield identical findings', async () => {
    const a = await provider.analyze(photos(['k/1.jpg', 'k/2.jpg', 'k/3.jpg']), 'pre_tow', {});
    const b = await provider.analyze(photos(['k/1.jpg', 'k/2.jpg', 'k/3.jpg']), 'pre_tow', {});
    expect(a.findings).toEqual(b.findings);
  });

  it('produces different findings for a different phase over the same photos', async () => {
    const pre = await provider.analyze(photos(['k/1.jpg', 'k/2.jpg', 'k/3.jpg']), 'pre_tow', {});
    const post = await provider.analyze(photos(['k/1.jpg', 'k/2.jpg', 'k/3.jpg']), 'post_tow', {});
    expect(post.findings).not.toEqual(pre.findings);
  });

  it('emits only actionable findings (no severity "none", confidence ≥ 65)', async () => {
    const r = await provider.analyze(
      photos(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
      'pre_tow',
      {},
    );
    for (const f of r.findings) {
      expect(f.severity).not.toBe('none');
      expect(f.confidencePct).toBeGreaterThanOrEqual(65);
      expect(f.confidencePct).toBeLessThanOrEqual(100);
      expect(f.boundingBox?.photoKey).toBeDefined();
    }
  });

  it('handles an empty photo set', async () => {
    const r = await provider.analyze([], 'pre_tow', {});
    expect(r.findings).toEqual([]);
  });
});
