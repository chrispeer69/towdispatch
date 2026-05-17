'use client';

import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';

// Deploy trigger 2026-05-17 — force Railway redeploy after the
// previous push didn't pick up the TRUCKS/DRIVERS trim.

/**
 * Sub-nav for the /fleet shell. Sits below the page title on every fleet
 * page, mirroring the visual density of the dispatch board's filter row.
 *
 * Expirations, Maintenance, and DVIR tabs were removed at user request —
 * those workflows are owned by US Tow Fleet (the dedicated fleet-management
 * SaaS in the Blue Collar AI ecosystem). The /fleet/expirations,
 * /fleet/maintenance, and /fleet/dvirs routes still exist for direct-URL
 * access and any deep links, but they're no longer surfaced from the
 * sub-nav. When the US Tow Fleet integration ships, those routes will
 * either redirect to the SaaS or be removed entirely.
 */
const TABS: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: '/fleet/trucks', label: 'Trucks', match: (p) => p.startsWith('/fleet/trucks') },
  { href: '/fleet/drivers', label: 'Drivers', match: (p) => p.startsWith('/fleet/drivers') },
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
          <a
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
          </a>
        );
      })}
    </nav>
  );
}
