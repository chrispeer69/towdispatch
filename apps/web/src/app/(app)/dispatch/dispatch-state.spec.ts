import type { JobDto } from '@towdispatch/shared';
import { describe, expect, it } from 'vitest';
import { dispatchReducer, initialState } from './dispatch-state';

const baseJob = (overrides: Partial<JobDto> = {}): JobDto => ({
  id: 'job-1',
  tenantId: '00000000-0000-0000-0000-000000000001',
  jobNumber: '20260509-0001',
  status: 'new',
  serviceType: 'tow',
  customerId: null,
  vehicleId: null,
  accountId: null,
  pickupAddress: '100 Main St',
  pickupLat: null,
  pickupLng: null,
  dropoffAddress: null,
  dropoffLat: null,
  dropoffLng: null,
  authorizedBy: 'customer',
  authorizedByName: null,
  rateQuotedCents: 9500,
  rateBreakdown: null,
  notes: null,
  cancelledReason: null,
  assignedDriverId: null,
  assignedTruckId: null,
  assignedShiftId: null,
  assignedAt: null,
  createdByUserId: null,
  createdAt: '2026-05-09T10:00:00.000Z',
  updatedAt: '2026-05-09T10:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

describe('dispatchReducer', () => {
  it('snapshot replaces the queue/active/roster atomically', () => {
    const job = baseJob();
    const state = dispatchReducer(initialState, {
      type: 'snapshot',
      payload: { queue: [job], active: [], recentlyCompleted: [], roster: [] },
    });
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.id).toBe('job-1');
  });

  it('optimistic-assign moves a queued job to active and stores rollback snapshot', () => {
    const job = baseJob();
    const after = dispatchReducer(
      dispatchReducer(initialState, {
        type: 'snapshot',
        payload: { queue: [job], active: [], recentlyCompleted: [], roster: [] },
      }),
      {
        type: 'optimistic-assign',
        jobId: 'job-1',
        driverId: 'driver-1',
        truckId: 'truck-1',
        shiftId: 'shift-1',
      },
    );
    expect(after.queue).toHaveLength(0);
    expect(after.active).toHaveLength(1);
    expect(after.active[0]?.assignedDriverId).toBe('driver-1');
    expect(after.pending['job-1']).toBeDefined();
    expect(after.pending['job-1']?.status).toBe('new');
  });

  it('rollback restores the original job and surfaces an error toast', () => {
    const job = baseJob();
    let s = dispatchReducer(initialState, {
      type: 'snapshot',
      payload: { queue: [job], active: [], recentlyCompleted: [], roster: [] },
    });
    s = dispatchReducer(s, {
      type: 'optimistic-assign',
      jobId: 'job-1',
      driverId: 'd',
      truckId: null,
      shiftId: null,
    });
    s = dispatchReducer(s, { type: 'rollback', jobId: 'job-1', reason: 'driver off shift' });
    expect(s.queue).toHaveLength(1);
    expect(s.active).toHaveLength(0);
    expect(s.pending['job-1']).toBeUndefined();
    expect(s.toast?.message).toBe('driver off shift');
    expect(s.toast?.level).toBe('error');
  });

  it('commit clears the pending entry and re-classifies based on the server status', () => {
    const job = baseJob();
    let s = dispatchReducer(initialState, {
      type: 'snapshot',
      payload: { queue: [job], active: [], recentlyCompleted: [], roster: [] },
    });
    s = dispatchReducer(s, {
      type: 'optimistic-assign',
      jobId: 'job-1',
      driverId: 'd',
      truckId: null,
      shiftId: null,
    });
    s = dispatchReducer(s, {
      type: 'commit',
      jobId: 'job-1',
      job: baseJob({ status: 'dispatched', assignedDriverId: 'd' }),
    });
    expect(s.queue).toHaveLength(0);
    expect(s.active).toHaveLength(1);
    expect(s.pending['job-1']).toBeUndefined();
  });

  it('job-created adds a new queue card', () => {
    const after = dispatchReducer(initialState, {
      type: 'job-created',
      job: baseJob({ id: 'new-1' }),
    });
    expect(after.queue).toHaveLength(1);
    expect(after.queue[0]?.id).toBe('new-1');
  });

  it('terminal status moves a job to recentlyCompleted', () => {
    let s = dispatchReducer(initialState, {
      type: 'snapshot',
      payload: {
        queue: [],
        active: [baseJob({ status: 'in_progress' })],
        recentlyCompleted: [],
        roster: [],
      },
    });
    s = dispatchReducer(s, { type: 'job-status-changed', jobId: 'job-1', toStatus: 'completed' });
    expect(s.active).toHaveLength(0);
    expect(s.recentlyCompleted).toHaveLength(1);
    expect(s.recentlyCompleted[0]?.status).toBe('completed');
  });
});
