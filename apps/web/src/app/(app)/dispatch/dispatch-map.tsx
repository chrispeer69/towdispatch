'use client';

/**
 * Dispatch map pane — Mapbox GL JS with graceful degradation.
 *
 * If NEXT_PUBLIC_MAPBOX_TOKEN is missing or still set to the placeholder
 * value, we render a styled "Mapbox token not configured" panel instead of
 * crashing the dispatch board.
 *
 * When a token IS present, we initialize a single Map instance, then
 * imperatively reconcile driver- and job-marker DOM elements on each
 * roster/jobs prop update. We avoid pulling in react-map-gl to keep the
 * bundle slim — the dispatch board already runs hot, so a 200KB delta is
 * money.
 */
import type { DriverRosterRow, JobDto } from '@ustowdispatch/shared';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface Props {
  token: string | null;
  roster: DriverRosterRow[];
  jobs: JobDto[];
}

const DEFAULT_CENTER = { lng: -82.998, lat: 39.961 }; // Columbus, OH
const DEFAULT_ZOOM = 11;

function isUsableToken(token: string | null): boolean {
  if (!token) return false;
  if (token === 'pk.placeholder') return false;
  if (token.startsWith('pk.placeholder')) return false;
  return token.length > 20;
}

export function DispatchMap({ token, roster, jobs }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);
  const driverMarkersRef = useRef<Map<string, unknown>>(new Map());
  const jobMarkersRef = useRef<Map<string, unknown>>(new Map());

  useEffect(() => {
    if (!isUsableToken(token)) return;
    if (!containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const mod = await import('mapbox-gl');
        const mapboxgl = (mod.default ?? mod) as unknown as typeof import('mapbox-gl');
        if (cancelled || !containerRef.current) return;

        // Token is checked before the dynamic import so we don't pay the
        // network cost in the missing-token case.
        // biome-ignore lint/suspicious/noExplicitAny: mapbox-gl types are imported above
        (mapboxgl as any).accessToken = token;
        // biome-ignore lint/suspicious/noExplicitAny: same as above
        const map = new (mapboxgl as any).Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: DEFAULT_ZOOM,
          attributionControl: true,
        });
        mapRef.current = map;

        cleanup = () => {
          driverMarkersRef.current.forEach((m) => {
            // biome-ignore lint/suspicious/noExplicitAny: mapbox marker
            (m as any).remove();
          });
          jobMarkersRef.current.forEach((m) => {
            // biome-ignore lint/suspicious/noExplicitAny: mapbox marker
            (m as any).remove();
          });
          driverMarkersRef.current.clear();
          jobMarkersRef.current.clear();
          // biome-ignore lint/suspicious/noExplicitAny: mapbox cleanup
          (map as any).remove();
          mapRef.current = null;
        };
      } catch {
        // Mapbox failed to init — fall back to placeholder. We don't surface
        // a toast because the rest of the board still works.
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [token]);

  // Reconcile markers on roster/jobs change.
  useEffect(() => {
    if (!isUsableToken(token)) return;
    const map = mapRef.current;
    if (!map) return;

    (async () => {
      try {
        const mod = await import('mapbox-gl');
        const mapboxgl = (mod.default ?? mod) as unknown as typeof import('mapbox-gl');
        // biome-ignore lint/suspicious/noExplicitAny: mapbox marker constructor
        const Marker = (mapboxgl as any).Marker;

        const seenDrivers = new Set<string>();
        for (const row of roster) {
          if (!row.shift?.lastLat || !row.shift.lastLng) continue;
          const id = row.driver.id;
          seenDrivers.add(id);
          const existing = driverMarkersRef.current.get(id);
          if (existing) {
            // biome-ignore lint/suspicious/noExplicitAny: marker.setLngLat
            (existing as any).setLngLat([row.shift.lastLng, row.shift.lastLat]);
          } else {
            const el = document.createElement('div');
            el.dataset.testid = `map-driver-${id}`;
            el.className =
              'flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-300 bg-emerald-500 text-[10px] font-bold uppercase text-white shadow';
            el.textContent = `${row.driver.firstName[0] ?? ''}${row.driver.lastName[0] ?? ''}`;
            // biome-ignore lint/suspicious/noExplicitAny: marker constructor
            const marker = new Marker({ element: el })
              .setLngLat([row.shift.lastLng, row.shift.lastLat])
              // biome-ignore lint/suspicious/noExplicitAny: marker addTo
              .addTo(map as any);
            driverMarkersRef.current.set(id, marker);
          }
        }
        // Drop drivers not in the seen set.
        for (const [id, m] of driverMarkersRef.current.entries()) {
          if (!seenDrivers.has(id)) {
            // biome-ignore lint/suspicious/noExplicitAny: marker remove
            (m as any).remove();
            driverMarkersRef.current.delete(id);
          }
        }

        const seenJobs = new Set<string>();
        for (const job of jobs) {
          if (job.pickupLat == null || job.pickupLng == null) continue;
          const id = job.id;
          seenJobs.add(id);
          const existing = jobMarkersRef.current.get(id);
          if (existing) {
            // biome-ignore lint/suspicious/noExplicitAny: marker.setLngLat
            (existing as any).setLngLat([job.pickupLng, job.pickupLat]);
          } else {
            const el = document.createElement('div');
            el.dataset.testid = `map-job-${id}`;
            el.className =
              'flex h-7 w-7 items-center justify-center rounded-full border-2 border-orange-300 bg-orange-500 text-[10px] font-bold uppercase text-white shadow';
            el.textContent = job.serviceType.slice(0, 1).toUpperCase();
            // biome-ignore lint/suspicious/noExplicitAny: marker constructor
            const marker = new Marker({ element: el })
              .setLngLat([job.pickupLng, job.pickupLat])
              // biome-ignore lint/suspicious/noExplicitAny: marker addTo
              .addTo(map as any);
            jobMarkersRef.current.set(id, marker);
          }
        }
        for (const [id, m] of jobMarkersRef.current.entries()) {
          if (!seenJobs.has(id)) {
            // biome-ignore lint/suspicious/noExplicitAny: marker remove
            (m as any).remove();
            jobMarkersRef.current.delete(id);
          }
        }
      } catch {
        /* ignore reconciliation errors */
      }
    })();
  }, [token, roster, jobs]);

  if (!isUsableToken(token)) {
    return (
      <div
        data-testid="dispatch-map-placeholder"
        className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-steel-border bg-steel/40 p-6 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-warn" />
        <p className="font-condensed text-sm font-bold uppercase tracking-wide text-text-primary">
          Mapbox token not configured
        </p>
        <p className="max-w-md text-xs text-text-secondary">
          Set <code className="rounded bg-steel px-1 py-0.5">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{' '}
          <code className="rounded bg-steel px-1 py-0.5">apps/web/.env.local</code> and restart the
          web dev server. The rest of the dispatch board works without it.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="dispatch-map-container"
      className="h-[420px] w-full overflow-hidden rounded-md border border-steel-border"
    />
  );
}
