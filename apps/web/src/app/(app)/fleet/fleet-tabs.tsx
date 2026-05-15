'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sub-nav for the /fleet shell. Sits below the page title on every fleet
 * page, mirroring the visual density of the dispatch board's filter row.
 */
const TABS: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: '/fleet/trucks', label: 'Trucks', match: (p) => p.startsWith('/fleet/trucks') },
  { href: '/fleet/drivers', label: 'Drivers', match: (p) => p.startsWith('/fleet/drivers') },
  {
    href: '/fleet/expirations',
    label: 'Expirations',
    match: (p) => p.startsWith('/fleet/expirations'),
  },
  {
    href: '/fleet/maintenance',
    label: 'Maintenance',
    match: (p) => p.startsWith('/fleet/maintenance'),
  },
  { href: '/fleet/dvirs', label: 'DVIR', match: (p) => p.startsWith('/fleet/dvirs') },
];

export function FleetTabs(): JSX.Element {
  const pathname = usePathname() ?? '';
  return (
    <nav
      className="flex flex-wrap gap-1.5 border-b border-divider pb-3"
      aria-label="Fleet navigation"
    >
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'rounded-[8px] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
              active
                ? 'border-brand-primary/40 bg-brand-primary/15 text-brand-primary'
                : 'border-divider bg-bg-surface-elevated/40 text-text-secondary-on-dark hover:text-text-primary-on-dark',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
