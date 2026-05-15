'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateTruckPayload,
  type TruckDto,
  createTruckSchema,
  truckCapacityClassValues,
  truckEquipmentValues,
  truckFuelTypeValues,
  truckStatusValues,
  truckTypeValues,
} from '@ustowdispatch/shared';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';

interface Props {
  mode: 'create' | 'edit';
  initial?: TruckDto;
}

export function TruckForm({ mode, initial }: Props): JSX.Element {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateTruckPayload>({
    resolver: zodResolver(createTruckSchema),
    defaultValues: initial
      ? {
          unitNumber: initial.unitNumber,
          truckType: initial.truckType,
          year: initial.year ?? undefined,
          make: initial.make ?? undefined,
          model: initial.model ?? undefined,
          plate: initial.plate ?? undefined,
          plateState: initial.plateState ?? undefined,
          vin: initial.vin ?? undefined,
          capacityClass: initial.capacityClass ?? undefined,
          gvwrLbs: initial.gvwrLbs ?? undefined,
          fuelType: initial.fuelType ?? undefined,
          equipment: initial.equipment ?? undefined,
          registrationExpiresAt: initial.registrationExpiresAt ?? undefined,
          insuranceExpiresAt: initial.insuranceExpiresAt ?? undefined,
          iftaLicense: initial.iftaLicense ?? undefined,
          irpAccount: initial.irpAccount ?? undefined,
          teslaCertified: initial.teslaCertified,
          aaaFlatbed: initial.aaaFlatbed,
          heavyDutyCapable: initial.heavyDutyCapable,
          currentOdometer: initial.currentOdometer ?? undefined,
          status: initial.status,
          notes: initial.notes ?? undefined,
        }
      : { unitNumber: '', truckType: 'light_duty', status: 'active' },
  });

  const onSubmit: SubmitHandler<CreateTruckPayload> = async (values) => {
    setSubmitError(null);
    const url = mode === 'create' ? '/api/fleet/trucks' : `/api/fleet/trucks/${initial?.id}`;
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
    const created = (await res.json()) as TruckDto;
    toast.success(mode === 'create' ? 'Truck created' : 'Truck updated');
    router.push(`/fleet/trucks/${created.id ?? initial?.id}`);
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
        <Field label="Unit number" error={errors.unitNumber?.message}>
          <Input data-testid="truck-unit" {...register('unitNumber')} />
        </Field>
        <Field label="Year" error={errors.year?.message}>
          <Input {...register('year')} />
        </Field>
        <Field label="Make" error={errors.make?.message}>
          <Input {...register('make')} />
        </Field>
        <Field label="Model" error={errors.model?.message}>
          <Input {...register('model')} />
        </Field>
        <Field label="VIN" error={errors.vin?.message}>
          <Input {...register('vin')} />
        </Field>
      </Section>

      <Section title="Classification">
        <Field label="Truck type">
          <select
            {...register('truckType')}
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2"
          >
            {truckTypeValues.map((v) => (
              <option key={v} value={v}>
                {v.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Capacity class">
          <select
            {...register('capacityClass')}
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2"
          >
            <option value="">—</option>
            {truckCapacityClassValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fuel type">
          <select
            {...register('fuelType')}
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2"
          >
            <option value="">—</option>
            {truckFuelTypeValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            {...register('status')}
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2"
          >
            {truckStatusValues.map((v) => (
              <option key={v} value={v}>
                {v.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="GVWR (lbs)" error={errors.gvwrLbs?.message}>
          <Input type="number" {...register('gvwrLbs', { valueAsNumber: true })} />
        </Field>
        <Field label="Current odometer" error={errors.currentOdometer?.message}>
          <Input type="number" {...register('currentOdometer', { valueAsNumber: true })} />
        </Field>
      </Section>

      <Section title="Equipment">
        <fieldset className="col-span-full grid grid-cols-2 gap-2 md:grid-cols-3">
          {truckEquipmentValues.map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
              <input
                type="checkbox"
                value={v}
                {...register('equipment')}
                className="accent-orange"
              />
              <span>{v.replace('_', ' ')}</span>
            </label>
          ))}
        </fieldset>
      </Section>

      <Section title="Compliance">
        <Field label="Registration expires">
          <Input type="date" {...register('registrationExpiresAt')} />
        </Field>
        <Field label="Insurance expires">
          <Input type="date" {...register('insuranceExpiresAt')} />
        </Field>
        <Field label="IFTA license">
          <Input {...register('iftaLicense')} />
        </Field>
        <Field label="IRP account">
          <Input {...register('irpAccount')} />
        </Field>
      </Section>

      <Section title="Certifications">
        <label className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
          <input type="checkbox" {...register('teslaCertified')} className="accent-orange" />
          Tesla certified
        </label>
        <label className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
          <input type="checkbox" {...register('aaaFlatbed')} className="accent-orange" />
          AAA flatbed
        </label>
        <label className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
          <input type="checkbox" {...register('heavyDutyCapable')} className="accent-orange" />
          Heavy-duty capable
        </label>
      </Section>

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
        <Button type="submit" disabled={isSubmitting} data-testid="truck-submit">
          {mode === 'create' ? 'Create truck' : 'Save changes'}
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
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}): JSX.Element {
  const id = React.useId();
  const errorId = `${id}-error`;
  let enhanced: React.ReactNode = children;
  if (React.isValidElement(children)) {
    const extra: Record<string, string | boolean> = { id };
    if (error) {
      extra['aria-describedby'] = errorId;
      extra['aria-invalid'] = true;
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
      ) : null}
    </div>
  );
}
