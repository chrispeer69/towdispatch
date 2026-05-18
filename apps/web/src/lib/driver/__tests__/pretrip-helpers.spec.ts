import { describe, expect, it } from 'vitest';
import {
  type PretripFormCategory,
  type PretripFormItem,
  PretripValidationError,
  buildPretripPayload,
  newDefaultForm,
  rollupStatus,
} from '../pretrip-helpers';

function completeAllPass(): ReturnType<typeof newDefaultForm> {
  return newDefaultForm().map((c) => ({
    ...c,
    items: c.items.map((i) => ({ ...i, state: 'ok' as const })),
  }));
}

function findItem(
  form: PretripFormCategory[],
  categoryKey: string,
  itemKey: string,
): PretripFormItem {
  const category = form.find((c) => c.key === categoryKey);
  if (!category) throw new Error(`category ${categoryKey} missing from form fixture`);
  const item = category.items.find((i) => i.key === itemKey);
  if (!item) throw new Error(`item ${itemKey} missing from category ${categoryKey}`);
  return item;
}

describe('rollupStatus', () => {
  it('returns pass when every item is ok', () => {
    expect(rollupStatus(completeAllPass())).toBe('pass');
  });

  it('returns fail_unsafe when brakes fail (operator policy)', () => {
    const form = completeAllPass();
    findItem(form, 'tires_brakes', 'brakes_parking').state = 'fail';
    expect(rollupStatus(form)).toBe('fail_unsafe');
  });

  it('returns fail_safe when a non-safety item fails (e.g., wipers)', () => {
    const form = completeAllPass();
    findItem(form, 'safety', 'wipers').state = 'fail';
    expect(rollupStatus(form)).toBe('fail_safe');
  });

  it('treats N/A (attention) without fails as a pass', () => {
    const form = completeAllPass();
    findItem(form, 'safety', 'wipers').state = 'attention';
    expect(rollupStatus(form)).toBe('pass');
  });
});

describe('buildPretripPayload', () => {
  it('throws when an item is unreviewed', () => {
    const form = newDefaultForm();
    expect(() => buildPretripPayload({ form, truckId: 'truck-1' })).toThrow(PretripValidationError);
  });

  it('requires a note when an item is marked fail', () => {
    const form = completeAllPass();
    const headlights = findItem(form, 'exterior', 'lights_head');
    headlights.state = 'fail';
    headlights.photoKeys = ['k1'];
    expect(() => buildPretripPayload({ form, truckId: 'truck-1' })).toThrow(PretripValidationError);
  });

  it('requires a photo when an item is marked fail', () => {
    const form = completeAllPass();
    const headlights = findItem(form, 'exterior', 'lights_head');
    headlights.state = 'fail';
    headlights.note = 'Left headlight out';
    expect(() => buildPretripPayload({ form, truckId: 'truck-1' })).toThrow(PretripValidationError);
  });

  it('emits a valid API payload for an all-pass form', () => {
    const form = completeAllPass();
    const payload = buildPretripPayload({
      form,
      truckId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      odometerMiles: 152_034,
      notes: 'No issues',
    });
    expect(payload.truckId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(payload.status).toBe('pass');
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.odometerMiles).toBe(152_034);
    expect(payload.notes).toBe('No issues');
    expect(typeof payload.submittedAt).toBe('string');
    for (const item of payload.items) {
      expect(item.state).toBe('ok');
    }
  });

  it('serializes a fail item with note and photoKeys preserved', () => {
    const form = completeAllPass();
    const wipers = findItem(form, 'safety', 'wipers');
    wipers.state = 'fail';
    wipers.note = 'Driver-side wiper not sweeping';
    wipers.photoKeys = ['s3-key-1'];
    const payload = buildPretripPayload({ form, truckId: 'truck-1' });
    expect(payload.status).toBe('fail_safe');
    const wiperEntry = payload.items.find((i) => i.key === 'wipers');
    expect(wiperEntry).toBeDefined();
    expect(wiperEntry?.note).toBe('Driver-side wiper not sweeping');
    expect(wiperEntry?.photoKeys).toEqual(['s3-key-1']);
  });
});
