import { getOptionalUser } from '@/lib/auth/session';
import { ROLES } from '@towdispatch/shared';
import { redirect } from 'next/navigation';
import { ReconcileClient } from './reconcile-client';

export const metadata = { title: 'Reconcile â€” Tow Dispatch' };

export default async function ReconcilePage(): Promise<JSX.Element> {
  // Auth gating is owned by (app)/layout.tsx â€” see /import/page.tsx for the
  // rationale on using the non-throwing variant here.
  const me = await getOptionalUser();
  if (!me) return <div className="space-y-6" />;
  if (me.user.role !== ROLES.OWNER && me.user.role !== ROLES.ADMIN) {
    redirect('/dashboard');
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          Towbook Reconciliation
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Diff a Towbook export against what we have. Drop the same bundle you'd import â€” you'll
          get missing / orphaned / drift counts back. Cancel Towbook when both missing and drift are
          zero.
        </p>
      </header>
      <ReconcileClient tenantId={me.tenant.id} />
    </div>
  );
}
