'use client';
import {
  clientPersonalPropertyHold,
  clientValidatePeacefulRepo,
} from '@/lib/api/repo-compliance-client';
import type {
  RepoAttemptFacts,
  RepoPeacefulResult,
  RepoPersonalPropertyHoldResult,
  RepoState,
  RepoStateRulesDto,
} from '@ustowdispatch/shared';
import { type JSX, useMemo, useState } from 'react';

interface Props {
  rules: RepoStateRulesDto[];
}

// The breach-of-peace attempt fields, in the order shown in the checklist.
const ATTEMPT_FIELDS: { key: keyof RepoAttemptFacts; label: string }[] = [
  { key: 'debtorPresent', label: 'Debtor present at the scene' },
  { key: 'debtorObjected', label: 'Debtor objected / told you to stop' },
  { key: 'breachedLockedEnclosure', label: 'Entered a closed/locked enclosure (gate, garage)' },
  { key: 'enteredResidence', label: 'Entered a residence' },
  { key: 'usedOrThreatenedForce', label: 'Used or threatened force' },
  { key: 'lawEnforcementDirected', label: 'An officer directed/assisted the repo' },
  { key: 'occurredAtNight', label: 'Occurred at night' },
];

export function RepoComplianceReferenceClient({ rules }: Props): JSX.Element {
  const sorted = useMemo(() => [...rules].sort((a, b) => a.state.localeCompare(b.state)), [rules]);
  const [state, setState] = useState<string>(sorted[0]?.state ?? 'CA');
  const selected = sorted.find((r) => r.state === state) ?? sorted[0];

  if (!selected) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Repo Compliance</h1>
        <p className="text-text-secondary-on-dark">No state rules are available.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Repo Compliance</h1>
          <p className="text-text-secondary-on-dark text-sm">
            State-by-state repossession rules — breach of peace, notices, redemption, and personal
            property. Best-effort; verify with counsel before filing.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary-on-dark">State</span>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded border border-border-on-dark bg-bg-surface px-2 py-1"
          >
            {sorted.map((r) => (
              <option key={r.state} value={r.state}>
                {r.state}
              </option>
            ))}
          </select>
        </label>
      </header>

      <CompliancePanel dto={selected} />
      <div className="grid gap-6 md:grid-cols-2">
        <BreachChecklist state={selected.state as RepoState} />
        <PersonalPropertyCalculator state={selected.state as RepoState} dto={selected} />
      </div>
    </section>
  );
}

function CompliancePanel({ dto }: { dto: RepoStateRulesDto }): JSX.Element {
  const r = dto.rules;
  return (
    <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{dto.state} — required compliance</h2>
        <span className="text-xs text-text-secondary-on-dark">{r.statute}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
        <Row
          label="Pre-repo notice / right-to-cure"
          value={
            r.preRepoNoticeRequired ? `Required — ${r.preRepoNoticeDays} days` : 'Not required'
          }
        />
        <Row
          label="Post-repo notice"
          value={
            r.postRepoNoticeRequired
              ? `${r.postRepoNoticeDays} days, by ${r.postRepoNoticeMethod}`
              : 'Not required'
          }
        />
        <Row
          label="Redemption period"
          value={
            r.redemptionPeriodDays > 0 ? `${r.redemptionPeriodDays} days` : 'No pre-sale window'
          }
        />
        <Row label="Right to cure" value={r.cureRight ? `${r.cureRightDays} days` : 'No'} />
        <Row label="Personal-property hold" value={`${r.personalPropertyHoldDays} days`} />
        <Row label="PP release" value={humanizeMethod(r.personalPropertyReleaseMethod)} />
        <Row label="Secondary contact" value={r.secondaryContactRequired ? 'Required' : 'No'} />
        <Row
          label="Law-enforcement report"
          value={r.sheriffNoticeRequired ? (r.sheriffNoticeJurisdiction ?? 'Required') : 'No'}
        />
      </dl>
      <p className="text-xs text-text-secondary-on-dark border-t border-border-on-dark pt-2">
        {r.peacefulRepoDefinition}
      </p>
    </div>
  );
}

function BreachChecklist({ state }: { state: RepoState }): JSX.Element {
  const [attempt, setAttempt] = useState<RepoAttemptFacts>({
    state,
    debtorPresent: false,
    debtorObjected: false,
    breachedLockedEnclosure: false,
    enteredResidence: false,
    usedOrThreatenedForce: false,
    lawEnforcementDirected: false,
    occurredAtNight: false,
  });
  const [result, setResult] = useState<RepoPeacefulResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(next: RepoAttemptFacts): Promise<void> {
    setError(null);
    try {
      setResult(await clientValidatePeacefulRepo({ ...next, state }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed');
    }
  }

  return (
    <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-6 space-y-3">
      <h2 className="text-lg font-semibold">Breach-of-peace check</h2>
      <div className="space-y-1.5 text-sm">
        {ATTEMPT_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(attempt[f.key])}
              onChange={(e) => {
                const next = { ...attempt, [f.key]: e.target.checked };
                setAttempt(next);
                void check(next);
              }}
            />
            <span>{f.label}</span>
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {result?.allowed && (
        <div className="rounded border border-green-700 bg-green-950/40 p-3 text-sm text-green-300">
          ✓ Lawful self-help repossession — no breach of the peace detected.
        </div>
      )}
      {result && !result.allowed && (
        <div className="rounded border border-red-700 bg-red-950/40 p-3 text-sm text-red-300">
          <p className="font-semibold">⚠ Breach of the peace — do NOT proceed.</p>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            {result.violations.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PersonalPropertyCalculator({
  state,
  dto,
}: {
  state: RepoState;
  dto: RepoStateRulesDto;
}): JSX.Element {
  const [recoveredAt, setRecoveredAt] = useState<string>(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<RepoPersonalPropertyHoldResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function calc(): Promise<void> {
    setError(null);
    try {
      setResult(
        await clientPersonalPropertyHold({
          state,
          recoveredAt: new Date(`${recoveredAt}T00:00:00.000Z`).toISOString(),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calculation failed');
    }
  }

  return (
    <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-6 space-y-3">
      <h2 className="text-lg font-semibold">Personal-property hold</h2>
      <p className="text-sm text-text-secondary-on-dark">
        {dto.state} requires holding personal property for {dto.rules.personalPropertyHoldDays} days
        ({humanizeMethod(dto.rules.personalPropertyReleaseMethod)}).
      </p>
      <div className="flex items-end gap-2">
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark">Recovery date</span>
          <input
            type="date"
            value={recoveredAt}
            onChange={(e) => setRecoveredAt(e.target.value)}
            className="rounded border border-border-on-dark bg-bg-surface px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={() => void calc()}
          className="rounded bg-accent-orange px-3 py-1.5 text-sm font-medium text-black"
        >
          Compute hold-until
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {result && (
        <p className="text-sm">
          Hold until <span className="font-semibold">{result.holdUntil.slice(0, 10)}</span> (
          {result.holdDays} days) — {humanizeMethod(result.releaseMethod)}.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-3 border-b border-border-on-dark/40 py-1">
      <dt className="text-text-secondary-on-dark">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function humanizeMethod(method: string): string {
  switch (method) {
    case 'owner_pickup_after_notice':
      return 'owner pickup after notice';
    case 'mail_return':
      return 'returned by mail';
    case 'disposal_after_hold':
      return 'disposed after hold';
    default:
      return method;
  }
}
