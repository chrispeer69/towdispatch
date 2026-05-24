import { describe, expect, it } from 'vitest';
import { HOLD_LABEL, STATUS_LABEL, formatCents, vehicleLabel } from './impound-ui-helpers';

describe('formatCents', () => {
  it('renders cents as USD', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(3500)).toBe('$35.00');
    expect(formatCents(123_456)).toBe('$1,234.56');
  });
});

describe('vehicleLabel', () => {
  it('joins the present descriptors', () => {
    expect(
      vehicleLabel({
        vehicleYear: 2019,
        vehicleColor: 'Blue',
        vehicleMake: 'Honda',
        vehicleModel: 'Civic',
        licensePlate: 'ABC123',
      }),
    ).toBe('2019 Blue Honda Civic');
  });

  it('falls back to the plate when no descriptors are present', () => {
    expect(
      vehicleLabel({
        vehicleYear: null,
        vehicleColor: null,
        vehicleMake: null,
        vehicleModel: null,
        licensePlate: 'XYZ789',
      }),
    ).toBe('Plate XYZ789');
  });

  it('falls back to a generic label with nothing to show', () => {
    expect(
      vehicleLabel({
        vehicleYear: null,
        vehicleColor: null,
        vehicleMake: null,
        vehicleModel: null,
        licensePlate: null,
      }),
    ).toBe('Unidentified vehicle');
  });
});

describe('label maps', () => {
  it('covers every record status', () => {
    expect(STATUS_LABEL.stored).toBe('Stored');
    expect(STATUS_LABEL.pending_release).toBe('Pending release');
    expect(STATUS_LABEL.disposed).toBe('Disposed');
  });

  it('covers every hold type', () => {
    expect(HOLD_LABEL.police).toBe('Police hold');
    expect(HOLD_LABEL.owner_request).toBe('Owner request');
  });
});
