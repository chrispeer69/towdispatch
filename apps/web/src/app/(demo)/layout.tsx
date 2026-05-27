/**
 * Demo route layout — no authentication required.
 *
 * This is a parallel route group to (app)/ that provides the same
 * sidebar + topbar shell but without requireUser() or SessionProvider.
 * All data is hardcoded mock data.
 */
import type { ReactNode } from 'react';
import { DemoSidebar } from './demo/demo-sidebar';
import { DemoTour } from './demo/demo-tour';

export default function DemoLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-screen bg-bg-base text-text-primary-on-dark">
      <DemoSidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Demo topbar */}
        <header className="sticky top-0 z-30 flex h-[60px] items-center justify-between border-b border-divider bg-bg-surface/80 px-6 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h2 className="font-condensed text-sm font-extrabold uppercase tracking-wide">
              Demo Environment
            </h2>
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-brand-primary/30 bg-brand-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-primary animate-pulse" />
              No data is saved
            </span>
          </div>
          <a
            href="/"
            className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-text-primary-on-dark transition-colors hover:border-brand-primary/40 hover:text-brand-primary"
          >
            ← Exit Demo
          </a>
        </header>
        <main id="main-content" className="flex-1 overflow-y-auto bg-bg-base" tabIndex={-1}>
          <div className="mx-auto w-full max-w-[1472px] px-6 py-8 md:px-10">{children}</div>
        </main>
      </div>
      <DemoTour />
    </div>
  );
}
