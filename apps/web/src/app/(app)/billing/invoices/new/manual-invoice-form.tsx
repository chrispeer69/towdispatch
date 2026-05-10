'use client';

import { invoiceTermsValues, type InvoiceWithDetailsDto } from '@towcommand/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
      router.push(`/billing/invoices/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-steel-border bg-steel-mid/40 p-4"
      onSubmit={submit}
      data-testid="manual-invoice-form"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
          Bill-to name
          <input
            type="text"
            value={billingName}
            onChange={(e) => setBillingName(e.target.value)}
            className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
            data-testid="bill-to-name"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
          Bill-to email
          <input
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
          Terms
          <select
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
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
        <h2 className="text-xs uppercase tracking-wider text-text-muted">Line items</h2>
        <div className="mt-2 space-y-2">
          {lines.map((l, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: row order is stable for the duration of the form
            <div key={idx} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <input
                type="text"
                value={l.description}
                onChange={(e) => update(idx, { description: e.target.value })}
                placeholder="Description"
                className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
                data-testid={`line-desc-${idx}`}
              />
              <input
                type="text"
                value={l.quantity}
                onChange={(e) => update(idx, { quantity: e.target.value })}
                placeholder="Qty"
                className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
                data-testid={`line-qty-${idx}`}
              />
              <input
                type="text"
                value={l.unit}
                onChange={(e) => update(idx, { unit: e.target.value })}
                placeholder="unit"
                className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                value={l.unitPriceDollars}
                onChange={(e) => update(idx, { unitPriceDollars: e.target.value })}
                placeholder="0.00"
                className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
                data-testid={`line-price-${idx}`}
              />
              <button
                type="button"
                onClick={() => removeLine(idx)}
                className="rounded-md border border-steel-border px-2 py-1.5 text-xs text-text-secondary"
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
          className="mt-2 rounded-md bg-steel-light px-2 py-1 text-xs hover:bg-steel-border"
        >
          + Add line
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-orange px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-light disabled:opacity-50"
          data-testid="manual-invoice-submit"
        >
          Create draft
        </button>
        {error ? <span className="text-sm text-red-400">{error}</span> : null}
      </div>
    </form>
  );
}
