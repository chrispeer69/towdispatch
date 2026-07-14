/**
 * CADS core vocabulary — duty classes, status bands, defaults.
 *
 * load_ratio = weighted_active_jobs / eligible_signed_in_drivers, computed
 * per duty class (light|medium|heavy) and blended ('all'). Bands map the
 * ratio to a partner-facing availability signal; OFFLINE is the
 * zero-eligible-drivers state (never a divide-by-zero).
 */
import { z } from 'zod';

export const CAPACITY_DUTY_CLASSES = ['light', 'medium', 'heavy'] as const;
export type CapacityDutyClass = (typeof CAPACITY_DUTY_CLASSES)[number];

/** Snapshot/override scope: a concrete class or the blended/global 'all'. */
export const CAPACITY_CLASS_SCOPES = ['light', 'medium', 'heavy', 'all'] as const;
export type CapacityClassScope = (typeof CAPACITY_CLASS_SCOPES)[number];

export const CAPACITY_BANDS = [
  'available_now',
  'limited',
  'constrained',
  'at_capacity',
  'offline',
] as const;
export type CapacityBand = (typeof CAPACITY_BANDS)[number];

export const capacityDutyClassSchema = z.enum(CAPACITY_DUTY_CLASSES);
export const capacityClassScopeSchema = z.enum(CAPACITY_CLASS_SCOPES);
export const capacityBandSchema = z.enum(CAPACITY_BANDS);

/**
 * Partner network codes — mirrors accounts.motor_club_network_code values
 * seeded in 0023 plus 'generic' for any other webhook consumer. Extend by
 * adding a code here; the CapacitySignalAdapter registry resolves formats
 * by this code.
 */
export const CAPACITY_NETWORK_CODES = [
  'agero',
  'nsd',
  'geico',
  'aaa',
  'urgently',
  'generic',
] as const;
export type CapacityNetworkCode = (typeof CAPACITY_NETWORK_CODES)[number];
export const capacityNetworkCodeSchema = z.enum(CAPACITY_NETWORK_CODES);

export const CAPACITY_DELIVERY_MODES = ['webhook', 'pull_only'] as const;
export type CapacityDeliveryMode = (typeof CAPACITY_DELIVERY_MODES)[number];
export const capacityDeliveryModeSchema = z.enum(CAPACITY_DELIVERY_MODES);

export const CAPACITY_BROADCAST_STATUSES = [
  'pending',
  'delivered',
  'failed',
  'dead_letter',
] as const;
export type CapacityBroadcastStatus = (typeof CAPACITY_BROADCAST_STATUSES)[number];
export const capacityBroadcastStatusSchema = z.enum(CAPACITY_BROADCAST_STATUSES);

/** Outbound payload contract version. Bump on breaking payload changes. */
export const CAPACITY_SCHEMA_VERSION = '1.0' as const;

/** Default band thresholds (upper bound of each band, inclusive). */
export const CAPACITY_DEFAULTS = {
  availableMaxRatio: 0.75,
  limitedMaxRatio: 1.5,
  constrainedMaxRatio: 2.0,
  hysteresisBuffer: 0.05,
  hysteresisDwellSeconds: 60,
  minBroadcastIntervalSeconds: 60,
  guidelineMinutes: 60,
  overrideDefaultExpiryMinutes: 240,
  /** Hard ceiling on override lifetime. */
  overrideMaxExpiryMinutes: 1440,
  /** Steady-state snapshot cadence when no band transition occurs. */
  steadyStateSnapshotSeconds: 300,
  jobWeights: {
    dispatched: 1.0,
    enroute: 1.0,
    on_scene: 1.0,
    in_progress: 1.0,
  } as Readonly<Record<string, number>>,
} as const;
