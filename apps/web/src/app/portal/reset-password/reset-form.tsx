'use client';

import type { PortalMessages } from '@/lib/portal/i18n';
import Link from 'next/link';
import { type FormEvent, type JSX, useState } from 'react';
import {
  PortalCard,
  PortalField,
  PortalInput,
  PortalNotice,
  PortalPrimaryButton,
} from '../portal-ui';

export function PortalResetForm({ t, token }: { t: PortalMessages; token: string }): JSX.Element {
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? t.genericError);
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalCard title={t.resetTitle}>
      {done ? (
        <>
          <PortalNotice tone="success">{t.resetDone}</PortalNotice>
          <div className="mt-4 text-sm">
            <Link className="text-neutral-600 underline" href="/portal/login">
              {t.signIn}
            </Link>
          </div>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          {error ? (
            <div className="mb-4">
              <PortalNotice tone="error">{error}</PortalNotice>
            </div>
          ) : null}
          <PortalField label={t.newPassword}>
            <PortalInput
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </PortalField>
          <PortalPrimaryButton type="submit" disabled={busy || !token}>
            {busy ? '…' : t.resetCta}
          </PortalPrimaryButton>
        </form>
      )}
    </PortalCard>
  );
}
