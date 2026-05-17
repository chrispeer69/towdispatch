'use client';
/**
 * DynamicPricingSettingsClient — five tier-category cards with
 * configure buttons + cap multiplier + demand-surge thresholds + storm
 * surge enable toggle. The configure modals (NOAA mappings, holiday
 * list, curve editor, special-event scheduling) are rendered inline
 * below the cards as collapsible sections.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  clientCreateHoliday,
  clientCreateNoaaMapping,
  clientUpdateHoliday,
  clientUpdateNoaaMapping,
  clientUpdateSettings,
} from '@/lib/api/dynamic-pricing-client';
import { cn } from '@/lib/utils';
import {
  type DynamicPricingHolidayDto,
  type DynamicPricingNoaaMappingDto,
  type DynamicPricingTenantSettings,
  type DynamicPricingTierDto,
} from '@ustowdispatch/shared';
import { Calendar, CloudRain, Loader2, Star, TrafficCone, Watch } from 'lucide-react';
import { type JSX, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  initialTiers: DynamicPricingTierDto[];
  initialMappings: DynamicPricingNoaaMappingDto[];
  initialHolidays: DynamicPricingHolidayDto[];
  initialSettings: DynamicPricingTenantSettings;
}

const CATEGORIES: Array<{
  key: 'weather' | 'traffic' | 'calendar' | 'time_of_day' | 'special_event';
  label: string;
  description: string;
  icon: typeof CloudRain;
}> = [
  {
    key: 'weather',
    label: 'Weather',
    description: 'NOAA alerts auto-activate Weather tiers (operator can edit multipliers).',
    icon: CloudRain,
  },
  {
    key: 'traffic',
    label: 'Traffic',
    description: 'Call-volume proxy: when active jobs exceed threshold, Traffic tier kicks in.',
    icon: TrafficCone,
  },
  {
    key: 'calendar',
    label: 'Calendar',
    description: '14 US federal holidays + custom events. Fires for the whole calendar day.',
    icon: Calendar,
  },
  {
    key: 'time_of_day',
    label: 'Time of Day',
    description: '24-hour or 7×24 multiplier curve. Default: 1.3× overnight (22:00–06:00).',
    icon: Watch,
  },
  {
    key: 'special_event',
    label: 'Special Events',
    description: 'Manual operator activation only — name the event, set the multiplier.',
    icon: Star,
  },
];

export function DynamicPricingSettingsClient({
  initialTiers,
  initialMappings,
  initialHolidays,
  initialSettings,
}: Props): JSX.Element {
  const [settings, setSettings] = useState(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [openCategory, setOpenCategory] = useState<typeof CATEGORIES[number]['key'] | null>(null);

  const tiersByCategory = initialTiers.reduce<Record<string, DynamicPricingTierDto[]>>(
    (acc, t) => {
      const arr = acc[t.category] ?? [];
      arr.push(t);
      acc[t.category] = arr;
      return acc;
    },
    {},
  );

  async function patchSettings(patch: Partial<DynamicPricingTenantSettings>): Promise<void> {
    setSavingSettings(true);
    try {
      const next = await clientUpdateSettings(patch);
      setSettings(next);
      toast.success('Saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((c) => {
          const tiers = tiersByCategory[c.key] ?? [];
          const Icon = c.icon;
          const open = openCategory === c.key;
          const activeCount = tiers.filter((t) => t.isActive && !t.deletedAt).length;
          return (
            <div
              key={c.key}
              className={cn(
                'rounded-[14px] border bg-bg-surface p-4 transition-colors',
                open
                  ? 'border-brand-primary/60 ring-2 ring-brand-primary/30'
                  : 'border-divider hover:border-divider-strong',
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-brand-primary" />
                  <h3 className="font-semibold">{c.label}</h3>
                </div>
                <span className="rounded bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                  {activeCount} active
                </span>
              </div>
              <p className="mt-2 text-xs text-text-secondary-on-dark">{c.description}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={() => setOpenCategory(open ? null : c.key)}
                >
                  {open ? 'Close' : 'Configure'}
                </Button>
              </div>
            </div>
          );
        })}
      </section>

      {openCategory === 'weather' ? (
        <NoaaMappingsEditor initial={initialMappings} />
      ) : null}
      {openCategory === 'calendar' ? <HolidayEditor initial={initialHolidays} /> : null}

      <section className="rounded-[14px] border border-divider bg-bg-surface p-4 space-y-3">
        <h3 className="font-semibold">Cap & Demand Surge Thresholds</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Cap multiplier
            </label>
            <Input
              type="number"
              min={1}
              max={10}
              step={0.1}
              defaultValue={settings.capMultiplier}
              onBlur={(e) => {
                const v = Number(e.currentTarget.value);
                if (Number.isFinite(v) && v > 0) {
                  void patchSettings({ capMultiplier: v });
                }
              }}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Demand surge thresholds (% of baseline) → multipliers
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {settings.demandSurgeThresholds.map((thr, i) => (
                <div key={i} className="flex gap-1 text-xs">
                  <Input
                    type="number"
                    min={101}
                    max={1000}
                    step={1}
                    defaultValue={thr}
                    aria-label={`threshold ${i + 1}`}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    step={0.05}
                    defaultValue={settings.demandSurgeMultipliers[i] ?? 1.3}
                    aria-label={`multiplier ${i + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.motorClubStormSurgeEnabled}
            disabled={savingSettings}
            onChange={(e) => void patchSettings({ motorClubStormSurgeEnabled: e.target.checked })}
            className="h-4 w-4 cursor-pointer accent-brand-primary"
          />
          Enable Storm Surge offers on inbound motor-club dispatches
        </label>
        {savingSettings ? (
          <Loader2 className="h-3 w-3 animate-spin text-text-secondary-on-dark" />
        ) : null}
      </section>
    </div>
  );
}

function NoaaMappingsEditor({
  initial,
}: { initial: DynamicPricingNoaaMappingDto[] }): JSX.Element {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function patchRow(id: string, patch: { multiplier?: number; isEnabled?: boolean }): Promise<void> {
    setBusy(true);
    try {
      const next = await clientUpdateNoaaMapping(id, patch);
      setRows((prev) => prev.map((r) => (r.id === id ? next as DynamicPricingNoaaMappingDto : r)));
      toast.success('Saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-brand-primary/40 bg-bg-surface p-4">
      <h3 className="font-semibold mb-3">NOAA Alert Mappings</h3>
      <div className="space-y-1">
        {rows.map((m) => (
          <div key={m.id} className="grid grid-cols-12 items-center gap-2 text-sm">
            <span className="col-span-7 truncate">{m.noaaAlertType}</span>
            <Input
              className="col-span-2 text-xs"
              type="number"
              min={0.1}
              max={10}
              step={0.05}
              defaultValue={m.multiplier}
              disabled={busy}
              onBlur={(e) => {
                const v = Number(e.currentTarget.value);
                if (Number.isFinite(v) && v > 0 && v !== m.multiplier) {
                  void patchRow(m.id, { multiplier: v });
                }
              }}
            />
            <label className="col-span-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={m.isEnabled}
                disabled={busy}
                onChange={(e) => void patchRow(m.id, { isEnabled: e.target.checked })}
                className="h-4 w-4 cursor-pointer accent-brand-primary"
              />
              Enabled
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}

function HolidayEditor({
  initial,
}: { initial: DynamicPricingHolidayDto[] }): JSX.Element {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function patchRow(id: string, patch: { multiplier?: number; isEnabled?: boolean }): Promise<void> {
    setBusy(true);
    try {
      const next = await clientUpdateHoliday(id, patch);
      setRows((prev) => prev.map((r) => (r.id === id ? next as DynamicPricingHolidayDto : r)));
      toast.success('Saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-brand-primary/40 bg-bg-surface p-4">
      <h3 className="font-semibold mb-3">Holiday Calendar</h3>
      <div className="space-y-1">
        {rows.map((h) => (
          <div key={h.id} className="grid grid-cols-12 items-center gap-2 text-sm">
            <span className="col-span-7 truncate">{h.name}</span>
            <Input
              className="col-span-2 text-xs"
              type="number"
              min={0.1}
              max={10}
              step={0.05}
              defaultValue={h.multiplier}
              disabled={busy}
              onBlur={(e) => {
                const v = Number(e.currentTarget.value);
                if (Number.isFinite(v) && v > 0 && v !== h.multiplier) {
                  void patchRow(h.id, { multiplier: v });
                }
              }}
            />
            <label className="col-span-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={h.isEnabled}
                disabled={busy}
                onChange={(e) => void patchRow(h.id, { isEnabled: e.target.checked })}
                className="h-4 w-4 cursor-pointer accent-brand-primary"
              />
              Enabled
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
