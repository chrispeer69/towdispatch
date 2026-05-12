'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function ChallengeClient(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get('next') ?? '/dashboard';

  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as {
        status?: string;
        message?: string;
        code?: string;
      } | null;
      if (!res.ok || data?.status !== 'authenticated') {
        if (res.status === 401 && data?.code === 'AUTH_REQUIRED') {
          router.push('/login');
          return;
        }
        setError(data?.message ?? 'Invalid code. Try again.');
        return;
      }
      router.push(next);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const isReady = mode === 'totp' ? /^\d{6}$/.test(code) : code.replace(/[\s-]+/g, '').length >= 8;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <div className="space-y-1.5">
        <label
          htmlFor="mfa-code"
          className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted"
        >
          {mode === 'totp' ? '6-digit code from your app' : 'Recovery code'}
        </label>
        <Input
          id="mfa-code"
          autoFocus
          inputMode={mode === 'totp' ? 'numeric' : 'text'}
          pattern={mode === 'totp' ? '[0-9]*' : undefined}
          maxLength={mode === 'totp' ? 6 : 20}
          value={code}
          onChange={(e) =>
            setCode(mode === 'totp' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)
          }
          placeholder={mode === 'totp' ? '123456' : 'abcde-12345'}
          className="text-center font-mono text-lg tracking-[0.4em]"
        />
      </div>
      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </div>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={submitting || !isReady}>
        {submitting ? 'Verifying…' : 'Verify and sign in'}
      </Button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'totp' ? 'recovery' : 'totp');
          setCode('');
          setError(null);
        }}
        className="block w-full text-center text-xs font-semibold uppercase tracking-[0.18em] text-text-muted hover:text-text-secondary"
      >
        {mode === 'totp' ? 'Use a recovery code instead' : 'Use authenticator app instead'}
      </button>
    </form>
  );
}
