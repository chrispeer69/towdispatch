'use client';
import { publicApiBase as apiBase } from '@/lib/api/public-base';
/**
 * Client-side accept / decline interaction for the public offer page.
 *
 * The server component renders the offer body and delegates the action
 * buttons here so the POSTs include the recipient's User-Agent and the
 * server's view of their IP. The decline path optionally captures a
 * reason in a small textarea before submission.
 */
import { type JSX, useEffect, useState } from 'react';

interface Props {
  token: string;
  recipientName: string;
  initialAction: 'accept' | 'decline' | null;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'declining' }
  | { kind: 'submitting' }
  | { kind: 'done'; status: string }
  | { kind: 'error'; message: string };

export function OfferClient({ token, recipientName, initialAction }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [declineReason, setDeclineReason] = useState('');

  // If the email link carries ?action=accept or ?action=decline, surface
  // that intent to the user — but never auto-submit. They confirm with
  // an explicit click.
  useEffect(() => {
    if (initialAction === 'decline') setPhase({ kind: 'declining' });
  }, [initialAction]);

  async function submit(verb: 'accept' | 'decline'): Promise<void> {
    setPhase({ kind: 'submitting' });
    try {
      const url = `${apiBase()}/public/tier-offers/${encodeURIComponent(token)}/${verb}`;
      const body = verb === 'decline' ? { reason: declineReason || undefined } : {};
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        setPhase({
          kind: 'error',
          message: err
            ? `Could not record your response (${res.status}). ${err}`
            : `Could not record your response (${res.status}). Please retry.`,
        });
        return;
      }
      const json = (await res.json()) as { status: string };
      setPhase({ kind: 'done', status: json.status });
    } catch (err) {
      setPhase({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Network error. Please retry; your previous click was not recorded.',
      });
    }
  }

  if (phase.kind === 'done') {
    return (
      <div className="mt-6 p-4 rounded-md border border-border-on-dark bg-bg-base/60">
        <p className="font-bold text-lg mb-1">
          {phase.status === 'accepted'
            ? `Thank you, ${recipientName}. We've recorded your acceptance.`
            : phase.status === 'declined'
              ? `Thank you, ${recipientName}. We've recorded your decline.`
              : `Recorded as: ${phase.status}.`}
        </p>
        <p className="text-sm text-text-secondary-on-dark">
          The operator will see your response immediately. You can close this window.
        </p>
      </div>
    );
  }

  if (phase.kind === 'declining') {
    return (
      <div className="mt-6 space-y-3">
        <label
          htmlFor="decline-reason"
          className="block text-sm font-semibold uppercase tracking-wide text-text-secondary-on-dark"
        >
          Reason for declining (optional)
        </label>
        <textarea
          id="decline-reason"
          rows={3}
          maxLength={2000}
          value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
          placeholder="e.g., This rate exceeds our reimbursement schedule for this storm class."
          className="w-full bg-bg-base border border-border-on-dark rounded-md p-3 text-sm"
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => submit('decline')}
            className="px-5 py-2 rounded-md bg-status-danger-on-dark text-white font-semibold disabled:opacity-50"
          >
            Decline offer
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="px-5 py-2 rounded-md border border-border-on-dark text-text-primary-on-dark"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {phase.kind === 'error' && (
        <div className="p-3 rounded-md border border-status-danger-on-dark/40 bg-status-danger-on-dark/10 text-sm">
          {phase.message}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => submit('accept')}
          disabled={phase.kind === 'submitting'}
          className="px-6 py-3 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
        >
          {phase.kind === 'submitting' ? 'Recording…' : 'Accept terms'}
        </button>
        <button
          type="button"
          onClick={() => setPhase({ kind: 'declining' })}
          disabled={phase.kind === 'submitting'}
          className="px-6 py-3 rounded-md border border-border-on-dark text-text-primary-on-dark font-semibold disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
