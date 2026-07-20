'use client';

import {
  BAND_LABEL,
  BandPill,
  CLASS_LABEL,
  SetOverrideDialog,
  formatRatio,
  timeAgo,
  timeUntil,
} from '@/components/capacity/capacity-shared';
import { clientClearCapacityOverride, clientGetCapacityStatus } from '@/lib/api/capacity-client';
/**
 * Capacity Signal widget (CADS, Session 58) — compact dispatch-board panel
 * showing the live per-class load signal partners see: blended status
 * first/largest, then light / medium / heavy gauges (ratio + band pill +
 * "N drivers - X jobs"), an override banner with clear action when a
 * manual override is live, and the last-broadcast stamp.
 *
 * Initial data is server-fetched by the page; live updates arrive on the
 * `capacity.status_changed` socket event carrying a full CapacityStatusDto.
 * The widget opens its own Socket.IO connection via the same
 * /api/socket/token handshake the board uses, so the existing
 * useDispatchBoard hook (shared with /assign-jobs) stays untouched.
 *
 * TODO(i18n): CADS strings are English-only today, matching the settings
 * and dispatch surfaces; add es parity when those migrate to next-intl.
 */
import {
  type CapacityDutyClass,
  type CapacityStatusDto,
  DISPATCH_EVENTS,
} from '@ustowdispatch/shared';
import { RadioTower } from 'lucide-react';
import { type JSX, useEffect, useState } from 'react';
import { type Socket, io as ioClient } from 'socket.io-client';
import { toast } from 'sonner';

const CLASS_ORDER: readonly CapacityDutyClass[] = ['light', 'medium', 'heavy'];

export function CapacitySignalPanel({
  initialStatus,
  className,
}: {
  initialStatus: CapacityStatusDto | null;
  className?: string;
}): JSX.Element {
  const [status, setStatus] = useState<CapacityStatusDto | null>(initialStatus);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);
  // Ticker so "Xm left" / "Xm ago" stamps stay honest between events.
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;

    async function connect(): Promise<void> {
      try {
        const tokenRes = await fetch('/api/socket/token', { cache: 'no-store' });
        if (!tokenRes.ok) return;
        const { accessToken, apiUrl } = (await tokenRes.json()) as {
          accessToken: string;
          apiUrl: string;
        };
        if (cancelled) return;
        socket = ioClient(apiUrl, {
          path: '/socket.io',
          auth: { token: accessToken },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 500,
          reconnectionDelayMax: 5_000,
        });
        socket.on(DISPATCH_EVENTS.CAPACITY_STATUS_CHANGED, (payload: CapacityStatusDto) => {
          setStatus(payload);
        });
      } catch {
        /* best effort */
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (initialStatus !== null) return;
    let alive = true;
    clientGetCapacityStatus()
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => {
        /* panel degrades to the unavailable state */
      });
    return () => {
      alive = false;
    };
  }, [initialStatus]);

  async function refresh(): Promise<void> {
    try {
      setStatus(await clientGetCapacityStatus());
    } catch {
      /* socket will catch us up */
    }
  }

  async function clearOverride(id: string): Promise<void> {
    setClearingId(id);
    try {
      await clientClearCapacityOverride(id);
      toast.success('Override cleared — computed signal resumed.');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setClearingId(null);
    }
  }

  return (
    <section
      data-testid="capacity-signal"
      className={`rounded-[14px] border border-divider bg-bg-surface/40 p-3 ${className ?? ''}`}
    >
      <header className="flex items-center justify-between gap-2 pb-2">
        <h2 className="flex items-center gap-2 font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          <RadioTower className="h-4 w-4 text-brand-primary" aria-hidden />
          Capacity Signal
        </h2>
        <div className="flex items-center gap-3">
          {status ? (
            <span className="text-[11px] text-text-secondary-on-dark">
              Last broadcast: {status.lastBroadcastAt ? timeAgo(status.lastBroadcastAt) : 'never'}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setOverrideOpen(true)}
            className="rounded-md border border-divider px-2 py-1 text-xs font-semibold text-text-secondary-on-dark transition-colors hover:border-divider-strong hover:text-text-primary-on-dark"
            data-testid="capacity-set-override"
          >
            Set override
          </button>
        </div>
      </header>

      {status === null ? (
        <p className="py-3 text-xs text-text-secondary-on-dark">Capacity signal unavailable.</p>
      ) : (
        <>
          {status.activeOverrides.length > 0 ? (
            <div
              data-testid="capacity-override-banner"
              className="mb-2 space-y-1 rounded-[10px] border border-warn/40 bg-warn/10 px-3 py-2"
            >
              {status.activeOverrides.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2 text-xs text-warn">
                  <span className="font-semibold uppercase tracking-wide">
                    Override — {CLASS_LABEL[o.dutyClass]} → {BAND_LABEL[o.forcedBand]}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-text-secondary-on-dark"
                    title={o.reason}
                  >
                    “{o.reason}”
                  </span>
                  <span className="font-mono">{timeUntil(o.expiresAt)}</span>
                  <button
                    type="button"
                    onClick={() => clearOverride(o.id)}
                    disabled={clearingId === o.id}
                    className="rounded-md border border-warn/40 px-2 py-0.5 font-semibold text-warn transition-colors hover:bg-warn/15 disabled:opacity-40"
                  >
                    {clearingId === o.id ? 'Clearing…' : 'Clear'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <BlendedGauge status={status} />
            {CLASS_ORDER.map((cls) => {
              const row = status.classes.find((c) => c.dutyClass === cls);
              return row ? <ClassGauge key={cls} row={row} /> : null;
            })}
          </div>
        </>
      )}

      {overrideOpen ? (
        <SetOverrideDialog
          onClose={() => setOverrideOpen(false)}
          onCreated={() => void refresh()}
        />
      ) : null}
    </section>
  );
}

function BlendedGauge({ status }: { status: CapacityStatusDto }): JSX.Element {
  const b = status.blended;
  return (
    <div
      data-testid="capacity-blended"
      className="rounded-md border border-divider-strong bg-bg-base/80 p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-condensed text-xs font-extrabold uppercase tracking-widest text-text-primary-on-dark">
          Blended
        </span>
        <BandPill band={b.band} size="lg" />
      </div>
      <p className="mt-1 font-mono text-xl font-bold text-text-primary-on-dark">
        {formatRatio(b.ratio)}
      </p>
      <p className="text-[11px] text-text-secondary-on-dark">
        {b.eligibleDrivers} {b.eligibleDrivers === 1 ? 'driver' : 'drivers'} -{' '}
        {b.weightedActiveJobs.toFixed(1)} jobs
        {b.overrideActive ? <span className="ml-1 text-warn">(override)</span> : null}
      </p>
    </div>
  );
}

function ClassGauge({ row }: { row: CapacityStatusDto['classes'][number] }): JSX.Element {
  return (
    <div
      data-testid={`capacity-class-${row.dutyClass}`}
      className="rounded-md border border-divider bg-bg-base/60 p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-condensed text-[11px] font-extrabold uppercase tracking-widest text-text-secondary-on-dark">
          {CLASS_LABEL[row.dutyClass]}
        </span>
        <BandPill band={row.band} />
      </div>
      <p className="mt-1 font-mono text-base font-bold text-text-primary-on-dark">
        {formatRatio(row.ratio)}
      </p>
      <p className="text-[11px] text-text-secondary-on-dark">
        {row.eligibleDrivers} {row.eligibleDrivers === 1 ? 'driver' : 'drivers'} -{' '}
        {row.weightedActiveJobs.toFixed(1)} jobs
        {row.overrideActive ? (
          <span className="ml-1 text-warn" title={`Computed: ${BAND_LABEL[row.computedBand]}`}>
            (override)
          </span>
        ) : null}
      </p>
    </div>
  );
}
