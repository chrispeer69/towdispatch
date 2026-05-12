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
import { signupSchema } from '@towcommand/shared';
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
  const password = watch('password') ?? '';

  useEffect(() => {
    if (!slugDirty) {
      setValue('tenantSlug', slugify(tenantName ?? ''), { shouldValidate: false });
    }
  }, [tenantName, slugDirty, setValue]);

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
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      setSubmitError(data?.message ?? 'Signup failed. Please try again.');
      return;
    }
    router.push('/verify-email-pending');
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
          <span className="font-mono text-xs text-text-muted">towcommand.app/</span>
          <Input
            className="flex-1"
            placeholder="acme-towing"
            autoComplete="off"
            {...register('tenantSlug', {
              onChange: () => setSlugDirty(true),
            })}
          />
        </div>
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

      <label className="flex items-start gap-3 text-xs text-text-secondary">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-steel-border bg-steel-mid accent-orange"
          {...register('authorized')}
        />
        <span>I am authorized to create this account on behalf of my company.</span>
      </label>
      {errors.authorized?.message ? (
        <p className="text-xs text-danger">{errors.authorized.message}</p>
      ) : null}

      <p className="text-xs text-text-muted">
        By creating an account you agree to our <span className="text-text-secondary">Terms</span>{' '}
        and <span className="text-text-secondary">Privacy Policy</span>.
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
        <p id={hintId} className="text-xs text-text-muted">
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
