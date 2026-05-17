import { fetchArSearch } from '@/lib/api/ar';
import { tryFetch } from '@/lib/api/client';
/**
 * /billing/aging — A/R Search workspace (Build 5).
 *
 * Replaces the prior "A/R Aging" tile dashboard. The new page is the
 * dispatcher- and accountant-facing primary surface for invoice
 * triage: a multi-select status filter (with computed past_due), date
 * range on a chosen field, customer/account/amount filters, paginated
 * results with bulk actions, and a sticky summary footer.
 *
 * The legacy aging-buckets view moves to /billing/aging/reports →
 * "A/R Aging Summary" template.
 */
import { fetchAccounts } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import type { AccountDto, ArSearchResponse } from '@ustowdispatch/shared';
import { ArSearchClient } from './ar-search-client';

export const metadata = { title: 'A/R workspace — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

const EMPTY: ArSearchResponse = {
  rows: [],
  total: 0,
  limit: 50,
  offset: 0,
  summary: {
    invoiceCount: 0,
    totalBilledCents: 0,
    totalPaidCents: 0,
    totalOutstandingCents: 0,
    totalPastDueCents: 0,
  },
};

export default async function ArWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<JSX.Element> {
  const sp = await searchParams;
  const token = await getSessionToken();

  const query: Record<string, string | undefined> = {
    statuses: sp.statuses,
    dateField: sp.dateField,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    q: sp.q,
    accountIds: sp.accountIds,
    minAmountCents: sp.minAmountCents,
    maxAmountCents: sp.maxAmountCents,
    limit: sp.limit,
    offset: sp.offset,
    sortBy: sp.sortBy,
    sortDir: sp.sortDir,
  };

  const [searchResult, accountsResult] = await Promise.all([
    tryFetch(() => fetchArSearch(query, token)),
    tryFetch(() => fetchAccounts({ perPage: '200' }, token)),
  ]);

  const data = searchResult.data ?? EMPTY;
  const accounts: AccountDto[] = accountsResult.data?.data ?? [];
  const errorMsg = searchResult.error?.message ?? null;
  const initialFilters = {
    statuses: sp.statuses ?? '',
    dateField: (sp.dateField as 'issued_at' | 'due_at' | 'created_at' | 'paid_at') ?? 'issued_at',
    dateFrom: sp.dateFrom ?? '',
    dateTo: sp.dateTo ?? '',
    q: sp.q ?? '',
    accountIds: sp.accountIds ?? '',
    minAmountCents: sp.minAmountCents ?? '',
    maxAmountCents: sp.maxAmountCents ?? '',
  };

  return (
    <ArSearchClient
      initial={data}
      initialFilters={initialFilters}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name, isMotorClub: a.isMotorClub }))}
      errorMessage={errorMsg}
    />
  );
}
