/**
 * /billing/statements — Statement generation surface (Build 5 Part 3).
 *
 * Two stacked sections:
 *   1. "Generate New Statement" — pick account, date range, invoice
 *      filter, click Preview to see the preview modal/inline render,
 *      then Email / Download / Print.
 *   2. "Recent Statement Sends" — table of recent statement_sends
 *      audit rows, with Resend + Download PDF actions.
 *
 * Replaces the previous minimal /billing/statements page (which only
 * exposed a per-account PDF link).
 */
import { fetchRecentStatementSends } from '@/lib/api/ar';
import { tryFetch } from '@/lib/api/client';
import { fetchAccounts } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import type { AccountDto, StatementSendDto } from '@ustowdispatch/shared';
import { StatementsClient } from './statements-client';

export const metadata = { title: 'Statements — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<JSX.Element> {
  const sp = await searchParams;
  const token = await getSessionToken();

  const [accountsResult, sendsResult] = await Promise.all([
    tryFetch(() => fetchAccounts({ perPage: '200' }, token)),
    tryFetch(() => fetchRecentStatementSends(token)),
  ]);

  const accounts: AccountDto[] = accountsResult.data?.data ?? [];
  const sends: StatementSendDto[] = sendsResult.data ?? [];

  return (
    <StatementsClient
      accounts={accounts.map((a) => ({
        id: a.id,
        name: a.name,
        billingEmail: a.apContactEmail ?? a.billingEmail ?? null,
      }))}
      recentSends={sends}
      preselectedAccountId={sp.accountId ?? null}
    />
  );
}
