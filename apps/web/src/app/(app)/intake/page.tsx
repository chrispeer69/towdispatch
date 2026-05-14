import { requireUser } from '@/lib/auth/session';
import { IntakeClient } from './intake-client';

export const metadata = { title: 'Call Intake — US Tow DISPATCH' };

/**
 * /intake — the call-intake screen.
 *
 * Server component thinly wraps the client form. We pull the user only to
 * run requireUser() (auth gate) and pass the tenant name into the title.
 * Everything interactive lives in IntakeClient because the form is
 * heavily interactive (debounced rate quote, autocomplete, optimistic
 * existing-customer/vehicle badges).
 */
export default async function IntakePage(): Promise<JSX.Element> {
  const session = await requireUser();
  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Call Intake
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Phone-first capture · {session.tenant.name}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Tab to advance · Cmd/Ctrl+Enter to dispatch
        </span>
      </header>
      <IntakeClient />
    </div>
  );
}
