/**
 * /settings/company — Company Profile page (Admin Settings build 7 of 7).
 *
 * The 17-field editor lives in CompanyProfileForm. This file handles:
 *   - Auth: pulls the current user via requireUser() so we can pass the
 *     caller's role down to the form (the form decides edit vs read-only).
 *   - Authorization gate: roles outside the edit/read sets are bounced to
 *     /forbidden rather than rendered into a read-only form (we don't
 *     want to leak the field shape to drivers).
 *   - Tenant fetch: GET /tenants/current, surfaced via a warning card on
 *     load failure so the page doesn't crash if the API hiccups.
 */
import { tryFetch } from '@/lib/api/client';
import { fetchTenantCurrent } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/cookies';
import { requireUser } from '@/lib/auth/session';
import { ROLES, type Role } from '@ustowdispatch/shared';
import { AlertTriangle } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { CompanyProfileForm } from './company-profile-form';
import { DriverAccessPanel } from './driver-access-panel';

const TAB = findSettingsTab('company');

export const metadata = { title: 'Company Profile — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const VIEW_ROLES: readonly Role[] = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING];

export default async function CompanyProfilePage(): Promise<JSX.Element> {
  const me = await requireUser();
  const role = me.user.role as Role;
  if (!VIEW_ROLES.includes(role)) {
    redirect('/forbidden');
  }

  const token = await getSessionToken();
  const result = await tryFetch(() => fetchTenantCurrent(token));

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
              Couldn&rsquo;t load company profile (HTTP {result.error.status})
            </p>
            <p className="mt-1 text-text-secondary-on-dark">{result.error.message}</p>
          </div>
        </div>
      ) : (
        <>
          <DriverAccessPanel companyCode={result.data.companyCode} />
          <CompanyProfileForm initial={result.data} callerRole={role} />
        </>
      )}
    </div>
  );
}
