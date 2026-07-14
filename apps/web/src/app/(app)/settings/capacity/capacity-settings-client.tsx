'use client';

/**
 * /settings/capacity — CADS admin client.
 *
 * Four sections against /capacity/* CRUD:
 *   - Band thresholds + broadcast tuning (PATCH /capacity/settings)
 *   - Job weights (PATCH /capacity/settings, jobWeights only)
 *   - Partner registry: create (credentials revealed ONCE), enable/disable,
 *     rotate secret / API key (revealed once), test-fire, delete.
 *   - Active manual overrides: clear + force-status dialog (shared with
 *     the dispatch-board widget).
 *
 * Credentials returned at creation/rotation are shown once in a reveal
 * modal with copy buttons; they are never re-fetchable. Modals use the
 * native <dialog> element (via CapacityModal) so the browser supplies
 * focus trap, Escape, and the backdrop scrim — same as /settings/api.
 */
import {
  BAND_LABEL,
  BandPill,
  CLASS_LABEL,
  CapacityModal,
  SetOverrideDialog,
  capacitySelectCls,
  timeAgo,
  timeUntil,
} from '@/components/capacity/capacity-shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  clientClearCapacityOverride,
  clientCreateCapacityPartner,
  clientDeleteCapacityPartner,
  clientListCapacityOverrides,
  clientRotateCapacityPartnerKey,
  clientRotateCapacityPartnerSecret,
  clientTestFireCapacityPartner,
  clientUpdateCapacityPartner,
  clientUpdateCapacitySettings,
} from '@/lib/api/capacity-client';
import { cn } from '@/lib/utils';
import {
  CAPACITY_DELIVERY_MODES,
  CAPACITY_DUTY_CLASSES,
  CAPACITY_NETWORK_CODES,
  type CapacityDeliveryMode,
  type CapacityDutyClass,
  type CapacityNetworkCode,
  type CapacityOverrideDto,
  type CapacityPartnerCredentials,
  type CapacityPartnerDto,
  type CapacitySettingsDto,
  type CreateCapacityPartnerPayload,
  type UpdateCapacitySettingsPayload,
  assertBandsOrdered,
} from '@ustowdispatch/shared';
import {
  AlertTriangle,
  Check,
  Copy,
  Gauge,
  KeyRound,
  Radio,
  Scale,
  ScrollText,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, type JSX, type ReactNode, useState } from 'react';
import { toast } from 'sonner';

// TODO(i18n): CADS settings strings are English-only today, matching the
// rest of /settings; add es parity when the surface migrates to next-intl.

const NETWORK_LABEL: Record<CapacityNetworkCode, string> = {
  agero: 'Agero',
  nsd: 'NSD',
  geico: 'GEICO',
  aaa: 'AAA',
  urgently: 'Urgently',
  generic: 'Generic',
};

/** Job statuses the weights table exposes; anything else weighs 0. */
const WEIGHTED_STATUSES = ['dispatched', 'enroute', 'on_scene', 'in_progress'] as const;

const WEIGHTED_STATUS_LABEL: Record<(typeof WEIGHTED_STATUSES)[number], string> = {
  dispatched: 'Dispatched',
  enroute: 'Enroute',
  on_scene: 'On scene',
  in_progress: 'In tow',
};

interface Props {
  initialSettings: CapacitySettingsDto;
  initialPartners: CapacityPartnerDto[];
  initialOverrides: CapacityOverrideDto[];
}

export function CapacitySettingsClient({
  initialSettings,
  initialPartners,
  initialOverrides,
}: Props): JSX.Element {
  const [partners, setPartners] = useState<CapacityPartnerDto[]>(initialPartners);
  const [overrides, setOverrides] = useState<CapacityOverrideDto[]>(initialOverrides);
  const [addPartnerOpen, setAddPartnerOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [credentials, setCredentials] = useState<CapacityPartnerCredentials | null>(null);

  async function refreshOverrides(): Promise<void> {
    try {
      setOverrides(await clientListCapacityOverrides(false));
    } catch {
      /* keep the current list */
    }
  }

  return (
    <div className="space-y-10">
      <ThresholdsSection initialSettings={initialSettings} />
      <JobWeightsSection initialSettings={initialSettings} />
      <PartnersSection
        partners={partners}
        onCreate={() => setAddPartnerOpen(true)}
        onUpdated={(p) => setPartners((prev) => prev.map((x) => (x.id === p.id ? p : x)))}
        onDeleted={(id) => setPartners((prev) => prev.filter((x) => x.id !== id))}
        onCredentials={setCredentials}
      />
      <OverridesSection
        overrides={overrides}
        onForce={() => setOverrideOpen(true)}
        onCleared={(id) => setOverrides((prev) => prev.filter((o) => o.id !== id))}
      />

      <section className="rounded-[14px] border border-divider bg-bg-surface/40 px-4 py-3">
        <Link
          href="/settings/capacity/broadcasts"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-primary hover:underline"
        >
          <ScrollText className="h-4 w-4" aria-hidden />
          View the broadcast log — every delivery attempt, receipt, and error
        </Link>
      </section>

      {addPartnerOpen ? (
        <AddPartnerModal
          onClose={() => setAddPartnerOpen(false)}
          onCreated={(creds) => {
            setPartners((prev) => [creds.partner, ...prev]);
            setCredentials(creds);
          }}
        />
      ) : null}

      {overrideOpen ? (
        <SetOverrideDialog
          onClose={() => setOverrideOpen(false)}
          onCreated={() => void refreshOverrides()}
        />
      ) : null}

      {credentials ? (
        <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />
      ) : null}
    </div>
  );
}

// ======================================================================
// Thresholds & broadcast tuning
// ======================================================================

function ThresholdsSection({
  initialSettings,
}: {
  initialSettings: CapacitySettingsDto;
}): JSX.Element {
  const [available, setAvailable] = useState(String(initialSettings.availableMaxRatio));
  const [limited, setLimited] = useState(String(initialSettings.limitedMaxRatio));
  const [constrained, setConstrained] = useState(String(initialSettings.constrainedMaxRatio));
  const [hysteresisBuffer, setHysteresisBuffer] = useState(
    String(initialSettings.hysteresisBuffer),
  );
  const [dwellSeconds, setDwellSeconds] = useState(String(initialSettings.hysteresisDwellSeconds));
  const [minInterval, setMinInterval] = useState(
    String(initialSettings.minBroadcastIntervalSeconds),
  );
  const [guidelineMinutes, setGuidelineMinutes] = useState(
    String(initialSettings.guidelineMinutes),
  );
  const [overrideExpiry, setOverrideExpiry] = useState(
    String(initialSettings.overrideDefaultExpiryMinutes),
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    const thresholds = {
      availableMaxRatio: Number(available),
      limitedMaxRatio: Number(limited),
      constrainedMaxRatio: Number(constrained),
    };
    const rest = {
      hysteresisBuffer: Number(hysteresisBuffer),
      hysteresisDwellSeconds: Number(dwellSeconds),
      minBroadcastIntervalSeconds: Number(minInterval),
      guidelineMinutes: Number(guidelineMinutes),
      overrideDefaultExpiryMinutes: Number(overrideExpiry),
    };
    if (
      Object.values(thresholds).some((v) => Number.isNaN(v)) ||
      Object.values(rest).some((v) => Number.isNaN(v))
    ) {
      setErrorMessage('All fields must be numbers.');
      return;
    }
    if (!assertBandsOrdered(thresholds)) {
      setErrorMessage('Thresholds must be strictly increasing: available < limited < constrained.');
      return;
    }
    setSaving(true);
    try {
      const payload: UpdateCapacitySettingsPayload = { ...thresholds, ...rest };
      await clientUpdateCapacitySettings(payload);
      toast.success('Capacity thresholds saved.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary-on-dark">
        <Gauge className="h-5 w-5 text-brand-primary" /> Band thresholds & broadcast tuning
      </h2>
      <p className="max-w-prose text-sm text-text-secondary-on-dark">
        The load ratio is weighted active jobs ÷ eligible signed-in drivers, computed per duty
        class. Each threshold is the highest ratio that still qualifies for its band; anything above
        the constrained maximum reads as at capacity.
      </p>
      <div className="flex flex-wrap gap-2" aria-hidden>
        <BandPill band="available_now" />
        <BandPill band="limited" />
        <BandPill band="constrained" />
        <BandPill band="at_capacity" />
        <BandPill band="offline" />
      </div>
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-[14px] border border-divider bg-bg-surface/40 p-4"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <NumberField
            id="cap-available"
            label={`${BAND_LABEL.available_now} — max ratio`}
            value={available}
            onChange={setAvailable}
            step="0.05"
            min="0.05"
          />
          <NumberField
            id="cap-limited"
            label={`${BAND_LABEL.limited} — max ratio`}
            value={limited}
            onChange={setLimited}
            step="0.05"
            min="0.05"
          />
          <NumberField
            id="cap-constrained"
            label={`${BAND_LABEL.constrained} — max ratio`}
            value={constrained}
            onChange={setConstrained}
            step="0.05"
            min="0.05"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <NumberField
            id="cap-hysteresis"
            label="Hysteresis buffer (ratio)"
            value={hysteresisBuffer}
            onChange={setHysteresisBuffer}
            step="0.01"
            min="0"
            max="1"
            hint="Ratio must clear the boundary by this much before the band flips."
          />
          <NumberField
            id="cap-dwell"
            label="Hysteresis dwell (seconds)"
            value={dwellSeconds}
            onChange={setDwellSeconds}
            step="1"
            min="0"
            max="3600"
            hint="New band must hold this long before it broadcasts."
          />
          <NumberField
            id="cap-interval"
            label="Min broadcast interval (seconds)"
            value={minInterval}
            onChange={setMinInterval}
            step="1"
            min="0"
            max="3600"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <NumberField
            id="cap-guideline"
            label="ETA guideline (minutes)"
            value={guidelineMinutes}
            onChange={setGuidelineMinutes}
            step="5"
            min="5"
            max="720"
            hint="Advisory ETA sent with the signal — never a promise."
          />
          <NumberField
            id="cap-override-expiry"
            label="Override default expiry (minutes)"
            value={overrideExpiry}
            onChange={setOverrideExpiry}
            step="15"
            min="15"
            max="1440"
          />
        </div>
        {errorMessage ? <ErrorNote>{errorMessage}</ErrorNote> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save thresholds'}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ======================================================================
// Job weights
// ======================================================================

function JobWeightsSection({
  initialSettings,
}: {
  initialSettings: CapacitySettingsDto;
}): JSX.Element {
  const [weights, setWeights] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const s of WEIGHTED_STATUSES) {
      seed[s] = String(initialSettings.jobWeights[s] ?? 0);
    }
    return seed;
  });
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    const jobWeights: Record<string, number> = {};
    for (const s of WEIGHTED_STATUSES) {
      const v = Number(weights[s]);
      if (Number.isNaN(v) || v < 0 || v > 10) {
        setErrorMessage(`Weight for "${WEIGHTED_STATUS_LABEL[s]}" must be between 0 and 10.`);
        return;
      }
      jobWeights[s] = v;
    }
    setSaving(true);
    try {
      await clientUpdateCapacitySettings({ jobWeights });
      toast.success('Job weights saved.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary-on-dark">
        <Scale className="h-5 w-5 text-brand-primary" /> Job weights
      </h2>
      <p className="max-w-prose text-sm text-text-secondary-on-dark">
        How much each active job status counts toward the load ratio. Statuses not listed count 0.
      </p>
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-[14px] border border-divider bg-bg-surface/40 p-4"
      >
        <div className="overflow-hidden rounded-[10px] border border-divider">
          <table className="w-full divide-y divide-divider text-sm">
            <thead className="bg-bg-surface/60 text-left">
              <tr>
                <Th>Job status</Th>
                <Th>Weight</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {WEIGHTED_STATUSES.map((s) => (
                <tr key={s} className="hover:bg-bg-surface-elevated/30">
                  <td className="px-4 py-2 align-middle">
                    <label
                      htmlFor={`weight-${s}`}
                      className="font-medium text-text-primary-on-dark"
                    >
                      {WEIGHTED_STATUS_LABEL[s]}
                    </label>
                    <code className="ml-2 font-mono text-[10px] text-text-secondary-on-dark">
                      {s}
                    </code>
                  </td>
                  <td className="px-4 py-2 align-middle">
                    <Input
                      id={`weight-${s}`}
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      max="10"
                      value={weights[s] ?? '0'}
                      onChange={(e) => setWeights((prev) => ({ ...prev, [s]: e.target.value }))}
                      className="h-9 w-28"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {errorMessage ? <ErrorNote>{errorMessage}</ErrorNote> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save weights'}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ======================================================================
// Partners
// ======================================================================

function PartnersSection({
  partners,
  onCreate,
  onUpdated,
  onDeleted,
  onCredentials,
}: {
  partners: CapacityPartnerDto[];
  onCreate: () => void;
  onUpdated: (p: CapacityPartnerDto) => void;
  onDeleted: (id: string) => void;
  onCredentials: (c: CapacityPartnerCredentials) => void;
}): JSX.Element {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary-on-dark">
          <Radio className="h-5 w-5 text-brand-primary" /> Signal partners
        </h2>
        <Button type="button" onClick={onCreate}>
          Add partner
        </Button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-divider">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <Th>Name</Th>
              <Th>Network</Th>
              <Th>Delivery</Th>
              <Th>Classes</Th>
              <Th>Status</Th>
              <Th>Last broadcast</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {partners.map((p) => (
              <PartnerRow
                key={p.id}
                partner={p}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
                onCredentials={onCredentials}
              />
            ))}
            {partners.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-secondary-on-dark">
                  No partners yet. Add one to start broadcasting your capacity signal.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PartnerRow({
  partner,
  onUpdated,
  onDeleted,
  onCredentials,
}: {
  partner: CapacityPartnerDto;
  onUpdated: (p: CapacityPartnerDto) => void;
  onDeleted: (id: string) => void;
  onCredentials: (c: CapacityPartnerCredentials) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);

  async function toggleEnabled(): Promise<void> {
    setBusy(true);
    try {
      const updated = await clientUpdateCapacityPartner(partner.id, {
        enabled: !partner.enabled,
      });
      onUpdated(updated);
      toast.success(updated.enabled ? `"${updated.name}" enabled.` : `"${updated.name}" paused.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function rotateSecret(): Promise<void> {
    if (
      !window.confirm(
        `Rotate the webhook secret for "${partner.name}"? Their current secret stops verifying immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const creds = await clientRotateCapacityPartnerSecret(partner.id);
      onUpdated(creds.partner);
      onCredentials(creds);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rotate failed');
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey(): Promise<void> {
    if (
      !window.confirm(
        `Rotate the pull-API key for "${partner.name}"? Their current key stops working immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const creds = await clientRotateCapacityPartnerKey(partner.id);
      onUpdated(creds.partner);
      onCredentials(creds);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rotate failed');
    } finally {
      setBusy(false);
    }
  }

  async function testFire(): Promise<void> {
    setBusy(true);
    try {
      const result = await clientTestFireCapacityPartner(partner.id);
      if (result.delivered) {
        toast.success(
          `Test delivered (HTTP ${result.httpStatus ?? '—'}, ${result.latencyMs ?? '—'} ms).`,
        );
      } else {
        toast.error(
          `Test failed: ${result.error ?? `HTTP ${result.httpStatus ?? '—'}`}${
            result.latencyMs !== null ? ` (${result.latencyMs} ms)` : ''
          }`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Delete partner "${partner.name}"? Broadcasts to them stop immediately.`)) {
      return;
    }
    setBusy(true);
    try {
      await clientDeleteCapacityPartner(partner.id);
      onDeleted(partner.id);
      toast.success(`"${partner.name}" deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="hover:bg-bg-surface-elevated/30">
      <td className="px-4 py-3 align-middle font-medium text-text-primary-on-dark">
        {partner.name}
        {partner.apiKeyPrefix ? (
          <code className="ml-2 font-mono text-[10px] text-text-secondary-on-dark">
            {partner.apiKeyPrefix}…
          </code>
        ) : null}
      </td>
      <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
        {NETWORK_LABEL[partner.networkCode]}
      </td>
      <td className="px-4 py-3 align-middle">
        <span className="rounded bg-bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
          {partner.deliveryMode === 'webhook' ? 'webhook' : 'pull only'}
        </span>
        {partner.webhookUrl ? (
          <div
            className="mt-1 max-w-[180px] truncate font-mono text-[10px] text-text-secondary-on-dark"
            title={partner.webhookUrl}
          >
            {partner.webhookUrl}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-wrap gap-1">
          {partner.classVisibility.map((c) => (
            <code
              key={c}
              className="rounded bg-bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-secondary-on-dark"
            >
              {c}
            </code>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 align-middle">
        {partner.enabled ? (
          <StatusPill tone="success">Enabled</StatusPill>
        ) : (
          <StatusPill tone="warning">Paused</StatusPill>
        )}
      </td>
      <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
        {partner.lastBroadcastAt ? timeAgo(partner.lastBroadcastAt) : 'Never'}
      </td>
      <td className="px-4 py-3 align-middle text-right">
        <div className="inline-flex items-center gap-1">
          <IconBtn title="Send test broadcast" onClick={testFire} disabled={busy}>
            <Send className="h-3.5 w-3.5" />
          </IconBtn>
          {partner.deliveryMode === 'webhook' ? (
            <IconBtn title="Rotate webhook secret" onClick={rotateSecret} disabled={busy}>
              <ShieldAlert className="h-3.5 w-3.5" />
            </IconBtn>
          ) : null}
          <IconBtn title="Rotate API key" onClick={rotateKey} disabled={busy}>
            <KeyRound className="h-3.5 w-3.5" />
          </IconBtn>
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={busy}
            className="rounded-md border border-divider px-2 py-1 text-xs font-semibold text-text-secondary-on-dark hover:border-divider-strong disabled:opacity-40"
          >
            {partner.enabled ? 'Pause' : 'Enable'}
          </button>
          <IconBtn title="Delete" onClick={remove} disabled={busy} danger>
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </td>
    </tr>
  );
}

function AddPartnerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (creds: CapacityPartnerCredentials) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [networkCode, setNetworkCode] = useState<CapacityNetworkCode>('generic');
  const [deliveryMode, setDeliveryMode] = useState<CapacityDeliveryMode>('webhook');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [classes, setClasses] = useState<Set<CapacityDutyClass>>(new Set(CAPACITY_DUTY_CLASSES));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggleClass(c: CapacityDutyClass): void {
    setClasses((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    if (classes.size === 0) {
      setErrorMessage('Pick at least one duty class.');
      return;
    }
    if (deliveryMode === 'webhook' && !webhookUrl.trim()) {
      setErrorMessage('A webhook URL is required for webhook delivery.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreateCapacityPartnerPayload = {
        name: name.trim(),
        networkCode,
        deliveryMode,
        classVisibility: CAPACITY_DUTY_CLASSES.filter((c) => classes.has(c)),
        ...(deliveryMode === 'webhook' ? { webhookUrl: webhookUrl.trim() } : {}),
      };
      const creds = await clientCreateCapacityPartner(payload);
      onCreated(creds);
      toast.success(`Partner "${creds.partner.name}" created.`);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CapacityModal titleId="add-partner-title" title="Add signal partner" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="partner-name">Name</Label>
          <Input
            id="partner-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            placeholder="e.g. Agero — Region 4"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="partner-network">Network</Label>
          <select
            id="partner-network"
            value={networkCode}
            onChange={(e) => setNetworkCode(e.target.value as CapacityNetworkCode)}
            className={capacitySelectCls}
          >
            {CAPACITY_NETWORK_CODES.map((c) => (
              <option key={c} value={c}>
                {NETWORK_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="partner-delivery">Delivery mode</Label>
          <select
            id="partner-delivery"
            value={deliveryMode}
            onChange={(e) => setDeliveryMode(e.target.value as CapacityDeliveryMode)}
            className={capacitySelectCls}
          >
            {CAPACITY_DELIVERY_MODES.map((m) => (
              <option key={m} value={m}>
                {m === 'webhook' ? 'Webhook (we push to them)' : 'Pull only (they poll us)'}
              </option>
            ))}
          </select>
        </div>
        {deliveryMode === 'webhook' ? (
          <div className="space-y-1">
            <Label htmlFor="partner-url">Webhook URL</Label>
            <Input
              id="partner-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              required
              maxLength={2000}
              placeholder="https://partner.example.com/capacity"
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
              Must be https.
            </p>
          </div>
        ) : null}
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-text-primary-on-dark">
            Visible duty classes
          </legend>
          <div className="flex gap-4">
            {CAPACITY_DUTY_CLASSES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-primary"
                  checked={classes.has(c)}
                  onChange={() => toggleClass(c)}
                />
                {CLASS_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>
        {errorMessage ? <ErrorNote>{errorMessage}</ErrorNote> : null}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
          >
            Cancel
          </button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add partner'}
          </Button>
        </div>
      </form>
    </CapacityModal>
  );
}

/**
 * Shown-once credentials reveal. Rendered after partner creation and after
 * either rotate action; whichever of the two secrets is non-null appears
 * with its own copy button.
 */
function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: CapacityPartnerCredentials;
  onClose: () => void;
}): JSX.Element {
  return (
    <CapacityModal
      titleId="partner-credentials-title"
      title={`Credentials for "${credentials.partner.name}"`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-[10px] border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Copy these now — this is the only time they’re shown. They can’t be retrieved later,
            only rotated.
          </span>
        </div>
        {credentials.webhookSecret ? (
          <SecretField label="Webhook signing secret" secret={credentials.webhookSecret} />
        ) : null}
        {credentials.apiKey ? (
          <SecretField label="Pull-API key" secret={credentials.apiKey} />
        ) : null}
        <div className="flex justify-end pt-2">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </CapacityModal>
  );
}

function SecretField({ label, secret }: { label: string; secret: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select and copy manually.');
    }
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all break-all rounded-[10px] border border-divider bg-bg-base px-3 py-2 font-mono text-xs text-text-primary-on-dark">
          {secret}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="inline-flex items-center gap-1 rounded-md border border-divider px-2 py-2 text-xs font-semibold text-text-secondary-on-dark hover:border-divider-strong"
        >
          {copied ? (
            <Check className="h-4 w-4 text-status-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

// ======================================================================
// Overrides
// ======================================================================

function OverridesSection({
  overrides,
  onForce,
  onCleared,
}: {
  overrides: CapacityOverrideDto[];
  onForce: () => void;
  onCleared: (id: string) => void;
}): JSX.Element {
  const [clearingId, setClearingId] = useState<string | null>(null);

  async function clear(o: CapacityOverrideDto): Promise<void> {
    setClearingId(o.id);
    try {
      await clientClearCapacityOverride(o.id);
      onCleared(o.id);
      toast.success('Override cleared — computed signal resumed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setClearingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary-on-dark">
          <ShieldAlert className="h-5 w-5 text-brand-primary" /> Manual overrides
        </h2>
        <Button type="button" onClick={onForce}>
          Force status
        </Button>
      </div>
      <div className="overflow-hidden rounded-[14px] border border-divider">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <Th>Scope</Th>
              <Th>Forced status</Th>
              <Th>Reason</Th>
              <Th>Set by</Th>
              <Th>Expires</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {overrides.map((o) => (
              <tr key={o.id} className="hover:bg-bg-surface-elevated/30">
                <td className="px-4 py-3 align-middle font-medium text-text-primary-on-dark">
                  {CLASS_LABEL[o.dutyClass]}
                </td>
                <td className="px-4 py-3 align-middle">
                  <BandPill band={o.forcedBand} />
                </td>
                <td
                  className="max-w-xs truncate px-4 py-3 align-middle text-text-secondary-on-dark"
                  title={o.reason}
                >
                  {o.reason}
                </td>
                <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
                  {o.createdByName ?? '—'}
                </td>
                <td className="px-4 py-3 align-middle font-mono text-xs text-text-secondary-on-dark">
                  {timeUntil(o.expiresAt)}
                </td>
                <td className="px-4 py-3 align-middle text-right">
                  <button
                    type="button"
                    onClick={() => clear(o)}
                    disabled={clearingId === o.id}
                    className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-semibold text-danger transition-colors hover:border-danger/60 disabled:opacity-40"
                  >
                    {clearingId === o.id ? 'Clearing…' : 'Clear'}
                  </button>
                </td>
              </tr>
            ))}
            {overrides.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-text-secondary-on-dark">
                  No active overrides. The broadcast signal is fully computed.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ======================================================================
// Shared presentational helpers
// ======================================================================

function NumberField({
  id,
  label,
  value,
  onChange,
  step,
  min,
  max,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: string;
  min?: string;
  max?: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min={min}
        max={max}
        required
      />
      {hint ? <p className="text-[11px] text-text-secondary-on-dark">{hint}</p> : null}
    </div>
  );
}

function ErrorNote({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p
      role="alert"
      className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      {children}
    </p>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger';
  children: ReactNode;
}): JSX.Element {
  const toneClass =
    tone === 'success'
      ? 'bg-status-success/15 text-status-success'
      : tone === 'warning'
        ? 'bg-status-warning/15 text-status-warning'
        : 'bg-danger/15 text-danger';
  return (
    <span
      className={cn(
        'rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]',
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border px-2 py-1 transition-colors disabled:opacity-40',
        danger
          ? 'border-danger/30 bg-danger/5 text-danger hover:border-danger/60'
          : 'border-divider text-text-secondary-on-dark hover:border-divider-strong',
      )}
    >
      {children}
    </button>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
}): JSX.Element {
  return (
    <th
      className={cn(
        'px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}
