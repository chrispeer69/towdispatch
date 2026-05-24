'use client';

import {
  SCORE_TONE_CLASS,
  factorLabel,
  formatEtaMinutes,
  scoreTone,
} from '@/lib/ai-dispatch/ui-helpers';
/**
 * Smart Recommendations panel — inline on the job-detail page.
 *
 * Shows the engine's top candidates (truck + driver) for an unassigned job:
 * composite score, per-factor breakdown, and a predicted drive-to-scene ETA.
 * ADVISORY ONLY — there is deliberately no "assign" button here; the dispatcher
 * assigns from the dispatch board. Writers can recompute on demand.
 */
import { clientRecomputeRecommendations } from '@/lib/api/ai-dispatch-client';
import type {
  DispatchFactorKey,
  DispatchRecommendationDto,
  RecommendationItem,
} from '@ustowdispatch/shared';
import { type JSX, useState } from 'react';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

export function SmartRecommendationsPanel({
  jobId,
  role,
  initial,
}: {
  jobId: string;
  role: string;
  initial: DispatchRecommendationDto | null;
}): JSX.Element {
  const canWrite = WRITER_ROLES.has(role);
  const [rec, setRec] = useState<DispatchRecommendationDto | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recompute(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setRec(await clientRecomputeRecommendations(jobId, { limit: 3 }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const items = rec?.recommendations ?? [];

  return (
    <section className="space-y-3" data-testid="smart-recommendations">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            🤖 Smart recommendations
          </h2>
          <p className="text-xs text-text-secondary-on-dark">
            Advisory only — the engine ranks candidates; the dispatcher assigns.
            {rec ? (
              <span className="ml-1">
                Computed{' '}
                {new Date(rec.computedAt).toLocaleString(undefined, {
                  timeStyle: 'short',
                  dateStyle: 'short',
                })}
                .
              </span>
            ) : null}
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={() => void recompute()}
            disabled={busy}
            className="shrink-0 rounded bg-accent-orange px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Computing…' : rec ? 'Recompute' : 'Run recommendations'}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {items.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-divider bg-bg-surface/40 p-5 text-center text-sm text-text-secondary-on-dark">
          {rec
            ? 'No eligible candidates right now (no active shift with a truck and a known position).'
            : 'No recommendations computed yet for this job.'}
        </div>
      ) : (
        <ol className="space-y-3">
          {items.map((item, idx) => (
            <CandidateCard key={`${item.truckId}-${item.driverId}`} item={item} rank={idx + 1} />
          ))}
        </ol>
      )}
    </section>
  );
}

function CandidateCard({ item, rank }: { item: RecommendationItem; rank: number }): JSX.Element {
  const tone = scoreTone(item.score);
  return (
    <li className="rounded-[14px] border border-divider bg-bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-text-primary-on-dark">
            <span className="mr-2 font-mono text-text-secondary-on-dark">#{rank}</span>
            {item.driverName ?? 'Driver'}{' '}
            <span className="text-text-secondary-on-dark">· Unit {item.truckUnit ?? '—'}</span>
          </p>
          <p className="text-xs text-text-secondary-on-dark">
            Predicted ETA to scene:{' '}
            <span className="font-mono font-bold text-text-primary-on-dark">
              {formatEtaMinutes(item.predictedEtaMinutes)}
            </span>
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-sm font-bold tabular-nums ${SCORE_TONE_CLASS[tone]}`}
          aria-label={`Score ${item.score} of 100`}
        >
          {item.score.toFixed(0)}
        </span>
      </div>

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {item.factors.map((f) => (
          <li key={f.key} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 text-text-secondary-on-dark">
              {factorLabel(f.key as DispatchFactorKey)}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-surface-elevated">
              <span
                className="block h-full rounded-full bg-brand-primary"
                style={{ width: `${Math.max(0, Math.min(100, f.score))}%` }}
              />
            </span>
            <span className="w-7 shrink-0 text-right font-mono text-text-secondary-on-dark">
              {f.score.toFixed(0)}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
