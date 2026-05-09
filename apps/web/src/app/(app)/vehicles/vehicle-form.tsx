'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateVehiclePayload,
  type VehicleDto,
  createVehicleSchema,
  drivetrainValues,
  vehicleClassValues,
} from '@towcommand/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

interface Props {
  mode: 'create' | 'edit';
  initial?: VehicleDto;
}

export function VehicleForm({ mode, initial }: Props): JSX.Element {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateVehiclePayload>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: initial
      ? {
          vin: initial.vin ?? undefined,
          plate: initial.plate ?? undefined,
          plateState: initial.plateState ?? undefined,
          year: initial.year ?? undefined,
          make: initial.make ?? undefined,
          model: initial.model ?? undefined,
          color: initial.color ?? undefined,
          vehicleClass: initial.vehicleClass,
          drivetrain: initial.drivetrain,
          isElectric: initial.isElectric,
          isLowClearance: initial.isLowClearance,
          specialInstructions: initial.specialInstructions ?? undefined,
        }
      : { vehicleClass: 'unknown', drivetrain: 'unknown' },
  });

  async function onSubmit(values: CreateVehiclePayload): Promise<void> {
    setSubmitError(null);
    const payload: Record<string, unknown> = {
      vehicleClass: values.vehicleClass,
      drivetrain: values.drivetrain,
    };
    for (const k of [
      'vin',
      'plate',
      'plateState',
      'make',
      'model',
      'color',
      'specialInstructions',
    ] as const) {
      const v = values[k];
      if (v) payload[k] = v;
    }
    if (values.year !== undefined && values.year !== null && !Number.isNaN(values.year)) {
      payload.year = Number(values.year);
    }
    if (values.isElectric !== undefined) payload.isElectric = values.isElectric;
    if (values.isLowClearance !== undefined) payload.isLowClearance = values.isLowClearance;

    const url = mode === 'create' ? '/api/vehicles' : `/api/vehicles/${initial?.id}`;
    const method = mode === 'create' ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      setSubmitError(data?.message ?? 'Save failed. Please try again.');
      return;
    }
    const result = (await res.json()) as VehicleDto;
    router.push(`/vehicles/${result.id ?? initial?.id}`);
    router.refresh();
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <Section title="Identification">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="VIN (17 chars)" error={errors.vin?.message}>
            <Input
              placeholder="1HGCM82633A004352"
              maxLength={17}
              className="font-mono uppercase"
              {...register('vin')}
            />
          </Field>
          <Field label="Plate" error={errors.plate?.message}>
            <Input placeholder="ABC123" {...register('plate')} />
          </Field>
          <Field label="Plate state (2-letter)" error={errors.plateState?.message}>
            <Input placeholder="OH" maxLength={2} {...register('plateState')} />
          </Field>
        </div>
      </Section>

      <Section title="Specs">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Year" error={errors.year?.message}>
            <Input
              type="number"
              placeholder="2020"
              {...register('year', { valueAsNumber: true })}
            />
          </Field>
          <Field label="Make" error={errors.make?.message}>
            <Input placeholder="Honda" {...register('make')} />
          </Field>
          <Field label="Model" error={errors.model?.message}>
            <Input placeholder="Civic" {...register('model')} />
          </Field>
          <Field label="Color" error={errors.color?.message}>
            <Input placeholder="Silver" {...register('color')} />
          </Field>
          <Field label="Class" error={errors.vehicleClass?.message}>
            <select
              {...register('vehicleClass')}
              className="h-11 w-full rounded-[10px] border border-steel-border bg-steel-mid px-3 text-sm text-text-primary"
            >
              {vehicleClassValues.map((v) => (
                <option key={v} value={v}>
                  {v.replace('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Drivetrain" error={errors.drivetrain?.message}>
            <select
              {...register('drivetrain')}
              className="h-11 w-full rounded-[10px] border border-steel-border bg-steel-mid px-3 text-sm text-text-primary"
            >
              {drivetrainValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" className="h-4 w-4 accent-orange" {...register('isElectric')} />
            <span>Electric / hybrid</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-orange"
              {...register('isLowClearance')}
            />
            <span>Low clearance — needs flatbed</span>
          </label>
        </div>
      </Section>

      <Section title="Notes">
        <Field label="Special instructions" error={errors.specialInstructions?.message}>
          <textarea
            {...register('specialInstructions')}
            rows={3}
            placeholder="e.g. loose front bumper, AWD do not flat-tow"
            className="w-full rounded-[10px] border border-steel-border bg-steel-mid px-3 py-2 text-sm text-text-primary"
          />
        </Field>
      </Section>

      {submitError ? (
        <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {submitError}
        </div>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create vehicle' : 'Save changes'}
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
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
