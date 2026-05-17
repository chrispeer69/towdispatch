'use client';

import { useUser } from '@/components/app-shell/session-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateDriverPayload,
  type DriverDto,
  ROLES,
  type Role,
  createDriverSchema,
  driverCdlClassValues,
  driverCertificationValues,
  driverEmploymentStatusValues,
} from '@ustowdispatch/shared';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';

const COMMISSION_EDIT_ROLES: ReadonlySet<Role> = new Set([ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER]);

interface Props {
  mode: 'create' | 'edit';
  initial?: DriverDto;
}

export function DriverForm({ mode, initial }: Props): JSX.Element {
  const router = useRouter();
  const user = useUser();
  const canEditCommission = COMMISSION_EDIT_ROLES.has(user.role as Role);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateDriverPayload>({
    resolver: zodResolver(createDriverSchema),
    defaultValues: initial
      ? {
          firstName: initial.firstName,
          lastName: initial.lastName,
          preferredName: initial.preferredName ?? undefined,
          employeeNumber: initial.employeeNumber ?? undefined,
          phone: initial.phone ?? undefined,
          email: initial.email ?? undefined,
          cdlClass: initial.cdlClass,
          cdlExpiresAt: initial.cdlExpiresAt ?? undefined,
          licenseNumber: initial.licenseNumber ?? undefined,
          licenseState: initial.licenseState ?? undefined,
          licenseExpiresAt: initial.licenseExpiresAt ?? undefined,
          medicalCardExpiresAt: initial.medicalCardExpiresAt ?? undefined,
          drugTestLastAt: initial.drugTestLastAt ?? undefined,
          roadTestCompletedAt: initial.roadTestCompletedAt ?? undefined,
          certifications: initial.certifications ?? undefined,
          hiredAt: initial.hiredAt ?? undefined,
          employmentStatus: initial.employmentStatus,
          defaultCommissionPct: initial.defaultCommissionPct ?? undefined,
          notes: initial.notes ?? undefined,
        }
      : { firstName: '', lastName: '', cdlClass: 'none', employmentStatus: 'active' },
  });

  const onSubmit: SubmitHandler<CreateDriverPayload> = async (values) => {
    setSubmitError(null);
    const url = mode === 'create' ? '/api/fleet/drivers' : `/api/fleet/drivers/${initial?.id}`;
    const method = mode === 'create' ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      const msg = data?.message ?? 'Save failed.';
      setSubmitError(msg);
      toast.error(msg);
      return;
    }
    const created = (await res.json()) as DriverDto;
    toast.success(mode === 'create' ? 'Driver created' : 'Driver updated');
    router.push(`/fleet/drivers/${created.id ?? initial?.id}`);
    router.refresh();
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-8"
      aria-busy={isSubmitting}
    >
      <Section title="Identity">
        <Field label="First name" error={errors.firstName?.message}>
          <Input data-testid="driver-first-name" {...register('firstName')} />
        </Field>
        <Field label="Last name" error={errors.lastName?.message}>
          <Input data-testid="driver-last-name" {...register('lastName')} />
        </Field>
        <Field label="Preferred name">
          <Input {...register('preferredName')} />
        </Field>
        <Field label="Employee #" error={errors.employeeNumber?.message}>
          <Input {...register('employeeNumber')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register('phone')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input {...register('email')} />
        </Field>
      </Section>

      <Section title="Employment">
        <Field label="Status">
          <select
            {...register('employmentStatus')}
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2"
          >
            {driverEmploymentStatusValues.map((v) => (
              <option key={v} value={v}>
                {v.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hire date">
          <Input type="date" {...register('hiredAt')} />
        </Field>
      </Section>

      <Section title="Licensing">
        <Field label="CDL class">
          <select
            {...register('cdlClass')}
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2"
          >
            {driverCdlClassValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="CDL expires">
          <Input type="date" {...register('cdlExpiresAt')} />
        </Field>
        <Field label="License #">
          <Input {...register('licenseNumber')} />
        </Field>
        <Field label="License state" error={errors.licenseState?.message}>
          <Input {...register('licenseState')} />
        </Field>
        <Field label="License expires">
          <Input type="date" {...register('licenseExpiresAt')} />
        </Field>
        <Field label="Medical card expires">
          <Input type="date" {...register('medicalCardExpiresAt')} />
        </Field>
        <Field label="Drug test (last)">
          <Input type="date" {...register('drugTestLastAt')} />
        </Field>
        <Field label="Road test (completed)">
          <Input type="date" {...register('roadTestCompletedAt')} />
        </Field>
      </Section>

      <Section title="Certifications">
        <fieldset className="col-span-full grid grid-cols-2 gap-2 md:grid-cols-3">
          {driverCertificationValues.map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
              <input
                type="checkbox"
                value={v}
                {...register('certifications')}
                className="accent-orange"
              />
              <span>{v}</span>
            </label>
          ))}
        </fieldset>
      </Section>

      {canEditCommission ? (
        <Section title="Commission Settings">
          <Field
            label="Default Commission Rate"
            error={errors.defaultCommissionPct?.message}
            helper="This is the default rate applied to each invoice line item assigned to this driver. Dispatcher can adjust per-line during invoice review."
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                step={0.01}
                data-testid="driver-default-commission-pct"
                placeholder={initial?.defaultCommissionPct == null ? 'Not set' : undefined}
                {...register('defaultCommissionPct', {
                  setValueAs: (v) =>
                    v === '' || v === null || Number.isNaN(Number(v)) ? undefined : Number(v),
                })}
              />
              <span className="text-sm text-text-secondary-on-dark">
                % of invoice line items by default
              </span>
            </div>
          </Field>
        </Section>
      ) : null}

      <Section title="Notes">
        <textarea
          {...register('notes')}
          rows={3}
          className="col-span-full w-full rounded-[8px] border border-divider bg-bg-base px-3 py-2 text-sm"
        />
      </Section>

      {submitError ? (
        <p className="text-sm text-red-400" role="alert" aria-live="assertive">
          {submitError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting} data-testid="driver-submit">
          {mode === 'create' ? 'Create driver' : 'Save changes'}
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
    <section className="space-y-3">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark-on-dark/60">
        {title}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  error,
  helper,
  children,
}: {
  label: string;
  error?: string | undefined;
  helper?: string | undefined;
  children: React.ReactNode;
}): JSX.Element {
  const id = React.useId();
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  let enhanced: React.ReactNode = children;
  if (React.isValidElement(children)) {
    const extra: Record<string, string | boolean> = { id };
    if (error) {
      extra['aria-describedby'] = errorId;
      extra['aria-invalid'] = true;
    } else if (helper) {
      extra['aria-describedby'] = helperId;
    }
    enhanced = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, extra);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {enhanced}
      {error ? (
        <p id={errorId} className="text-xs text-red-400">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-xs text-text-secondary-on-dark">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
