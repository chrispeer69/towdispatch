'use client';

import { paymentMethodValues, type InvoiceWithDetailsDto } from '@towcommand/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  invoice: InvoiceWithDetailsDto;
}

/**
 * Action buttons for an invoice — Issue / Send / Void / Record payment / PDF.
 * Each action posts to the BFF and then refreshes the page so the server-rendered
 * detail re-fetches with the new state.
 */
export function InvoiceActionsClient({ invoice }: Props): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDraft = invoice.status === 'draft';
  const isVoid = invoice.status === 'void';
  const isPaid = invoice.status === 'paid';

  async function call(method: 'POST', path: string, body?: unknown): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {isDraft ? (
          <button
            type="button"
            onClick={() => call('POST', `invoices/${invoice.id}/issue`)}
            disabled={busy}
            className="rounded-md bg-orange px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-light disabled:opacity-50"
            data-testid="invoice-issue-btn"
          >
            Issue invoice
          </button>
        ) : null}
        {!isDraft && !isVoid && !isPaid ? (
          <button
            type="button"
            onClick={() => setShowPay((v) => !v)}
            className="rounded-md bg-steel-light px-4 py-1.5 text-sm hover:bg-steel-border"
            data-testid="invoice-record-payment-btn"
          >
            Record payment
          </button>
        ) : null}
        {!isDraft ? (
          <a
            href={`/api/billing/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-steel-light px-4 py-1.5 text-sm hover:bg-steel-border"
            data-testid="invoice-pdf-link"
          >
            PDF
          </a>
        ) : null}
        {!isVoid ? (
          <button
            type="button"
            onClick={() => {
              const reason = window.prompt('Reason for voiding?');
              if (reason && reason.trim()) {
                void call('POST', `invoices/${invoice.id}/void`, { reason });
              }
            }}
            disabled={busy}
            className="rounded-md border border-red-700 px-4 py-1.5 text-sm text-red-400 hover:bg-red-700/10 disabled:opacity-50"
          >
            Void
          </button>
        ) : null}
      </div>
      {showPay ? (
        <PaymentForm
          invoiceId={invoice.id}
          balanceCents={invoice.balanceCents}
          onSubmit={async (payload) => {
            await call('POST', 'payments', payload);
            setShowPay(false);
          }}
          busy={busy}
        />
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}

function PaymentForm({
  invoiceId,
  balanceCents,
  onSubmit,
  busy,
}: {
  invoiceId: string;
  balanceCents: number;
  onSubmit: (payload: {
    invoiceId: string;
    amountCents: number;
    paymentMethod: string;
    referenceNumber: string | null;
  }) => Promise<void>;
  busy: boolean;
}): JSX.Element {
  const [amount, setAmount] = useState(((balanceCents > 0 ? balanceCents : 0) / 100).toFixed(2));
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  return (
    <form
      className="rounded-md border border-steel-border bg-steel-mid/40 p-3"
      data-testid="payment-form"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = Math.round(Number.parseFloat(amount) * 100);
        if (!Number.isFinite(cents) || cents === 0) return;
        void onSubmit({
          invoiceId,
          amountCents: cents,
          paymentMethod: method,
          referenceNumber: ref || null,
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
          Amount
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
            data-testid="payment-amount-input"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
            data-testid="payment-method-select"
          >
            {paymentMethodValues.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
          Reference
          <input
            type="text"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="check #, ACH ref…"
            className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-light disabled:opacity-50"
          data-testid="payment-submit-btn"
        >
          Record
        </button>
      </div>
    </form>
  );
}
