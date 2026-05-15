import { SessionProvider } from '@/components/app-shell/session-provider';
import { AppSidebar } from '@/components/app-shell/sidebar';
import { AppTopbar } from '@/components/app-shell/topbar';
import { requireUser } from '@/lib/auth/session';
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
  const session = await requireUser();
  return (
    <SessionProvider value={session}>
      <div className="flex min-h-screen bg-bg-base text-text-primary-on-dark">
        <AppSidebar tenant={session.tenant} user={session.user} />
        <div className="flex min-h-screen flex-1 flex-col">
          <AppTopbar />
          <main id="main-content" className="flex-1 overflow-y-auto bg-bg-base" tabIndex={-1}>
            <div className="mx-auto w-full max-w-7xl px-6 py-8 md:px-10">{children}</div>
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
