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

export function PortalSignupForm({ t }: { t: PortalMessages }): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      setError(t.genericError);
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <PortalCard title={t.signupTitle}>
        <PortalNotice tone="success">{t.signupSent}</PortalNotice>
        <div className="mt-4 text-sm">
          <Link className="text-neutral-600 underline" href="/portal/login">
            {t.signIn}
          </Link>
        </div>
      </PortalCard>
    );
  }

  return (
    <PortalCard title={t.signupTitle}>
      <form onSubmit={onSubmit}>
        {error ? (
          <div className="mb-4">
            <PortalNotice tone="error">{error}</PortalNotice>
          </div>
        ) : null}
        <PortalField label={t.email}>
          <PortalInput
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </PortalField>
        <PortalField label={t.password}>
          <PortalInput
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </PortalField>
        <PortalPrimaryButton type="submit" disabled={busy}>
          {busy ? '…' : t.signupCta}
        </PortalPrimaryButton>
      </form>
      <div className="mt-4 text-sm">
        <Link className="text-neutral-600 underline" href="/portal/login">
          {t.signIn}
        </Link>
      </div>
    </PortalCard>
  );
}
