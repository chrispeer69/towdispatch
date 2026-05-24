'use client';

/**
 * Multi-step self-serve onboarding wizard. Server-driven resume: the active
 * step comes from the server's computed `nextStep`, and every mutation calls a
 * server action then `router.refresh()` to re-pull authoritative state. The
 * step forms only collect the minimum the existing backend endpoints require.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useState, useTransition } from 'react';
import {
  activateFreeTier,
  addFirstDriver,
  addFirstTruck,
  completeOnboarding,
  inviteFirstUser,
  saveCompanyInfo,
  skipStep,
} from './actions';
import type {
  ActionResult,
  ActivationEventType,
  OnboardingStateDto,
  OnboardingStep,
} from './types';

const STEP_LABELS: Record<OnboardingStep, string> = {
  company_info: 'Company info',
  first_user: 'Invite a teammate',
  first_truck: 'Add your first truck',
  first_driver: 'Add your first driver',
  activate: 'Activate your plan',
  completed: 'Done',
};

const ORDER: OnboardingStep[] = [
  'company_info',
  'first_user',
  'first_truck',
  'first_driver',
  'activate',
];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

const INVITE_ROLES: ReadonlyArray<readonly [string, string]> = [
  ['admin', 'Admin'],
  ['manager', 'Manager'],
  ['dispatcher', 'Dispatcher'],
  ['driver', 'Driver'],
  ['accounting', 'Accounting'],
];

const MILESTONE_LABELS: Partial<Record<ActivationEventType, string>> = {
  account_created: 'Account created',
  email_verified: 'Email verified',
  company_info_completed: 'Company info added',
  first_user_invited: 'Teammate invited',
  first_truck_added: 'Truck added',
  first_driver_added: 'Driver added',
  free_tier_activated: 'Free plan activated',
  first_job_dispatched: 'First job dispatched',
};

export function OnboardingWizard({
  initialState,
}: {
  initialState: OnboardingStateDto;
}): JSX.Element {
  const router = useRouter();
  const state = initialState;
  const completed = Boolean(state.progress.completedAt);
  const active: OnboardingStep = completed ? 'completed' : (state.nextStep ?? 'activate');

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, redirectTo?: string): void {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong. Please try again.');
        return;
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary-on-dark">Set up your workspace</h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          A few quick steps to get your towing operation dispatching jobs.
        </p>
      </header>

      {!state.milestones.email_verified ? (
        <div
          aria-live="polite"
          className="mb-6 rounded-[10px] border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
        >
          Verify your email — we sent a confirmation link to your inbox. You can keep setting up in
          the meantime.
        </div>
      ) : null}

      <Stepper active={active} completedSteps={state.progress.stepsCompleted} />

      <MilestoneChecklist milestones={state.milestones} />

      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <section className="rounded-xl border border-divider bg-bg-surface p-6">
        {active === 'company_info' && (
          <CompanyInfoStep isPending={isPending} onSubmit={(v) => run(() => saveCompanyInfo(v))} />
        )}
        {active === 'first_user' && (
          <InviteUserStep
            isPending={isPending}
            onSubmit={(v) => run(() => inviteFirstUser(v))}
            onSkip={() => run(() => skipStep('first_user'))}
          />
        )}
        {active === 'first_truck' && (
          <TruckStep
            isPending={isPending}
            onSubmit={(v) => run(() => addFirstTruck(v))}
            onSkip={() => run(() => skipStep('first_truck'))}
          />
        )}
        {active === 'first_driver' && (
          <DriverStep
            isPending={isPending}
            onSubmit={(v) => run(() => addFirstDriver(v))}
            onSkip={() => run(() => skipStep('first_driver'))}
          />
        )}
        {active === 'activate' && (
          <ActivateStep
            isPending={isPending}
            tierActivated={state.milestones.free_tier_activated}
            truckLimit={state.truckLimit}
            onActivate={() => run(() => activateFreeTier())}
            onComplete={() => run(() => completeOnboarding())}
          />
        )}
        {active === 'completed' && <CompletedStep onGo={() => router.push('/dashboard')} />}
      </section>
    </main>
  );
}

function Stepper({
  active,
  completedSteps,
}: {
  active: OnboardingStep;
  completedSteps: OnboardingStep[];
}): JSX.Element {
  return (
    <ol className="mb-6 flex flex-wrap gap-2" aria-label="Onboarding steps">
      {ORDER.map((step, i) => {
        const done = completedSteps.includes(step);
        const isActive = step === active;
        return (
          <li
            key={step}
            aria-current={isActive ? 'step' : undefined}
            className={[
              'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
              isActive
                ? 'border-brand-primary text-brand-primary'
                : done
                  ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                  : 'border-divider text-text-secondary-on-dark',
            ].join(' ')}
          >
            <span aria-hidden>{done ? '✓' : i + 1}</span>
            {STEP_LABELS[step]}
          </li>
        );
      })}
    </ol>
  );
}

function MilestoneChecklist({
  milestones,
}: {
  milestones: Record<ActivationEventType, boolean>;
}): JSX.Element {
  const entries = Object.entries(MILESTONE_LABELS) as Array<[ActivationEventType, string]>;
  return (
    <ul className="mb-6 grid grid-cols-2 gap-1 text-xs text-text-secondary-on-dark sm:grid-cols-4">
      {entries.map(([key, label]) => (
        <li key={key} className="flex items-center gap-1.5">
          <span aria-hidden className={milestones[key] ? 'text-emerald-500' : 'text-divider'}>
            {milestones[key] ? '✓' : '○'}
          </span>
          <span className={milestones[key] ? 'text-text-primary-on-dark' : undefined}>{label}</span>
        </li>
      ))}
    </ul>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, hint, children }: FieldProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-text-secondary-on-dark/60">{hint}</p> : null}
    </div>
  );
}

function StepActions({
  isPending,
  submitLabel,
  onSkip,
}: {
  isPending: boolean;
  submitLabel: string;
  onSkip?: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 pt-2">
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Saving…' : submitLabel}
      </Button>
      {onSkip ? (
        <button
          type="button"
          onClick={onSkip}
          disabled={isPending}
          className="text-sm text-text-secondary-on-dark underline-offset-2 hover:underline disabled:opacity-50"
        >
          Skip for now
        </button>
      ) : null}
    </div>
  );
}

function CompanyInfoStep({
  isPending,
  onSubmit,
}: {
  isPending: boolean;
  onSubmit: (v: { name: string; timezone?: string }) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState<string>(TIMEZONES[0] ?? 'America/New_York');
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length === 0) return;
        onSubmit({ name: name.trim(), timezone });
      }}
    >
      <h2 className="text-lg font-medium text-text-primary-on-dark">Company info</h2>
      <Field label="Company name" htmlFor="ob-company-name">
        <Input
          id="ob-company-name"
          value={name}
          required
          maxLength={120}
          placeholder="Acme Towing"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Time zone" htmlFor="ob-tz" hint="Used for scheduling and reporting.">
        <select
          id="ob-tz"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>
      <StepActions isPending={isPending} submitLabel="Save and continue" />
    </form>
  );
}

function InviteUserStep({
  isPending,
  onSubmit,
  onSkip,
}: {
  isPending: boolean;
  onSubmit: (v: { email: string; role: string; fullName?: string | undefined }) => void;
  onSkip: () => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>(INVITE_ROLES[0]?.[0] ?? 'dispatcher');
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim().length === 0) return;
        onSubmit({ email: email.trim(), role, fullName: fullName.trim() || undefined });
      }}
    >
      <h2 className="text-lg font-medium text-text-primary-on-dark">Invite a teammate</h2>
      <p className="text-sm text-text-secondary-on-dark">
        Optional — invite a dispatcher or manager. They&apos;ll get an email to set their password.
      </p>
      <Field label="Email" htmlFor="ob-invite-email">
        <Input
          id="ob-invite-email"
          type="email"
          value={email}
          placeholder="teammate@company.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Full name" htmlFor="ob-invite-name">
        <Input
          id="ob-invite-name"
          value={fullName}
          placeholder="Jordan Dispatcher"
          onChange={(e) => setFullName(e.target.value)}
        />
      </Field>
      <Field label="Role" htmlFor="ob-invite-role">
        <select
          id="ob-invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm"
        >
          {INVITE_ROLES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <StepActions isPending={isPending} submitLabel="Send invite" onSkip={onSkip} />
    </form>
  );
}

function TruckStep({
  isPending,
  onSubmit,
  onSkip,
}: {
  isPending: boolean;
  onSubmit: (v: {
    unitNumber: string;
    make?: string | undefined;
    model?: string | undefined;
  }) => void;
  onSkip: () => void;
}): JSX.Element {
  const [unitNumber, setUnitNumber] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (unitNumber.trim().length === 0) return;
        onSubmit({
          unitNumber: unitNumber.trim(),
          make: make.trim() || undefined,
          model: model.trim() || undefined,
        });
      }}
    >
      <h2 className="text-lg font-medium text-text-primary-on-dark">Add your first truck</h2>
      <Field label="Unit number" htmlFor="ob-truck-unit">
        <Input
          id="ob-truck-unit"
          value={unitNumber}
          required
          maxLength={40}
          placeholder="Unit 12"
          onChange={(e) => setUnitNumber(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Make" htmlFor="ob-truck-make">
          <Input
            id="ob-truck-make"
            value={make}
            placeholder="Ford"
            onChange={(e) => setMake(e.target.value)}
          />
        </Field>
        <Field label="Model" htmlFor="ob-truck-model">
          <Input
            id="ob-truck-model"
            value={model}
            placeholder="F-550"
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
      </div>
      <StepActions isPending={isPending} submitLabel="Add truck" onSkip={onSkip} />
    </form>
  );
}

function DriverStep({
  isPending,
  onSubmit,
  onSkip,
}: {
  isPending: boolean;
  onSubmit: (v: { firstName: string; lastName: string; phone?: string | undefined }) => void;
  onSkip: () => void;
}): JSX.Element {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (firstName.trim().length === 0 || lastName.trim().length === 0) return;
        onSubmit({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
        });
      }}
    >
      <h2 className="text-lg font-medium text-text-primary-on-dark">Add your first driver</h2>
      <div className="grid grid-cols-2 gap-4">
        <Field label="First name" htmlFor="ob-driver-first">
          <Input
            id="ob-driver-first"
            value={firstName}
            required
            placeholder="Sam"
            onChange={(e) => setFirstName(e.target.value)}
          />
        </Field>
        <Field label="Last name" htmlFor="ob-driver-last">
          <Input
            id="ob-driver-last"
            value={lastName}
            required
            placeholder="Carter"
            onChange={(e) => setLastName(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Phone" htmlFor="ob-driver-phone" hint="Optional. Format: +15551234567">
        <Input
          id="ob-driver-phone"
          value={phone}
          placeholder="+15551234567"
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <StepActions isPending={isPending} submitLabel="Add driver" onSkip={onSkip} />
    </form>
  );
}

function ActivateStep({
  isPending,
  tierActivated,
  truckLimit,
  onActivate,
  onComplete,
}: {
  isPending: boolean;
  tierActivated: boolean;
  truckLimit: number | null;
  onActivate: () => void;
  onComplete: () => void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-text-primary-on-dark">Activate your plan</h2>
      <div className="rounded-[10px] border border-divider p-4">
        <p className="font-medium text-text-primary-on-dark">Free plan</p>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Up to {truckLimit ?? 'unlimited'} truck{truckLimit === 1 ? '' : 's'}. Dispatch jobs,
          invite your team, and try the full workflow.
        </p>
      </div>
      {!tierActivated ? (
        <Button type="button" onClick={onActivate} disabled={isPending}>
          {isPending ? 'Activating…' : 'Activate free plan'}
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            ✓ Free plan activated. You&apos;re ready to dispatch your first job.
          </p>
          <Button type="button" onClick={onComplete} disabled={isPending}>
            {isPending ? 'Finishing…' : 'Finish setup'}
          </Button>
        </div>
      )}
    </div>
  );
}

function CompletedStep({ onGo }: { onGo: () => void }): JSX.Element {
  return (
    <div className="space-y-4 text-center">
      <h2 className="text-lg font-medium text-text-primary-on-dark">You&apos;re all set 🎉</h2>
      <p className="text-sm text-text-secondary-on-dark">
        Your workspace is ready. Dispatch your first job to complete activation.
      </p>
      <Button type="button" onClick={onGo}>
        Go to dashboard
      </Button>
    </div>
  );
}
