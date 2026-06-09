'use client';

import type { StripeConnectStatusDto } from '@towdispatch/shared';
import { type JSX, useState, useTransition } from 'react';

interface Props {
  initial: StripeConnectStatusDto;
}

const STATUS_LABELS: Record<string, string> = {
  none: 'Not connected',
  pending: 'Onboarding in progress',
  active: 'Active',
  restricted: 'Restricted — action required',
  rejected: 'Rejected',
};

export function PaymentsSettingsClient({ initial }: Props): JSX.Element {
  const [status, setStatus] = useState(initial);
  const [marginInput, setMarginInput] = useState(String(initial.platformMarginBps));
  const [pending, start] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const post = async (url: string): Promise<void> => {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error(`request failed: ${res.status}`);
  };

  const onConnect = (): void => {
    start(async () => {
      try {
        setErrorMessage(null);
        const res = await fetch('/api/payments/connect/start', { method: 'POST' });
        if (!res.ok) throw new Error('start failed');
        const body = (await res.json()) as { onboardingUrl: string };
        window.location.href = body.onboardingUrl;
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onSync = (): void => {
    start(async () => {
      try {
        setErrorMessage(null);
        await post('/api/payments/connect/sync');
        const fresh = await fetch('/api/payments/connect/status', { cache: 'no-store' });
        if (fresh.ok) setStatus((await fresh.json()) as StripeConnectStatusDto);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onSaveMargin = (): void => {
    start(async () => {
      try {
        setErrorMessage(null);
        const bps = Number(marginInput);
        if (!Number.isFinite(bps)) throw new Error('Enter a number 0-1000');
        const res = await fetch('/api/payments/connect/margin', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ platformMarginBps: bps }),
        });
        if (!res.ok) throw new Error('save failed');
        const body = (await res.json()) as StripeConnectStatusDto;
        setStatus(body);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-bg-surface-elevated p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Stripe Connect</h2>
            <p className="text-sm text-text-secondary-on-dark mt-1">
              Status:{' '}
              <span className="font-mono">
                {STATUS_LABELS[status.accountStatus] ?? status.accountStatus}
              </span>
            </p>
            {status.accountId ? (
              <p className="text-xs text-text-secondary-on-dark mt-1 font-mono">
                {status.accountId}
              </p>
            ) : null}
          </div>
          <div className="space-x-2">
            {status.accountId ? (
              <button
                type="button"
                onClick={onSync}
                disabled={pending}
                className="rounded bg-bg-base px-3 py-2 text-sm border border-border hover:border-action"
              >
                Refresh from Stripe
              </button>
            ) : null}
            <button
              type="button"
              onClick={onConnect}
              disabled={pending}
              className="rounded bg-action px-3 py-2 text-sm font-semibold text-white"
            >
              {status.accountId ? 'Continue onboarding' : 'Connect Stripe'}
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-text-secondary-on-dark">Charges enabled</dt>
            <dd>{status.chargesEnabled ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-text-secondary-on-dark">Payouts enabled</dt>
            <dd>{status.payoutsEnabled ? 'Yes' : 'No'}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg bg-bg-surface-elevated p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Platform margin</h2>
          <p className="text-sm text-text-secondary-on-dark mt-1">
            Basis points retained by the platform on each transaction. 30 bps = 0.30%. Stored on the
            tenant; capped at 1000 bps (10%).
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <input
            type="number"
            min={0}
            max={1000}
            value={marginInput}
            onChange={(e): void => setMarginInput(e.target.value)}
            className="w-28 rounded bg-bg-base border border-border px-3 py-2 text-sm font-mono"
          />
          <span className="text-text-secondary-on-dark text-sm">bps</span>
          <button
            type="button"
            onClick={onSaveMargin}
            disabled={pending}
            className="rounded bg-action px-3 py-2 text-sm font-semibold text-white"
          >
            Save margin
          </button>
        </div>
      </section>

      {errorMessage ? (
        <p role="alert" aria-live="assertive" className="text-red-400 text-sm">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
