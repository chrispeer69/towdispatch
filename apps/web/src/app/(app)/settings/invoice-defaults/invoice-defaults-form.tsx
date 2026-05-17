'use client';

/**
 * Tenant-wide invoice defaults form. Six fields persisted on
 * tenants.settings.invoiceDefaults (jsonb):
 *
 *   defaultDelinquencyDays           int     default 30
 *   cashCustomerDelinquencyDays      int     default 7
 *   defaultInvoiceTerms              enum    default net_30
 *   invoiceNumberPrefix              text    default "INV-"
 *   invoiceFooterText                text    default ""
 *   paymentInstructionsText          text    default ""
 *
 * Owners/admins can save; lower roles see the form fields but the
 * save button is disabled. Per-account thresholds (Contract Terms tab)
 * override the tenant default per account.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientUpdateInvoiceDefaults } from '@/lib/api/ar';
import {
  type TenantInvoiceDefaults,
  type UpdateTenantInvoiceDefaultsPayload,
  invoiceTermsValues,
} from '@ustowdispatch/shared';
import { type JSX, useState } from 'react';
import { toast } from 'sonner';

const TERMS_LABELS: Record<(typeof invoiceTermsValues)[number], string> = {
  due_on_receipt: 'Due on receipt',
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_45: 'Net 45',
  net_60: 'Net 60',
  cod: 'COD',
  prepay: 'Prepay',
};

export function InvoiceDefaultsForm({
  initial,
  errorMessage,
}: {
  initial: TenantInvoiceDefaults;
  errorMessage: string | null;
}): JSX.Element {
  const [draft, setDraft] = useState(initial);
  const [original, setOriginal] = useState(initial);
  const [saving, setSaving] = useState(false);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(original);

  const set = <K extends keyof TenantInvoiceDefaults>(k: K, v: TenantInvoiceDefaults[K]): void => {
    setDraft((prev) => ({ ...prev, [k]: v }));
  };

  const onSave = async (): Promise<void> => {
    if (!isDirty) return;
    if (draft.defaultDelinquencyDays <= 0 || draft.cashCustomerDelinquencyDays <= 0) {
      toast.error('Delinquency days must be positive integers.');
      return;
    }
    setSaving(true);
    try {
      const payload: UpdateTenantInvoiceDefaultsPayload = {
        defaultDelinquencyDays: draft.defaultDelinquencyDays,
        cashCustomerDelinquencyDays: draft.cashCustomerDelinquencyDays,
        defaultInvoiceTerms: draft.defaultInvoiceTerms,
        invoiceNumberPrefix: draft.invoiceNumberPrefix,
        invoiceFooterText: draft.invoiceFooterText,
        paymentInstructionsText: draft.paymentInstructionsText,
      };
      const updated = await clientUpdateInvoiceDefaults(payload);
      setOriginal(updated);
      setDraft(updated);
      toast.success('Invoice defaults saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-5"
      data-testid="invoice-defaults-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      {errorMessage ? (
        <div className="rounded-[10px] border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          {errorMessage}
        </div>
      ) : null}

      <fieldset className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
        <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
          Delinquency
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Default days until past due"
            help="Applies to accounts without their own threshold. Industry typical: 30."
          >
            <Input
              type="number"
              min={1}
              value={String(draft.defaultDelinquencyDays)}
              onChange={(e) => set('defaultDelinquencyDays', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Cash customer days until past due"
            help="Applies when the invoice has no account (walk-up / cash). Industry typical: 7."
          >
            <Input
              type="number"
              min={1}
              value={String(draft.cashCustomerDelinquencyDays)}
              onChange={(e) => set('cashCustomerDelinquencyDays', Number(e.target.value))}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
        <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
          Invoice generation
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Default invoice terms">
            <select
              value={draft.defaultInvoiceTerms}
              onChange={(e) =>
                set(
                  'defaultInvoiceTerms',
                  e.target.value as TenantInvoiceDefaults['defaultInvoiceTerms'],
                )
              }
              className="w-full rounded-[8px] border border-divider bg-bg-base px-2 py-2 text-sm"
            >
              {invoiceTermsValues.map((v) => (
                <option key={v} value={v}>
                  {TERMS_LABELS[v]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Invoice number prefix"
            help="Prepended to the per-tenant sequence. Default: INV-"
          >
            <Input
              value={draft.invoiceNumberPrefix}
              onChange={(e) => set('invoiceNumberPrefix', e.target.value)}
              maxLength={20}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
        <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
          Document text
        </legend>
        <Field
          label="Invoice footer text"
          help="Rendered on every invoice PDF + emailed invoice body."
        >
          <textarea
            rows={3}
            value={draft.invoiceFooterText}
            onChange={(e) => set('invoiceFooterText', e.target.value)}
            className="w-full rounded-[8px] border border-divider bg-bg-base px-2 py-2 text-sm"
            maxLength={4000}
          />
        </Field>
        <Field
          label="Payment instructions text"
          help="Rendered on the invoice PDF + the customer-facing email."
        >
          <textarea
            rows={4}
            value={draft.paymentInstructionsText}
            onChange={(e) => set('paymentInstructionsText', e.target.value)}
            className="w-full rounded-[8px] border border-divider bg-bg-base px-2 py-2 text-sm"
            maxLength={4000}
            placeholder="e.g. Mail checks to: PO Box 123, Anytown USA. Or pay online at the link provided."
          />
        </Field>
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

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
        {label}
      </span>
      {children}
      {help ? <p className="text-[11px] text-text-secondary-on-dark">{help}</p> : null}
    </div>
  );
}
