'use client';

import { Bell, HelpCircle, Search } from 'lucide-react';
import { useUser } from './session-provider';

export function AppTopbar(): JSX.Element {
  const user = useUser();
  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center justify-between border-b border-steel-border bg-steel-mid/95 px-6 backdrop-blur md:px-10">
      <div className="flex items-center gap-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
          Operations Overview
        </h2>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-[8px] border border-steel-border bg-steel-light/40 px-3 py-1.5 md:flex">
          <Search className="h-3.5 w-3.5 text-text-muted" />
          <input
            type="search"
            placeholder="Search jobs, drivers, customers"
            className="w-56 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>
        <button
          type="button"
          aria-label="Help"
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-steel-border bg-steel-light/40 text-text-secondary transition-colors hover:text-text-primary"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-[8px] border border-steel-border bg-steel-light/40 text-text-secondary transition-colors hover:text-text-primary"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-orange shadow-orange-glow" />
        </button>
        <div className="flex items-center gap-2 rounded-[8px] border border-steel-border bg-steel-light/40 px-2 py-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-orange text-xs font-extrabold text-white">
            {(user.firstName?.[0] ?? '?').toUpperCase()}
          </div>
          <div className="hidden md:block">
            <p className="text-xs font-semibold leading-none text-text-primary">
              {user.firstName} {user.lastName}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
              {user.role}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
