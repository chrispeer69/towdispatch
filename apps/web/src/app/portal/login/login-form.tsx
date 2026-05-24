'use client';

import type { PortalMessages } from '@/lib/portal/i18n';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';
import {
  PortalCard,
  PortalField,
  PortalInput,
  PortalNotice,
  PortalPrimaryButton,
} from '../portal-ui';

export function PortalLoginForm({ t }: { t: PortalMessages }): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push('/portal/dashboard');
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      setError(body?.code === 'email_not_verified' ? t.emailNotVerified : t.genericError);
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalCard title={t.signIn}>
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </PortalField>
        <PortalPrimaryButton type="submit" disabled={busy}>
          {busy ? '…' : t.signIn}
        </PortalPrimaryButton>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link className="text-neutral-600 underline" href="/portal/forgot-password">
          {t.forgotPassword}
        </Link>
        <Link className="text-neutral-600 underline" href="/portal/signup">
          {t.signUp}
        </Link>
      </div>
    </PortalCard>
  );
}
