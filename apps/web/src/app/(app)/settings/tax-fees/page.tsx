/**
 * /settings/tax-fees — preferences capture (live save, not yet
 * enforced by invoicing). See the form's header banner for the
 * caveat about backend integration timing.
 */
import { tryFetch } from '@/lib/api/client';
import { fetchTenantCurrent } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import { AlertTriangle } from 'lucide-react';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { TaxFeesForm } from './tax-fees-form';

const TAB = findSettingsTab('tax-fees');

export const metadata = { title: 'Tax & Fees — Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function TaxFeesPage(): Promise<JSX.Element> {
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
              Couldn&rsquo;t load tax settings (HTTP {result.error.status})
            </p>
            <p className="mt-1 text-text-secondary-on-dark">{result.error.message}</p>
          </div>
        </div>
      ) : (
        <TaxFeesForm initial={result.data} />
      )}
    </div>
  );
}
