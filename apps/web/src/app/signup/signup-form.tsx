'use client';

import { PasswordStrength } from '@/components/auth/password-strength';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
/**
 * Signup form. Validates with the same Zod schema the API uses (signupSchema)
 * — adds local-only fields (confirmPassword, authorizedCheckbox) on top.
 *
 * The slug auto-derives from the company name, but stays editable. Once the
 * user manually edits the slug, we stop syncing to avoid clobbering it.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema } from '@ustowdispatch/shared';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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

export function SignupForm(): JSX.Element {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [slugDirty, setSlugDirty] = useState(false);
  /**
   * 'idle' | 'checking' | 'available' | 'taken' | 'too-short'.
   * Drives the inline slug status indicator under the slug input.
   */
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

  // Debounced slug-availability check. As the user types, we ask the
  // API whether the slug is free; if it isn\u2019t, we fetch the next
  // free suggestion and (when the user hasn\u2019t manually edited the
  // slug field) silently substitute it. Either way, the user sees a
  // green check or a yellow "already registered" hint right under the
  // slug input.
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
          // Fall back to idle if the probe itself errors out \u2014 the
          // 409 path on submit will still catch it.
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
            // Auto-uniquify only when the user hasn\u2019t manually
            // touched the slug field. Respect their explicit choice.
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
    const res = await fetch('/api/auth/signup', {
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
      if (isConflict) {
        setSubmitError(
          'This company name is already registered. Try a different name or sign in to your existing account.',
        );
      } else {
        setSubmitError(data?.message ?? 'Signup failed. Please try again.');
      }
      return;
    }
    // Signup sets the session cookies via the BFF route, so the new owner is
    // authenticated immediately — send them straight into the onboarding
    // wizard. Email verification is surfaced (non-blocking) inside the wizard.
    router.push('/signup/wizard');
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field label="Company name" error={errors.tenantName?.message}>
        <Input placeholder="Acme Towing" autoComplete="organization" {...register('tenantName')} />
      </Field>

      <Field
        label="URL slug"
        error={errors.tenantSlug?.message}
        hint="Lowercase letters, numbers, hyphens. This is your workspace URL."
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-secondary-on-dark-on-dark/60">
            ustowdispatch.app/
          </span>
          <Input
            className="flex-1"
            placeholder="acme-towing"
            autoComplete="off"
            {...register('tenantSlug', {
              onChange: () => setSlugDirty(true),
            })}
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

      <p className="text-xs text-text-secondary-on-dark-on-dark/60">
        By creating an account you agree to our{' '}
        <span className="text-text-secondary-on-dark">Terms</span> and{' '}
        <span className="text-text-secondary-on-dark">Privacy Policy</span>.
      </p>

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

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, error, hint, children }: FieldProps): JSX.Element {
  const id = React.useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  // Inject id + aria-describedby + aria-invalid into the single child
  // input when the child is a valid element. Robust against arrays or
  // non-element children — those render unchanged.
  let enhanced: React.ReactNode = children;
  if (React.isValidElement(children)) {
    const extra: Record<string, string | boolean> = { id };
    if (describedBy) extra['aria-describedby'] = describedBy;
    if (error) extra['aria-invalid'] = true;
    enhanced = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, extra);
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {enhanced}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-text-secondary-on-dark-on-dark/60">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
