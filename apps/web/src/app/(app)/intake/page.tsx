import { getOptionalUser } from '@/lib/auth/session';
import { IntakeClient } from './intake-client';

export const metadata = { title: 'Call Intake â€” Tow Dispatch' };

/**
 * /intake â€” the call-intake screen.
 *
 * Server component thinly wraps the client form. Auth gating lives in the
 * (app)/ layout â€” we read the session here only to surface the tenant name,
 * using the non-throwing getOptionalUser() so a transient /auth/me flake
 * cannot redirect this page out from under a layout that already streamed an
 * authenticated shell. See lib/auth/session.ts for the chokepoint.
 */
export default async function IntakePage(): Promise<JSX.Element> {
  const session = await getOptionalUser();
  const tenantName = session?.tenant.name ?? '';
  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Call Intake
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Phone-first capture{tenantName ? ` Â· ${tenantName}` : ''}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          Tab to advance Â· Cmd/Ctrl+Enter to dispatch
        </span>
      </header>
      <IntakeClient />
    </div>
  );
}
