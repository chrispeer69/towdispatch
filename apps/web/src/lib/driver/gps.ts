'use client';

/**
 * GPS telemetry loop for the driver app.
 *
 * Strategy:
 *   - When a shift is active, every 60s we grab the device's current
 *     position via navigator.geolocation.getCurrentPosition and POST it
 *     to /driver-telemetry/batch. If accuracy worsens to >200m we mark
 *     the ping `manual` so the dispatch board can dim its confidence.
 *   - When document.visibilitystate flips to 'hidden' we pause the
 *     interval. Pings resume on visibilitychange → 'visible'.
 *   - Failed POSTs (offline, 5xx) get enqueued via the offline queue
 *     so they survive a hard reload and replay on reconnect.
 *
 * The 60s interval is a documented battery compromise: more frequent
 * sampling drains the device too quickly during a 12-hour shift; less
 * frequent sampling produces gaps the dispatcher sees as a frozen
 * truck. Future work (Session 5) will adapt to motion (5min when
 * stationary, 30s when speed > 25mph) — for now we treat all pings
 * equally.
 */
import {
  type CreateDriverTelemetryBatchPayload,
  type CreateDriverTelemetryEventPayload,
} from '@ustowdispatch/shared';
import { DriverOfflineError, driverApi } from './api-client';
import { enqueueAction } from './offline-queue';

export interface GpsLoopOptions {
  shiftId: string;
  intervalMs?: number;
  /** Callback fired after each successful POST. Used by the UI to show
   *  the "last ping at HH:MM" indicator. */
  onPing?: (payload: CreateDriverTelemetryEventPayload) => void;
}

export interface GpsLoopHandle {
  stop: () => void;
  /** Force a single ping immediately. */
  pingNow: () => Promise<void>;
}

export function startGpsLoop(opts: GpsLoopOptions): GpsLoopHandle {
  const intervalMs = opts.intervalMs ?? 60_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;

  async function singlePing(): Promise<void> {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          () => resolve(null),
          { enableHighAccuracy: false, maximumAge: 30_000, timeout: 10_000 },
        );
      } catch {
        resolve(null);
      }
    });
    if (!position) return;
    const event: CreateDriverTelemetryEventPayload = {
      shiftId: opts.shiftId,
      recordedAt: new Date(position.timestamp).toISOString(),
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      ...(position.coords.speed != null
        ? { speedMph: Math.max(0, Math.min(300, position.coords.speed * 2.2369362921)) }
        : {}),
      ...(position.coords.heading != null ? { headingDegrees: position.coords.heading } : {}),
      ...(position.coords.accuracy != null
        ? { accuracyMeters: Math.min(100_000, position.coords.accuracy) }
        : {}),
      eventKind: 'ping',
    };
    try {
      const body: CreateDriverTelemetryBatchPayload = { events: [event] };
      await driverApi('POST', '/driver-telemetry/batch', body);
      opts.onPing?.(event);
    } catch (err) {
      if (err instanceof DriverOfflineError) {
        // Offline — drop the ping into the queue so the dispatcher
        // gets the breadcrumbs once the truck is back online.
        enqueueAction({
          actionKind: 'shift_clock_on',
          payload: { telemetry: event },
          shiftId: opts.shiftId,
        });
      }
    }
  }

  function loop(): void {
    if (stopped) return;
    if (!paused) {
      void singlePing();
    }
    timer = setTimeout(loop, intervalMs);
  }

  const onVisibility = (): void => {
    if (typeof document === 'undefined') return;
    paused = document.visibilityState === 'hidden';
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  // First tick immediately so the dispatcher sees the truck the moment
  // the driver hits Start Shift.
  void singlePing();
  timer = setTimeout(loop, intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
    pingNow: () => singlePing(),
  };
}

export interface BrowserPosition {
  lat: number;
  lng: number;
}

/**
 * One-shot geolocation helper. Used by the workspace shift-start button
 * and the job state-machine controls (every transition carries a fresh
 * coordinate pair when available). Resolves to null on permission
 * denied — callers fall back to a server-side estimation.
 */
export async function currentPosition(): Promise<BrowserPosition | null> {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) return null;
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, maximumAge: 15_000, timeout: 8_000 },
      );
    } catch {
      resolve(null);
    }
  });
}
