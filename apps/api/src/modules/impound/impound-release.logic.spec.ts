import { describe, expect, it } from 'vitest';
import { buildImpoundFormStub, evaluateReleaseGate } from './impound-release.logic.js';

describe('evaluateReleaseGate', () => {
  const ok = {
    recordStatus: 'stored' as const,
    activeHoldCount: 0,
    idVerified: true,
    ownershipDocVerified: true,
  };

  it('passes when storage + holds + documents are all clear', () => {
    const r = evaluateReleaseGate(ok);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('blocks on active holds and reports the count', () => {
    const r = evaluateReleaseGate({ ...ok, activeHoldCount: 2 });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('2 active hold'))).toBe(true);
  });

  it('blocks when ID is not verified', () => {
    const r = evaluateReleaseGate({ ...ok, idVerified: false });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => /ID/.test(x))).toBe(true);
  });

  it('blocks when ownership is not verified', () => {
    const r = evaluateReleaseGate({ ...ok, ownershipDocVerified: false });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => /ownership/i.test(x))).toBe(true);
  });

  it('reports every failing reason at once', () => {
    const r = evaluateReleaseGate({
      recordStatus: 'stored',
      activeHoldCount: 1,
      idVerified: false,
      ownershipDocVerified: false,
    });
    expect(r.reasons).toHaveLength(3);
  });

  it('rejects an already-released record', () => {
    const r = evaluateReleaseGate({ ...ok, recordStatus: 'released' });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => /already released/i.test(x))).toBe(true);
  });

  it.each(['transferred', 'disposed'] as const)('rejects a %s record', (recordStatus) => {
    const r = evaluateReleaseGate({ ...ok, recordStatus });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes(recordStatus))).toBe(true);
  });
});

describe('buildImpoundFormStub', () => {
  const now = new Date('2026-05-23T10:00:00.000Z');
  const ctx = {
    recordId: '00000000-0000-0000-0000-000000000001',
    yardName: 'North Lot',
    vehicleDescription: '2019 Blue Honda Civic',
    licensePlate: 'ABC123',
    vehicleVin: '1HGCV1F30JA000000',
    arrivedAt: '2026-05-01T00:00:00.000Z',
    daysStored: 22,
    feeTotalCents: 77000,
    lienEligible: false,
  };

  it('returns a stub payload with the stable fields contract', () => {
    const stub = buildImpoundFormStub('lien_notice', ctx, now);
    expect(stub.status).toBe('stub');
    expect(stub.kind).toBe('lien_notice');
    expect(stub.recordId).toBe(ctx.recordId);
    expect(stub.generatedAt).toBe(now.toISOString());
    expect(stub.fields.yardName).toBe('North Lot');
    expect(stub.fields.feeTotalCents).toBe(77000);
    expect(stub.fields.licensePlate).toBe('ABC123');
  });

  it.each([
    'lien_notice',
    'release_authorization',
    'abandoned_vehicle_notice',
    'storage_invoice',
  ] as const)('mentions Session 23 in the message for %s', (kind) => {
    const stub = buildImpoundFormStub(kind, ctx, now);
    expect(stub.message).toMatch(/Session 23/);
  });
});
