import { getOptionalUser } from '@/lib/auth/session';
/**
 * Towbook Import — Session 16.
 *
 * Multi-step wizard, admin/owner only. Reads the session role on the server,
 * renders the client wizard, which:
 *   1. shows tenant info (auto-set from the session)
 *   2. takes a drag-drop ZIP, uploads it via XMLHttpRequest with progress
 *   3. lets the user run a dry-run, then commits live
 *   4. polls /import/runs/:id until status leaves 'running'
 *   5. shows the totals report and errored events
 *
 * Auth gating is owned by (app)/layout.tsx — we use the non-throwing
 * getOptionalUser() so a transient /auth/me flake here can't redirect the page
 * out from under the layout's already-authenticated shell. The null branch
 * renders an empty fallback that the layout's redirect supersedes.
 */
import { tracedRedirect } from '@/lib/debug/redirect-trace';
import { ROLES } from '@towcommand/shared';
import { ImportWizardClient } from './import-wizard-client';

export const metadata = { title: 'Towbook Import — TowCommand' };

export default async function ImportPage(): Promise<JSX.Element> {
  const me = await getOptionalUser();
  if (!me) return <div className="space-y-6" />;
  if (me.user.role !== ROLES.OWNER && me.user.role !== ROLES.ADMIN) {
    tracedRedirect('/dashboard', 'import-page:role-not-admin');
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Towbook Import
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Migrate your historical Towbook data into TowCommand for <strong>{me.tenant.name}</strong>
          . Dry-run first, then commit.
        </p>
      </header>
      <ImportWizardClient tenantId={me.tenant.id} tenantName={me.tenant.name} />
    </div>
  );
}
