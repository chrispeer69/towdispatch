'use client';

import type {
  CompareAnalysisResponse,
  DamageAnalysisDetailDto,
  DamageFindingDto,
  DamagePhase,
  DamageSeverity,
} from '@ustowdispatch/shared';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';
import {
  AREA_LABEL,
  PHASE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type UiLang,
  effectiveSeverity,
  formatDateTime,
  photoLabel,
} from './damage-ui-helpers';

const SEVERITIES: DamageSeverity[] = ['none', 'minor', 'moderate', 'severe'];

interface EvidenceItem {
  id: string;
  s3Key: string;
  downloadUrl: string | null;
}

interface VehicleHint {
  make?: string | undefined;
  model?: string | undefined;
  year?: number | undefined;
}

interface Props {
  jobId: string;
  vehicle: VehicleHint;
  evidence: EvidenceItem[];
  analyses: DamageAnalysisDetailDto[];
  canWrite: boolean;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`/api/damage-analysis${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function DamageClient({ jobId, vehicle, evidence, analyses, canWrite }: Props): JSX.Element {
  const router = useRouter();
  const [lang, setLang] = useState<UiLang>('en');
  const [phase, setPhase] = useState<DamagePhase>('pre_tow');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completed = analyses.filter((a) => a.status === 'complete');
  const [preId, setPreId] = useState<string>(
    completed.find((a) => a.phase === 'pre_tow')?.id ?? completed[0]?.id ?? '',
  );
  const [postId, setPostId] = useState<string>(
    completed.find((a) => a.phase === 'post_tow')?.id ?? completed[1]?.id ?? '',
  );
  const [comparison, setComparison] = useState<CompareAnalysisResponse | null>(null);

  const togglePhoto = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runAnalysis = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await call('', {
        method: 'POST',
        body: JSON.stringify({
          jobId,
          phase,
          photoKeys: [...selected],
          vehicleContext: vehicle,
        }),
      });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const override = async (
    analysisId: string,
    findingId: string,
    patch: Record<string, unknown>,
  ): Promise<void> => {
    setError(null);
    try {
      await call(`/${analysisId}/findings/${findingId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runCompare = async (): Promise<void> => {
    if (!preId || !postId || preId === postId) {
      setError('Select two distinct completed analyses to compare.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await call<CompareAnalysisResponse>('/compare', {
        method: 'POST',
        body: JSON.stringify({ preAnalysisId: preId, postAnalysisId: postId }),
      });
      setComparison(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] uppercase tracking-wide text-text-secondary-on-dark/60">
          {/* TODO(i18n): full sentence localization pending a web i18n framework */}
          Language
        </span>
        <div className="inline-flex overflow-hidden rounded-full border border-divider text-xs">
          {(['en', 'es'] as UiLang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`px-3 py-1 uppercase ${lang === l ? 'bg-accent-orange/20 text-accent-orange' : 'text-text-secondary-on-dark'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-error-on-dark/40 bg-status-error-on-dark/10 px-3 py-2 text-sm text-status-error-on-dark"
        >
          {error}
        </p>
      ) : null}

      {/* Trigger */}
      {canWrite ? (
        <section className="space-y-3 rounded-[14px] border border-divider bg-bg-surface p-5">
          <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
            Run analysis
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-text-secondary-on-dark" htmlFor="phase">
              Phase
            </label>
            <select
              id="phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value as DamagePhase)}
              className="rounded-md border border-divider bg-bg-base px-2 py-1 text-sm"
            >
              <option value="pre_tow">{PHASE_LABEL[lang].pre_tow}</option>
              <option value="post_tow">{PHASE_LABEL[lang].post_tow}</option>
              <option value="claim_review">{PHASE_LABEL[lang].claim_review}</option>
            </select>
          </div>
          {evidence.length === 0 ? (
            <p className="text-sm text-text-secondary-on-dark">
              {/* TODO(i18n) */}
              No evidence photos uploaded yet. Add photos on the job before running analysis.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {evidence.map((e) => {
                const on = selected.has(e.s3Key);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => togglePhoto(e.s3Key)}
                    aria-pressed={on}
                    className={`flex flex-col gap-1 rounded-lg border p-2 text-left text-[11px] ${on ? 'border-accent-orange bg-accent-orange/10' : 'border-divider bg-bg-base'}`}
                  >
                    {e.downloadUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.downloadUrl}
                        alt={photoLabel(e.s3Key)}
                        className="h-20 w-full rounded object-cover"
                      />
                    ) : (
                      <span className="flex h-20 w-full items-center justify-center rounded bg-bg-surface-elevated/40 text-text-secondary-on-dark">
                        {photoLabel(e.s3Key)}
                      </span>
                    )}
                    <span className="truncate">{photoLabel(e.s3Key)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={runAnalysis}
            disabled={busy || selected.size === 0}
            className="rounded-full bg-accent-orange px-4 py-1.5 text-sm font-semibold text-bg-base disabled:opacity-40"
          >
            {/* TODO(i18n) */}
            Analyze {selected.size} photo{selected.size === 1 ? '' : 's'}
          </button>
        </section>
      ) : null}

      {/* Existing analyses */}
      <section className="space-y-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
          Analyses
        </h2>
        {analyses.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No analyses yet.</p>
        ) : (
          analyses.map((a) => (
            <AnalysisCard
              key={a.id}
              analysis={a}
              lang={lang}
              canWrite={canWrite}
              onOverride={override}
            />
          ))
        )}
      </section>

      {/* Comparison */}
      {completed.length >= 2 ? (
        <section className="space-y-3 rounded-[14px] border border-divider bg-bg-surface p-5">
          <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
            Pre / post comparison
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <AnalysisSelect
              label="Pre"
              value={preId}
              onChange={setPreId}
              options={completed}
              lang={lang}
            />
            <AnalysisSelect
              label="Post"
              value={postId}
              onChange={setPostId}
              options={completed}
              lang={lang}
            />
            <button
              type="button"
              onClick={runCompare}
              disabled={busy}
              className="rounded-full bg-accent-orange px-4 py-1.5 text-sm font-semibold text-bg-base disabled:opacity-40"
            >
              {/* TODO(i18n) */}
              Compare
            </button>
          </div>

          {comparison ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary-on-dark">
                {comparison.comparison.comparisonSummary}
              </p>
              <a
                href={`/api/damage-analysis/comparisons/${comparison.comparison.id}/report.pdf?lang=${lang}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs font-semibold text-accent-orange underline"
              >
                {/* TODO(i18n) */}
                Download comparison report (PDF)
              </a>
              <div className="grid gap-3 md:grid-cols-3">
                <CompareColumn
                  title="New damage"
                  highlight
                  entries={comparison.result.newDamage}
                  lang={lang}
                />
                <CompareColumn
                  title="Pre-existing"
                  entries={comparison.result.preExisting}
                  lang={lang}
                />
                <CompareColumn
                  title="Inconclusive"
                  entries={comparison.result.inconclusive}
                  lang={lang}
                />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function AnalysisSelect({
  label,
  value,
  onChange,
  options,
  lang,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: DamageAnalysisDetailDto[];
  lang: UiLang;
}): JSX.Element {
  return (
    <label className="flex items-center gap-1">
      <span className="text-xs text-text-secondary-on-dark">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-divider bg-bg-base px-2 py-1 text-sm"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {PHASE_LABEL[lang][o.phase]} · {formatDateTime(o.requestedAt)}
          </option>
        ))}
      </select>
    </label>
  );
}

function AnalysisCard({
  analysis,
  lang,
  canWrite,
  onOverride,
}: {
  analysis: DamageAnalysisDetailDto;
  lang: UiLang;
  canWrite: boolean;
  onOverride: (analysisId: string, findingId: string, patch: Record<string, unknown>) => void;
}): JSX.Element {
  return (
    <div className="rounded-[14px] border border-divider bg-bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-condensed text-sm font-bold uppercase">
            {PHASE_LABEL[lang][analysis.phase]}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[analysis.status]}`}
          >
            {STATUS_LABEL[lang][analysis.status]}
          </span>
          <span className="text-[11px] text-text-secondary-on-dark/70">
            {analysis.provider} · {formatDateTime(analysis.requestedAt)}
          </span>
        </div>
        {analysis.status === 'complete' ? (
          <a
            href={`/api/damage-analysis/${analysis.id}/report.pdf?lang=${lang}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-accent-orange underline"
          >
            {/* TODO(i18n) */}
            PDF
          </a>
        ) : null}
      </div>
      {analysis.error ? (
        <p className="mt-2 text-xs text-status-error-on-dark">{analysis.error}</p>
      ) : null}
      <div className="mt-3 space-y-2">
        {analysis.findings.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No damage detected.</p>
        ) : (
          analysis.findings.map((f) => (
            <FindingRow
              key={f.id}
              analysisId={analysis.id}
              finding={f}
              lang={lang}
              canWrite={canWrite}
              onOverride={onOverride}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FindingRow({
  analysisId,
  finding,
  lang,
  canWrite,
  onOverride,
}: {
  analysisId: string;
  finding: DamageFindingDto;
  lang: UiLang;
  canWrite: boolean;
  onOverride: (analysisId: string, findingId: string, patch: Record<string, unknown>) => void;
}): JSX.Element {
  const sev = effectiveSeverity(finding);
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-divider/60 bg-bg-base px-3 py-2 text-sm ${finding.isDismissed ? 'opacity-50' : ''}`}
    >
      <span className="min-w-[120px] font-semibold">{AREA_LABEL[lang][finding.area]}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${SEVERITY_TONE[sev]}`}>
        {SEVERITY_LABEL[lang][sev]}
        {finding.operatorSeverity ? ' *' : ''}
      </span>
      <span className="text-xs text-text-secondary-on-dark">{finding.confidencePct}%</span>
      <span className="flex-1 text-xs text-text-secondary-on-dark">
        {finding.description ?? ''}
      </span>
      {canWrite ? (
        <div className="flex items-center gap-1">
          <select
            aria-label="Override severity"
            value={finding.operatorSeverity ?? ''}
            onChange={(e) =>
              onOverride(analysisId, finding.id, {
                operatorSeverity: e.target.value === '' ? null : (e.target.value as DamageSeverity),
              })
            }
            className="rounded-md border border-divider bg-bg-surface px-1.5 py-0.5 text-xs"
          >
            <option value="">{/* TODO(i18n) */}— model —</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[lang][s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              onOverride(analysisId, finding.id, { isDismissed: !finding.isDismissed })
            }
            className="rounded-full border border-divider px-2 py-0.5 text-[11px] text-text-secondary-on-dark hover:text-text-primary-on-dark"
          >
            {/* TODO(i18n) */}
            {finding.isDismissed ? 'Restore' : 'Dismiss'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CompareColumn({
  title,
  entries,
  highlight,
  lang,
}: {
  title: string;
  entries: CompareAnalysisResponse['result']['newDamage'];
  highlight?: boolean;
  lang: UiLang;
}): JSX.Element {
  return (
    <div
      className={`rounded-lg border p-3 ${highlight ? 'border-status-error-on-dark/50 bg-status-error-on-dark/5' : 'border-divider bg-bg-base'}`}
    >
      <h3
        className={`mb-2 font-condensed text-sm font-bold uppercase ${highlight ? 'text-status-error-on-dark' : 'text-text-primary-on-dark'}`}
      >
        {/* TODO(i18n): column titles */}
        {title} ({entries.length})
      </h3>
      <ul className="space-y-1.5">
        {entries.map((e, i) => (
          <li key={`${e.area}-${i}`} className="text-xs">
            <span className="font-semibold">{AREA_LABEL[lang][e.area]}</span>{' '}
            <span className={`rounded px-1 ${SEVERITY_TONE[e.severity]}`}>
              {SEVERITY_LABEL[lang][e.severity]}
            </span>
            {e.priorSeverity ? (
              <span className="text-text-secondary-on-dark/70">
                {' '}
                (was {SEVERITY_LABEL[lang][e.priorSeverity]})
              </span>
            ) : null}
            <span className="block text-text-secondary-on-dark/70">{e.reason}</span>
          </li>
        ))}
        {entries.length === 0 ? (
          <li className="text-xs text-text-secondary-on-dark/60">—</li>
        ) : null}
      </ul>
    </div>
  );
}
