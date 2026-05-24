'use client';

/**
 * /driver/jobs/[jobId]/ev — the in-truck EV surface.
 *
 *   1. EV equipment badge (FLATBED ONLY) — the headline call
 *   2. OEM tow-mode + HV-disconnect steps, pre-loaded on accept
 *   3. Thermal-event quick-report (tap "Report" → tap severity = 2 taps),
 *      then the bilingual evacuation warning + the escalation checklist
 *
 * Driver-JWT surface — every call goes through driverApi against /driver-ev/*.
 * Touch targets use size="touch" per the driver-app convention.
 */
import { DriverShell } from '@/components/driver/driver-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DriverApiError, driverApi } from '@/lib/driver/api-client';
import {
  bilingualThermalWarning,
  equipmentBadge,
  escalationActions,
  severityLabel,
} from '@/lib/ev/ev-ui-helpers';
import type { EvJobDetailDto } from '@ustowdispatch/shared';
import { evThermalSeverityValues } from '@ustowdispatch/shared';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useState } from 'react';

export default function DriverEvPage(): JSX.Element {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [detail, setDetail] = useState<EvJobDetailDto | null>(null);
  const [notEv, setNotEv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await driverApi<EvJobDetailDto>('GET', `/driver-ev/jobs/${jobId}`);
      setDetail(d);
      setNotEv(false);
    } catch (err) {
      if (err instanceof DriverApiError && err.status === 404) {
        setNotEv(true);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DriverShell title="EV recovery" backHref={`/driver/jobs/${jobId}`}>
      {error && (
        <Card className="mb-3 border-danger/40">
          <CardContent className="p-3 text-sm text-danger">{error}</CardContent>
        </Card>
      )}

      {loading && <p className="text-sm text-text-secondary-on-dark">Loading…</p>}

      {!loading && notEv && (
        <Card className="mb-3">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm">This job is not marked as an EV recovery yet.</p>
            <Button
              size="touch"
              disabled={busy}
              onClick={() => run(() => driverApi('PATCH', `/driver-ev/jobs/${jobId}`, {}))}
            >
              Mark as EV recovery
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && detail && (
        <div className="space-y-3">
          <EquipmentCard detail={detail} />
          {detail.thermalEvents[0] && <ActiveThermalCard detail={detail} />}
          <OemCard detail={detail} />
          <ThermalReporter
            picking={picking}
            busy={busy}
            onStart={() => setPicking(true)}
            onCancel={() => setPicking(false)}
            onPick={(severity) => {
              setPicking(false);
              void run(() =>
                driverApi('POST', `/driver-ev/jobs/${jobId}/thermal-events`, { severity }),
              );
            }}
          />
        </div>
      )}
    </DriverShell>
  );
}

function EquipmentCard({ detail }: { detail: EvJobDetailDto }): JSX.Element {
  const badge = equipmentBadge(detail.equipment);
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Badge tone={badge.tone} className="text-sm font-bold uppercase">
            {badge.label}
          </Badge>
          {detail.equipment.hvIsolationRequired && (
            <Badge tone="danger" className="uppercase">
              Isolate HV
            </Badge>
          )}
        </div>
        <ul className="text-sm text-text-secondary-on-dark list-disc pl-5">
          {detail.equipment.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ActiveThermalCard({ detail }: { detail: EvJobDetailDto }): JSX.Element {
  const ev = detail.thermalEvents[0];
  if (!ev) return <></>;
  const warn = bilingualThermalWarning(ev.escalation);
  return (
    <Card className="border-2 border-danger">
      <CardContent className="p-4 space-y-2">
        <p className="font-bold text-danger uppercase text-sm">
          Thermal event: {severityLabel(ev.severity)}
        </p>
        <p className="text-sm font-semibold">{warn.en}</p>
        <p className="text-sm italic text-text-secondary-on-dark">{warn.es}</p>
        <ul className="text-sm list-disc pl-5">
          {escalationActions(ev.escalation).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function OemCard({ detail }: { detail: EvJobDetailDto }): JSX.Element {
  const p = detail.oemProcedure;
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <p className="font-semibold">OEM procedure{p ? ` — ${p.make} ${p.model ?? ''}` : ''}</p>
        {p ? (
          <>
            <div className="text-sm">
              <p className="font-medium">Tow mode</p>
              <p className="text-text-secondary-on-dark whitespace-pre-line">{p.towModeSteps}</p>
            </div>
            <div className="text-sm">
              <p className="font-medium">HV disconnect</p>
              <p className="text-text-secondary-on-dark whitespace-pre-line">
                {p.hvDisconnectSteps}
              </p>
            </div>
            {p.jackingPointsUrl && (
              <a
                className="text-brand-primary text-sm"
                href={p.jackingPointsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Jacking points ↗
              </a>
            )}
            <p className="text-[11px] text-text-secondary-on-dark">
              Verify against the OEM manual. Last verified {p.lastVerifiedAt.slice(0, 10)}.
            </p>
          </>
        ) : (
          <p className="text-sm text-text-secondary-on-dark">
            No OEM-specific procedure on file — flatbed only, consult the manufacturer guide.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ThermalReporter({
  picking,
  busy,
  onStart,
  onCancel,
  onPick,
}: {
  picking: boolean;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  onPick: (severity: (typeof evThermalSeverityValues)[number]) => void;
}): JSX.Element {
  if (!picking) {
    return (
      <Button
        size="touch"
        variant="destructive"
        className="w-full"
        disabled={busy}
        onClick={onStart}
      >
        ⚠ Report thermal event
      </Button>
    );
  }
  return (
    <Card className="border-danger/40">
      <CardContent className="p-3 space-y-2">
        <p className="text-sm font-semibold">What do you see?</p>
        <div className="grid grid-cols-2 gap-2">
          {evThermalSeverityValues.map((s) => (
            <Button
              key={s}
              size="touch"
              variant="destructive"
              disabled={busy}
              onClick={() => onPick(s)}
            >
              {severityLabel(s)}
            </Button>
          ))}
        </div>
        <Button size="touch" variant="ghost" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}
