'use client';

/**
 * SetDriverPin — operator-side button that enrolls / rotates a driver's
 * 4-digit PIN. Surfaces on the driver detail page. Calls the existing
 * POST /driver-auth/set-pin endpoint, which is RBAC-gated to OWNER /
 * ADMIN / MANAGER.
 *
 * UX is deliberately minimal: a "Set PIN" button that opens an inline
 * input asking for exactly 4 digits, plus a Save button. After save it
 * shows a success line and disappears until you click Set PIN again.
 *
 * The PIN is never round-tripped after enrollment — the API stores
 * bcrypt(pin) and discards the plaintext. So if a driver forgets, the
 * operator just sets a new one.
 */

import { useState } from 'react';

export function SetDriverPin({ driverId }: { driverId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/driver-auth/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId, pin }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Save failed (${res.status})`);
      }
      setSavedAt(new Date().toLocaleTimeString());
      setPin('');
      setOpen(false);
    } catch (e) {
      setError((e as Error).message ?? 'Could not save PIN.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSavedAt(null);
            setError(null);
          }}
          className="rounded-md border border-divider bg-bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:bg-bg-surface-elevated"
        >
          Set / change driver PIN
        </button>
        {savedAt ? <span className="text-xs text-ok">PIN updated at {savedAt}</span> : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-divider bg-bg-surface p-4 space-y-3">
      <p className="text-sm font-semibold">Enter the 4-digit PIN the driver gave you.</p>
      <p className="text-xs text-text-secondary-on-dark">
        The driver picked their own PIN on the in-cab tablet and told you verbally or by phone. Type
        it here exactly and save. They can sign in immediately afterwards.
      </p>
      <input
        type="password"
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="••••"
        className="w-32 rounded-md border border-divider bg-bg-base px-3 py-2 text-center font-mono text-xl tracking-[0.4em]"
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || pin.length !== 4}
          className="rounded-md bg-brand-primary px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save PIN'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPin('');
            setError(null);
          }}
          className="rounded-md border border-divider px-4 py-1.5 text-xs font-semibold uppercase tracking-wide hover:bg-bg-surface-elevated"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
