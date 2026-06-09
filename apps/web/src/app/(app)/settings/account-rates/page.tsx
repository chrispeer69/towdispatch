/**
 * /settings/account-rates — per-account pricing overrides, service
 * availability, and contract terms (Admin Settings build 6 of 7).
 *
 * Two-pane layout: left rail is the account list, right pane is a
 * three-tab editor (Rate Card / Service Availability / Contract Terms).
 * The page fetches the account list server-side so the rail renders
 * immediately; the right pane lazy-loads each account's rate card via
 * the BFF when the operator clicks an account.
 */
import { fetchAccounts } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import type { AccountDto } from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { AccountRateCardsClient } from './account-rate-cards-client';

export const metadata = { title: 'Account Rate Cards — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const TAB = findSettingsTab('account-rates');

export default async function AccountRateCardsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  let accounts: AccountDto[] = [];
  let loadError: string | null = null;
  try {
    const page = await fetchAccounts({ perPage: '200', active: 'true' }, token);
    accounts = page.data;
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load accounts';
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          {TAB.label}
        </h1>
        <p className="text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {loadError}
        </div>
      ) : null}

      <AccountRateCardsClient accounts={accounts} />
    </div>
  );
}
