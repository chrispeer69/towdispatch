'use client';

/**
 * /driver/workspace — the home of the in-truck driver app.
 *
 * Sections (top-down):
 *   1. Top bar (driver name + tenant + sign-out) — from <DriverShell />
 *   2. Briefing banner — unmissable until acknowledged
 *   3. Shift control — Start Shift / End Shift with truck picker dialog
 *   4. Pre-trip prompt — forces /driver/pretrip when missing
 *   5. Active jobs — list from /driver-jobs/me
 *   6. Quick actions — manual GPS ping, offline queue, help
 *   7. Diagnostics expander (long-press the version label to reveal)
 */
import { DriverShell } from '@/components/driver/driver-shell';
import { OfflineBanner } from '@/components/driver/offline-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DriverApiError, driverApi } from '@/lib/driver/api-client';
import { useDriverAuth } from '@/lib/driver/auth';
import { type BriefingNeedsResponse, decideBriefingBanner } from '@/lib/driver/briefing-helpers';
import { type GpsLoopHandle, currentPosition, startGpsLoop } from '@/lib/driver/gps';
import { maybeReplay, readQueue } from '@/lib/driver/offline-queue';
import { DRIVER_BRIEFING_LOCAL_ACK_KEY } from '@/lib/driver/storage-keys';
import { STATUS_LABEL } from '@/lib/driver/transitions';
import type { DriverDailyBriefingDto, DriverShiftDto, JobDto } from '@/lib/driver/types';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  HelpCircle,
  Inbox,
  MapPin,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface TruckSummary {
  id: string;
  unitNumber: string;
  make: string | null;
  model: string | null;
  status: string;
}

interface PretripRecent {
  id: string;
  status: 'pass' | 'fail_safe' | 'fail_unsafe';
  submittedAt: string;
  shiftId: string | null;
}

export default function DriverWorkspacePage(): JSX.Element {
  const router = useRouter();
  const { profile } = useDriverAuth();
  const [shift, setShift] = useState<DriverShiftDto | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [briefing, setBriefing] = useState<BriefingNeedsResponse | null>(null);
  const [pretripForShift, setPretripForShift] = useState<PretripRecent | null>(null);
  const [trucks, setTrucks] = useState<TruckSummary[]>([]);
  const [startShiftOpen, setStartShiftOpen] = useState(false);
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [lastPingAt, setLastPingAt] = useState<Date | null>(null);
  const gpsRef = useRef<GpsLoopHandle | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [shiftRes, jobsRes, briefingRes] = await Promise.all([
        driverApi<DriverShiftDto | null>('GET', '/driver-shifts/me'),
        driverApi<JobDto[]>('GET', '/driver-jobs/me').catch(() => [] as JobDto[]),
        driverApi<BriefingNeedsResponse>('GET', '/driver-briefings/needs-acknowledgment').catch(
          () => ({ needs: false, briefing: null }),
        ),
      ]);
      setShift(shiftRes);
      setJobs(jobsRes);
      setBriefing(briefingRes);
      if (shiftRes) {
        try {
          const recent = await driverApi<PretripRecent[]>('GET', '/driver-pretrip/my-recent');
          const match = recent.find((p) => p.shiftId === shiftRes.id) ?? null;
          setPretripForShift(match);
        } catch {
          setPretripForShift(null);
        }
      } else {
        setPretripForShift(null);
      }
    } finally {
      setShiftLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    setQueueCount(readQueue().length);
    const onOnline = (): void => {
      void maybeReplay().then(() => {
        setQueueCount(readQueue().length);
        void refreshAll();
      });
    };
    window.addEventListener('online', onOnline);
    // First-load opportunistic replay so a tab that boots after a flaky
    // network event clears its queue.
    void maybeReplay().then(() => setQueueCount(readQueue().length));
    return () => window.removeEventListener('online', onOnline);
  }, [refreshAll]);

  // GPS loop wakes when a shift is active, sleeps when it ends.
  useEffect(() => {
    if (!shift || shift.endedAt) {
      gpsRef.current?.stop();
      gpsRef.current = null;
      return;
    }
    if (gpsRef.current) return;
    gpsRef.current = startGpsLoop({
      shiftId: shift.id,
      onPing: () => setLastPingAt(new Date()),
    });
    return () => {
      gpsRef.current?.stop();
      gpsRef.current = null;
    };
  }, [shift]);

  async function openStartShift(): Promise<void> {
    setStartShiftOpen(true);
    try {
      const list = await driverApi<TruckSummary[]>('GET', '/driver-trucks/mine');
      setTrucks(list);
    } catch {
      setTrucks([]);
    }
  }

  async function startShift(truckId: string): Promise<void> {
    try {
      const next = await driverApi<DriverShiftDto>('POST', '/driver-shifts/check-in', { truckId });
      setShift(next);
      setStartShiftOpen(false);
      // Capture an initial ping immediately for the dispatcher.
      const pos = await currentPosition();
      if (pos) setLastPingAt(new Date());
      void refreshAll();
    } catch (err) {
      // Keep the dialog open so the driver can retry.
      const msg = err instanceof DriverApiError ? err.message : 'Could not start shift';
      window.alert(msg);
    }
  }

  async function endShift(): Promise<void> {
    try {
      await driverApi('POST', '/driver-shifts/check-out');
      setShift(null);
      setEndShiftOpen(false);
      gpsRef.current?.stop();
      gpsRef.current = null;
      void refreshAll();
    } catch (err) {
      const msg = err instanceof DriverApiError ? err.message : 'Could not end shift';
      window.alert(msg);
    }
  }

  const banner = useMemo(() => {
    if (!briefing) return { kind: 'hidden' } as const;
    const localRaw =
      typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(DRIVER_BRIEFING_LOCAL_ACK_KEY);
    const local = localRaw
      ? (JSON.parse(localRaw) as { briefingId: string | null; acknowledgedDate: string | null })
      : { briefingId: null, acknowledgedDate: null };
    return decideBriefingBanner(briefing, local);
  }, [briefing]);

  const dvirFail = pretripForShift && pretripForShift.status !== 'pass';
  const needsPretrip = Boolean(shift && !pretripForShift);
  const canStartJobs = Boolean(shift && pretripForShift && !dvirFail);

  return (
    <DriverShell>
      <OfflineBanner />

      {/* Briefing banner */}
      {banner.kind === 'banner' ? (
        <BriefingBanner
          briefing={banner.briefing}
          onAcknowledged={() => {
            const today = new Date().toISOString().slice(0, 10);
            window.localStorage.setItem(
              DRIVER_BRIEFING_LOCAL_ACK_KEY,
              JSON.stringify({ briefingId: banner.briefing.id, acknowledgedDate: today }),
            );
            void refreshAll();
          }}
        />
      ) : banner.kind === 'acknowledged-pill' ? (
        <div className="mb-3 flex items-center gap-2 rounded-full border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
          <CheckCircle2 className="h-4 w-4" />
          Today's briefing acknowledged
        </div>
      ) : null}

      {/* Shift control */}
      <Card className="mb-3">
        <CardContent className="space-y-3 p-5">
          {shiftLoading ? (
            <p className="text-sm text-text-secondary-on-dark">Loading shift…</p>
          ) : shift ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">Shift active</p>
                <Badge tone="ok">
                  <CircleDot className="h-3 w-3" />{' '}
                  {STATUS_LABEL[shift.status as 'in_progress'] ?? shift.status}
                </Badge>
              </div>
              <p className="text-sm text-text-secondary-on-dark">
                Started {new Date(shift.startedAt).toLocaleTimeString()} · GPS ping{' '}
                {lastPingAt ? `${formatRelative(lastPingAt)} ago` : 'pending…'}
              </p>
              <Button
                size="touch"
                variant="destructive"
                className="w-full"
                onClick={() => setEndShiftOpen(true)}
              >
                End shift
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="font-semibold">No active shift</p>
              <p className="text-sm text-text-secondary-on-dark">
                Pick your truck to clock on for the day.
              </p>
              <Button size="touch" className="w-full" onClick={openStartShift}>
                <PlayCircle className="h-5 w-5" />
                Start shift
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pretrip prompt */}
      {needsPretrip ? (
        <Card className="mb-3 border-status-warning/40">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-status-warning" />
              <p className="font-semibold">Pre-trip inspection required</p>
            </div>
            <p className="text-sm text-text-secondary-on-dark">
              Complete the DVIR checklist before you can take any jobs. Takes about two minutes.
            </p>
            <Button size="touch" className="w-full" onClick={() => router.push('/driver/pretrip')}>
              Start DVIR
            </Button>
          </CardContent>
        </Card>
      ) : pretripForShift ? (
        <div className="mb-3 flex items-center justify-between rounded-full border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-ok">
            <ShieldCheck className="h-4 w-4" />
            Pre-trip captured at {new Date(pretripForShift.submittedAt).toLocaleTimeString()}
          </span>
          <Link href="/driver/pretrip" className="text-xs underline">
            Redo
          </Link>
        </div>
      ) : null}

      {dvirFail ? (
        <div className="mb-3 rounded-[10px] border border-danger/40 bg-danger/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle className="h-4 w-4" />
            DVIR fail — see admin
          </p>
          <p className="mt-1 text-text-secondary-on-dark">
            You cannot start jobs until dispatch clears the truck. Call the office and have them
            review your inspection.
          </p>
        </div>
      ) : null}

      {/* Active jobs */}
      <section className="mb-3">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-condensed text-base font-extrabold uppercase tracking-tight">
            Active jobs
          </h2>
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="flex h-9 items-center gap-1 rounded-full px-2 text-xs text-text-secondary-on-dark hover:bg-bg-surface-elevated"
            aria-label="Refresh jobs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </header>
        {jobs.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-text-secondary-on-dark">
              No active jobs. Sit tight — dispatch will assign your next one.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link
                  href={canStartJobs ? `/driver/jobs/${j.id}` : '#'}
                  aria-disabled={!canStartJobs}
                  onClick={(e) => {
                    if (!canStartJobs) {
                      e.preventDefault();
                      window.alert(
                        dvirFail
                          ? 'Truck is flagged DVIR fail. Call dispatch to clear it.'
                          : 'Complete pre-trip inspection first.',
                      );
                    }
                  }}
                  className="block rounded-[10px] border border-divider bg-bg-surface p-4 hover:border-brand-primary"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-xs text-text-secondary-on-dark">{j.jobNumber}</p>
                    <Badge tone={badgeToneForStatus(j.status)}>{STATUS_LABEL[j.status]}</Badge>
                  </div>
                  <p className="mt-1 text-base font-semibold">
                    {j.customer?.name ?? 'Customer pending'}
                  </p>
                  <p className="mt-0.5 text-sm text-text-secondary-on-dark">
                    {j.vehicle ? formatVehicle(j.vehicle) : 'Vehicle pending'}
                  </p>
                  <p className="mt-2 flex items-center gap-1 text-sm">
                    <MapPin className="h-4 w-4" />
                    {(j.pickupAddress ?? '—').split(',')[0]}
                  </p>
                  <p className="mt-2 flex items-center justify-end text-xs text-text-secondary-on-dark">
                    Open job <ChevronRight className="h-4 w-4" />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Quick actions */}
      <section className="mb-6 grid grid-cols-3 gap-2">
        <button
          type="button"
          className="flex h-20 flex-col items-center justify-center rounded-[10px] border border-divider bg-bg-surface p-2 text-xs"
          onClick={async () => {
            if (!shift) {
              window.alert('Start a shift first.');
              return;
            }
            await gpsRef.current?.pingNow();
            setLastPingAt(new Date());
          }}
        >
          <Truck className="mb-1 h-5 w-5" />
          Log GPS ping
        </button>
        <Link
          href="/driver/offline"
          className="flex h-20 flex-col items-center justify-center rounded-[10px] border border-divider bg-bg-surface p-2 text-xs"
        >
          <Inbox className="mb-1 h-5 w-5" />
          Offline queue
          {queueCount > 0 ? (
            <span className="mt-1 rounded-full bg-status-warning/20 px-1.5 text-[10px] text-status-warning">
              {queueCount}
            </span>
          ) : null}
        </Link>
        <Link
          href="/help"
          className="flex h-20 flex-col items-center justify-center rounded-[10px] border border-divider bg-bg-surface p-2 text-xs"
        >
          <HelpCircle className="mb-1 h-5 w-5" />
          Help
        </Link>
      </section>

      <Diagnostics shift={shift} profile={profile} queueCount={queueCount} />

      <Dialog open={startShiftOpen} onOpenChange={setStartShiftOpen}>
        <DialogContent onClose={() => setStartShiftOpen(false)}>
          <DialogHeader>
            <DialogTitle>Pick your truck</DialogTitle>
            <DialogDescription>Which truck are you taking out today?</DialogDescription>
          </DialogHeader>
          {trucks.length === 0 ? (
            <p className="text-sm text-text-secondary-on-dark">
              No trucks assigned to you. Ask dispatch to qualify you on a truck before starting your
              shift.
            </p>
          ) : (
            <ul className="space-y-2">
              {trucks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void startShift(t.id)}
                    className="flex h-14 w-full items-center justify-between rounded-[10px] border border-divider px-4 text-left hover:border-brand-primary"
                  >
                    <span>
                      <span className="block font-semibold">Unit {t.unitNumber}</span>
                      <span className="text-xs text-text-secondary-on-dark">
                        {t.make ?? ''} {t.model ?? ''}
                      </span>
                    </span>
                    <span className="text-xs uppercase text-text-secondary-on-dark">
                      {t.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={endShiftOpen} onOpenChange={setEndShiftOpen}>
        <DialogContent onClose={() => setEndShiftOpen(false)}>
          <DialogHeader>
            <DialogTitle>End shift?</DialogTitle>
            <DialogDescription>
              This will stop GPS tracking and clock you off for the day. Make sure any active jobs
              are completed first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEndShiftOpen(false)}>
              Keep shift
            </Button>
            <Button variant="destructive" onClick={() => void endShift()}>
              End shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DriverShell>
  );
}

function badgeToneForStatus(s: string): 'neutral' | 'info' | 'warn' | 'ok' | 'brand' {
  if (s === 'dispatched') return 'info';
  if (s === 'enroute' || s === 'on_scene') return 'warn';
  if (s === 'in_progress') return 'brand';
  if (s === 'completed') return 'ok';
  return 'neutral';
}

function formatVehicle(v: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
}): string {
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
}

function formatRelative(when: Date): string {
  const ms = Date.now() - when.getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3600_000)}h`;
}

function BriefingBanner({
  briefing,
  onAcknowledged,
}: {
  briefing: DriverDailyBriefingDto;
  onAcknowledged: () => void;
}): JSX.Element {
  const [read, setRead] = useState(false);
  const [videoCompletedAt, setVideoCompletedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function acknowledge(): Promise<void> {
    setBusy(true);
    try {
      const body: { briefingId: string; messageReadAt?: string; videoCompletedAt?: string } = {
        briefingId: briefing.id,
        messageReadAt: new Date().toISOString(),
        ...(videoCompletedAt ? { videoCompletedAt } : {}),
      };
      await driverApi('POST', `/driver-briefings/${briefing.id}/acknowledge`, body);
      onAcknowledged();
    } catch (err) {
      const msg = err instanceof DriverApiError ? err.message : 'Could not record acknowledgment';
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 overflow-hidden rounded-[14px] border-2 border-brand-primary/60 bg-brand-primary/10">
      <div className="p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-primary">
          Daily Briefing
        </p>
        <h3 className="mt-1 text-lg font-bold">{briefing.title}</h3>
        <p className="mt-2 text-sm leading-6 text-text-primary-on-dark/95 whitespace-pre-wrap">
          {briefing.message}
        </p>
        {briefing.videoUrl ? (
          <video
            controls
            preload="metadata"
            className="mt-3 w-full max-w-full rounded-[10px] bg-black"
            style={{ aspectRatio: '16/9' }}
            onEnded={() => setVideoCompletedAt(new Date().toISOString())}
          >
            <source src={briefing.videoUrl} />
            <track kind="captions" srcLang="en" label="English" />
            Your browser does not support inline video. Open the briefing page.
          </video>
        ) : null}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={read}
            onChange={(e) => setRead(e.target.checked)}
            className="h-5 w-5"
          />
          I have read and watched the briefing for today.
        </label>
      </div>
      <div className="border-t border-brand-primary/30 bg-brand-primary/5 p-3">
        <Button
          size="touch"
          className="w-full"
          disabled={!read || busy}
          onClick={() => void acknowledge()}
        >
          Acknowledge briefing
        </Button>
      </div>
    </div>
  );
}

function Diagnostics({
  shift,
  profile,
  queueCount,
}: {
  shift: DriverShiftDto | null;
  profile: ReturnType<typeof useDriverAuth>['profile'];
  queueCount: number;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const pressing = useRef<ReturnType<typeof setTimeout> | null>(null);
  function startPress(): void {
    pressing.current = setTimeout(() => setOpen((v) => !v), 800);
  }
  function endPress(): void {
    if (pressing.current) clearTimeout(pressing.current);
  }
  return (
    <div className="mb-6 text-center text-[10px] text-text-secondary-on-dark">
      <button
        type="button"
        onTouchStart={startPress}
        onTouchEnd={endPress}
        onMouseDown={startPress}
        onMouseUp={endPress}
        onMouseLeave={endPress}
        className="select-none text-text-secondary-on-dark/70"
        aria-label="Toggle diagnostics"
      >
        Driver workspace · v1 (session 3)
      </button>
      {open ? (
        <div className="mt-2 rounded-[10px] border border-divider bg-bg-surface-elevated p-3 text-left text-[11px]">
          <p>
            Driver id: <code>{profile?.driverId ?? '—'}</code>
          </p>
          <p>
            Tenant id: <code>{profile?.tenantId ?? '—'}</code>
          </p>
          <p>
            Shift id: <code>{shift?.id ?? '—'}</code>
          </p>
          <p>
            Truck id: <code>{shift?.truckId ?? '—'}</code>
          </p>
          <p>
            Queue: <code>{queueCount}</code> pending
          </p>
          <p>
            Online: <code>{typeof navigator === 'undefined' ? '?' : String(navigator.onLine)}</code>
          </p>
        </div>
      ) : null}
    </div>
  );
}
