'use client';

/**
 * /settings/company — the 17-field Company Profile editor.
 *
 * State model:
 *   - The form is driven by react-hook-form bound to companyProfilePatchSchema
 *     from @ustowdispatch/shared (the same schema the API enforces). RHF
 *     handles dirty tracking, validation, and submission state.
 *   - Phone fields are displayed as (NNN) NNN-NNNN but stored as E.164.
 *     Conversion happens on blur (display→E.164) and at hydration time
 *     (E.164→display).
 *   - Federal EIN is displayed and stored identically (NN-NNNNNNN) so the
 *     form value matches the schema verbatim.
 *
 * RBAC: PATCH /tenants/current is gated to OWNER + ADMIN. Lesser roles
 * hit 403, which the API BFF surfaces — we render the form read-only and
 * hide the Save button. Manager + Accounting see the form disabled;
 * Dispatcher/Driver/Auditor are bounced earlier by the route gate (see
 * page.tsx).
 *
 * Dirty-state navigation guard: react-hook-form's `formState.isDirty`
 * powers a beforeunload listener. The Next.js client router doesn't fire
 * beforeunload for in-app nav, but the rest of the codebase hasn't
 * introduced a custom guard pattern either; beforeunload covers the
 * tab-close case, which is the highest-impact loss.
 */
import { PhoneInput } from '@/app/(app)/settings/company/phone-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CompanyProfilePatchPayload,
  type Role,
  type TenantDto,
  US_STATES,
  companyProfilePatchSchema,
} from '@ustowdispatch/shared';
import { Lock } from 'lucide-react';
import { type JSX, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ALL_TIMEZONES, US_TIMEZONES } from './timezones';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

const DAY_LABELS: Record<(typeof DAYS)[number], string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

const EDIT_ROLES: Role[] = ['owner', 'admin'];

interface Props {
  initial: TenantDto;
  callerRole: Role | null;
}

type FormValues = CompanyProfilePatchPayload;

export function CompanyProfileForm({ initial, callerRole }: Props): JSX.Element {
  const canEdit = callerRole !== null && EDIT_ROLES.includes(callerRole);
  const [permissionLocked, setPermissionLocked] = useState(false);

  const defaultValues = useMemo<FormValues>(() => hydrate(initial), [initial]);

  const form = useForm<FormValues>({
    resolver: zodResolver(companyProfilePatchSchema),
    mode: 'onBlur',
    defaultValues,
  });

  const dirty = form.formState.isDirty;

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const mailingSameAsPhysical = form.watch('settings.mailing_address') === undefined;

  async function onSubmit(values: FormValues): Promise<void> {
    const res = await fetch('/api/tenants/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        code?: string;
        message?: string;
      } | null;
      if (res.status === 401 || res.status === 403) {
        setPermissionLocked(true);
        return;
      }
      toast.error(body?.message ?? `Save failed (HTTP ${res.status}).`);
      return;
    }
    const updated = (await res.json()) as TenantDto;
    form.reset(hydrate(updated));
    toast.success('Company profile saved.');
  }

  if (permissionLocked) {
    return <PermissionLockedNotice />;
  }

  const errs = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-24">
      {!canEdit ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[14px] border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <div>
            <p className="font-semibold text-text-primary-on-dark">Read-only access</p>
            <p className="mt-1 text-text-secondary-on-dark">
              Only Owner and Admin can edit Company Profile. You can review the values below.
            </p>
          </div>
        </div>
      ) : null}

      {/* SECTION 1 — Legal & Tax */}
      <Section title="Legal & Tax" description="Filing names, license, and federal IDs.">
        <Field label="Legal Business Name" required error={errs.name?.message}>
          <Input disabled={!canEdit} {...form.register('name')} />
        </Field>
        <Field label="DBA / Brand Name" error={errs.settings?.dba_name?.message}>
          <Input disabled={!canEdit} {...form.register('settings.dba_name')} />
        </Field>
        <Field
          label="Federal EIN"
          required
          hint="Format NN-NNNNNNN"
          error={errs.settings?.federal_ein?.message}
        >
          <Input
            disabled={!canEdit}
            placeholder="12-3456789"
            inputMode="numeric"
            maxLength={10}
            {...form.register('settings.federal_ein', {
              onChange: (e) => {
                const formatted = formatEin(e.target.value);
                form.setValue('settings.federal_ein', formatted, { shouldDirty: true });
              },
            })}
          />
        </Field>
        <Field
          label="State License #"
          required
          error={errs.settings?.state_license_number?.message}
        >
          <Input disabled={!canEdit} {...form.register('settings.state_license_number')} />
        </Field>
        <Field label="MC / DOT Number" error={errs.settings?.mc_dot_number?.message}>
          <Input disabled={!canEdit} {...form.register('settings.mc_dot_number')} />
        </Field>
      </Section>

      {/* SECTION 2 — Locations */}
      <Section
        title="Locations"
        description="Physical address is mandatory. Mailing address defaults to physical."
      >
        <fieldset className="space-y-3">
          <legend className="font-condensed text-sm font-semibold uppercase tracking-[0.16em] text-text-secondary-on-dark">
            Physical Address
          </legend>
          <AddressFields
            disabled={!canEdit}
            namePrefix="settings.physical_address"
            register={form.register}
            errors={errs.settings?.physical_address}
          />
        </fieldset>

        <fieldset className="mt-6 space-y-3">
          <legend className="flex items-center gap-3 font-condensed text-sm font-semibold uppercase tracking-[0.16em] text-text-secondary-on-dark">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={mailingSameAsPhysical}
              onChange={(e) => {
                if (e.target.checked) {
                  form.setValue('settings.mailing_address', undefined, { shouldDirty: true });
                } else {
                  const phys = form.getValues('settings.physical_address');
                  form.setValue('settings.mailing_address', phys, { shouldDirty: true });
                }
              }}
              className="h-4 w-4 rounded border-divider bg-bg-surface accent-orange"
            />
            Mailing Address — same as physical
          </legend>
          {!mailingSameAsPhysical ? (
            <AddressFields
              disabled={!canEdit}
              namePrefix="settings.mailing_address"
              register={form.register}
              errors={errs.settings?.mailing_address}
            />
          ) : null}
        </fieldset>
      </Section>

      {/* SECTION 3 — Contact */}
      <Section title="Contact" description="Reachability for customers and partners.">
        <Field
          label="Phone"
          required
          hint="Formatted (NNN) NNN-NNNN, stored as E.164"
          error={errs.settings?.phone?.message}
        >
          <PhoneInput
            disabled={!canEdit}
            value={form.watch('settings.phone') ?? ''}
            onChange={(e164) =>
              form.setValue('settings.phone', e164, { shouldDirty: true, shouldValidate: true })
            }
          />
        </Field>
        <Field label="Email" required error={errs.settings?.email?.message}>
          <Input
            type="email"
            disabled={!canEdit}
            autoComplete="email"
            {...form.register('settings.email')}
          />
        </Field>
        <Field label="Website" error={errs.settings?.website?.message}>
          <Input
            type="url"
            disabled={!canEdit}
            placeholder="https://example.com"
            {...form.register('settings.website')}
          />
        </Field>
      </Section>

      {/* SECTION 4 — Branding */}
      <Section
        title="Branding"
        description="Logo and accent colour shown on invoices and the tracking page."
      >
        <Field
          label="Logo URL"
          hint="Paste a hosted image URL. File upload coming soon."
          error={errs.settings?.logo_url?.message}
        >
          <Input
            disabled={!canEdit}
            placeholder="https://cdn.example.com/logo.png"
            {...form.register('settings.logo_url')}
          />
        </Field>
        <Field
          label="Brand Color"
          hint="Hex like #1E40AF"
          error={errs.settings?.brand_color?.message}
        >
          <div className="flex items-center gap-3">
            <Input
              type="color"
              disabled={!canEdit}
              value={form.watch('settings.brand_color') ?? '#1E40AF'}
              onChange={(e) =>
                form.setValue('settings.brand_color', e.target.value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              className="h-11 w-24 cursor-pointer p-1"
            />
            <code className="font-mono text-xs text-text-secondary-on-dark">
              {form.watch('settings.brand_color') ?? '—'}
            </code>
          </div>
        </Field>
      </Section>

      {/* SECTION 5 — Operations */}
      <Section title="Operations" description="Business hours and timezone for dispatching.">
        <BusinessHoursGrid disabled={!canEdit} form={form} />

        <Field label="Timezone" required error={errs.settings?.timezone?.message}>
          <select
            disabled={!canEdit}
            {...form.register('settings.timezone')}
            className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark focus-visible:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
          >
            <optgroup label="United States">
              {US_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </optgroup>
            <optgroup label="Other">
              {ALL_TIMEZONES.filter((t) => !US_TIMEZONES.includes(t as never)).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
      </Section>

      {/* SECTION 6 — Owner */}
      <Section title="Owner" description="The accountable person on file for this account.">
        <Field label="Owner Name" required error={errs.settings?.owner_name?.message}>
          <Input disabled={!canEdit} {...form.register('settings.owner_name')} />
        </Field>
        <Field label="Owner Mobile" required error={errs.settings?.owner_mobile?.message}>
          <PhoneInput
            disabled={!canEdit}
            value={form.watch('settings.owner_mobile') ?? ''}
            onChange={(e164) =>
              form.setValue('settings.owner_mobile', e164, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
        </Field>
      </Section>

      {/* SECTION 7 — Compliance */}
      <Section title="Compliance" description="Defaults used by impound and lien workflows.">
        <Field
          label="Default Lien State"
          required
          error={errs.settings?.default_lien_state?.message}
        >
          <select
            disabled={!canEdit}
            {...form.register('settings.default_lien_state')}
            className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark focus-visible:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
          >
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {canEdit ? (
        <div
          className={
            'fixed inset-x-0 bottom-0 z-20 border-t border-divider bg-bg-base/95 px-6 py-3 backdrop-blur transition-opacity ' +
            (dirty ? 'opacity-100' : 'pointer-events-none opacity-0')
          }
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-xs text-text-secondary-on-dark">You have unsaved changes.</p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => form.reset(defaultValues)}
                disabled={form.formState.isSubmitting}
              >
                Discard
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

interface SectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

function Section({ title, description, children }: SectionProps): JSX.Element {
  return (
    <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
      <header>
        <h2 className="font-condensed text-lg font-extrabold uppercase tracking-tight text-text-primary-on-dark">
          {title}
        </h2>
        <p className="mt-1 text-sm text-text-secondary-on-dark">{description}</p>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}

function Field({ label, required, hint, error, children }: FieldProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface AddressFieldsProps {
  namePrefix: 'settings.physical_address' | 'settings.mailing_address';
  disabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errors: any;
}

function AddressFields({
  namePrefix,
  disabled,
  register,
  errors,
}: AddressFieldsProps): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label>Street Address 1</Label>
        <Input disabled={disabled} {...register(`${namePrefix}.street_1`)} />
        {errors?.street_1?.message ? (
          <p className="mt-1 text-xs text-danger">{errors.street_1.message}</p>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <Label>Street Address 2 (optional)</Label>
        <Input disabled={disabled} {...register(`${namePrefix}.street_2`)} />
      </div>
      <div>
        <Label>City</Label>
        <Input disabled={disabled} {...register(`${namePrefix}.city`)} />
        {errors?.city?.message ? (
          <p className="mt-1 text-xs text-danger">{errors.city.message}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>State</Label>
          <select
            disabled={disabled}
            {...register(`${namePrefix}.state`)}
            className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark focus-visible:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
          >
            <option value="" />
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>ZIP</Label>
          <Input disabled={disabled} placeholder="00000" {...register(`${namePrefix}.zip`)} />
        </div>
      </div>
    </div>
  );
}

interface BusinessHoursGridProps {
  disabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
}

function BusinessHoursGrid({ disabled, form }: BusinessHoursGridProps): JSX.Element {
  function copyTo(target: 'weekdays' | 'weekends'): void {
    const days =
      target === 'weekdays'
        ? (['tuesday', 'wednesday', 'thursday', 'friday'] as const)
        : (['sunday'] as const);
    const source = target === 'weekdays' ? 'monday' : 'saturday';
    const src = form.getValues(`settings.business_hours.${source}`);
    for (const d of days) {
      form.setValue(`settings.business_hours.${d}`, src, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  return (
    <div className="space-y-2 rounded-[10px] border border-divider bg-bg-surface-elevated/40 p-3">
      <div className="flex items-center justify-between">
        <p className="font-condensed text-sm font-semibold uppercase tracking-[0.16em] text-text-secondary-on-dark">
          Business Hours
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => copyTo('weekdays')}
            className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary-on-dark hover:text-text-primary-on-dark disabled:opacity-50"
          >
            Copy Mon → weekday
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => copyTo('weekends')}
            className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary-on-dark hover:text-text-primary-on-dark disabled:opacity-50"
          >
            Copy Sat → Sun
          </button>
        </div>
      </div>

      {DAYS.map((d) => {
        const closed = form.watch(`settings.business_hours.${d}.closed`);
        return (
          <div
            key={d}
            className="grid grid-cols-12 items-center gap-2 border-t border-divider/40 pt-2 first:border-t-0 first:pt-0"
          >
            <div className="col-span-3 text-sm text-text-primary-on-dark">{DAY_LABELS[d]}</div>
            <label className="col-span-3 flex items-center gap-2 text-xs text-text-secondary-on-dark">
              <input
                type="checkbox"
                disabled={disabled}
                checked={closed ?? false}
                onChange={(e) =>
                  form.setValue(`settings.business_hours.${d}.closed`, e.target.checked, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                className="h-4 w-4 rounded border-divider bg-bg-surface accent-orange"
              />
              Closed
            </label>
            <input
              type="time"
              disabled={disabled || closed}
              {...form.register(`settings.business_hours.${d}.open`)}
              className="col-span-3 h-9 rounded-[8px] border border-divider bg-bg-surface px-2 text-sm text-text-primary-on-dark disabled:opacity-40"
            />
            <input
              type="time"
              disabled={disabled || closed}
              {...form.register(`settings.business_hours.${d}.close`)}
              className="col-span-3 h-9 rounded-[8px] border border-divider bg-bg-surface px-2 text-sm text-text-primary-on-dark disabled:opacity-40"
            />
          </div>
        );
      })}
    </div>
  );
}

function PermissionLockedNotice(): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-[14px] border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
      <div>
        <p className="font-semibold text-text-primary-on-dark">
          You don&rsquo;t have permission to edit Company Profile
        </p>
        <p className="mt-1 text-text-secondary-on-dark">
          Editing the company profile is gated to Owner and Admin roles. Ask an admin to switch
          your role or save the change on your behalf.
        </p>
      </div>
    </div>
  );
}

function hydrate(tenant: TenantDto): FormValues {
  const s = (tenant.settings ?? {}) as Record<string, unknown>;
  return {
    name: tenant.name,
    settings: {
      dba_name: pickString(s.dba_name) ?? undefined,
      federal_ein: pickString(s.federal_ein) ?? '',
      state_license_number: pickString(s.state_license_number) ?? '',
      mc_dot_number: pickString(s.mc_dot_number) ?? undefined,
      physical_address: pickAddress(s.physical_address) ?? blankAddress(),
      mailing_address: pickAddress(s.mailing_address) ?? undefined,
      phone: pickString(s.phone) ?? '',
      email: pickString(s.email) ?? '',
      website: pickString(s.website) ?? undefined,
      logo_url: pickString(s.logo_url) ?? undefined,
      brand_color: pickString(s.brand_color) ?? '#1E40AF',
      business_hours: pickBusinessHours(s.business_hours) ?? defaultBusinessHours(),
      timezone: pickString(s.timezone) ?? 'America/New_York',
      owner_name: pickString(s.owner_name) ?? '',
      owner_mobile: pickString(s.owner_mobile) ?? '',
      default_lien_state: (pickString(s.default_lien_state) ?? 'OH') as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickAddress(v: unknown): any | null {
  if (typeof v !== 'object' || v === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return v as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickBusinessHours(v: unknown): any | null {
  if (typeof v !== 'object' || v === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return v as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blankAddress(): any {
  return { street_1: '', city: '', state: '' as never, zip: '' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defaultBusinessHours(): any {
  return {
    monday: { closed: false, open: '08:00', close: '17:00' },
    tuesday: { closed: false, open: '08:00', close: '17:00' },
    wednesday: { closed: false, open: '08:00', close: '17:00' },
    thursday: { closed: false, open: '08:00', close: '17:00' },
    friday: { closed: false, open: '08:00', close: '17:00' },
    saturday: { closed: true },
    sunday: { closed: true },
  };
}

function formatEin(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}
