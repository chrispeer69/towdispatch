'use client';

import { PasswordStrength } from '@/components/auth/password-strength';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { zodResolver } from '@hookform/resolvers/zod';
/**
 * Account step — step 1 of the self-serve onboarding wizard.
 *
 * Validates with the same Zod schema the API uses (signupSchema) plus
 * local-only confirmPassword / authorized fields. Posts to the onboarding
 * BFF (/api/onboarding/start), which provisions the tenant + owner, sends the
 * verification email, sets the session cookies, and returns the initial
 * onboarding progress. On success it hands that progress up to the wizard.
 */
import { type OnboardingProgressDto, signupSchema } from '@ustowdispatch/shared';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field } from './field';

const formSchema = signupSchema
  .extend({
    confirmPassword: z.string(),
    authorized: z.literal(true, {
      errorMap: () => ({ message: 'Please confirm you are authorized to create this account' }),
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof formSchema>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function AccountStep({
  onComplete,
}: {
  onComplete: (progress: OnboardingProgressDto) => void;
}): JSX.Element {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [slugDirty, setSlugDirty] = useState(false);
  const [slugStatus, setSlugStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'too-short'
  >('idle');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: {
      tenantName: '',
      tenantSlug: '',
      ownerName: '',
      ownerEmail: '',
      password: '',
      confirmPassword: '',
      authorized: undefined as unknown as true,
    },
  });

  const tenantName = watch('tenantName');
  const tenantSlug = watch('tenantSlug') ?? '';
  const password = watch('password') ?? '';

  useEffect(() => {
    if (!slugDirty) {
      setValue('tenantSlug', slugify(tenantName ?? ''), { shouldValidate: false });
    }
  }, [tenantName, slugDirty, setValue]);

  // Debounced slug-availability check (reuses the public /auth/check-slug BFF).
  useEffect(() => {
    const candidate = (tenantSlug ?? '').trim();
    if (candidate.length < 2) {
      setSlugStatus(candidate.length === 0 ? 'idle' : 'too-short');
      return;
    }
    let cancelled = false;
    setSlugStatus('checking');
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/auth/check-slug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantSlug: candidate }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setSlugStatus('idle');
          return;
        }
        const data = (await res.json()) as { available: boolean; suggested: string };
        if (cancelled) return;
        if (data.available) {
          setSlugStatus('available');
        } else {
          setSlugStatus('taken');
          if (!slugDirty && data.suggested && data.suggested !== candidate) {
            setValue('tenantSlug', data.suggested, { shouldValidate: false });
          }
        }
      } catch {
        if (!cancelled) setSlugStatus('idle');
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [tenantSlug, slugDirty, setValue]);

  async function onSubmit(values: FormValues): Promise<void> {
    setSubmitError(null);
    const res = await fetch('/api/onboarding/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantName: values.tenantName,
        tenantSlug: values.tenantSlug,
        ownerName: values.ownerName,
        ownerEmail: values.ownerEmail,
        password: values.password,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        code?: string;
      } | null;
      const isConflict =
        res.status === 409 ||
        data?.code === 'conflict' ||
        (data?.message ?? '').toLowerCase().includes('already taken');
      const isRateLimited = res.status === 429 || data?.code === 'rate_limited';
      if (isConflict) {
        setSubmitError(
          'This company name is already registered. Try a different name or sign in to your existing account.',
        );
      } else if (isRateLimited) {
        setSubmitError(
          data?.message ?? 'Too many signups from this network. Please try again later.',
        );
      } else {
        setSubmitError(data?.message ?? 'Signup failed. Please try again.');
      }
      return;
    }
    const data = (await res.json()) as { onboarding: OnboardingProgressDto };
    onComplete(data.onboarding);
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* TODO(i18n): Spanish parity once the web app gains an i18n framework. */}
      <Field label="Company name" error={errors.tenantName?.message}>
        <Input placeholder="Acme Towing" autoComplete="organization" {...register('tenantName')} />
      </Field>

      <Field
        label="URL slug"
        error={errors.tenantSlug?.message}
        hint="Lowercase letters, numbers, hyphens. This is your workspace URL."
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-secondary-on-dark/60">
            ustowdispatch.app/
          </span>
          <Input
            className="flex-1"
            placeholder="acme-towing"
            autoComplete="off"
            {...register('tenantSlug', { onChange: () => setSlugDirty(true) })}
          />
        </div>
        {slugStatus === 'available' && (
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            ✓ This URL is available.
          </p>
        )}
        {slugStatus === 'taken' && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            That URL is already registered. We picked the next available one for you.
          </p>
        )}
        {slugStatus === 'too-short' && (
          <p className="mt-1 text-xs text-text-secondary-on-dark/60">
            URL must be at least 2 characters.
          </p>
        )}
        {slugStatus === 'checking' && (
          <p className="mt-1 text-xs text-text-secondary-on-dark/60">Checking availability…</p>
        )}
      </Field>

      <Field label="Your name" error={errors.ownerName?.message}>
        <Input placeholder="Jane Owner" autoComplete="name" {...register('ownerName')} />
      </Field>

      <Field label="Email" error={errors.ownerEmail?.message}>
        <Input
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          {...register('ownerEmail')}
        />
      </Field>

      <Field label="Password" error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...register('password')} />
        <PasswordStrength value={password} />
      </Field>

      <Field label="Confirm password" error={errors.confirmPassword?.message}>
        <Input type="password" autoComplete="new-password" {...register('confirmPassword')} />
      </Field>

      <label className="flex items-start gap-3 text-xs text-text-secondary-on-dark">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-divider bg-bg-surface accent-orange"
          {...register('authorized')}
        />
        <span>I am authorized to create this account on behalf of my company.</span>
      </label>
      {errors.authorized?.message ? (
        <p className="text-xs text-danger">{errors.authorized.message}</p>
      ) : null}

      {submitError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {submitError}
        </div>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Creating workspace…' : 'Create workspace'}
      </Button>
    </form>
  );
}
