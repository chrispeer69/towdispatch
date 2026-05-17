'use client';

/**
 * Left-rail sub-nav for /settings.
 *
 * Active state mirrors the top-level sidebar pattern in
 * app-shell/sidebar.tsx: longest-matching-href wins via a per-item
 * `match(pathname)` predicate so a nested route like
 * /settings/users/123 still keeps the Users tab highlighted.
 */
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { SETTINGS_TABS, settingsTabHref } from './tabs';

export function SettingsSidebar(): JSX.Element {
  const pathname = usePathname() ?? '/settings';
  return (
    <aside className="w-full shrink-0 md:w-60">
      <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark/60">
        Settings
      </p>
      <ul className="space-y-0.5">
        {SETTINGS_TABS.map((tab) => {
          const href = settingsTabHref(tab.slug);
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={tab.slug}>
              <a
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center justify-between rounded-[8px] px-3 py-2 transition-colors',
                  isActive
                    ? 'bg-brand-primary/15 text-brand-primary'
                    : 'text-text-secondary-on-dark hover:bg-bg-surface-elevated hover:text-text-primary-on-dark',
                )}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute -left-3 top-1.5 h-6 w-1 rounded-r-full bg-brand-primary"
                  />
                ) : null}
                <span className="text-sm font-medium">{tab.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
