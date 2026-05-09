'use client';

import { PasswordStrength } from '@/components/auth/password-strength';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema } from '@towcommand/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const formSchema = resetPasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof formSchema>;

export function ResetForm(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const token = params?.get('token') ?? '';
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: { token, newPassword: '', confirmPassword: '' },
  });
  const pw = watch('newPassword') ?? '';

  async function onSubmit(values: FormValues): Promise<void> {
    setSubmitError(null);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: values.token, newPassword: values.newPassword }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      setSubmitError(data?.message ?? 'Reset failed. Try requesting a new link.');
      return;
    }
    router.push('/login?reset=ok');
  }

  if (!token) {
    return (
      <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
        Missing or invalid reset link. Request a new one from the forgot-password page.
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <input type="hidden" {...register('token')} />
      <div className="space-y-1.5">
        <Label>New password</Label>
        <Input type="password" autoComplete="new-password" {...register('newPassword')} />
        <PasswordStrength value={pw} />
        {errors.newPassword?.message ? (
          <p className="text-xs text-danger">{errors.newPassword.message}</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label>Confirm password</Label>
        <Input type="password" autoComplete="new-password" {...register('confirmPassword')} />
        {errors.confirmPassword?.message ? (
          <p className="text-xs text-danger">{errors.confirmPassword.message}</p>
        ) : null}
      </div>
      {submitError ? (
        <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {submitError}
        </div>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Save new password'}
      </Button>
    </form>
  );
}
