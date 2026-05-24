'use client';

import { NotificationBell } from '@/components/notifications/notification-bell';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { HelpCircle, Search } from 'lucide-react';
import Link from 'next/link';
import { useUser } from './session-provider';

export function AppTopbar(): JSX.Element {
  const user = useUser();
  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center justify-between border-b border-divider bg-bg-surface/95 px-6 backdrop-blur md:px-10">
      <div className="flex items-center gap-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          Operations Overview
        </h2>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-[8px] border border-divider bg-bg-surface-elevated/40 px-3 py-1.5 md:flex">
          <Search className="h-3.5 w-3.5 text-text-secondary-on-dark-on-dark/60" />
          <input
            type="search"
            placeholder="Search jobs, drivers, customers"
            className="w-56 bg-transparent text-xs text-text-primary-on-dark placeholder:text-text-secondary-on-dark-on-dark/60 focus:outline-none"
          />
        </div>
        <ThemeToggle />
        <Link
          href="/help"
          aria-label="Help center"
          title="Help center"
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-divider bg-bg-surface-elevated/40 text-text-secondary-on-dark transition-colors hover:text-text-primary-on-dark"
        >
          <HelpCircle className="h-4 w-4" />
        </Link>
        <NotificationBell />
        <div className="flex items-center gap-2 rounded-[8px] border border-divider bg-bg-surface-elevated/40 px-2 py-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary text-xs font-extrabold text-white">
            {(user.firstName?.[0] ?? '?').toUpperCase()}
          </div>
          <div className="hidden md:block">
            <p className="text-xs font-semibold leading-none text-text-primary-on-dark">
              {user.firstName} {user.lastName}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
              {user.role}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
