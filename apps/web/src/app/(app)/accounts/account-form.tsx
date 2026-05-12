'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type AccountDto,
  type CreateAccountPayload,
  billingTermsValues,
  createAccountSchema,
} from '@towcommand/shared';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

interface Props {
  mode: 'create' | 'edit';
  initial?: AccountDto;
}

export function AccountForm({ mode, initial }: Props): JSX.Element {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateAccountPayload>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          accountNumber: initial.accountNumber ?? undefined,
          billingTerms: initial.billingTerms,
          creditLimit: initial.creditLimit ?? undefined,
          billingEmail: initial.billingEmail ?? undefined,
          billingPhone: initial.billingPhone ?? undefined,
          apContactName: initial.apContactName ?? undefined,
          apContactEmail: initial.apContactEmail ?? undefined,
          coiRequired: initial.coiRequired,
          isMotorClub: initial.isMotorClub,
          motorClubNetworkCode: initial.motorClubNetworkCode ?? undefined,
          active: initial.active,
          notes: initial.notes ?? undefined,
        }
      : { billingTerms: 'net_30', active: true, coiRequired: false, isMotorClub: false },
  });

  async function onSubmit(values: CreateAccountPayload): Promise<void> {
    setSubmitError(null);
    const payload: Record<string, unknown> = {
      name: values.name,
      billingTerms: values.billingTerms,
    };
    for (const k of [
      'accountNumber',
      'creditLimit',
      'billingEmail',
      'billingPhone',
      'apContactName',
      'apContactEmail',
      'motorClubNetworkCode',
      'notes',
    ] as const) {
      const v = values[k];
      if (v) payload[k] = v;
    }
    if (values.coiRequired !== undefined) payload.coiRequired = values.coiRequired;
    if (values.isMotorClub !== undefined) payload.isMotorClub = values.isMotorClub;
    if (values.active !== undefined) payload.active = values.active;

    const url = mode === 'create' ? '/api/accounts' : `/api/accounts/${initial?.id}`;
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
    const result = (await res.json()) as AccountDto;
    toast.success(mode === 'create' ? 'Account created' : 'Account updated');
    router.push(`/accounts/${result.id ?? initial?.id}`);
    router.refresh();
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-8"
      aria-busy={isSubmitting}
    >
      <Section title="Company">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Account name" error={errors.name?.message}>
            <Input placeholder="Acme Logistics" {...register('name')} />
          </Field>
          <Field label="Internal account #" error={errors.accountNumber?.message}>
            <Input placeholder="optional" {...register('accountNumber')} />
          </Field>
        </div>
      </Section>

      <Section title="Billing terms">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Terms" error={errors.billingTerms?.message}>
            <select
              {...register('billingTerms')}
              className="h-11 w-full rounded-[10px] border border-steel-border bg-steel-mid px-3 text-sm text-text-primary"
            >
              {billingTermsValues.map((v) => (
                <option key={v} value={v}>
                  {v.replace('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Credit limit" error={errors.creditLimit?.message}>
            <Input placeholder="50000.00" {...register('creditLimit')} />
          </Field>
        </div>
      </Section>

      <Section title="Contacts">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Billing email" error={errors.billingEmail?.message}>
            <Input type="email" placeholder="ar@example.com" {...register('billingEmail')} />
          </Field>
          <Field label="Billing phone" error={errors.billingPhone?.message}>
            <Input placeholder="+15555550100" {...register('billingPhone')} />
          </Field>
          <Field label="AP contact name" error={errors.apContactName?.message}>
            <Input placeholder="Jane Doe" {...register('apContactName')} />
          </Field>
          <Field label="AP contact email" error={errors.apContactEmail?.message}>
            <Input type="email" placeholder="jane@example.com" {...register('apContactEmail')} />
          </Field>
        </div>
      </Section>

      <Section title="Motor club / settings">
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" className="h-4 w-4 accent-orange" {...register('isMotorClub')} />
            <span>This is a motor club account</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" className="h-4 w-4 accent-orange" {...register('coiRequired')} />
            <span>COI required</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-orange"
              defaultChecked={initial?.active ?? true}
              {...register('active')}
            />
            <span>Active</span>
          </label>
        </div>
        <Field
          label="Motor club network code"
          error={errors.motorClubNetworkCode?.message}
          hint="e.g. AGERO, HONK, AAA"
        >
          <Input placeholder="AGERO" {...register('motorClubNetworkCode')} />
        </Field>
        <Field label="Notes" error={errors.notes?.message}>
          <textarea
            {...register('notes')}
            rows={3}
            className="w-full rounded-[10px] border border-steel-border bg-steel-mid px-3 py-2 text-sm text-text-primary"
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
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create account' : 'Save changes'}
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
    <section className="space-y-4 rounded-[14px] border border-steel-border bg-steel-mid p-5">
      <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
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
