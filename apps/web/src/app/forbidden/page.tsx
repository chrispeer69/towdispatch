/**
 * 403 — forbidden. Authenticated user without the required role hits this
 * route via a redirect from middleware or a server-side role check.
 *
 * Never used for cross-tenant access (those go to /not-found). This page
 * is strictly for "you are who you say you are, but your role doesn't
 * allow this".
 */
import { Home, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Access denied — US Tow Dispatch',
};

export default function ForbiddenPage(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-base px-6 py-12">
      <section
        role="alert"
        className="flex max-w-xl flex-col items-center rounded-lg border border-amber-500/30 bg-amber-500/5 px-6 py-12 text-center"
      >
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
          <ShieldAlert size={32} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-text-primary-on-dark">Access denied</h1>
        <p className="mb-6 max-w-md text-sm text-text-secondary-on-dark">
          Your role doesn't have access to this page. If you think this is a mistake, ask an owner
          or admin on your team to update your role under Settings → Users.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-brand-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          <Home size={16} aria-hidden="true" /> Back to dashboard
        </Link>
      </section>
    </main>
  );
}
