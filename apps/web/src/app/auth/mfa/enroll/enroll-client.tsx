'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MfaSetupResponse } from '@ustowdispatch/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type Step = 'loading' | 'codes' | 'verify' | 'done';

interface SetupErr {
  code?: string;
  message?: string;
}

export function EnrollClient(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get('next') ?? '/dashboard';

  const [step, setStep] = useState<Step>('loading');
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/auth/mfa/setup', { method: 'POST' });
      const data = (await res.json().catch(() => null)) as
        | (MfaSetupResponse & SetupErr)
        | SetupErr
        | null;
      if (cancelled) return;
      if (!res.ok || !data || !('qrCodeDataUrl' in data)) {
        const message = (data as SetupErr | null)?.message ?? 'Could not start enrollment.';
        setError(message);
        // If the bridge cookie is missing/expired the user has to restart from
        // /login — point them back rather than leaving them stranded.
        if (res.status === 401) router.push('/login');
        return;
      }
      setSetup(data);
      setStep('codes');
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function verify(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totpCode: code }),
      });
      const data = (await res.json().catch(() => null)) as {
        status?: string;
        message?: string;
      } | null;
      if (!res.ok || data?.status !== 'authenticated') {
        setError(data?.message ?? 'Invalid code. Try the next 6 digits from your app.');
        return;
      }
      setStep('done');
      router.push(next);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'loading') {
    return <p className="text-sm text-text-secondary">Preparing your authenticator setup…</p>;
  }

  if (step === 'codes' && setup) {
    return (
      <CodesPanel
        setup={setup}
        acknowledged={acknowledged}
        onAck={setAcknowledged}
        error={error}
        onContinue={() => setStep('verify')}
      />
    );
  }

  if (step === 'verify' && setup) {
    return (
      <VerifyPanel
        otpAuthUrl={setup.otpAuthUrl}
        qrCodeDataUrl={setup.qrCodeDataUrl}
        secret={setup.secret}
        code={code}
        onChange={setCode}
        onSubmit={verify}
        onBack={() => setStep('codes')}
        submitting={submitting}
        error={error}
      />
    );
  }

  return <p className="text-sm text-text-secondary">You&rsquo;re all set. Redirecting…</p>;
}

function CodesPanel({
  setup,
  acknowledged,
  onAck,
  onContinue,
  error,
}: {
  setup: MfaSetupResponse;
  acknowledged: boolean;
  onAck: (v: boolean) => void;
  onContinue: () => void;
  error: string | null;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <div className="rounded-[10px] border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning">
        These recovery codes are shown <strong>only once</strong>. Save them somewhere safe — you
        can use any of them in place of a TOTP code if you lose your phone.
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-[10px] border border-steel-border bg-steel-mid px-4 py-4 font-mono text-sm tracking-[0.2em] text-text-primary">
        {setup.recoveryCodes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted hover:text-text-secondary"
          onClick={() => {
            void navigator.clipboard.writeText(setup.recoveryCodes.join('\n'));
          }}
        >
          Copy all
        </button>
        <button
          type="button"
          className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted hover:text-text-secondary"
          onClick={() => {
            const blob = new Blob([setup.recoveryCodes.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ustowdispatch-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </button>
      </div>
      <label className="flex items-center gap-3 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAck(e.target.checked)}
          className="h-4 w-4 rounded border-steel-border bg-steel-mid"
        />
        I&rsquo;ve saved my recovery codes somewhere safe.
      </label>
      {error ? (
        <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={!acknowledged}
        onClick={onContinue}
      >
        Continue
      </Button>
    </div>
  );
}

function VerifyPanel({
  otpAuthUrl,
  qrCodeDataUrl,
  secret,
  code,
  onChange,
  onSubmit,
  onBack,
  submitting,
  error,
}: {
  otpAuthUrl: string;
  qrCodeDataUrl: string;
  secret: string;
  code: string;
  onChange: (v: string) => void;
  onSubmit: () => Promise<void>;
  onBack: () => void;
  submitting: boolean;
  error: string | null;
}): JSX.Element {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
      className="space-y-5"
    >
      <div className="flex flex-col items-center gap-3 rounded-[10px] border border-steel-border bg-steel-mid p-4">
        {/* qrcode is generated server-side in /auth/mfa/setup. Rendering it
            as a plain <img> avoids pulling a QR library into the bundle. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrCodeDataUrl}
          alt="TOTP QR code"
          width={196}
          height={196}
          className="rounded-[6px] bg-white p-2"
        />
        <details className="w-full text-xs text-text-muted">
          <summary className="cursor-pointer select-none">Can&rsquo;t scan? Enter manually</summary>
          <div className="mt-2 space-y-1">
            <p>
              Secret: <code className="select-all font-mono text-text-secondary">{secret}</code>
            </p>
            <p className="truncate">
              URL:{' '}
              <a className="text-orange-light underline" href={otpAuthUrl}>
                {otpAuthUrl}
              </a>
            </p>
          </div>
        </details>
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="mfa-totp"
          className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted"
        >
          6-digit code from your app
        </label>
        <Input
          id="mfa-totp"
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="123456"
          className="text-center font-mono text-lg tracking-[0.4em]"
        />
      </div>
      {error ? (
        <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={submitting || code.length !== 6}>
        {submitting ? 'Verifying…' : 'Finish enrollment'}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="block w-full text-center text-xs font-semibold uppercase tracking-[0.18em] text-text-muted hover:text-text-secondary"
      >
        ← Back to recovery codes
      </button>
    </form>
  );
}
