import { jobSchema } from '@ustowdispatch/shared';
/**
 * Contract tests for the widened JobDto.customer and JobDto.vehicle
 * snapshots used by the driver-side job detail page.
 *
 * The driver in-truck app reads phone / email / VIN / plate / color /
 * drivetrain directly off these embedded objects; if a future schema
 * change drops any of them or makes them required, the driver page
 * will silently break. Locking the contract here keeps that drift
 * detectable.
 */
import { describe, expect, it } from 'vitest';

const BASE_JOB = {
  id: '00000000-0000-7000-8000-000000000001',
  tenantId: '00000000-0000-7000-8000-000000000002',
  jobNumber: 'JOB-0001',
  status: 'enroute',
  serviceType: 'tow',
  customerId: '00000000-0000-7000-8000-000000000003',
  vehicleId: '00000000-0000-7000-8000-000000000004',
  accountId: null,
  pickupAddress: '123 Main St',
  pickupLat: null,
  pickupLng: null,
  dropoffAddress: '456 Shop Rd',
  dropoffLat: null,
  dropoffLng: null,
  authorizedBy: 'customer',
  authorizedByName: 'Jane Doe',
  rateQuotedCents: 12500,
  rateBreakdown: null,
  notes: null,
  cancelledReason: null,
  assignedDriverId: '00000000-0000-7000-8000-000000000005',
  assignedTruckId: null,
  assignedShiftId: null,
  assignedAt: '2026-05-19T10:00:00.000Z',
  createdByUserId: null,
  createdAt: '2026-05-19T09:00:00.000Z',
  updatedAt: '2026-05-19T10:00:00.000Z',
  deletedAt: null,
};

describe('JobDto.customer contract', () => {
  it('accepts the minimum shape (id + name only)', () => {
    const parsed = jobSchema.parse({
      ...BASE_JOB,
      customer: { id: '00000000-0000-7000-8000-00000000aaaa', name: 'Jane' },
    });
    expect(parsed.customer?.name).toBe('Jane');
  });

  it('accepts the full driver-detail shape (phone + email)', () => {
    const parsed = jobSchema.parse({
      ...BASE_JOB,
      customer: {
        id: '00000000-0000-7000-8000-00000000aaaa',
        name: 'Jane Doe',
        phone: '+16145551212',
        email: 'jane@example.com',
      },
    });
    expect(parsed.customer?.phone).toBe('+16145551212');
    expect(parsed.customer?.email).toBe('jane@example.com');
  });

  it('treats null customer as a valid absence', () => {
    const parsed = jobSchema.parse({ ...BASE_JOB, customer: null });
    expect(parsed.customer).toBeNull();
  });

  it('treats null phone and email as valid', () => {
    const parsed = jobSchema.parse({
      ...BASE_JOB,
      customer: {
        id: '00000000-0000-7000-8000-00000000aaaa',
        name: 'Jane',
        phone: null,
        email: null,
      },
    });
    expect(parsed.customer?.phone).toBeNull();
    expect(parsed.customer?.email).toBeNull();
  });
});

describe('JobDto.vehicle contract', () => {
  it('accepts the minimum shape (id + nullable YMM)', () => {
    const parsed = jobSchema.parse({
      ...BASE_JOB,
      vehicle: {
        id: '00000000-0000-7000-8000-00000000bbbb',
        year: null,
        make: null,
        model: null,
      },
    });
    expect(parsed.vehicle?.id).toBe('00000000-0000-7000-8000-00000000bbbb');
  });

  it('accepts the full driver-detail shape (VIN + plate + color + drivetrain)', () => {
    const parsed = jobSchema.parse({
      ...BASE_JOB,
      vehicle: {
        id: '00000000-0000-7000-8000-00000000bbbb',
        year: 2022,
        make: 'Honda',
        model: 'Accord',
        color: 'Silver',
        vin: '1HGCV1F30NA000000',
        plate: 'ABC1234',
        plateState: 'OH',
        drivetrain: 'AWD',
      },
    });
    expect(parsed.vehicle?.vin).toBe('1HGCV1F30NA000000');
    expect(parsed.vehicle?.plate).toBe('ABC1234');
    expect(parsed.vehicle?.plateState).toBe('OH');
    expect(parsed.vehicle?.color).toBe('Silver');
    expect(parsed.vehicle?.drivetrain).toBe('AWD');
  });

  it('treats null VIN / plate / color as valid', () => {
    const parsed = jobSchema.parse({
      ...BASE_JOB,
      vehicle: {
        id: '00000000-0000-7000-8000-00000000bbbb',
        year: 2022,
        make: 'Honda',
        model: 'Accord',
        color: null,
        vin: null,
        plate: null,
        plateState: null,
        drivetrain: null,
      },
    });
    expect(parsed.vehicle?.color).toBeNull();
    expect(parsed.vehicle?.vin).toBeNull();
    expect(parsed.vehicle?.plate).toBeNull();
  });

  it('treats null vehicle as a valid absence', () => {
    const parsed = jobSchema.parse({ ...BASE_JOB, vehicle: null });
    expect(parsed.vehicle).toBeNull();
  });
});
