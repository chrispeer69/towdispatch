import Link from 'next/link';
import type { JSX } from 'react';

export default function AccountingLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/accounting/settings" className="text-text-primary hover:text-action">
          Connection
        </Link>
        <Link href="/accounting/mapping" className="text-text-primary hover:text-action">
          Chart mapping
        </Link>
      </nav>
      {children}
    </div>
  );
}
