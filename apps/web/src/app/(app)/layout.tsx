import { SessionProvider } from '@/components/app-shell/session-provider';
import { AppSidebar } from '@/components/app-shell/sidebar';
import { AppTopbar } from '@/components/app-shell/topbar';
import { requireUser } from '@/lib/auth/session';
import { getRequestId } from '@/lib/debug/redirect-trace';
import { headers } from 'next/headers';
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
  // [FLEET_DEBUG_V2] — log every (app)/ render with rid + incoming path so we
  // can match server logs against the user's browser session. Revert when
  // root cause is fixed.
  const rid = getRequestId();
  const h = await headers();
  const path = h.get('x-current-path') ?? '(no x-current-path)';
  // eslint-disable-next-line no-console
  console.error(`[FLEET_DEBUG_V2 rid=${rid}] (app)/layout enter path=${path}`);
  const session = await requireUser();
  // eslint-disable-next-line no-console
  console.error(
    `[FLEET_DEBUG_V2 rid=${rid}] (app)/layout requireUser OK userId=${session.user.id} role=${session.user.role}`,
  );
  return (
    <SessionProvider value={session}>
      <div className="flex min-h-screen bg-steel text-text-primary">
        <AppSidebar tenant={session.tenant} user={session.user} />
        <div className="flex min-h-screen flex-1 flex-col">
          <AppTopbar />
          <main id="main-content" className="flex-1 overflow-y-auto bg-steel" tabIndex={-1}>
            <div className="mx-auto w-full max-w-7xl px-6 py-8 md:px-10">{children}</div>
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
