/**
 * 404 — not found. Routes that don't exist OR resources you can't see
 * (cross-tenant access) land here.
 *
 * Branded shell so the user knows they hit a real US Tow DISPATCH page and not
 * an upstream gateway misroute.
 */
import { Compass, Home, Search } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Not found — US Tow DISPATCH',
};

export default function NotFound(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-base px-6 py-12">
      <section
        role="alert"
        className="flex max-w-xl flex-col items-center rounded-lg border border-divider bg-bg-surface-elevated/40 px-6 py-12 text-center"
      >
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-bg-surface-elevated text-brand-primary">
          <Compass size={32} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-text-primary-on-dark">Page not found</h1>
        <p className="mb-6 max-w-md text-sm text-text-secondary-on-dark">
          The page you tried to open doesn't exist, or you don't have access. If you got here from a
          link inside US Tow DISPATCH, the record may have been deleted or moved to a different
          tenant.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-brand-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            <Home size={16} aria-hidden="true" /> Back to dashboard
          </Link>
          <Link
            href="/customers"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-divider bg-bg-surface-elevated px-4 text-sm font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            <Search size={16} aria-hidden="true" /> Search customers
          </Link>
        </div>
      </section>
    </main>
  );
}
