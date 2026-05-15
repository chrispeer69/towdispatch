'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ForgotPasswordPayload, forgotPasswordSchema } from '@ustowdispatch/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

export function ForgotForm(): JSX.Element {
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordPayload>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordPayload): Promise<void> {
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/40 p-4 text-sm text-text-secondary-on-dark">
        If an account exists for that email, we&rsquo;ve sent a reset link. Check your inbox (and
        spam folder) for instructions.
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          aria-required="true"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'forgot-email-error' : undefined}
          {...register('email')}
        />
        {errors.email?.message ? (
          <p id="forgot-email-error" className="text-xs text-danger">
            {errors.email.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
