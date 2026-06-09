'use client';

import { type InvoiceWithDetailsDto, invoiceTermsValues } from '@towdispatch/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface DraftLine {
  description: string;
  quantity: string;
  unit: string;
  unitPriceDollars: string;
}

export function ManualInvoiceFormClient(): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingName, setBillingName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [terms, setTerms] = useState<string>('net_30');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { description: 'Service', quantity: '1', unit: 'each', unitPriceDollars: '0.00' },
  ]);

  function update(idx: number, patch: Partial<DraftLine>): void {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine(): void {
    setLines((prev) => [
      ...prev,
      { description: '', quantity: '1', unit: 'each', unitPriceDollars: '0.00' },
    ]);
  }
  function removeLine(idx: number): void {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        invoiceType: 'manual' as const,
        terms,
        notes: notes || null,
        billingAddress:
          billingName || billingEmail
            ? {
                name: billingName || null,
                email: billingEmail || null,
              }
            : null,
        lineItems: lines.map((l) => ({
          lineType: 'custom',
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceCents: Math.round(Number.parseFloat(l.unitPriceDollars || '0') * 100),
          taxable: false,
          taxRatePct: 0,
        })),
      };
      const res = await fetch('/api/billing/invoices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Create failed: ${res.status} ${await res.text()}`);
      }
      const created = (await res.json()) as InvoiceWithDetailsDto;
      toast.success('Invoice draft created');
      router.push(`/billing/invoices/${created.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-divider bg-bg-surface/40 p-4"
      onSubmit={submit}
      data-testid="manual-invoice-form"
      aria-busy={busy}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
          Bill-to name
          <input
            type="text"
            value={billingName}
            onChange={(e) => setBillingName(e.target.value)}
            className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
            data-testid="bill-to-name"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
          Bill-to email
          <input
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
          Terms
          <select
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
          >
            {invoiceTermsValues.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
          Line items
        </h2>
        <div className="mt-2 space-y-2">
          {lines.map((l, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: row order is stable for the duration of the form
            <div key={idx} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <input
                type="text"
                value={l.description}
                onChange={(e) => update(idx, { description: e.target.value })}
                placeholder="Description"
                aria-label={`Line ${idx + 1} description`}
                className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
                data-testid={`line-desc-${idx}`}
              />
              <input
                type="text"
                value={l.quantity}
                onChange={(e) => update(idx, { quantity: e.target.value })}
                placeholder="Qty"
                aria-label={`Line ${idx + 1} quantity`}
                className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
                data-testid={`line-qty-${idx}`}
              />
              <input
                type="text"
                value={l.unit}
                onChange={(e) => update(idx, { unit: e.target.value })}
                placeholder="unit"
                aria-label={`Line ${idx + 1} unit`}
                className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                value={l.unitPriceDollars}
                onChange={(e) => update(idx, { unitPriceDollars: e.target.value })}
                placeholder="0.00"
                aria-label={`Line ${idx + 1} unit price (dollars)`}
                className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
                data-testid={`line-price-${idx}`}
              />
              <button
                type="button"
                onClick={() => removeLine(idx)}
                aria-label={`Remove line ${idx + 1}`}
                className="rounded-md border border-divider px-2 py-1.5 text-xs text-text-secondary-on-dark"
                disabled={lines.length === 1}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-2 rounded-md bg-bg-surface-elevated px-2 py-1 text-xs hover:bg-divider"
        >
          + Add line
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-primary-hover disabled:opacity-50"
          data-testid="manual-invoice-submit"
        >
          Create draft
        </button>
        {error ? (
          <span role="alert" aria-live="assertive" className="text-sm text-red-400">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
