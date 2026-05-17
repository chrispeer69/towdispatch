'use client';

/**
 * Contract Terms tab — payment terms, intake flags, GOA policy, SLA.
 *
 * Fetches the account's current values on mount (these live on the
 * accounts row, not in a child table). Save PATCHes only the changed
 * fields.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ACCOUNT_PAYMENT_TERMS_LABELS,
  type AccountContractTermsDto,
  type AccountDto,
  type AccountPaymentTermValue,
  accountPaymentTermsValues,
} from '@ustowdispatch/shared';
import { type JSX, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  accountId: string;
}

type Draft = {
  paymentTerms: AccountPaymentTermValue;
  requiresPhotoBeforeBilling: boolean;
  requiresAuthorizationCode: boolean;
  goaPolicy: string;
  slaArrivalMinutes: string;
  afterHoursBillingAllowed: boolean;
  delinquencyDaysThreshold: string;
};

function accountToDraft(a: AccountDto | AccountContractTermsDto): Draft {
  return {
    paymentTerms: a.paymentTerms,
    requiresPhotoBeforeBilling: a.requiresPhotoBeforeBilling,
    requiresAuthorizationCode: a.requiresAuthorizationCode,
    goaPolicy: a.goaPolicy ?? '',
    slaArrivalMinutes: a.slaArrivalMinutes != null ? String(a.slaArrivalMinutes) : '',
    afterHoursBillingAllowed: a.afterHoursBillingAllowed,
    delinquencyDaysThreshold:
      a.delinquencyDaysThreshold != null ? String(a.delinquencyDaysThreshold) : '',
  };
}

export function ContractTermsTab({ accountId }: Props): JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async (): Promise<void> => {
      try {
        const res = await fetch(`/api/accounts/${accountId}`, { cache: 'no-store' });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `Failed to load (${res.status})`);
        }
        const a = (await res.json()) as AccountDto;
        if (cancelled) return;
        const d = accountToDraft(a);
        setDraft(d);
        setOriginal(d);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load contract terms');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [accountId]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  const isDirty = !!draft && !!original && JSON.stringify(draft) !== JSON.stringify(original);

  async function handleSave(): Promise<void> {
    if (!draft || !isDirty || saving) return;
    const slaMinutes = draft.slaArrivalMinutes.trim();
    const slaParsed = slaMinutes === '' ? null : Number.parseInt(slaMinutes, 10);
    if (slaParsed != null && (!Number.isInteger(slaParsed) || slaParsed <= 0)) {
      toast.error('SLA arrival minutes must be a positive integer or blank.');
      return;
    }
    const delinquencyTrim = draft.delinquencyDaysThreshold.trim();
    const delinquencyParsed = delinquencyTrim === '' ? null : Number.parseInt(delinquencyTrim, 10);
    if (
      delinquencyParsed != null &&
      (!Number.isInteger(delinquencyParsed) || delinquencyParsed <= 0)
    ) {
      toast.error('Days until past due must be a positive integer or blank.');
      return;
    }

    const payload: Record<string, unknown> = {
      paymentTerms: draft.paymentTerms,
      requiresPhotoBeforeBilling: draft.requiresPhotoBeforeBilling,
      requiresAuthorizationCode: draft.requiresAuthorizationCode,
      goaPolicy: draft.goaPolicy.trim() === '' ? null : draft.goaPolicy.trim(),
      slaArrivalMinutes: slaParsed,
      afterHoursBillingAllowed: draft.afterHoursBillingAllowed,
      delinquencyDaysThreshold: delinquencyParsed,
    };

    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/contract-terms`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? `Save failed (${res.status})`);
        return;
      }
      setOriginal(draft);
      toast.success('Contract terms saved');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-[14px] border border-divider bg-bg-surface p-6 text-center text-sm text-text-secondary-on-dark">
        Loading…
      </div>
    );
  }
  if (loadError || !draft) {
    return (
      <div className="rounded-[14px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
        {loadError ?? 'Could not load contract terms'}
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      data-testid="account-contract-terms-tab"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/40 px-4 py-3 text-xs text-text-secondary-on-dark">
        These terms apply at intake and invoice time. The system will prompt dispatchers based on
        these flags.
      </div>

      <fieldset className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="contract-payment-terms"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark"
            >
              Payment terms
            </label>
            <select
              id="contract-payment-terms"
              className="w-full rounded-[8px] border border-divider bg-bg-base px-2 py-2 text-sm"
              value={draft.paymentTerms}
              onChange={(e) => update('paymentTerms', e.target.value as AccountPaymentTermValue)}
            >
              {accountPaymentTermsValues.map((v) => (
                <option key={v} value={v}>
                  {ACCOUNT_PAYMENT_TERMS_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="contract-sla-minutes"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark"
            >
              SLA arrival (minutes)
            </label>
            <Input
              id="contract-sla-minutes"
              type="number"
              min={1}
              placeholder="e.g. 45"
              value={draft.slaArrivalMinutes}
              onChange={(e) => update('slaArrivalMinutes', e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="contract-delinquency-days"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark"
          >
            Days until past due
          </label>
          <Input
            id="contract-delinquency-days"
            type="number"
            min={1}
            placeholder="Inherit tenant default (30)"
            value={draft.delinquencyDaysThreshold}
            onChange={(e) => update('delinquencyDaysThreshold', e.target.value)}
          />
          <p className="text-[11px] text-text-secondary-on-dark">
            How many days after the invoice posted date before this account&apos;s invoices are
            flagged as past due. Industry typical: Agero 7, AAA 15, Allstate 14, Honk 10. Leave
            blank to inherit the tenant default.
          </p>
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="contract-goa-policy"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark"
          >
            GOA policy
          </label>
          <textarea
            id="contract-goa-policy"
            rows={3}
            placeholder="e.g. GOA billed at 50% of base after 15 min wait, photo required."
            className="w-full rounded-[8px] border border-divider bg-bg-base px-2 py-2 text-sm"
            value={draft.goaPolicy}
            onChange={(e) => update('goaPolicy', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Toggle
            label="Requires photo before billing"
            checked={draft.requiresPhotoBeforeBilling}
            onChange={(v) => update('requiresPhotoBeforeBilling', v)}
          />
          <Toggle
            label="Requires authorization code"
            checked={draft.requiresAuthorizationCode}
            onChange={(v) => update('requiresAuthorizationCode', v)}
          />
          <Toggle
            label="After-hours billing allowed"
            checked={draft.afterHoursBillingAllowed}
            onChange={(v) => update('afterHoursBillingAllowed', v)}
          />
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        {isDirty ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
            Unsaved changes
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          disabled={saving || !isDirty}
          onClick={() => setDraft(original)}
        >
          Discard
        </Button>
        <Button type="submit" disabled={saving || !isDirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 hover:bg-bg-surface-elevated/40">
      <span className="text-sm text-text-primary-on-dark">{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
