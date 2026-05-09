'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
/**
 * Login flow handles three branches the API might return:
 *   - authenticated → push to /dashboard
 *   - needs_tenant_selection → render a tenant picker, then re-submit with slug
 *   - mfa_required → render TOTP input, then call /api/auth/mfa-login
 */
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type LoginPayload,
  type LoginResponse,
  type TenantSelectionDto,
  loginSchema,
} from '@towcommand/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

interface MfaState {
  mfaToken: string;
}

export function LoginForm(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get('next') ?? '/dashboard';
  const [error, setError] = useState<string | null>(null);
  const [tenantOptions, setTenantOptions] = useState<TenantSelectionDto[] | null>(null);
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [pendingPayload, setPendingPayload] = useState<LoginPayload | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginPayload>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  async function submitLogin(payload: LoginPayload): Promise<void> {
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as
      | (LoginResponse & { code?: string })
      | { message?: string }
      | null;
    if (!res.ok) {
      setError(
        (data && 'message' in data && data.message) ||
          'Could not sign in. Check your email and password.',
      );
      return;
    }
    if (!data) return;

    if ('status' in data && data.status === 'authenticated') {
      router.push(next);
      router.refresh();
      return;
    }
    if ('status' in data && data.status === 'needs_tenant_selection') {
      setTenantOptions(data.tenants);
      setPendingPayload(payload);
      return;
    }
    if ('status' in data && data.status === 'mfa_required') {
      setMfa({ mfaToken: data.mfaToken });
      setPendingPayload(payload);
      return;
    }
  }

  async function pickTenant(slug: string): Promise<void> {
    if (!pendingPayload) return;
    await submitLogin({ ...pendingPayload, tenantSlug: slug });
  }

  async function submitMfa(totpCode: string): Promise<void> {
    if (!mfa) return;
    setError(null);
    const res = await fetch('/api/auth/mfa-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken: mfa.mfaToken, totpCode }),
    });
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    if (!res.ok) {
      setError(data?.message ?? 'Invalid TOTP code.');
      return;
    }
    router.push(next);
    router.refresh();
  }

  if (mfa) {
    return <MfaPanel onSubmit={submitMfa} error={error} />;
  }

  if (tenantOptions) {
    return (
      <TenantPicker
        options={tenantOptions}
        onPick={pickTenant}
        onCancel={() => {
          setTenantOptions(null);
          setPendingPayload(null);
        }}
      />
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit(submitLogin)} className="space-y-5">
      <Field label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...register('email')} />
      </Field>
      <Field label="Password" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...register('password')} />
      </Field>
      <div className="flex items-center justify-between text-xs">
        <Link
          href="/forgot-password"
          className="font-semibold text-orange-light transition-colors hover:text-orange"
        >
          Forgot password?
        </Link>
      </div>
      {error ? (
        <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

interface FieldProps {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}
function Field({ label, error, children }: FieldProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function TenantPicker({
  options,
  onPick,
  onCancel,
}: {
  options: TenantSelectionDto[];
  onPick: (slug: string) => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        We found this email in more than one workspace. Pick which to sign in to:
      </p>
      <ul className="space-y-2">
        {options.map((t) => (
          <li key={t.slug}>
            <button
              type="button"
              onClick={() => onPick(t.slug)}
              className="flex w-full items-center justify-between rounded-[10px] border border-steel-border bg-steel-mid px-4 py-3 text-left transition-colors hover:border-orange"
            >
              <span>
                <span className="block font-semibold text-text-primary">{t.name}</span>
                <span className="block font-mono text-xs text-text-muted">{t.slug}</span>
              </span>
              <span className="text-xs font-semibold text-orange-light">Sign in →</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted hover:text-text-secondary"
      >
        ← Use a different email
      </button>
    </div>
  );
}

function MfaPanel({
  onSubmit,
  error,
}: {
  onSubmit: (code: string) => Promise<void>;
  error: string | null;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        await onSubmit(code);
        setPending(false);
      }}
      className="space-y-4"
    >
      <p className="text-sm text-text-secondary">
        Two-factor required. Open your authenticator and enter the 6-digit code.
      </p>
      <Input
        autoFocus
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="123456"
        className="text-center font-mono text-lg tracking-[0.4em]"
      />
      {error ? (
        <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending || code.length !== 6}>
        {pending ? 'Verifying…' : 'Verify and sign in'}
      </Button>
    </form>
  );
}
