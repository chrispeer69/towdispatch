/**
 * Canada Expansion (Session 47) — i18n bundle smoke test.
 *
 * Proves all three locale bundles load, share an identical key structure (so a
 * translated screen never renders a missing-key error), and that fr-CA is
 * actually translated for the customer-facing surfaces we committed to v1.
 */
import { describe, expect, it } from 'vitest';
import enCA from '../../../messages/en-CA.json';
import enUS from '../../../messages/en-US.json';
import frCA from '../../../messages/fr-CA.json';

type Tree = { [k: string]: string | Tree };

function keyPaths(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? [path] : keyPaths(v, path);
  });
}

describe('locale message bundles', () => {
  it('all three bundles load', () => {
    expect(enUS).toBeTruthy();
    expect(enCA).toBeTruthy();
    expect(frCA).toBeTruthy();
  });

  it('share an identical key structure (no missing keys per locale)', () => {
    const base = keyPaths(enUS as Tree).sort();
    expect(keyPaths(enCA as Tree).sort()).toEqual(base);
    expect(keyPaths(frCA as Tree).sort()).toEqual(base);
  });

  it('renders fr-CA translations for customer-facing keys', () => {
    expect(frCA.portal.payNow).toBe('Payer maintenant');
    expect(frCA.invoice.balanceDue).toBe('Solde dû');
    expect(frCA.nav.billing).toBe('Facturation');
    // Translated, not an English passthrough (using keys that aren't cognates;
    // some words like "Total" are legitimately identical across en/fr).
    expect(frCA.portal.payNow).not.toBe(enUS.portal.payNow);
    expect(frCA.common.save).not.toBe(enUS.common.save);
  });
});
