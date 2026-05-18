/**
 * localStorage keys owned by the driver web app. Centralized so a future
 * "sign out everywhere" sweep can find them, and so tests can clear all
 * driver state in one call.
 */
export const DRIVER_JWT_KEY = 'driver_jwt';
export const DRIVER_PROFILE_KEY = 'driver_profile';
export const DRIVER_TENANT_SLUG_KEY = 'driver_tenant_slug';
export const DRIVER_OFFLINE_QUEUE_KEY = 'driver_offline_queue';
export const DRIVER_BRIEFING_LOCAL_ACK_KEY = 'driver_briefing_local_ack';

/**
 * Every driver-owned localStorage key. Use to bulk-clear on logout / for
 * test setup.
 */
export const DRIVER_STORAGE_KEYS = [
  DRIVER_JWT_KEY,
  DRIVER_PROFILE_KEY,
  DRIVER_TENANT_SLUG_KEY,
  DRIVER_OFFLINE_QUEUE_KEY,
  DRIVER_BRIEFING_LOCAL_ACK_KEY,
] as const;
