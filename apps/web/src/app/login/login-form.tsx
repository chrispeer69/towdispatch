'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
/**
 * Login flow. With MFA_LOGIN_GATE_ENABLED=false on the API the backend
 * only returns `authenticated` or `needs_tenant_selection`. The
 * `mfa_required` / `mfa_setup_required` BFF routes and /auth/mfa/* pages
 * are left in the repo but are no longer reachable from this form — flip
 * MFA_LOGIN_GATE_ENABLED on the API to re-wire them.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginPayload, type TenantSelectionDto, loginSchema } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

type LoginApiResponse =
  | { status: 'authenticated'; user: unknown; tenant: unknown }
  | { status: 'needs_tenant_selection'; tenants: TenantSelectionDto[] }
  | { code?: string; message?: string };

export function LoginForm(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get('next') ?? '/dashboard';
  const [error, setError] = useState<string | null>(null);
  const [tenantOptions, setTenantOptions] = useState<TenantSelectionDto[] | null>(null);
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
    const data = (await res.json().catch(() => null)) as LoginApiResponse | null;
    if (!res.ok) {
      const msg =
        data && 'message' in data && data.message
          ? data.message
          : 'Could not sign in. Check your email and password.';
      setError(msg);
      return;
    }
    if (!data || !('status' in data)) return;

    if (data.status === 'authenticated') {
      router.push(next);
      router.refresh();
      return;
    }
    if (data.status === 'needs_tenant_selection') {
      setTenantOptions(data.tenants);
      setPendingPayload(payload);
      return;
    }
  }

  async function pickTenant(slug: string): Promise<void> {
    if (!pendingPayload) return;
    await submitLogin({ ...pendingPayload, tenantSlug: slug });
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
    <form
      noValidate
      onSubmit={handleSubmit(submitLogin)}
      className="space-y-5"
      aria-busy={isSubmitting}
    >
      <Field label="Email" htmlFor="login-email" error={errors.email?.message}>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          aria-required="true"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'login-email-error' : undefined}
          {...register('email')}
        />
      </Field>
      <Field label="Password" htmlFor="login-password" error={errors.password?.message}>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          aria-required="true"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'login-password-error' : undefined}
          {...register('password')}
        />
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
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
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
  htmlFor?: string;
  error?: string | undefined;
  children: React.ReactNode;
}
function Field({ label, htmlFor, error, children }: FieldProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
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
