/**
 * /settings/users — live Users & Permissions admin.
 *
 * Wired to /users CRUD. API gates mutations to OWNER/ADMIN (create
 * + deactivate) and OWNER/ADMIN/MANAGER (update). The client surfaces
 * 401/403 as toasts so unprivileged users see a clear "you don't
 * have permission" message instead of a silent failure.
 */
import { tryFetch } from '@/lib/api/client';
import { fetchUsers } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import { AlertTriangle } from 'lucide-react';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { UsersClient } from './users-client';

const TAB = findSettingsTab('users');

export const metadata = { title: 'Users & Permissions — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function UsersPermissionsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() => fetchUsers(token));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
              Couldn&rsquo;t load users (HTTP {result.error.status})
            </p>
            <p className="mt-1 text-text-secondary-on-dark">{result.error.message}</p>
          </div>
        </div>
      ) : (
        <UsersClient initial={result.data} />
      )}
    </div>
  );
}
