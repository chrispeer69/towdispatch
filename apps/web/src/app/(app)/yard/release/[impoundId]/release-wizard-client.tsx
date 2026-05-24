'use client';
import * as yard from '@/lib/api/yard-client';
import {
  type ReleaseWorkflowDto,
  type ReleaseWorkflowPayerIdType,
  type ReleaseWorkflowPaymentMethod,
  releaseWorkflowPayerIdTypeValues,
  releaseWorkflowPaymentMethodValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { type JSX, useState } from 'react';

const inputCls =
  'bg-bg-base border border-border-on-dark rounded-md px-2 py-1 text-sm focus:outline-none focus:border-accent-orange';

const STEPS = ['ID verification', 'Lienholder (optional)', 'Payment', 'Gate release'] as const;

function stepIndex(wf: ReleaseWorkflowDto | null): number {
  if (!wf) return 0;
  if (wf.status === 'gate_released' || wf.status === 'cancelled') return 4;
  if (wf.paymentAmountCents !== null) return 3;
  if (wf.lienholderAuthRef !== null) return 2;
  if (wf.payerIdLast4 !== null) return 1;
  return 0;
}

export function ReleaseWizardClient({
  impoundId,
  initial,
}: {
  impoundId: string;
  initial: ReleaseWorkflowDto | null;
}): JSX.Element {
  const [wf, setWf] = useState<ReleaseWorkflowDto | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<ReleaseWorkflowDto>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setWf(await fn());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const idx = stepIndex(wf);
  const done = wf?.status === 'gate_released';
  const cancelled = wf?.status === 'cancelled';

  return (
    <section className="max-w-lg space-y-5">
      <header>
        <Link href="/yard/gate-search" className="text-xs text-accent-orange">
          ← Gate search
        </Link>
        <h1 className="text-2xl font-bold">Vehicle Release</h1>
        <p className="text-xs text-text-secondary-on-dark">Impound {impoundId}</p>
      </header>

      <ol className="flex gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`flex-1 rounded-md border px-2 py-1 text-center ${
              i < idx
                ? 'border-success text-success'
                : i === idx && !done && !cancelled
                  ? 'border-accent-orange text-accent-orange'
                  : 'border-border-on-dark text-text-secondary-on-dark'
            }`}
          >
            {s}
          </li>
        ))}
      </ol>

      {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {cancelled && (
        <p className="rounded-md bg-bg-surface-elevated p-4 text-sm">
          This release was cancelled: {wf?.cancelReason}
        </p>
      )}
      {done && (
        <p className="rounded-md bg-success/10 p-4 text-sm text-success">
          Vehicle released through the gate at{' '}
          {wf?.gateReleasedAt ? new Date(wf.gateReleasedAt).toLocaleString() : ''}.
        </p>
      )}

      {!wf && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => yard.initiateRelease(impoundId))}
          className="rounded-md bg-accent-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          Start release
        </button>
      )}

      {wf && !done && !cancelled && (
        <div className="space-y-4">
          {idx === 0 && (
            <VerifyIdStep busy={busy} onSubmit={(b) => run(() => yard.verifyReleaseId(wf.id, b))} />
          )}
          {idx === 1 && (
            <LienholderStep
              busy={busy}
              onSkip={() => setWf({ ...wf })}
              onSubmit={(ref) =>
                run(() => yard.authorizeReleaseLienholder(wf.id, { lienholderAuthRef: ref }))
              }
            />
          )}
          {idx <= 2 && idx >= 1 && (
            <PaymentStep
              busy={busy}
              onSubmit={(b) => run(() => yard.collectReleasePayment(wf.id, b))}
            />
          )}
          {idx >= 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => yard.gateReleaseWorkflow(wf.id))}
              className="w-full rounded-md bg-success px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              Release at gate
            </button>
          )}
          <CancelControl
            busy={busy}
            onCancel={(reason) => run(() => yard.cancelRelease(wf.id, { reason }))}
          />
        </div>
      )}
    </section>
  );
}

function VerifyIdStep({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (b: {
    payerName: string;
    payerIdType: ReleaseWorkflowPayerIdType;
    payerIdLast4: string;
  }) => void;
}): JSX.Element {
  const [payerName, setPayerName] = useState('');
  const [payerIdType, setType] = useState<ReleaseWorkflowPayerIdType>('drivers_license');
  const [last4, setLast4] = useState('');
  return (
    <div className="space-y-2 rounded-md border border-border-on-dark p-3">
      <h2 className="text-sm font-semibold">Step 1 — Verify ID</h2>
      <input
        className={`${inputCls} w-full`}
        placeholder="Payer name"
        aria-label="Payer name"
        value={payerName}
        onChange={(e) => setPayerName(e.target.value)}
      />
      <div className="flex gap-2">
        <select
          className={inputCls}
          value={payerIdType}
          aria-label="ID type"
          onChange={(e) => setType(e.target.value as ReleaseWorkflowPayerIdType)}
        >
          {releaseWorkflowPayerIdTypeValues.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          className={`${inputCls} w-24`}
          placeholder="ID last 4"
          aria-label="ID last 4"
          maxLength={4}
          value={last4}
          onChange={(e) => setLast4(e.target.value)}
        />
      </div>
      <button
        type="button"
        disabled={busy || !payerName || !last4}
        onClick={() => onSubmit({ payerName, payerIdType, payerIdLast4: last4 })}
        className="rounded-md bg-accent-orange px-3 py-1 text-sm font-semibold text-black disabled:opacity-50"
      >
        Verify
      </button>
    </div>
  );
}

function LienholderStep({
  busy,
  onSkip,
  onSubmit,
}: { busy: boolean; onSkip: () => void; onSubmit: (ref: string) => void }): JSX.Element {
  const [ref, setRef] = useState('');
  return (
    <div className="space-y-2 rounded-md border border-border-on-dark p-3">
      <h2 className="text-sm font-semibold">Step 2 — Lienholder authorization (optional)</h2>
      <p className="text-xs text-text-secondary-on-dark">
        Record a lienholder/insurance authorization reference, or skip and collect payment.
      </p>
      <div className="flex gap-2">
        <input
          className={`${inputCls} flex-1`}
          placeholder="Authorization reference"
          aria-label="Lienholder authorization reference"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !ref}
          onClick={() => onSubmit(ref)}
          className="rounded-md bg-accent-orange px-3 py-1 text-sm font-semibold text-black disabled:opacity-50"
        >
          Record
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md border border-border-on-dark px-3 py-1 text-sm"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function PaymentStep({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (b: {
    paymentAmountCents: number;
    paymentMethod: ReleaseWorkflowPaymentMethod;
  }) => void;
}): JSX.Element {
  const [amount, setAmount] = useState('0.00');
  const [method, setMethod] = useState<ReleaseWorkflowPaymentMethod>('card');
  return (
    <div className="space-y-2 rounded-md border border-border-on-dark p-3">
      <h2 className="text-sm font-semibold">Step 3 — Collect payment</h2>
      <div className="flex gap-2">
        <input
          className={`${inputCls} w-28`}
          type="number"
          step="0.01"
          min="0"
          aria-label="Payment amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select
          className={inputCls}
          value={method}
          aria-label="Payment method"
          onChange={(e) => setMethod(e.target.value as ReleaseWorkflowPaymentMethod)}
        >
          {releaseWorkflowPaymentMethodValues.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onSubmit({
              paymentAmountCents: Math.round(Number(amount) * 100),
              paymentMethod: method,
            })
          }
          className="rounded-md bg-accent-orange px-3 py-1 text-sm font-semibold text-black disabled:opacity-50"
        >
          Collect
        </button>
      </div>
    </div>
  );
}

function CancelControl({
  busy,
  onCancel,
}: { busy: boolean; onCancel: (reason: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-text-secondary-on-dark hover:text-danger"
      >
        Cancel this release
      </button>
    );
  return (
    <div className="flex gap-2">
      <input
        className={`${inputCls} flex-1`}
        placeholder="Cancellation reason"
        aria-label="Cancellation reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        type="button"
        disabled={busy || !reason}
        onClick={() => onCancel(reason)}
        className="rounded-md bg-danger px-3 py-1 text-sm font-semibold text-black disabled:opacity-50"
      >
        Confirm cancel
      </button>
    </div>
  );
}
