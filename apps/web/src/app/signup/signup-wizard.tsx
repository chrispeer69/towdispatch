'use client';

/**
 * Self-serve onboarding wizard. Orchestrates the steps after account creation:
 *
 *   account → company_info → first_user → first_truck → first_driver → done
 *
 * The account step provisions the tenant + session (via /api/onboarding/start);
 * every later step is tenant-scoped. On mount the wizard tries to resume an
 * in-progress session (GET /api/onboarding/progress) so a reload picks up where
 * the operator left off. Verification is non-blocking — a persistent banner
 * nudges it while the operator finishes setup.
 *
 * TODO(i18n): strings need Spanish parity once the web app adopts i18n.
 */
import type { OnboardingProgressDto, OnboardingStep } from '@ustowdispatch/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccountStep } from './account-step';
import {
  CompanyInfoStep,
  DoneStep,
  FirstDriverStep,
  FirstTruckStep,
  FirstUserStep,
} from './wizard-steps';

type Phase =
  | 'loading'
  | 'account'
  | 'company_info'
  | 'first_user'
  | 'first_truck'
  | 'first_driver'
  | 'done';

const PANEL_ORDER: Phase[] = ['company_info', 'first_user', 'first_truck', 'first_driver', 'done'];

const STEPPER: Array<{ phase: Phase; label: string }> = [
  { phase: 'account', label: 'Account' },
  { phase: 'company_info', label: 'Company' },
  { phase: 'first_user', label: 'Team' },
  { phase: 'first_truck', label: 'Truck' },
  { phase: 'first_driver', label: 'Driver' },
  { phase: 'done', label: 'Done' },
];

function phaseForStep(step: OnboardingStep): Phase {
  switch (step) {
    case 'first_user':
      return 'first_user';
    case 'first_truck':
      return 'first_truck';
    case 'first_driver':
      return 'first_driver';
    case 'dispatch_first_job':
    case 'completed':
      return 'done';
    default:
      return 'company_info';
  }
}

function nextPanel(current: Phase): Phase {
  const idx = PANEL_ORDER.indexOf(current);
  if (idx < 0 || idx >= PANEL_ORDER.length - 1) return 'done';
  return PANEL_ORDER[idx + 1] as Phase;
}

export function SignupWizard(): JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState<OnboardingProgressDto | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Resume an in-progress session if there is one; otherwise start at account.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/onboarding/progress', { method: 'GET' });
        if (cancelled) return;
        if (res.ok) {
          const p = (await res.json()) as OnboardingProgressDto;
          setProgress(p);
          setPhase(phaseForStep(p.currentStep));
          return;
        }
      } catch {
        /* fall through to account */
      }
      if (!cancelled) setPhase('account');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyProgress(p: OnboardingProgressDto, from: Phase): void {
    setProgress(p);
    // 'account' isn't in the wizard panel order, so advance via the API's
    // resume step (→ company_info) rather than nextPanel(); every later step
    // advances linearly through the panels.
    setPhase(from === 'account' ? phaseForStep(p.currentStep) : nextPanel(from));
  }

  async function skip(step: OnboardingStep, from: Phase): Promise<void> {
    try {
      const res = await fetch('/api/onboarding/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step }),
      });
      if (res.ok) setProgress((await res.json()) as OnboardingProgressDto);
    } catch {
      /* non-fatal — advance anyway */
    }
    setPhase(nextPanel(from));
  }

  async function finish(): Promise<void> {
    setFinishing(true);
    try {
      await fetch('/api/onboarding/complete', { method: 'POST' });
    } catch {
      /* non-fatal */
    }
    router.push('/');
  }

  if (phase === 'loading') {
    return <p className="text-sm text-text-secondary-on-dark/70">Loading…</p>;
  }

  if (phase === 'account') {
    return <AccountStep onComplete={(p) => applyProgress(p, 'account')} />;
  }

  return (
    <div className="space-y-6">
      <Stepper current={phase} checklist={progress?.checklist} />

      {progress && !progress.checklist.emailVerified ? <VerifyBanner /> : null}

      {phase === 'company_info' && (
        <CompanyInfoStep onProgress={(p) => applyProgress(p, 'company_info')} />
      )}
      {phase === 'first_user' && (
        <FirstUserStep
          onProgress={(p) => applyProgress(p, 'first_user')}
          onSkip={() => void skip('first_user', 'first_user')}
        />
      )}
      {phase === 'first_truck' && (
        <FirstTruckStep onProgress={(p) => applyProgress(p, 'first_truck')} />
      )}
      {phase === 'first_driver' && (
        <FirstDriverStep
          onProgress={(p) => applyProgress(p, 'first_driver')}
          onSkip={() => void skip('first_driver', 'first_driver')}
        />
      )}
      {phase === 'done' && progress && (
        <DoneStep
          checklist={progress.checklist}
          emailVerified={progress.checklist.emailVerified}
          onFinish={() => void finish()}
          finishing={finishing}
        />
      )}
    </div>
  );
}

function Stepper({
  current,
  checklist,
}: {
  current: Phase;
  checklist: OnboardingProgressDto['checklist'] | undefined;
}): JSX.Element {
  const checkFor: Record<Phase, boolean> = {
    loading: false,
    account: checklist?.accountCreated ?? true,
    company_info: checklist?.companyInfoCompleted ?? false,
    first_user: checklist?.firstUserInvited ?? false,
    first_truck: checklist?.firstTruckAdded ?? false,
    first_driver: checklist?.firstDriverAdded ?? false,
    done: false,
  };
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Onboarding progress">
      {STEPPER.map((s, i) => {
        const active = s.phase === current;
        const complete = checkFor[s.phase];
        return (
          <li key={s.phase} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={[
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                active
                  ? 'bg-brand-primary text-white'
                  : complete
                    ? 'bg-emerald-500/20 text-emerald-500'
                    : 'bg-bg-surface text-text-secondary-on-dark/60',
              ].join(' ')}
            >
              {complete && !active ? '✓' : i + 1}
            </span>
            <span
              className={[
                'text-xs',
                active
                  ? 'font-semibold text-text-primary-on-dark'
                  : 'text-text-secondary-on-dark/70',
              ].join(' ')}
            >
              {s.label}
            </span>
            {i < STEPPER.length - 1 ? (
              <span aria-hidden className="text-text-secondary-on-dark/30">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function VerifyBanner(): JSX.Element {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  async function resend(): Promise<void> {
    setSending(true);
    try {
      await fetch('/api/auth/resend-verification', { method: 'POST' });
      setSent(true);
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      <span>Verify your email to secure your account — we sent you a link.</span>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={sending || sent}
        className="font-semibold underline disabled:opacity-60"
      >
        {sent ? 'Sent ✓' : sending ? 'Sending…' : 'Resend'}
      </button>
    </div>
  );
}
