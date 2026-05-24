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

export function PortalForgotForm({ t }: { t: PortalMessages }): JSX.Element {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    // Always neutral — the API never reveals whether the email exists.
    await fetch('/api/portal/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => undefined);
    setDone(true);
    setBusy(false);
  }

  return (
    <PortalCard title={t.forgotTitle}>
      {done ? (
        <PortalNotice tone="success">{t.forgotSent}</PortalNotice>
      ) : (
        <form onSubmit={onSubmit}>
          <PortalField label={t.email}>
            <PortalInput
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </PortalField>
          <PortalPrimaryButton type="submit" disabled={busy}>
            {busy ? '…' : t.forgotCta}
          </PortalPrimaryButton>
        </form>
      )}
      <div className="mt-4 text-sm">
        <Link className="text-neutral-600 underline" href="/portal/login">
          {t.signIn}
        </Link>
      </div>
    </PortalCard>
  );
}
