import { SessionProvider } from '@/components/app-shell/session-provider';
import { AppSidebar } from '@/components/app-shell/sidebar';
import { AppTopbar } from '@/components/app-shell/topbar';
import { requireUser } from '@/lib/auth/session';
import { getRequestId } from '@/lib/debug/request-id';
import type { MeResponse } from '@towcommand/shared';
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
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  // [FLEET_DEBUG] — temporary diagnostic. Revert after the fleet bounce is fixed.
  const rid = getRequestId();
  const h = await headers();
  const c = await cookies();
  const path = h.get('x-current-path') ?? '(no x-current-path header)';
  const referer = h.get('referer') ?? '(no referer)';
  const ua = (h.get('user-agent') ?? '').slice(0, 80);
  const cookieNames =
    c
      .getAll()
      .map((ck) => ck.name)
      .join(',') || '(none)';
  // eslint-disable-next-line no-console
  console.error(
    `[FLEET_DEBUG rid=${rid}] (app)/layout enter path=${path} referer=${referer} cookies=[${cookieNames}] ua="${ua}"`,
  );
  let session: MeResponse;
  try {
    session = await requireUser();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[FLEET_DEBUG rid=${rid}] (app)/layout requireUser threw type=${(err as { digest?: string })?.digest ?? typeof err} msg=${(err as Error)?.message ?? '?'} path=${path}`,
    );
    throw err;
  }
  // eslint-disable-next-line no-console
  console.error(
    `[FLEET_DEBUG rid=${rid}] (app)/layout requireUser OK userId=${session.user.id} tenantId=${session.tenant.id} path=${path}`,
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
