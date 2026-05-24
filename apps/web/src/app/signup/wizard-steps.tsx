'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { zodResolver } from '@hookform/resolvers/zod';
/**
 * Wizard step forms (company info, first user, first truck, first driver) plus
 * the final summary. Each form validates with the shared step schema, posts to
 * the onboarding BFF, and hands the updated progress back to the wizard.
 *
 * TODO(i18n): user-visible strings here need Spanish parity once the web app
 * adopts an i18n framework (none exists today — see SESSION_25_DECISIONS.md).
 */
import {
  type CompanyInfoStepPayload,
  type FirstDriverStepPayload,
  type FirstTruckStepPayload,
  type FirstUserStepPayload,
  type OnboardingChecklist,
  type OnboardingProgressDto,
  companyInfoStepSchema,
  firstDriverStepSchema,
  firstTruckStepSchema,
  firstUserStepSchema,
} from '@ustowdispatch/shared';
import { useState } from 'react';
import { type FieldValues, type UseFormReturn, useForm } from 'react-hook-form';
import { Field } from './field';

const ROLE_OPTIONS = [
  { value: 'dispatcher', label: 'Dispatcher' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'driver', label: 'Driver' },
  { value: 'accounting', label: 'Accounting' },
] as const;

const TRUCK_TYPE_OPTIONS = [
  { value: 'light_duty', label: 'Light duty' },
  { value: 'medium_duty', label: 'Medium duty' },
  { value: 'heavy_duty', label: 'Heavy duty' },
  { value: 'flatbed', label: 'Flatbed' },
  { value: 'wheel_lift', label: 'Wheel lift' },
  { value: 'service', label: 'Service' },
  { value: 'other', label: 'Other' },
] as const;

const selectClass =
  'flex h-10 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark focus:outline-none focus:ring-2 focus:ring-brand-primary';

/** POSTs a step payload to the onboarding BFF, returning the updated progress. */
async function postStep(
  path: string,
  body: unknown,
): Promise<{ ok: true; progress: OnboardingProgressDto } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/onboarding/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, error: data?.message ?? 'Something went wrong. Please try again.' };
    }
    return { ok: true, progress: (await res.json()) as OnboardingProgressDto };
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }
}

interface StepShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function StepShell({ title, description, children }: StepShellProps): JSX.Element {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-text-primary-on-dark">{title}</h2>
        <p className="text-sm text-text-secondary-on-dark/80">{description}</p>
      </header>
      {children}
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      {message}
    </div>
  );
}

interface StepFormProps {
  onProgress: (p: OnboardingProgressDto) => void;
  onSkip?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
}

interface StepNavProps {
  isSubmitting: boolean;
  submitLabel: string;
  onSkip?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
}

function StepNav({ isSubmitting, submitLabel, onSkip, onBack }: StepNavProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      <div>
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack} disabled={isSubmitting}>
            Back
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {onSkip ? (
          <Button type="button" variant="ghost" onClick={onSkip} disabled={isSubmitting}>
            Skip for now
          </Button>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** Shared submit wrapper: posts, surfaces errors, advances on success. */
function useStepSubmit<T extends FieldValues>(
  form: UseFormReturn<T>,
  path: string,
  onProgress: (p: OnboardingProgressDto) => void,
): {
  error: string | null;
  submit: (values: T) => Promise<void>;
} {
  const [error, setError] = useState<string | null>(null);
  const submit = async (values: T): Promise<void> => {
    setError(null);
    const result = await postStep(path, values);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onProgress(result.progress);
  };
  return { error, submit };
}

export function CompanyInfoStep({ onProgress }: StepFormProps): JSX.Element {
  const guessedTz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const form = useForm<CompanyInfoStepPayload>({
    resolver: zodResolver(companyInfoStepSchema),
    mode: 'onBlur',
    defaultValues: { timezone: guessedTz } as Partial<CompanyInfoStepPayload>,
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;
  const { error, submit } = useStepSubmit(form, 'steps/company-info', onProgress);

  return (
    <StepShell title="Company info" description="A few details so we can set up your workspace.">
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        <Field label="Legal business name" error={errors.legalName?.message}>
          <Input placeholder="Acme Towing LLC" {...register('legalName')} />
        </Field>
        <Field
          label="Timezone"
          error={errors.timezone?.message}
          hint="IANA zone, e.g. America/New_York"
        >
          <Input placeholder="America/New_York" {...register('timezone')} />
        </Field>
        <Field label="Street address" error={errors.addressLine1?.message}>
          <Input
            placeholder="123 Main St"
            autoComplete="address-line1"
            {...register('addressLine1')}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" error={errors.city?.message}>
            <Input placeholder="Columbus" {...register('city')} />
          </Field>
          <Field label="State" error={errors.state?.message}>
            <Input placeholder="OH" maxLength={2} {...register('state')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ZIP" error={errors.postalCode?.message}>
            <Input placeholder="43004" {...register('postalCode')} />
          </Field>
          <Field label="Phone (optional)" error={errors.phone?.message}>
            <Input placeholder="+15555550100" {...register('phone')} />
          </Field>
        </div>
        <ErrorBanner message={error} />
        <StepNav isSubmitting={isSubmitting} submitLabel="Continue" />
      </form>
    </StepShell>
  );
}

export function FirstUserStep({ onProgress, onSkip, onBack }: StepFormProps): JSX.Element {
  const form = useForm<FirstUserStepPayload>({
    resolver: zodResolver(firstUserStepSchema),
    mode: 'onBlur',
    defaultValues: { role: 'dispatcher' } as Partial<FirstUserStepPayload>,
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;
  const { error, submit } = useStepSubmit(form, 'steps/first-user', onProgress);

  return (
    <StepShell
      title="Invite your first teammate"
      description="We'll email them an invite to set their own password. You can skip this."
    >
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        <Field label="Full name" error={errors.fullName?.message}>
          <Input placeholder="Sam Dispatcher" autoComplete="name" {...register('fullName')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" placeholder="teammate@company.com" {...register('email')} />
        </Field>
        <Field label="Role" error={errors.role?.message}>
          <select className={selectClass} {...register('role')}>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <ErrorBanner message={error} />
        <StepNav
          isSubmitting={isSubmitting}
          submitLabel="Send invite"
          onSkip={onSkip}
          onBack={onBack}
        />
      </form>
    </StepShell>
  );
}

export function FirstTruckStep({ onProgress, onBack }: StepFormProps): JSX.Element {
  const form = useForm<FirstTruckStepPayload>({
    resolver: zodResolver(firstTruckStepSchema),
    mode: 'onBlur',
    defaultValues: { truckType: 'light_duty' } as Partial<FirstTruckStepPayload>,
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;
  const { error, submit } = useStepSubmit(form, 'steps/first-truck', onProgress);

  return (
    <StepShell
      title="Add your first truck"
      description="Your fleet starts here. You can add more later."
    >
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        <Field label="Unit number" error={errors.unitNumber?.message}>
          <Input placeholder="T-1" {...register('unitNumber')} />
        </Field>
        <Field label="Type" error={errors.truckType?.message}>
          <select className={selectClass} {...register('truckType')}>
            {TRUCK_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Year" error={errors.year?.message}>
            <Input placeholder="2022" {...register('year')} />
          </Field>
          <Field label="Make" error={errors.make?.message}>
            <Input placeholder="Ford" {...register('make')} />
          </Field>
          <Field label="Model" error={errors.model?.message}>
            <Input placeholder="F-550" {...register('model')} />
          </Field>
        </div>
        <ErrorBanner message={error} />
        <StepNav isSubmitting={isSubmitting} submitLabel="Add truck" onBack={onBack} />
      </form>
    </StepShell>
  );
}

export function FirstDriverStep({ onProgress, onSkip, onBack }: StepFormProps): JSX.Element {
  const form = useForm<FirstDriverStepPayload>({
    resolver: zodResolver(firstDriverStepSchema),
    mode: 'onBlur',
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;
  const { error, submit } = useStepSubmit(form, 'steps/first-driver', onProgress);

  return (
    <StepShell
      title="Add your first driver"
      description="Add a driver to your roster. You can skip and do this later."
    >
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={errors.firstName?.message}>
            <Input placeholder="Dana" autoComplete="given-name" {...register('firstName')} />
          </Field>
          <Field label="Last name" error={errors.lastName?.message}>
            <Input placeholder="Driver" autoComplete="family-name" {...register('lastName')} />
          </Field>
        </div>
        <Field label="Phone (optional)" error={errors.phone?.message}>
          <Input placeholder="+15555550100" {...register('phone')} />
        </Field>
        <Field label="Email (optional)" error={errors.email?.message}>
          <Input type="email" placeholder="driver@company.com" {...register('email')} />
        </Field>
        <ErrorBanner message={error} />
        <StepNav
          isSubmitting={isSubmitting}
          submitLabel="Add driver"
          onSkip={onSkip}
          onBack={onBack}
        />
      </form>
    </StepShell>
  );
}

const CHECKLIST_LABELS: Array<{ key: keyof OnboardingChecklist; label: string }> = [
  { key: 'accountCreated', label: 'Account created' },
  { key: 'emailVerified', label: 'Email verified' },
  { key: 'companyInfoCompleted', label: 'Company info added' },
  { key: 'firstUserInvited', label: 'Teammate invited' },
  { key: 'firstTruckAdded', label: 'First truck added' },
  { key: 'firstDriverAdded', label: 'First driver added' },
  { key: 'firstJobDispatched', label: 'First job dispatched 🎯' },
];

export function DoneStep({
  checklist,
  emailVerified,
  onFinish,
  finishing,
}: {
  checklist: OnboardingChecklist;
  emailVerified: boolean;
  onFinish: () => void;
  finishing: boolean;
}): JSX.Element {
  return (
    <StepShell
      title="You're all set"
      description="Your workspace is ready. Your activation goal is to dispatch your first job."
    >
      <ul className="space-y-2">
        {CHECKLIST_LABELS.map(({ key, label }) => (
          <li key={key} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={checklist[key] ? 'text-emerald-500' : 'text-text-secondary-on-dark/40'}
            >
              {checklist[key] ? '✓' : '○'}
            </span>
            <span
              className={
                checklist[key] ? 'text-text-primary-on-dark' : 'text-text-secondary-on-dark/70'
              }
            >
              {label}
            </span>
          </li>
        ))}
      </ul>
      {!emailVerified ? (
        <p className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Don't forget to verify your email — check your inbox for the confirmation link.
        </p>
      ) : null}
      <Button type="button" size="lg" className="w-full" onClick={onFinish} disabled={finishing}>
        {finishing ? 'Finishing…' : 'Go to dashboard'}
      </Button>
    </StepShell>
  );
}
