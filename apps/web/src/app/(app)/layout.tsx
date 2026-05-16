import { SessionProvider } from '@/components/app-shell/session-provider';
import { AppSidebar } from '@/components/app-shell/sidebar';
import { AppTopbar } from '@/components/app-shell/topbar';
import { getSessionToken, requireUser } from '@/lib/auth/session';
/**
 * Authenticated app shell.
 *
 * Server component: hits /auth/me. If unauthenticated the request bounces to
 * /login via requireUser(). Client interactions (sign out, search, etc.) are
 * inside the client components below.
 *
 * Layout pattern matches _reference/index.html:
 *   - 240px left sidebar with brand mark, navigation sections, company badge
 *   - 60px topbar with page title (slot), search, icons, notification dot
 *   - main content slot scrolls independently
 */
import type { ReactNode } from 'react';

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  // Session 9.7 — read the access cookie HERE, in the layout-render context
  // where cookies() actually works in Next 15 prod builds, so the result is
  // memoized in React.cache() and any descendant page that calls
  // getSessionToken() gets the value without re-invoking cookies(). See
  // BUILD_DECISIONS.md Session 9.7 and lib/auth/session.ts header comment.
  await getSessionToken();
  const session = await requireUser();
  return (
    <SessionProvider value={session}>
      <div className="flex min-h-screen bg-bg-base text-text-primary-on-dark">
        <AppSidebar tenant={session.tenant} user={session.user} />
        <div className="flex min-h-screen flex-1 flex-col">
          <AppTopbar />
          <main id="main-content" className="flex-1 overflow-y-auto bg-bg-base" tabIndex={-1}>
            {/*
              Content cap widened from max-w-7xl (1280px) to 1472px (≈+2 in
              at 96dpi) so the dense Services & Pricing table — and every
              other dense ops list (jobs, customers, billing/*) — stops
              crushing columns into each other on wide monitors. Bounded by
              viewport on smaller screens, so no horizontal scroll added on
              laptops. Revert to `max-w-7xl` if any page looks too sparse.
            */}
            <div className="mx-auto w-full max-w-[1472px] px-6 py-8 md:px-10">{children}</div>
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
