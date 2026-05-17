'use client';
/**
 * Dynamic Pricing Control Panel — six-section client component. Driven
 * by the server-side fetched snapshot; live updates happen on
 * activation toggles and demand-surge approvals.
 */
import { Button } from '@/components/ui/button';
import {
  clientApproveDemandSurge,
  clientDeactivateTier,
  clientDismissDemandSurge,
} from '@/lib/api/dynamic-pricing-client';
import {
  type DynamicPricingDemandSurgeSuggestionDto,
  type DynamicPricingPulseToday,
  type DynamicPricingTierDto,
  type OverrideReportRow,
  type TierHistoryRow,
  type TierPerformanceRow,
} from '@ustowdispatch/shared';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CloudRain,
  Loader2,
  Star,
  TrafficCone,
  Watch,
  XCircle,
} from 'lucide-react';
import { type JSX, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  tiers: DynamicPricingTierDto[];
  pulse: DynamicPricingPulseToday;
  suggestions: DynamicPricingDemandSurgeSuggestionDto[];
  history: TierHistoryRow[];
  overrides: OverrideReportRow[];
  performance: TierPerformanceRow[];
}

const CATEGORY_ICON: Record<string, typeof CloudRain> = {
  weather: CloudRain,
  traffic: TrafficCone,
  calendar: Calendar,
  time_of_day: Watch,
  special_event: Star,
};

function fmtMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const d = Math.floor(abs / 100);
  const c = abs % 100;
  return `${sign}$${d.toLocaleString('en-US')}.${String(c).padStart(2, '0')}`;
}

function fmtRel(iso: string): string {
  const dt = new Date(iso);
  const diff = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 60_000));
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  const hours = Math.floor(diff / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ControlPanelClient({
  tiers,
  pulse,
  suggestions,
  history,
  overrides,
  performance,
}: Props): JSX.Element {
  const [tierState, setTierState] = useState(tiers);
  const [suggestionState, setSuggestionState] = useState(suggestions);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeTiers = tierState.filter((t) => t.isActive && !t.deletedAt);
  const scheduled = tierState.filter(
    (t) => !t.isActive && !t.deletedAt && t.schedule?.startAt && new Date(t.schedule.startAt) > new Date(),
  );

  async function deactivate(id: string) {
    setBusyId(id);
    try {
      const next = await clientDeactivateTier(id, 'manual deactivation');
      setTierState((prev) => prev.map((t) => (t.id === id ? next as DynamicPricingTierDto : t)));
      toast.success('Tier deactivated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deactivate failed');
    } finally {
      setBusyId(null);
    }
  }

  async function approve(id: string) {
    setBusyId(id);
    try {
      await clientApproveDemandSurge(id, {});
      setSuggestionState((prev) => prev.filter((s) => s.id !== id));
      toast.success('Demand surge approved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    try {
      await clientDismissDemandSurge(id);
      setSuggestionState((prev) => prev.filter((s) => s.id !== id));
      toast.success('Suggestion dismissed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dismiss failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Dynamic Pricing
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          Shape the curve. Active tiers, scheduled activations, today&rsquo;s pulse, and recent
          performance.
        </p>
      </header>

      {suggestionState.length > 0 ? (
        <section className="space-y-2 rounded-[14px] border border-status-warning/40 bg-status-warning/10 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-status-warning" />
            <h2 className="font-semibold">Demand Surge Suggestions</h2>
          </div>
          <ul className="space-y-2 text-sm">
            {suggestionState.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-divider bg-bg-surface px-3 py-2">
                <span>
                  {s.thresholdPct}% threshold — current {s.currentJobs} jobs vs baseline{' '}
                  {Number(s.baselineJobs).toFixed(2)} → suggest {s.suggestedMultiplier}×
                </span>
                <div className="flex gap-2">
                  <Button onClick={() => approve(s.id)} disabled={busyId === s.id}>
                    {busyId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}{' '}
                    Approve
                  </Button>
                  <Button variant="ghost" onClick={() => dismiss(s.id)} disabled={busyId === s.id}>
                    <XCircle className="mr-1 h-3 w-3" /> Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-[14px] border border-divider bg-bg-surface p-4 space-y-3">
        <h2 className="font-semibold">1. Active tiers right now</h2>
        {activeTiers.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No active tiers.</p>
        ) : (
          <ul className="space-y-2">
            {activeTiers.map((t) => {
              const Icon = CATEGORY_ICON[t.category] ?? Star;
              return (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded border border-divider bg-bg-surface-elevated px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-brand-primary" />
                    <span className="font-medium">{t.name}</span>
                    <span className="font-mono text-xs text-text-secondary-on-dark">
                      {t.category}
                    </span>
                    <span className="font-mono text-xs">{t.multiplier}×</span>
                  </div>
                  <Button variant="ghost" onClick={() => deactivate(t.id)} disabled={busyId === t.id}>
                    {busyId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Deactivate'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-4 space-y-2">
        <h2 className="font-semibold">2. Scheduled activations</h2>
        {scheduled.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No scheduled activations.</p>
        ) : (
          <ul className="space-y-1">
            {scheduled.map((t) => (
              <li key={t.id} className="text-sm">
                <span className="font-medium">{t.name}</span> — {t.multiplier}× starts{' '}
                <span className="font-mono text-xs">
                  {t.schedule?.startAt ? new Date(t.schedule.startAt).toLocaleString() : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-4 space-y-2">
        <h2 className="font-semibold">3. Recent tier history (last 24 hours)</h2>
        {history.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No tier activity in the last 24 hours.</p>
        ) : (
          <ul className="space-y-1 max-h-72 overflow-y-auto text-sm">
            {history.slice(0, 30).map((h) => (
              <li key={h.activationId}>
                <span className="font-mono text-xs text-text-secondary-on-dark">{fmtRel(h.activatedAt)}</span>{' '}
                — {h.tierName} ({h.category}) {h.deactivatedAt ? '⇨ deactivated' : '⇨ activated'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-4 space-y-3">
        <h2 className="font-semibold">4. Today&rsquo;s Pulse</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Revenue" value={fmtMoney(pulse.revenueCents)} />
          <Stat label="Standard equivalent" value={fmtMoney(pulse.standardRevenueCents)} />
          <Stat label="Δ delta" value={fmtMoney(pulse.deltaCents)} accent="text-status-success" />
          <Stat label="Uplift" value={`${pulse.upliftPct.toFixed(1)}%`} />
        </div>
        {pulse.byTier.length > 0 ? (
          <div className="space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              By tier
            </p>
            {pulse.byTier.map((t) => (
              <div key={t.tierId} className="flex items-center justify-between text-xs">
                <span>
                  {t.name} ({t.category})
                </span>
                <span className="font-mono">
                  {t.acceptedCount}× → {fmtMoney(t.contributionCents)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">5. Override Report (last 7 days)</h2>
          <a
            href="/dynamic-pricing/reports?type=overrides"
            className="text-xs text-brand-primary underline"
          >
            View Full Report
          </a>
        </div>
        {overrides.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No overrides logged.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {overrides.map((o) => (
              <li key={o.reasonCode} className="flex items-center justify-between">
                <span>{o.reasonCode.replace(/_/g, ' ')}</span>
                <span className="font-mono text-xs">
                  {o.count}× • Δ {fmtMoney(o.totalDeltaCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">6. Tier Performance (this month)</h2>
          <a
            href="/dynamic-pricing/reports?type=tier-performance"
            className="text-xs text-brand-primary underline"
          >
            View Full Report
          </a>
        </div>
        {performance.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No tier revenue this month yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {performance.slice(0, 5).map((p) => (
              <li key={p.tierId} className="flex items-center justify-between">
                <span>
                  {p.tierName} ({p.category})
                </span>
                <span className="font-mono text-xs">
                  {p.acceptedCount}× → {fmtMoney(p.revenueCents)} (avg {p.averageMultiplier.toFixed(2)}×)
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: { label: string; value: string; accent?: string }): JSX.Element {
  return (
    <div className="rounded border border-divider bg-bg-surface-elevated px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">{label}</p>
      <p className={`text-lg font-semibold ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
