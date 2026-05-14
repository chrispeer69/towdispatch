import { getOptionalUser } from '@/lib/auth/session';
import { FleetTabs } from './fleet-tabs';

export const metadata = { title: 'Fleet — TowCommand' };

/**
 * /fleet/* uses a nested sub-layout to host the header + FleetTabs client
 * component. Without a sync point on auth, the client-component boundary in
 * FleetTabs can let this layout's HTML stream to the browser before the
 * outer (app)/layout.tsx's requireUser() has resolved — producing a visible
 * shell flash on no-session navigations before the redirect to /login lands.
 *
 * Awaiting the cached getOptionalUser() here creates that sync point. The
 * call is free: it shares its React.cache entry with (app)/layout, so there
 * is no extra /auth/me round trip. When the session is missing we render an
 * empty fragment so the outer layout's redirect wins cleanly. The (app)/
 * layout remains the only auth chokepoint — this is purely a streaming
 * guard, not a second redirect path.
 */
export default async function FleetLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const session = await getOptionalUser();
  if (!session) return <></>;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Fleet
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Trucks, drivers, expirations, maintenance, DVIR.
        </p>
      </header>
      <FleetTabs />
      <div>{children}</div>
    </div>
  );
}
