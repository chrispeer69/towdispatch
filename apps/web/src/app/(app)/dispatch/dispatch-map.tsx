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
import { type JSX, useEffect, useRef, useState } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';

interface Props {
  token: string | null;
  roster: DriverRosterRow[];
  jobs: JobDto[];
}

const DEFAULT_CENTER = { lng: -112.074, lat: 33.4484 }; // Phoenix, AZ
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
  const [mapLoaded, setMapLoaded] = useState(false);

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
        setMapLoaded(true);

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
            const statusStr = row.currentJobNumber ? `Working on #${row.currentJobNumber}` : 'Idle';
            const dateStr = row.shift?.lastPositionAt ? new Date(row.shift.lastPositionAt).toLocaleTimeString() : 'Unknown';
            const popupEl = (existing as any).getPopup()?.getElement();
            if (popupEl) {
              const statusEl = popupEl.querySelector('.driver-status');
              if (statusEl) statusEl.textContent = statusStr;
              const dateEl = popupEl.querySelector('.driver-updated');
              if (dateEl) dateEl.textContent = `Last updated: ${dateStr}`;
            }
          } else {
            const el = document.createElement('div');
            el.dataset.testid = `map-driver-${id}`;
            el.className =
              'flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-300 bg-emerald-500 text-[10px] font-bold uppercase text-white shadow cursor-pointer';
            el.textContent = `${row.driver.firstName[0] ?? ''}${row.driver.lastName[0] ?? ''}`;

            const popupContent = document.createElement('div');
            const statusStr = row.currentJobNumber ? `Working on #${row.currentJobNumber}` : 'Idle';
            const dateStr = row.shift?.lastPositionAt ? new Date(row.shift.lastPositionAt).toLocaleTimeString() : 'Unknown';
            popupContent.innerHTML = `
              <div class="p-2 min-w-[120px]">
                <p class="font-bold text-sm text-gray-900">${row.driver.firstName} ${row.driver.lastName}</p>
                <p class="text-xs text-gray-700 font-medium mt-0.5 driver-status">${statusStr}</p>
                <p class="text-[10px] text-gray-500 mt-1 driver-updated">Last updated: ${dateStr}</p>
              </div>
            `;
            // biome-ignore lint/suspicious/noExplicitAny: Popup constructor
            const popup = new (mapboxgl as any).Popup({ offset: 15, closeButton: false, closeOnClick: false }).setDOMContent(popupContent);

            // biome-ignore lint/suspicious/noExplicitAny: marker constructor
            const marker = new Marker({ element: el })
              .setLngLat([row.shift.lastLng, row.shift.lastLat])
              .setPopup(popup)
              // biome-ignore lint/suspicious/noExplicitAny: marker addTo
              .addTo(map as any);

            el.addEventListener('mouseenter', () => popup.addTo(map as any));
            el.addEventListener('mouseleave', () => popup.remove());

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
          const pickupId = `pickup-${job.id}`;
          seenJobs.add(pickupId);
          const existing = jobMarkersRef.current.get(pickupId);
          if (existing) {
            // biome-ignore lint/suspicious/noExplicitAny: marker.setLngLat
            (existing as any).setLngLat([job.pickupLng, job.pickupLat]);
          } else {
            const el = document.createElement('div');
            el.dataset.testid = `map-job-${job.id}`;
            el.className =
              'flex h-7 w-7 items-center justify-center rounded-full border-2 border-brand-primary bg-brand-primary text-[10px] font-bold uppercase text-white shadow cursor-pointer';
            
            if (job.serviceType === 'tow') {
              el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
            } else {
              el.textContent = job.serviceType.slice(0, 1).toUpperCase();
            }

            const popupContent = document.createElement('div');
            const vehicleDesc = job.vehicle ? `${job.vehicle.year || ''} ${job.vehicle.make || ''} ${job.vehicle.model || ''}`.trim() : 'No vehicle info';
            popupContent.innerHTML = `
              <div class="p-2 min-w-[140px]">
                <p class="font-bold text-sm text-gray-900">${job.customer?.name ?? 'Unknown Customer'}</p>
                <p class="text-xs text-gray-700 font-medium mt-0.5 uppercase tracking-wide">${job.serviceType.replace('_', ' ')}</p>
                <p class="text-[10px] text-gray-500 mt-1 max-w-[180px] truncate">${vehicleDesc || 'No vehicle info'}</p>
              </div>
            `;
            // biome-ignore lint/suspicious/noExplicitAny: Popup constructor
            const popup = new (mapboxgl as any).Popup({ offset: 15, closeButton: false, closeOnClick: false }).setDOMContent(popupContent);

            // biome-ignore lint/suspicious/noExplicitAny: marker constructor
            const marker = new Marker({ element: el })
              .setLngLat([job.pickupLng, job.pickupLat])
              .setPopup(popup)
              // biome-ignore lint/suspicious/noExplicitAny: marker addTo
              .addTo(map as any);
            
            el.addEventListener('mouseenter', () => popup.addTo(map as any));
            el.addEventListener('mouseleave', () => popup.remove());
            
            jobMarkersRef.current.set(pickupId, marker);
          }

          // Dropoff marker
          if (job.dropoffLat != null && job.dropoffLng != null) {
            const dropoffId = `dropoff-${job.id}`;
            seenJobs.add(dropoffId);
            const existingDrop = jobMarkersRef.current.get(dropoffId);
            if (existingDrop) {
              // biome-ignore lint/suspicious/noExplicitAny: marker.setLngLat
              (existingDrop as any).setLngLat([job.dropoffLng, job.dropoffLat]);
            } else {
              const el = document.createElement('div');
              el.className = 'flex h-6 w-6 items-center justify-center rounded-[6px] border-2 border-gray-600 bg-white text-[12px] shadow';
              el.innerHTML = '🏁';
              // biome-ignore lint/suspicious/noExplicitAny: marker constructor
              const marker = new Marker({ element: el })
                .setLngLat([job.dropoffLng, job.dropoffLat])
                .addTo(map as any);
              jobMarkersRef.current.set(dropoffId, marker);
            }
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
  }, [token, roster, jobs, mapLoaded]);

  if (!isUsableToken(token)) {
    return (
      <div
        data-testid="dispatch-map-placeholder"
        className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-divider bg-bg-base/40 p-6 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-warn" />
        <p className="font-condensed text-sm font-bold uppercase tracking-wide text-text-primary-on-dark">
          Mapbox token not configured
        </p>
        <p className="max-w-md text-xs text-text-secondary-on-dark">
          Set <code className="rounded bg-bg-base px-1 py-0.5">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{' '}
          <code className="rounded bg-bg-base px-1 py-0.5">apps/web/.env.local</code> and restart
          the web dev server. The rest of the dispatch board works without it.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="dispatch-map-container"
      className="h-[420px] w-full overflow-hidden rounded-md border border-divider"
    />
  );
}
