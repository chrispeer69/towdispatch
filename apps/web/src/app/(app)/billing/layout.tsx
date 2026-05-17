import type { ReactNode } from 'react';
/**
 * /billing layout — sticky tab strip across invoices/payments/aging/etc.
 * Mirrors apps/web/src/app/(app)/fleet/layout.tsx visual pattern.
 */

const TABS = [
  { label: 'Invoices', href: '/billing/invoices' },
  { label: 'Payments', href: '/billing/payments' },
  { label: 'Credit memos', href: '/billing/credit-memos' },
  { label: 'A/R aging', href: '/billing/aging' },
  { label: 'Statements', href: '/billing/statements' },
  { label: 'Recurring', href: '/billing/recurring' },
];

export default function BillingLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="space-y-4">
      <nav aria-label="Billing tabs" className="flex flex-wrap gap-2 border-b border-divider pb-2">
        {TABS.map((t) => (
          <a
            key={t.href}
            href={t.href}
            className="rounded-md px-3 py-1.5 text-sm text-text-secondary-on-dark hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
          >
            {t.label}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}
