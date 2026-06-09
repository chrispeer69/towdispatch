/**
 * /settings/branding — White-Label Portal admin (Session 32).
 *
 * Mirrors /settings/company: requireUser() for the caller role, a VIEW_ROLES
 * gate (drivers/dispatchers bounced to /forbidden), then a tolerant fetch of
 * GET /tenant-branding surfaced via a warning card on failure. The editor
 * lives in BrandingForm.
 */
import { apiServerSafe } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/cookies';
import { requireUser } from '@/lib/auth/session';
import { ROLES, type Role, type TenantBrandingDto } from '@ustowdispatch/shared';
import { AlertTriangle } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { BrandingForm } from './branding-form';

const TAB = findSettingsTab('branding');

export const metadata = { title: 'White-Label Portal — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const VIEW_ROLES: readonly Role[] = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING];

export default async function BrandingPage(): Promise<JSX.Element> {
  const me = await requireUser();
  const role = me.user.role as Role;
  if (!VIEW_ROLES.includes(role)) {
    redirect('/forbidden');
  }

  const token = await getSessionToken();
  const result = await apiServerSafe<TenantBrandingDto>('/tenant-branding', { accessToken: token });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          {TAB.label}
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>

      {result.error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[14px] border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <div>
            <p className="font-semibold text-text-primary-on-dark">
              Couldn&rsquo;t load branding (HTTP {result.error.status})
            </p>
            <p className="mt-1 text-text-secondary-on-dark">{result.error.message}</p>
          </div>
        </div>
      ) : (
        <BrandingForm
          initial={result.data}
          canEdit={role === ROLES.OWNER || role === ROLES.ADMIN}
        />
      )}
    </div>
  );
}
