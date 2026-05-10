import Link from 'next/link';
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
      <nav
        aria-label="Billing tabs"
        className="flex flex-wrap gap-2 border-b border-steel-border pb-2"
      >
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-steel-light hover:text-text-primary"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
