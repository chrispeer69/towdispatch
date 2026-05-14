import { requireUser } from '@/lib/auth/session';
import { ROLES } from '@ustowdispatch/shared';
import { redirect } from 'next/navigation';
import { ReconcileClient } from './reconcile-client';

export const metadata = { title: 'Reconcile — US Tow DISPATCH' };

export default async function ReconcilePage(): Promise<JSX.Element> {
  const me = await requireUser();
  if (me.user.role !== ROLES.OWNER && me.user.role !== ROLES.ADMIN) {
    redirect('/dashboard');
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Towbook Reconciliation
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Diff a Towbook export against what we have. Drop the same bundle you'd import — you'll get
          missing / orphaned / drift counts back. Cancel Towbook when both missing and drift are
          zero.
        </p>
      </header>
      <ReconcileClient tenantId={me.tenant.id} />
    </div>
  );
}
