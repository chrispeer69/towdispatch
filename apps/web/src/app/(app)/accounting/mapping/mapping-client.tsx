'use client';

import {
  type AccountMappingDto,
  type AccountMappingsResponse,
  type ChartOfAccountDto,
  type ChartOfAccountsResponse,
  accountMappingInternalCategoryDtoValues,
} from '@ustowdispatch/shared';
import { type JSX, useMemo, useState, useTransition } from 'react';

interface Props {
  chart: ChartOfAccountsResponse | null;
  mappings: AccountMappingsResponse | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  service_revenue: 'Service revenue',
  mileage_revenue: 'Mileage revenue',
  wait_time_revenue: 'Wait time revenue',
  storage_revenue: 'Storage revenue',
  recovery_revenue: 'Recovery revenue',
  admin_fee_revenue: 'Admin fee revenue',
  tax_payable: 'Sales tax payable',
  discounts: 'Discounts',
  platform_fees: 'Platform fees',
  stripe_fees: 'Stripe processing fees',
  cash_clearing: 'Cash clearing',
  undeposited_funds: 'Undeposited funds',
  accounts_receivable: 'Accounts receivable',
  refunds: 'Refunds',
};

export function MappingClient({ chart, mappings }: Props): JSX.Element {
  const initialMap = useMemo(() => {
    const m: Record<string, AccountMappingDto> = {};
    for (const row of mappings?.mappings ?? []) m[row.internalCategory] = row;
    return m;
  }, [mappings]);
  const [current, setCurrent] = useState(initialMap);
  const [pending, start] = useTransition();
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!chart || chart.accounts.length === 0) {
    return (
      <section className="rounded-lg bg-bg-surface-elevated p-6">
        <p className="text-sm text-text-secondary-on-dark">
          Connect QuickBooks Online first; once your chart of accounts is available you can map
          internal categories here.
        </p>
      </section>
    );
  }

  const accountsById = new Map<string, ChartOfAccountDto>();
  for (const a of chart.accounts) accountsById.set(a.externalId, a);

  const onSelect = (category: string, externalAccountId: string): void => {
    if (!externalAccountId) {
      const next = { ...current };
      delete next[category];
      setCurrent(next);
      return;
    }
    const account = accountsById.get(externalAccountId);
    if (!account) return;
    setCurrent({
      ...current,
      [category]: {
        internalCategory: category as AccountMappingDto['internalCategory'],
        externalAccountId,
        externalAccountName: account.name,
        externalAccountType: account.type,
      },
    });
  };

  const onSave = (category: string): void => {
    const mapping = current[category];
    if (!mapping) return;
    start(async () => {
      try {
        setErrorMessage(null);
        const res = await fetch('/api/accounting/account-mapping', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            internalCategory: mapping.internalCategory,
            externalAccountId: mapping.externalAccountId,
            externalAccountName: mapping.externalAccountName ?? undefined,
            externalAccountType: mapping.externalAccountType ?? undefined,
          }),
        });
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        setSavedFor(category);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <section className="rounded-lg bg-bg-surface-elevated p-6 space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-secondary-on-dark">
            <th className="py-2">Internal category</th>
            <th className="py-2">QBO account</th>
            <th className="py-2 w-32" />
          </tr>
        </thead>
        <tbody>
          {accountMappingInternalCategoryDtoValues.map((cat) => {
            const m = current[cat];
            return (
              <tr key={cat} className="border-t border-border">
                <td className="py-2">{CATEGORY_LABELS[cat] ?? cat}</td>
                <td className="py-2">
                  <select
                    aria-label={`Map ${CATEGORY_LABELS[cat] ?? cat} to external account`}
                    value={m?.externalAccountId ?? ''}
                    onChange={(e) => onSelect(cat, e.target.value)}
                    className="rounded bg-bg-base border border-border px-2 py-1 font-mono text-xs"
                  >
                    <option value="">— unmapped —</option>
                    {chart.accounts
                      .filter((a) => a.active)
                      .map((a) => (
                        <option key={a.externalId} value={a.externalId}>
                          {a.name} ({a.type})
                        </option>
                      ))}
                  </select>
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => onSave(cat)}
                    disabled={pending || !m}
                    className="rounded bg-action px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  {savedFor === cat ? (
                    <span className="ml-2 text-xs text-green-400">saved</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {errorMessage ? (
        <p role="alert" aria-live="assertive" className="text-red-400 text-sm">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
