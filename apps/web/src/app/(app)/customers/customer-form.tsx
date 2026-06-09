'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
/**
 * Create or edit a customer. Uses the shared Zod schema as the source of
 * truth — react-hook-form's Zod resolver runs the same validation the API
 * runs, so the user sees the same error messages on both sides.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateCustomerPayload,
  type CustomerDto,
  createCustomerSchema,
  customerTypeValues,
} from '@towdispatch/shared';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

interface Props {
  mode: 'create' | 'edit';
  initial?: CustomerDto;
}

export function CustomerForm({ mode, initial }: Props): JSX.Element {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCustomerPayload>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: initial
      ? {
          type: initial.type,
          name: initial.name,
          email: initial.email ?? undefined,
          phone: initial.phone ?? undefined,
          accountId: initial.accountId ?? undefined,
          taxExempt: initial.taxExempt,
          notes: initial.notes ?? undefined,
        }
      : { type: 'cash' },
  });

  async function onSubmit(values: CreateCustomerPayload): Promise<void> {
    setSubmitError(null);
    const payload: Record<string, unknown> = {
      type: values.type,
      name: values.name,
    };
    if (values.email) payload.email = values.email;
    if (values.phone) payload.phone = values.phone;
    if (values.accountId) payload.accountId = values.accountId;
    if (values.taxExempt !== undefined) payload.taxExempt = values.taxExempt;
    if (values.notes) payload.notes = values.notes;

    const url = mode === 'create' ? '/api/customers' : `/api/customers/${initial?.id}`;
    const method = mode === 'create' ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      const msg = data?.message ?? 'Save failed. Please try again.';
      setSubmitError(msg);
      toast.error(msg);
      return;
    }
    const created = (await res.json()) as CustomerDto;
    toast.success(mode === 'create' ? 'Customer created' : 'Customer updated');
    router.push(`/customers/${created.id ?? initial?.id}`);
    router.refresh();
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-8"
      aria-busy={isSubmitting}
    >
      <Section title="Identity">
        <Field label="Type" error={errors.type?.message}>
          <select
            {...register('type')}
            className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
          >
            {customerTypeValues.map((v) => (
              <option key={v} value={v}>
                {v.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" error={errors.name?.message}>
          <Input placeholder="John Smith" {...register('name')} />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Phone" error={errors.phone?.message} hint="E.164 format, e.g. +15555550100">
          <Input placeholder="+15555550100" {...register('phone')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" placeholder="customer@example.com" {...register('email')} />
        </Field>
      </Section>

      <Section title="Billing">
        <Field label="Account ID (optional)" error={errors.accountId?.message}>
          <Input placeholder="UUID of commercial account" {...register('accountId')} />
        </Field>
        <Field label="Tax exempt">
          <label className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
            <input type="checkbox" className="h-4 w-4 accent-orange" {...register('taxExempt')} />
            <span>This customer is tax-exempt</span>
          </label>
        </Field>
        <Field label="Notes" error={errors.notes?.message}>
          <textarea
            {...register('notes')}
            className="w-full rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm text-text-primary-on-dark"
            rows={3}
          />
        </Field>
      </Section>

      {submitError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {submitError}
        </div>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create customer' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
      <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
}): JSX.Element {
  const id = React.useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
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
