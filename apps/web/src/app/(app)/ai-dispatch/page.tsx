import { formatEtaMinutes } from '@/lib/ai-dispatch/ui-helpers';
/**
 * /ai-dispatch — AI Smart Dispatch accuracy reports.
 *
 * Three measures from the feedback loop (dispatch_outcomes):
 *   1. Recommendation accuracy — % of assignments that picked the engine's #1.
 *   2. ETA accuracy — mean absolute error (and signed bias) of the predicted ETA.
 *   3. Per-driver performance — completion volume + avg ETA error, ranked.
 *
 * Read-only. Advisory engine — these numbers tell the operator how much to
 * trust the recommendations, and feed the future ML training story.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import type {
  DriverPerformanceReport,
  EtaAccuracyReport,
  RecommendationAccuracyReport,
} from '@ustowdispatch/shared';
import type { JSX } from 'react';

export const metadata = { title: 'AI Smart Dispatch — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;

export default async function AiDispatchReportsPage(): Promise<JSX.Element> {
  const [recRes, etaRes, perfRes] = await Promise.all([
    tryFetch(() =>
      apiServer<RecommendationAccuracyReport>(
        `/ai-dispatch/reports/recommendation-accuracy?windowDays=${WINDOW_DAYS}`,
      ),
    ),
    tryFetch(() =>
      apiServer<EtaAccuracyReport>(`/ai-dispatch/reports/eta-accuracy?windowDays=${WINDOW_DAYS}`),
    ),
    tryFetch(() =>
      apiServer<DriverPerformanceReport>(
        `/ai-dispatch/reports/driver-performance?windowDays=${WINDOW_DAYS}`,
      ),
    ),
  ]);

  const rec = recRes.data;
  const eta = etaRes.data;
  const perf = perfRes.data;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          AI Smart Dispatch
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          Advisory recommendation + predictive-ETA accuracy over the last {WINDOW_DAYS} days. The
          engine recommends; dispatchers decide.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Kpi
          label="Top-1 picked"
          value={rec && rec.topOneAccuracyPct !== null ? `${rec.topOneAccuracyPct}%` : '—'}
          sub={
            rec
              ? `${rec.topOnePicked}/${rec.outcomesWithRecommendation} assignments matched the #1 rec`
              : 'No data'
          }
        />
        <Kpi
          label="ETA error (MAE)"
          value={
            eta?.meanAbsoluteErrorMinutes == null
              ? '—'
              : formatEtaMinutes(Math.round(eta.meanAbsoluteErrorMinutes))
          }
          sub={eta ? `${eta.samples} completed jobs with a recorded ETA` : 'No data'}
        />
        <Kpi
          label="ETA bias"
          value={
            eta?.meanBiasMinutes == null
              ? '—'
              : `${eta.meanBiasMinutes > 0 ? '+' : ''}${eta.meanBiasMinutes} min`
          }
          sub={
            eta?.meanBiasMinutes == null
              ? 'No data'
              : eta.meanBiasMinutes > 0
                ? 'Arrivals run later than predicted'
                : 'Arrivals run earlier than predicted'
          }
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          Per-driver performance
        </h2>
        {!perf || perf.drivers.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-[14px] border border-dashed border-divider bg-bg-surface/40 text-sm text-text-secondary-on-dark">
            No completed dispatches with recorded outcomes yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface">
            <table className="w-full divide-y divide-divider text-sm">
              <thead className="bg-bg-surface-elevated/30">
                <tr className="text-left">
                  <Th>Rank</Th>
                  <Th>Driver</Th>
                  <Th>Completed</Th>
                  <Th>Avg ETA error</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {perf.drivers.map((d) => (
                  <tr key={d.driverId} className="hover:bg-bg-surface-elevated/20">
                    <td className="px-4 py-2 font-mono font-bold tabular-nums">#{d.rank}</td>
                    <td className="px-4 py-2">{d.driverName ?? '—'}</td>
                    <td className="px-4 py-2 font-mono tabular-nums">{d.completedJobs}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-text-secondary-on-dark">
                      {d.avgEtaErrorMinutes == null
                        ? '—'
                        : formatEtaMinutes(Math.round(d.avgEtaErrorMinutes))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }): JSX.Element {
  return (
    <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
        {label}
      </p>
      <p className="mt-1 font-condensed text-2xl font-extrabold tabular-nums text-text-primary-on-dark">
        {value}
      </p>
      <p className="mt-1 text-xs text-text-secondary-on-dark">{sub}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
      {children}
    </th>
  );
}
