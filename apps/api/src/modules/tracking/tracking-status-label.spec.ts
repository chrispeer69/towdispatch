import { trackingStatusLabel } from '@towdispatch/shared';
/**
 * Status label translation contract — the customer page never sees raw enums.
 */
import { describe, expect, it } from 'vitest';

describe('trackingStatusLabel', () => {
  it('translates english labels for every job status', () => {
    expect(trackingStatusLabel('new', 'en')).toBe('Request received');
    expect(trackingStatusLabel('dispatched', 'en')).toBe('Driver assigned');
    expect(trackingStatusLabel('enroute', 'en')).toBe('On the way');
    expect(trackingStatusLabel('on_scene', 'en')).toBe('On scene');
    expect(trackingStatusLabel('in_progress', 'en')).toBe('Loaded, in transit');
    expect(trackingStatusLabel('completed', 'en')).toBe('Delivered');
    expect(trackingStatusLabel('cancelled', 'en')).toBe('Cancelled');
    expect(trackingStatusLabel('goa', 'en')).toBe('Driver arrived — service not needed');
  });

  it('translates spanish labels', () => {
    expect(trackingStatusLabel('dispatched', 'es')).toBe('Conductor asignado');
    expect(trackingStatusLabel('enroute', 'es')).toBe('En camino');
    expect(trackingStatusLabel('completed', 'es')).toBe('Entregado');
  });

  it('defaults to english when language omitted', () => {
    expect(trackingStatusLabel('dispatched')).toBe('Driver assigned');
  });
});
